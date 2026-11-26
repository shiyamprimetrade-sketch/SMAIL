import PostalMime from 'postal-mime';

import {
  readBoundedStream,
  MAX_RAW_EMAIL_BYTES,
  EmailTooLargeError,
} from './streams';

export const MAX_BODY_BYTES = 500_000;
export const MAX_ATTACHMENT_BYTES = 1_500_000;

export interface EmailAddress {
  name: string;
  address: string;
}

export interface ParsedAttachment {
  filename: string;
  mime: string;
  contentId: string | null;
  isInline: boolean;
  size: number;
  data: Uint8Array;
}

export interface ParsedEmail {
  from: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  replyTo: EmailAddress[];
  subject: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  text: string;
  html: string;
  attachments: ParsedAttachment[];
  omittedAttachments: string[];
  rawSize: number;
}

export function truncateUtf8(
  value: string,
  limit = MAX_BODY_BYTES,
): string {
  const encoded = new TextEncoder().encode(value);

  if (encoded.byteLength <= limit) {
    return value;
  }

  let end = limit;

  while (
    end > 0 &&
    (encoded[end] & 0xc0) === 0x80
  ) {
    end--;
  }

  return new TextDecoder().decode(
    encoded.subarray(0, end)
  );
}

type AddressInput = {
  name?: string;
  address?: string;
  group?: AddressInput[];
};

function addresses(
  values: AddressInput[] | undefined,
): EmailAddress[] {
  const result: EmailAddress[] = [];

  for (const value of values ?? []) {
    if (value.group) {
      result.push(...addresses(value.group));
    } else if (value.address) {
      result.push({
        name: value.name ?? '',
        address: value.address.trim(),
      });
    }
  }

  return result;
}

export async function parseEmail(
  stream: ReadableStream<Uint8Array>,
  envelopeFrom: string,
): Promise<ParsedEmail> {
  const raw = await readBoundedStream(
    stream,
    MAX_RAW_EMAIL_BYTES,
  );

  if (raw.byteLength === 0) {
    throw new Error('Empty email');
  }

  const parsed = await PostalMime.parse(raw);

  const attachments: ParsedAttachment[] = [];
  const omittedAttachments: string[] = [];

  for (const attachment of parsed.attachments) {
    const filename =
      attachment.filename || 'attachment';

    if (typeof attachment.content === 'string') {
      throw new Error(
        'Unexpected attachment encoding'
      );
    }

    const data = new Uint8Array(
      attachment.content
    );

    if (data.byteLength > MAX_ATTACHMENT_BYTES) {
      omittedAttachments.push(filename);
      continue;
    }

    attachments.push({
      filename,
      mime: attachment.mimeType ||
        'application/octet-stream',
      contentId: attachment.contentId || null,
      isInline:
        attachment.disposition === 'inline',
      size: data.byteLength,
      data,
    });
  }

  const from = addresses(
    parsed.from ? [parsed.from] : []
  )[0] ?? {
    name: '',
    address: envelopeFrom,
  };

  return {
    from,
    to: addresses(parsed.to),
    cc: addresses(parsed.cc),
    bcc: addresses(parsed.bcc),
    replyTo: addresses(parsed.replyTo),
    subject: parsed.subject ?? '',
    messageId: parsed.messageId || null,
    inReplyTo: parsed.inReplyTo || null,
    references:
      parsed.references?.match(/<[^<>]+>/g) ?? [],
    text: truncateUtf8(parsed.text ?? ''),
    html: truncateUtf8(parsed.html ?? ''),
    attachments,
    omittedAttachments,
    rawSize: raw.byteLength,
  };
}

export {
  EmailTooLargeError,
  MAX_RAW_EMAIL_BYTES,
};
