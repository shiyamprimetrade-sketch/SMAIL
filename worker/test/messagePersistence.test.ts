import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  buildMessageStatements,
  persistMessage,
} from '../src/services/messagePersistence';

import type {
  MessageRecord,
} from '../src/services/messageRecord';

const NOW = 1800000000000;

function record(
  overrides: Partial<MessageRecord> = {},
): MessageRecord {
  return {
    id: 'message-test',
    thread_id: 'thread-test',
    thread_subject: 'invoice',
    message_id_header: '<test@example.com>',
    in_reply_to: null,
    refs: null,
    from_name: 'Customer',
    from_addr: 'customer@example.com',
    to_addrs: '[]',
    cc_addrs: '[]',
    bcc_addrs: '[]',
    reply_to: null,
    subject: 'Invoice',
    text_body: 'Business correspondence.',
    html_body: '<p>Business correspondence.</p>',
    snippet: 'Business correspondence.',
    folder: 'inbox',
    is_read: 0,
    is_starred: 0,
    has_attachments: 0,
    direction: 'in',
    spam_score: 0,
    raw_size: 1024,
    received_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function mockDatabase() {
  const first = vi.fn()
    .mockResolvedValue(null);

  const statements: {
    sql: string;
    values: unknown[];
  }[] = [];

  const prepare = vi.fn(
    (sql: string) => ({
      bind: (...values: unknown[]) => {
        const statement = {
          sql,
          values,
          first,
        };

        statements.push(statement);

        return statement;
      },
    })
  );

  const batch = vi.fn()
    .mockResolvedValue([
      { success: true },
      { success: true },
      { success: true },
    ]);

  return {
    db: {
      prepare,
      batch,
    } as unknown as D1Database,
    prepare,
    batch,
    first,
    statements,
  };
}

describe('Atomic message statement construction', () => {
  it('creates exactly three statements', () => {
    const { db } = mockDatabase();

    expect(buildMessageStatements(
      db,
      record(),
    )).toHaveLength(3);
  });

  it('creates the thread before the message', () => {
    const { db, statements } =
      mockDatabase();

    buildMessageStatements(db, record());

    expect(statements[0].sql)
      .toContain('INSERT INTO threads');

    expect(statements[1].sql)
      .toContain('INSERT INTO messages');
  });

  it('reuses existing conversations', () => {
    const { db, statements } =
      mockDatabase();

    buildMessageStatements(db, record());

    expect(statements[0].sql)
      .toContain('ON CONFLICT(id) DO NOTHING');
  });

  it('initializes new thread count to zero', () => {
    const { db, statements } =
      mockDatabase();

    buildMessageStatements(db, record());

    expect(statements[0].sql)
      .toContain('VALUES (?, ?, ?, ?, 0)');
  });

  it('binds the correct thread metadata', () => {
    const { db, statements } =
      mockDatabase();

    buildMessageStatements(db, record());

    expect(statements[0].values).toEqual([
      'thread-test',
      'invoice',
      'Business correspondence.',
      NOW,
    ]);
  });

  it('binds all 25 message fields', () => {
    const { db, statements } =
      mockDatabase();

    buildMessageStatements(db, record());

    expect(statements[1].values)
      .toHaveLength(25);

    expect(
      statements[1].sql.match(/\?/g)
    ).toHaveLength(25);
  });

  it('preserves exact message field order', () => {
    const { db, statements } =
      mockDatabase();

    buildMessageStatements(db, record());

    expect(statements[1].values).toEqual([
      'message-test',
      'thread-test',
      '<test@example.com>',
      null,
      null,
      'Customer',
      'customer@example.com',
      '[]',
      '[]',
      '[]',
      null,
      'Invoice',
      'Business correspondence.',
      '<p>Business correspondence.</p>',
      'Business correspondence.',
      'inbox',
      0,
      0,
      0,
      'in',
      0,
      1024,
      NOW,
      NOW,
      NOW,
    ]);
  });

  it('uses parameterized message content', () => {
    const { db, statements } =
      mockDatabase();

    const text = "Customer's invoice";

    buildMessageStatements(db, record({
      text_body: text,
    }));

    expect(statements[1].sql)
      .not.toContain(text);

    expect(statements[1].values)
      .toContain(text);
  });

  it('updates thread after message insertion', () => {
    const { db, statements } =
      mockDatabase();

    buildMessageStatements(db, record());

    expect(statements[2].sql)
      .toContain('UPDATE threads');
  });

  it('recalculates actual conversation count', () => {
    const { db, statements } =
      mockDatabase();

    buildMessageStatements(db, record());

    expect(statements[2].sql)
      .toContain('SELECT COUNT(*)');
  });

  it('prevents timestamp regression', () => {
    const { db, statements } =
      mockDatabase();

    buildMessageStatements(db, record());

    expect(statements[2].sql)
      .toContain('last_message_at = MAX');
  });

  it('protects latest conversation snippet', () => {
    const { db, statements } =
      mockDatabase();

    buildMessageStatements(db, record());

    expect(statements[2].sql)
      .toContain('WHEN last_message_at <= ?');
  });

  it('binds correct thread update values', () => {
    const { db, statements } =
      mockDatabase();

    buildMessageStatements(db, record());

    expect(statements[2].values).toEqual([
      'thread-test',
      NOW,
      'Business correspondence.',
      NOW,
      'thread-test',
    ]);
  });
});

describe('Message persistence orchestration', () => {
  it('stores a new message atomically', async () => {
    const { db, batch } = mockDatabase();

    expect(await persistMessage(
      db,
      record(),
    )).toEqual({
      status: 'stored',
      messageId: 'message-test',
      threadId: 'thread-test',
    });

    expect(batch).toHaveBeenCalledTimes(1);

    expect(batch.mock.calls[0][0])
      .toHaveLength(3);
  });

  it('skips existing duplicate messages', async () => {
    const { db, batch, first } =
      mockDatabase();

    first.mockResolvedValueOnce({
      id: 'existing-message',
      threadId: 'existing-thread',
      messageId: '<test@example.com>',
    });

    expect(await persistMessage(
      db,
      record(),
    )).toEqual({
      status: 'duplicate',
      messageId: 'existing-message',
      threadId: 'existing-thread',
    });

    expect(batch).not.toHaveBeenCalled();
  });

  it('handles concurrent duplicate insertion', async () => {
    const { db, batch, first } =
      mockDatabase();

    first
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'winning-message',
        threadId: 'winning-thread',
        messageId: '<test@example.com>',
      });

    batch.mockRejectedValueOnce(
      new Error('UNIQUE constraint failed')
    );

    expect(await persistMessage(
      db,
      record(),
    )).toEqual({
      status: 'duplicate',
      messageId: 'winning-message',
      threadId: 'winning-thread',
    });
  });

  it('propagates nonduplicate database errors', async () => {
    const { db, batch } = mockDatabase();

    batch.mockRejectedValueOnce(
      new Error('Database unavailable')
    );

    await expect(persistMessage(
      db,
      record(),
    )).rejects.toThrow(
      'Database unavailable'
    );
  });

  it('handles messages without Message-ID', async () => {
    const { db, batch, first } =
      mockDatabase();

    const result = await persistMessage(
      db,
      record({
        message_id_header: null,
      }),
    );

    expect(result.status).toBe('stored');
    expect(first).not.toHaveBeenCalled();
    expect(batch).toHaveBeenCalledTimes(1);
  });

  it('rejects incomplete batch results', async () => {
    const { db, batch } = mockDatabase();

    batch.mockResolvedValueOnce([
      { success: true },
    ]);

    await expect(persistMessage(
      db,
      record(),
    )).rejects.toThrow(
      'Message persistence batch failed'
    );
  });

  it('rejects unsuccessful batch results', async () => {
    const { db, batch } = mockDatabase();

    batch.mockResolvedValueOnce([
      { success: true },
      { success: false },
      { success: true },
    ]);

    await expect(persistMessage(
      db,
      record(),
    )).rejects.toThrow(
      'Message persistence batch failed'
    );
  });

  it('prevents incomplete attachment storage', async () => {
    const { db, batch } = mockDatabase();

    await expect(persistMessage(
      db,
      record({
        has_attachments: 1,
      }),
    )).rejects.toThrow(
      'Attachment metadata mismatch'
    );

    expect(batch).not.toHaveBeenCalled();
  });

  it('propagates duplicate lookup failures', async () => {
    const { db, batch, first } =
      mockDatabase();

    first.mockRejectedValueOnce(
      new Error('Lookup failed')
    );

    await expect(persistMessage(
      db,
      record(),
    )).rejects.toThrow('Lookup failed');

    expect(batch).not.toHaveBeenCalled();
  });
});

describe('Atomic attachment integration', () => {
  const attachment = {
    filename: 'invoice.txt',
    mime: 'text/plain',
    contentId: null,
    isInline: false,
    size: 4,
    data: new Uint8Array([1, 2, 3, 4]),
  };

  it('stores message and attachment in one batch', async () => {
    const { db, batch, statements } =
      mockDatabase();

    batch.mockResolvedValueOnce(
      Array.from(
        { length: 4 },
        () => ({ success: true }),
      )
    );

    const result = await persistMessage(
      db,
      record({ has_attachments: 1 }),
      [attachment],
    );

    expect(result.status).toBe('stored');
    expect(batch).toHaveBeenCalledTimes(1);

    expect(batch.mock.calls[0][0])
      .toHaveLength(4);

    const sql = statements.map(
      statement => statement.sql
    );

    const inserted = sql.findIndex(
      value => value.includes(
        'INSERT INTO attachments'
      )
    );

    expect(inserted).toBeGreaterThan(-1);
  });

  it('stores multiple attachments in one batch', async () => {
    const { db, batch } = mockDatabase();

    batch.mockResolvedValueOnce(
      Array.from(
        { length: 5 },
        () => ({ success: true }),
      )
    );

    const result = await persistMessage(
      db,
      record({ has_attachments: 1 }),
      [attachment, attachment],
    );

    expect(result.status).toBe('stored');

    expect(batch.mock.calls[0][0])
      .toHaveLength(5);
  });

  it('rejects unexpected attachment data', async () => {
    const { db, batch } = mockDatabase();

    await expect(persistMessage(
      db,
      record({ has_attachments: 0 }),
      [attachment],
    )).rejects.toThrow(
      'Attachment metadata mismatch'
    );

    expect(batch).not.toHaveBeenCalled();
  });

  it('rejects invalid attachment sizes before writing', async () => {
    const { db, batch } = mockDatabase();

    await expect(persistMessage(
      db,
      record({ has_attachments: 1 }),
      [{
        ...attachment,
        size: 99,
      }],
    )).rejects.toThrow(
      'Attachment size mismatch'
    );

    expect(batch).not.toHaveBeenCalled();
  });

  it('does not insert attachments for duplicates', async () => {
    const { db, batch, first } =
      mockDatabase();

    first.mockResolvedValueOnce({
      id: 'existing-message',
      threadId: 'existing-thread',
      messageId: '<test@example.com>',
    });

    const result = await persistMessage(
      db,
      record({ has_attachments: 1 }),
      [attachment],
    );

    expect(result.status).toBe('duplicate');
    expect(batch).not.toHaveBeenCalled();
  });

  it('propagates attachment transaction failure', async () => {
    const { db, batch } = mockDatabase();

    batch.mockRejectedValueOnce(
      new Error('Attachment write failed')
    );

    await expect(persistMessage(
      db,
      record({ has_attachments: 1 }),
      [attachment],
    )).rejects.toThrow(
      'Attachment write failed'
    );
  });
});
