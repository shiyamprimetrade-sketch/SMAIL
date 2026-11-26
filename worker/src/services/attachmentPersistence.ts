import {
  MAX_ATTACHMENT_BYTES,
  truncateUtf8,
  type ParsedAttachment,
} from './mime';

export const MAX_STORED_FILENAME_BYTES = 512;

export interface AttachmentRecord {
  id: string;
  message_id: string;
  filename: string;
  mime: string;
  size: number;
  content_id: string | null;
  is_inline: number;
  data: ArrayBuffer;
}

export function safeAttachmentFilename(
  filename: string,
): string {
  const cleaned = filename
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '_')
    .trim();

  const bounded = truncateUtf8(
    cleaned,
    MAX_STORED_FILENAME_BYTES,
  );

  if (
    !bounded ||
    bounded === '.' ||
    bounded === '..'
  ) {
    return 'attachment';
  }

  return bounded;
}

export function safeAttachmentMime(
  mime: string,
): string {
  const value = mime.trim().toLowerCase();

  if (
    value.length > 255 ||
    !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/
      .test(value)
  ) {
    return 'application/octet-stream';
  }

  return value;
}

export function prepareAttachmentRecord(
  messageId: string,
  attachment: ParsedAttachment,
): AttachmentRecord {
  if (!messageId.trim()) {
    throw new Error(
      'Missing attachment message identifier'
    );
  }

  if (!(attachment.data instanceof Uint8Array)) {
    throw new Error(
      'Invalid attachment binary data'
    );
  }

  if (
    attachment.size !==
    attachment.data.byteLength
  ) {
    throw new Error(
      'Attachment size mismatch'
    );
  }

  if (
    attachment.data.byteLength >
    MAX_ATTACHMENT_BYTES
  ) {
    throw new Error(
      'Attachment exceeds storage limit'
    );
  }

  const data = new ArrayBuffer(
    attachment.data.byteLength
  );

  new Uint8Array(data).set(
    attachment.data
  );

  return {
    id: crypto.randomUUID(),
    message_id: messageId,
    filename: safeAttachmentFilename(
      attachment.filename
    ),
    mime: safeAttachmentMime(
      attachment.mime
    ),
    size: attachment.data.byteLength,
    content_id: attachment.contentId
      ? truncateUtf8(
          attachment.contentId.replace(
            /[\u0000-\u001f\u007f]/g,
            '',
          ),
          998,
        ) || null
      : null,
    is_inline: attachment.isInline ? 1 : 0,
    data,
  };
}

export function buildAttachmentStatements(
  db: D1Database,
  messageId: string,
  attachments: readonly ParsedAttachment[],
): D1PreparedStatement[] {
  return attachments.map(attachment => {
    const record = prepareAttachmentRecord(
      messageId,
      attachment,
    );

    return db.prepare(`
      INSERT INTO attachments (
        id,
        message_id,
        filename,
        mime,
        size,
        content_id,
        is_inline,
        data
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      record.id,
      record.message_id,
      record.filename,
      record.mime,
      record.size,
      record.content_id,
      record.is_inline,
      record.data,
    );
  });
}
