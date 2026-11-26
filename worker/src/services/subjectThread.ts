import {
  normalizeSubject,
  normalizeParticipant,
  THREAD_WINDOW_MS,
  withinThreadWindow,
} from './threadIdentity';

import {
  resolveHeaderThread,
  type ThreadHeaders,
  type HeaderThreadMatch,
} from './threadResolution';

export interface ThreadInput extends ThreadHeaders {
  subject: string;
  sender: string;
}

export interface SubjectThreadMatch {
  threadId: string;
  reason: 'subject-participant';
}

export type ThreadDecision =
  | HeaderThreadMatch
  | SubjectThreadMatch
  | {
      threadId: string;
      reason: 'new-thread';
    };

export async function resolveSubjectThread(
  db: D1Database,
  subject: string,
  sender: string,
  now = Date.now(),
): Promise<SubjectThreadMatch | null> {
  const normalizedSubject =
    normalizeSubject(subject);

  const participant =
    normalizeParticipant(sender);

  if (
    !normalizedSubject ||
    !participant ||
    !participant.includes('@') ||
    !Number.isSafeInteger(now) ||
    now < 0
  ) {
    return null;
  }

  const row = await db.prepare(`
    WITH participants AS (
      SELECT
        m.thread_id,
        m.from_addr AS address
      FROM messages m

      UNION ALL

      SELECT
        m.thread_id,
        json_extract(j.value, '$.addr')
      FROM messages m,
        json_each(m.to_addrs) j

      UNION ALL

      SELECT
        m.thread_id,
        json_extract(j.value, '$.addr')
      FROM messages m,
        json_each(m.cc_addrs) j

      UNION ALL

      SELECT
        m.thread_id,
        json_extract(j.value, '$.addr')
      FROM messages m,
        json_each(m.bcc_addrs) j
    )

    SELECT
      t.id AS threadId,
      t.last_message_at AS lastMessageAt

    FROM threads t

    WHERE t.subject = ?
      AND t.last_message_at >= ?
      AND t.last_message_at <= ?

      AND EXISTS (
        SELECT 1
        FROM participants p

        WHERE p.thread_id = t.id

          AND instr(p.address, '@') > 1

          AND (
            substr(
              p.address,
              1,
              instr(p.address, '@')
            )
            ||
            lower(
              substr(
                p.address,
                instr(p.address, '@') + 1
              )
            )
          ) = ?
      )

    ORDER BY
      t.last_message_at DESC,
      t.id ASC

    LIMIT 1
  `)
    .bind(
      normalizedSubject,
      Math.max(0, now - THREAD_WINDOW_MS),
      now,
      participant,
    )
    .first<{
      threadId: string;
      lastMessageAt: number;
    }>();

  if (
    !row ||
    !withinThreadWindow(
      row.lastMessageAt,
      now,
    )
  ) {
    return null;
  }

  return {
    threadId: row.threadId,
    reason: 'subject-participant',
  };
}

export async function resolveConversation(
  db: D1Database,
  input: ThreadInput,
  now = Date.now(),
): Promise<ThreadDecision> {
  const headerMatch =
    await resolveHeaderThread(db, input);

  if (headerMatch) return headerMatch;

  const subjectMatch =
    await resolveSubjectThread(
      db,
      input.subject,
      input.sender,
      now,
    );

  if (subjectMatch) return subjectMatch;

  return {
    threadId: crypto.randomUUID(),
    reason: 'new-thread',
  };
}
