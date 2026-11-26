import {
  normalizeMessageId,
  referenceCandidates,
} from './threadIdentity';

import {
  findExistingMessage,
} from './deduplication';

export const MAX_REFERENCE_LOOKUPS = 64;

export interface ThreadHeaders {
  inReplyTo?: string | null;
  references?: readonly string[];
}

export interface HeaderThreadMatch {
  threadId: string;
  matchedMessageId: string;
  reason: 'in-reply-to' | 'references';
}

export async function resolveHeaderThread(
  db: D1Database,
  headers: ThreadHeaders,
): Promise<HeaderThreadMatch | null> {
  const parentId = normalizeMessageId(
    headers.inReplyTo
  );

  if (parentId) {
    const parent = await findExistingMessage(
      db,
      parentId,
    );

    if (parent) {
      return {
        threadId: parent.threadId,
        matchedMessageId: parent.messageId,
        reason: 'in-reply-to',
      };
    }
  }

  const candidates = referenceCandidates(
    headers.references ?? [],
  )
    .filter(id => id !== parentId)
    .slice(0, MAX_REFERENCE_LOOKUPS);

  for (const candidate of candidates) {
    const match = await findExistingMessage(
      db,
      candidate,
    );

    if (match) {
      return {
        threadId: match.threadId,
        matchedMessageId: match.messageId,
        reason: 'references',
      };
    }
  }

  return null;
}
