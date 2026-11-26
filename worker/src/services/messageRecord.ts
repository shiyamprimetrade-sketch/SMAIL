import type {
  PreparedEmail,
} from './inbound';

import type {
  EmailAddress,
} from './mime';

import {
  truncateUtf8,
  MAX_BODY_BYTES,
} from './mime';

import {
  normalizeMessageId,
  normalizeParticipant,
  normalizeSubject,
  referenceCandidates,
} from './threadIdentity';

import type {
  SpamDecision,
} from './spam';

export const MAX_SNIPPET_BYTES = 240;

export interface StoredAddress {
  name: string;
  addr: string;
}

export function serializeAddresses(
  addresses: readonly EmailAddress[],
): string {
  return JSON.stringify(
    addresses.map(address => ({
      name: address.name,
      addr: normalizeParticipant(
        address.address
      ),
    }))
  );
}

export function createMessageSnippet(
  text: string,
): string {
  return truncateUtf8(
    text.replace(/\s+/gu, ' ').trim(),
    MAX_SNIPPET_BYTES,
  );
}

export function prepareMessageRecord(
  email: PreparedEmail,
  threadId: string,
  decision: SpamDecision,
  now = Date.now(),
) {
  if (
    !Number.isSafeInteger(now) ||
    now < 0
  ) {
    throw new Error(
      'Invalid message timestamp'
    );
  }

  if (!threadId.trim()) {
    throw new Error(
      'Invalid thread identifier'
    );
  }

  if (
    !Number.isFinite(decision.score) ||
    decision.score < -3 ||
    decision.score > 9
  ) {
    throw new Error(
      'Invalid spam score'
    );
  }

  if (
    decision.folder !==
    (decision.score >= 5 ? 'spam' : 'inbox')
  ) {
    throw new Error(
      'Inconsistent spam decision'
    );
  }

  const sender = normalizeParticipant(
    email.from.address
  );

  if (!sender) {
    throw new Error(
      'Missing sender address'
    );
  }

  const text = truncateUtf8(
    email.text,
    MAX_BODY_BYTES,
  );

  const html = truncateUtf8(
    email.html,
    MAX_BODY_BYTES,
  );

  const references = referenceCandidates(
    email.references
  ).reverse();

  return {
    id: crypto.randomUUID(),

    thread_id: threadId,

    thread_subject: normalizeSubject(
      email.subject
    ),

    message_id_header: normalizeMessageId(
      email.messageId
    ),

    in_reply_to: normalizeMessageId(
      email.inReplyTo
    ),

    refs: references.length
      ? references.join(' ')
      : null,

    from_name: email.from.name,

    from_addr: sender,

    to_addrs: serializeAddresses(
      email.to
    ),

    cc_addrs: serializeAddresses(
      email.cc
    ),

    bcc_addrs: serializeAddresses(
      email.bcc
    ),

    reply_to: email.replyTo.length
      ? serializeAddresses(email.replyTo)
      : null,

    subject: email.subject,

    text_body: text,

    html_body: html,

    snippet: createMessageSnippet(text),

    folder: decision.folder,

    is_read: 0,

    is_starred: 0,

    has_attachments:
      email.attachments.length > 0 ? 1 : 0,

    direction: 'in' as const,

    spam_score: decision.score,

    raw_size: email.rawSize,

    received_at: now,

    created_at: now,

    updated_at: now,
  };
}

export type MessageRecord = ReturnType<
  typeof prepareMessageRecord
>;
