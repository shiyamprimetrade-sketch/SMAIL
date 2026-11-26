import {
  prepareInboundEmail,
  type PreparedEmail,
} from './inbound';

import {
  truncateUtf8,
  EmailTooLargeError,
} from './mime';

import {
  normalizeMessageId,
} from './threadIdentity';

import {
  findExistingMessage,
} from './deduplication';

import {
  resolveConversation,
} from './subjectThread';

import {
  classifySecureInboundSpam,
} from './secureSpamClassifier';

import {
  prepareMessageRecord,
} from './messageRecord';

import {
  persistMessage,
} from './messagePersistence';

export interface InboundInput {
  raw: ReadableStream<Uint8Array>;
  envelopeFrom: string;
  envelopeTo: string;
  rawSubject?: string | null;
  rawMessageId?: string | null;
  rawSize?: number;
  receivedAt?: number;
}

export type InboundResult =
  | {
      status: 'stored' | 'duplicate';
      messageId: string;
      threadId: string;
      recovered: boolean;
    }
  | {
      status: 'rejected';
      reason: 'email_too_large';
    }
  | {
      status: 'failed';
      reason: 'processing_failed';
    };

function safeMetadata(
  value: string,
  limit: number,
): string {
  return truncateUtf8(
    value
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .trim(),
    limit,
  );
}

export function createFallbackEmail(
  input: InboundInput,
): PreparedEmail {
  const sender = safeMetadata(
    input.envelopeFrom,
    320,
  ) || 'unknown-sender';

  const recipient = safeMetadata(
    input.envelopeTo,
    320,
  );

  const subject = safeMetadata(
    input.rawSubject ?? '',
    998,
  ) || '[Email recovery]';

  const rawSize =
    typeof input.rawSize === 'number' &&
    Number.isSafeInteger(input.rawSize) &&
    input.rawSize >= 0
      ? input.rawSize
      : 0;

  return {
    from: {
      name: '',
      address: sender,
    },
    to: recipient
      ? [{
          name: '',
          address: recipient,
        }]
      : [],
    cc: [],
    bcc: [],
    replyTo: [],
    subject,
    messageId: normalizeMessageId(
      input.rawMessageId ?? null
    ),
    inReplyTo: null,
    references: [],
    text: [
      '[SMAIL email recovery]',
      '',
      'The original email could not be parsed.',
      'Its available metadata has been preserved.',
      'The original content and attachments are not available in this record.',
    ].join('\n'),
    html: '',
    attachments: [],
    omittedAttachments: [],
    rawSize,
    htmlRemoved: false,
  };
}

export async function processInboundEmail(
  db: D1Database,
  input: InboundInput,
): Promise<InboundResult> {
  try {
    const now =
      input.receivedAt ?? Date.now();

    let prepared: PreparedEmail;
    let recovered = false;

    try {
      prepared = await prepareInboundEmail(
        input.raw,
        input.envelopeFrom,
      );

    } catch (error) {
      if (error instanceof EmailTooLargeError) {
        return {
          status: 'rejected',
          reason: 'email_too_large',
        };
      }

      prepared = createFallbackEmail(input);
      recovered = true;
    }

    if (!prepared.from.address.trim()) {
      prepared.from.address =
        safeMetadata(
          input.envelopeFrom,
          320,
        ) || 'unknown-sender';
    }

    const existing = await findExistingMessage(
      db,
      prepared.messageId,
    );

    if (existing) {
      return {
        status: 'duplicate',
        messageId: existing.id,
        threadId: existing.threadId,
        recovered,
      };
    }

    const conversation =
      await resolveConversation(
        db,
        {
          subject: prepared.subject,
          sender: prepared.from.address,
          inReplyTo: prepared.inReplyTo,
          references: prepared.references,
        },
        now,
      );

    // Raw email authentication headers are
    // not treated as trusted provider evidence.

    const decision =
      await classifySecureInboundSpam(
        db,
        {
          sender: prepared.from.address,
          subject: prepared.subject,
          text: prepared.text,
          senderIdentityVerified: false,
          authentication: {
            trusted: false,
          },
        },
      );

    const record = prepareMessageRecord(
      prepared,
      conversation.threadId,
      decision,
      now,
    );

    const result = await persistMessage(
      db,
      record,
      prepared.attachments,
    );

    return {
      ...result,
      recovered,
    };

  } catch {
    // Do not expose email contents, credentials
    // or internal database errors in results.

    return {
      status: 'failed',
      reason: 'processing_failed',
    };
  }
}
