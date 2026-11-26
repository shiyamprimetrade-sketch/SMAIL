import {
  buildContactStatement,
} from './contactPersistence';

import type {
  ParsedAttachment,
} from './mime';

import {
  buildAttachmentStatements,
} from './attachmentPersistence';

import type {
  MessageRecord,
} from './messageRecord';

import {
  findExistingMessage,
} from './deduplication';

export type PersistenceResult = {
  status: 'stored' | 'duplicate';
  messageId: string;
  threadId: string;
};

export function buildMessageStatements(
  db: D1Database,
  record: MessageRecord,
): D1PreparedStatement[] {
  const createThread = db.prepare(`
    INSERT INTO threads (
      id,
      subject,
      snippet,
      last_message_at,
      message_count
    )
    VALUES (?, ?, ?, ?, 0)
    ON CONFLICT(id) DO NOTHING
  `).bind(
    record.thread_id,
    record.thread_subject,
    record.snippet,
    record.received_at,
  );

  const insertMessage = db.prepare(`
    INSERT INTO messages (
      id,
      thread_id,
      message_id_header,
      in_reply_to,
      refs,
      from_name,
      from_addr,
      to_addrs,
      cc_addrs,
      bcc_addrs,
      reply_to,
      subject,
      text_body,
      html_body,
      snippet,
      folder,
      is_read,
      is_starred,
      has_attachments,
      direction,
      spam_score,
      raw_size,
      received_at,
      created_at,
      updated_at
    )
    VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?
    )
  `).bind(
    record.id,
    record.thread_id,
    record.message_id_header,
    record.in_reply_to,
    record.refs,
    record.from_name,
    record.from_addr,
    record.to_addrs,
    record.cc_addrs,
    record.bcc_addrs,
    record.reply_to,
    record.subject,
    record.text_body,
    record.html_body,
    record.snippet,
    record.folder,
    record.is_read,
    record.is_starred,
    record.has_attachments,
    record.direction,
    record.spam_score,
    record.raw_size,
    record.received_at,
    record.created_at,
    record.updated_at,
  );

  const updateThread = db.prepare(`
    UPDATE threads
    SET
      message_count = (
        SELECT COUNT(*)
        FROM messages
        WHERE thread_id = ?
      ),
      snippet = CASE
        WHEN last_message_at <= ?
        THEN ?
        ELSE snippet
      END,
      last_message_at = MAX(
        last_message_at,
        ?
      )
    WHERE id = ?
  `).bind(
    record.thread_id,
    record.received_at,
    record.snippet,
    record.received_at,
    record.thread_id,
  );

  return [
    createThread,
    insertMessage,
    updateThread,
  ];
}

export async function persistMessage(
  db: D1Database,
  record: MessageRecord,
  attachments: readonly ParsedAttachment[] = [],
): Promise<PersistenceResult> {
  if (
    record.has_attachments !==
    (attachments.length > 0 ? 1 : 0)
  ) {
    throw new Error(
      'Attachment metadata mismatch'
    );
  }

  const existing = await findExistingMessage(
    db,
    record.message_id_header,
  );

  if (existing) {
    return {
      status: 'duplicate',
      messageId: existing.id,
      threadId: existing.threadId,
    };
  }

  try {
    const messageStatements =
      buildMessageStatements(db, record);

    const attachmentStatements =
      buildAttachmentStatements(
        db,
        record.id,
        attachments,
      );

    const contactStatement =
      buildContactStatement(
        db,
        record.from_addr,
        record.from_name,
        record.received_at,
      );

    const statements = [
      messageStatements[0],
      messageStatements[1],
      ...attachmentStatements,
      messageStatements[2],
      ...(contactStatement
        ? [contactStatement]
        : []),
    ];

    const results = await db.batch(
      statements
    );

    if (
      results.length !== statements.length ||
      results.some(
        result => result.success !== true
      )
    ) {
      throw new Error(
        'Message persistence batch failed'
      );
    }

    return {
      status: 'stored',
      messageId: record.id,
      threadId: record.thread_id,
    };

  } catch (error) {
    // A concurrent delivery may have inserted
    // the same Message-ID before this batch.

    if (record.message_id_header) {
      const duplicate =
        await findExistingMessage(
          db,
          record.message_id_header,
        );

      if (duplicate) {
        return {
          status: 'duplicate',
          messageId: duplicate.id,
          threadId: duplicate.threadId,
        };
      }
    }

    throw error;
  }
}
