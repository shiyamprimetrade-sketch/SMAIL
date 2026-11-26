import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  resolveSubjectThread,
  resolveConversation,
} from '../src/services/subjectThread';

import {
  THREAD_WINDOW_MS,
} from '../src/services/threadIdentity';

const now = 1800000000000;

const existing = {
  threadId: 'thread-001',
  lastMessageAt: now,
};

function mockDatabase(
  result: unknown = null,
) {
  const first = vi.fn()
    .mockResolvedValue(result);

  const bind = vi.fn()
    .mockReturnValue({ first });

  const prepare = vi.fn()
    .mockReturnValue({ bind });

  return {
    db: {
      prepare,
    } as unknown as D1Database,
    first,
    bind,
    prepare,
  };
}

describe('Subject and participant matching', () => {
  it('resolves matching conversations', async () => {
    const { db } = mockDatabase(existing);

    expect(await resolveSubjectThread(
      db,
      'Invoice',
      'sender@example.com',
      now,
    )).toEqual({
      threadId: 'thread-001',
      reason: 'subject-participant',
    });
  });

  it('normalizes subject prefixes', async () => {
    const { db, bind } = mockDatabase(existing);

    await resolveSubjectThread(
      db,
      'RE: FWD: Invoice',
      'sender@example.com',
      now,
    );

    expect(bind).toHaveBeenCalledWith(
      'invoice',
      now - THREAD_WINDOW_MS,
      now,
      'sender@example.com',
    );
  });

  it('normalizes participant domain', async () => {
    const { db, bind } = mockDatabase();

    await resolveSubjectThread(
      db,
      'Invoice',
      'Sender@EXAMPLE.COM',
      now,
    );

    expect(bind).toHaveBeenCalledWith(
      'invoice',
      now - THREAD_WINDOW_MS,
      now,
      'Sender@example.com',
    );
  });

  it('returns null without matching records', async () => {
    const { db } = mockDatabase();

    expect(await resolveSubjectThread(
      db,
      'Invoice',
      'sender@example.com',
      now,
    )).toBeNull();
  });

  it.each([
    ['', 'sender@example.com'],
    ['RE:', 'sender@example.com'],
    ['Invoice', ''],
    ['Invoice', 'invalid'],
  ])('skips invalid input %#', async (
    subject,
    sender,
  ) => {
    const { db, prepare } = mockDatabase();

    expect(await resolveSubjectThread(
      db,
      subject,
      sender,
      now,
    )).toBeNull();

    expect(prepare).not.toHaveBeenCalled();
  });

  it('accepts the exact 30-day boundary', async () => {
    const { db } = mockDatabase({
      ...existing,
      lastMessageAt: now - THREAD_WINDOW_MS,
    });

    expect(await resolveSubjectThread(
      db,
      'Invoice',
      'sender@example.com',
      now,
    )).not.toBeNull();
  });

  it('rejects expired conversations', async () => {
    const { db } = mockDatabase({
      ...existing,
      lastMessageAt:
        now - THREAD_WINDOW_MS - 1,
    });

    expect(await resolveSubjectThread(
      db,
      'Invoice',
      'sender@example.com',
      now,
    )).toBeNull();
  });

  it('rejects future conversations', async () => {
    const { db } = mockDatabase({
      ...existing,
      lastMessageAt: now + 1,
    });

    expect(await resolveSubjectThread(
      db,
      'Invoice',
      'sender@example.com',
      now,
    )).toBeNull();
  });

  it('queries all participant categories', async () => {
    const { db, prepare } = mockDatabase();

    await resolveSubjectThread(
      db,
      'Invoice',
      'sender@example.com',
      now,
    );

    const sql = prepare.mock.calls[0][0];

    for (const column of [
      'from_addr',
      'to_addrs',
      'cc_addrs',
      'bcc_addrs',
    ]) {
      expect(sql).toContain(column);
    }
  });

  it('uses deterministic conversation ordering', async () => {
    const { db, prepare } = mockDatabase();

    await resolveSubjectThread(
      db,
      'Invoice',
      'sender@example.com',
      now,
    );

    const sql = prepare.mock.calls[0][0];

    expect(sql).toContain(
      't.last_message_at DESC'
    );

    expect(sql).toContain('t.id ASC');
    expect(sql).toContain('LIMIT 1');
  });

  it('uses parameterized SQL', async () => {
    const { db, prepare, bind } =
      mockDatabase();

    const subject = "invoice' OR 1=1 --";

    await resolveSubjectThread(
      db,
      subject,
      'sender@example.com',
      now,
    );

    expect(
      prepare.mock.calls[0][0]
    ).not.toContain(subject);

    expect(bind.mock.calls[0][0]).toBe(
      subject.toLowerCase()
    );
  });

  it('propagates database errors', async () => {
    const { db, first } = mockDatabase();

    first.mockRejectedValueOnce(
      new Error('Database unavailable')
    );

    await expect(resolveSubjectThread(
      db,
      'Invoice',
      'sender@example.com',
      now,
    )).rejects.toThrow(
      'Database unavailable'
    );
  });
});

describe('Complete conversation decision', () => {
  const input = {
    subject: 'Invoice',
    sender: 'sender@example.com',
  };

  it('prioritizes header matches', async () => {
    const { db, prepare } = mockDatabase({
      id: 'message-001',
      threadId: 'parent-thread',
      messageId: '<parent@example.com>',
    });

    const result = await resolveConversation(
      db,
      {
        ...input,
        inReplyTo: '<parent@example.com>',
      },
      now,
    );

    expect(result.reason).toBe('in-reply-to');

    expect(result.threadId).toBe(
      'parent-thread'
    );

    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it('falls back to subject matching', async () => {
    const { db, first } = mockDatabase();

    first
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);

    const result = await resolveConversation(
      db,
      {
        ...input,
        inReplyTo: '<unknown@example.com>',
      },
      now,
    );

    expect(result.reason).toBe(
      'subject-participant'
    );

    expect(result.threadId).toBe(
      'thread-001'
    );
  });

  it('allocates a new conversation identity', async () => {
    const { db } = mockDatabase();

    const result = await resolveConversation(
      db,
      input,
      now,
    );

    expect(result.reason).toBe('new-thread');

    expect(result.threadId).toMatch(
      /^[0-9a-f-]{36}$/
    );
  });

  it('allocates distinct new identities', async () => {
    const { db } = mockDatabase();

    const first = await resolveConversation(
      db,
      input,
      now,
    );

    const second = await resolveConversation(
      db,
      input,
      now,
    );

    expect(first.threadId).not.toBe(
      second.threadId
    );
  });
});
