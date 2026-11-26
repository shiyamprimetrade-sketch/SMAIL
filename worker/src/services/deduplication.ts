import {
  normalizeMessageId,
} from './threadIdentity';

export interface ExistingMessage {
  id: string;
  threadId: string;
  messageId: string;
}

export async function findExistingMessage(
  db: D1Database,
  messageId: string | null | undefined,
): Promise<ExistingMessage | null> {
  const normalized = normalizeMessageId(
    messageId
  );

  if (!normalized) return null;

  return db.prepare(`
    SELECT
      id,
      thread_id AS threadId,
      message_id_header AS messageId
    FROM messages
    WHERE message_id_header = ?
    LIMIT 1
  `)
    .bind(normalized)
    .first<ExistingMessage>();
}

export async function isDuplicateMessage(
  db: D1Database,
  messageId: string | null | undefined,
): Promise<boolean> {
  return (
    await findExistingMessage(db, messageId)
  ) !== null;
}
