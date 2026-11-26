import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  MAX_REFERENCE_LOOKUPS,
  resolveHeaderThread,
} from '../src/services/threadResolution';

import type {
  ExistingMessage,
} from '../src/services/deduplication';

const parent = '<parent@example.com>';
const root = '<root@example.com>';
const recent = '<recent@example.com>';

function record(
  messageId: string,
  threadId = 'thread-001',
): ExistingMessage {
  return {
    id: `record-${messageId}`,
    threadId,
    messageId,
  };
}

function mockDatabase(
  records: ExistingMessage[] = [],
) {
  const entries = new Map(
    records.map(item => [
      item.messageId,
      item,
    ]),
  );

  const lookups: string[] = [];

  const bind = vi.fn((id: string) => {
    lookups.push(id);

    return {
      first: vi.fn().mockResolvedValue(
        entries.get(id) ?? null
      ),
    };
  });

  const prepare = vi.fn().mockReturnValue({
    bind,
  });

  return {
    db: {
      prepare,
    } as unknown as D1Database,
    prepare,
    bind,
    lookups,
  };
}

describe('Header-based conversation resolution', () => {
  it('resolves a direct reply', async () => {
    const { db } = mockDatabase([
      record(parent),
    ]);

    expect(await resolveHeaderThread(db, {
      inReplyTo: parent,
    })).toEqual({
      threadId: 'thread-001',
      matchedMessageId: parent,
      reason: 'in-reply-to',
    });
  });

  it('prioritizes direct replies over references', async () => {
    const { db, lookups } = mockDatabase([
      record(parent, 'thread-parent'),
      record(root, 'thread-root'),
    ]);

    const result = await resolveHeaderThread(
      db,
      {
        inReplyTo: parent,
        references: [root],
      },
    );

    expect(result?.threadId).toBe(
      'thread-parent'
    );

    expect(lookups).toEqual([parent]);
  });

  it('falls back to references', async () => {
    const { db } = mockDatabase([
      record(root),
    ]);

    expect(await resolveHeaderThread(db, {
      inReplyTo: parent,
      references: [root],
    })).toEqual({
      threadId: 'thread-001',
      matchedMessageId: root,
      reason: 'references',
    });
  });

  it('resolves references without a parent', async () => {
    const { db } = mockDatabase([
      record(root),
    ]);

    const result = await resolveHeaderThread(
      db,
      { references: [root] },
    );

    expect(result?.matchedMessageId).toBe(root);
  });

  it('prefers the most recent matching reference', async () => {
    const { db } = mockDatabase([
      record(root, 'thread-root'),
      record(recent, 'thread-recent'),
    ]);

    const result = await resolveHeaderThread(
      db,
      { references: [root, recent] },
    );

    expect(result?.threadId).toBe(
      'thread-recent'
    );
  });

  it('continues past unmatched references', async () => {
    const { db, lookups } = mockDatabase([
      record(root),
    ]);

    const result = await resolveHeaderThread(
      db,
      { references: [root, recent] },
    );

    expect(result?.matchedMessageId).toBe(root);

    expect(lookups).toEqual([
      recent,
      root,
    ]);
  });

  it('returns null when no relationship exists', async () => {
    const { db } = mockDatabase();

    expect(await resolveHeaderThread(db, {
      inReplyTo: parent,
      references: [root, recent],
    })).toBeNull();
  });

  it('avoids database access for empty headers', async () => {
    const { db, prepare } = mockDatabase();

    expect(
      await resolveHeaderThread(db, {})
    ).toBeNull();

    expect(prepare).not.toHaveBeenCalled();
  });

  it('ignores malformed relationship headers', async () => {
    const { db, lookups } = mockDatabase();

    expect(await resolveHeaderThread(db, {
      inReplyTo: 'invalid',
      references: ['bad', '', '<a b>'],
    })).toBeNull();

    expect(lookups).toEqual([]);
  });

  it('does not repeat the parent lookup', async () => {
    const { db, lookups } = mockDatabase();

    await resolveHeaderThread(db, {
      inReplyTo: parent,
      references: [root, parent],
    });

    expect(lookups).toEqual([
      parent,
      root,
    ]);
  });

  it('deduplicates repeated references', async () => {
    const { db, lookups } = mockDatabase();

    await resolveHeaderThread(db, {
      references: [
        root,
        recent,
        root,
        recent,
      ],
    });

    expect(lookups).toEqual([
      recent,
      root,
    ]);
  });

  it('normalizes surrounding whitespace', async () => {
    const { db, lookups } = mockDatabase([
      record(parent),
    ]);

    const result = await resolveHeaderThread(
      db,
      {
        inReplyTo: `  ${parent}  `,
      },
    );

    expect(result?.matchedMessageId).toBe(parent);

    expect(lookups).toEqual([parent]);
  });

  it('bounds reference database operations', async () => {
    const { db, lookups } = mockDatabase();

    const references = Array.from(
      { length: 1000 },
      (_, i) => `<reference-${i}@example.com>`,
    );

    await resolveHeaderThread(db, {
      references,
    });

    expect(lookups).toHaveLength(
      MAX_REFERENCE_LOOKUPS
    );

    expect(lookups[0]).toBe(
      references[999]
    );
  });

  it('propagates database failures', async () => {
    const { db, prepare } = mockDatabase();

    prepare.mockImplementationOnce(() => {
      throw new Error('Database unavailable');
    });

    await expect(
      resolveHeaderThread(db, {
        inReplyTo: parent,
      }),
    ).rejects.toThrow(
      'Database unavailable'
    );
  });

  it('stops after the first reference match', async () => {
    const { db, lookups } = mockDatabase([
      record(root),
      record(recent),
    ]);

    await resolveHeaderThread(db, {
      references: [root, recent],
    });

    expect(lookups).toEqual([recent]);
  });
});
