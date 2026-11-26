import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  findExistingMessage,
  isDuplicateMessage,
  type ExistingMessage,
} from '../src/services/deduplication';

const existing: ExistingMessage = {
  id: 'message-001',
  threadId: 'thread-001',
  messageId: '<original@example.com>',
};

function mockDatabase(
  result: ExistingMessage | null = null,
) {
  const first = vi.fn().mockResolvedValue(result);

  const bind = vi.fn().mockReturnValue({
    first,
  });

  const prepare = vi.fn().mockReturnValue({
    bind,
  });

  const db = {
    prepare,
  } as unknown as D1Database;

  return {
    db,
    prepare,
    bind,
    first,
  };
}

describe('Database-backed email deduplication', () => {
  it('finds an existing message', async () => {
    const { db } = mockDatabase(existing);

    expect(await findExistingMessage(
      db,
      existing.messageId,
    )).toEqual(existing);
  });

  it('returns null for a new message', async () => {
    const { db } = mockDatabase();

    expect(await findExistingMessage(
      db,
      '<new@example.com>',
    )).toBeNull();
  });

  it('identifies duplicate messages', async () => {
    const { db } = mockDatabase(existing);

    expect(await isDuplicateMessage(
      db,
      existing.messageId,
    )).toBe(true);
  });

  it('accepts previously unseen messages', async () => {
    const { db } = mockDatabase();

    expect(await isDuplicateMessage(
      db,
      '<new@example.com>',
    )).toBe(false);
  });

  it.each([
    null,
    undefined,
    '',
    'invalid',
    '<invalid id>',
    '<a><b>',
  ])('skips invalid message identity %#', async (id) => {
    const { db, prepare } = mockDatabase();

    expect(await findExistingMessage(
      db,
      id,
    )).toBeNull();

    expect(prepare).not.toHaveBeenCalled();
  });

  it('normalizes surrounding whitespace', async () => {
    const { db, bind } = mockDatabase(existing);

    await findExistingMessage(
      db,
      '  <original@example.com>  ',
    );

    expect(bind).toHaveBeenCalledWith(
      '<original@example.com>'
    );
  });

  it('preserves Message-ID case', async () => {
    const { db, bind } = mockDatabase();

    await findExistingMessage(
      db,
      '<ABC@example.com>',
    );

    expect(bind).toHaveBeenCalledWith(
      '<ABC@example.com>'
    );
  });

  it('uses a parameterized SQL query', async () => {
    const { db, prepare, bind } = mockDatabase();

    const id = "<test'--@example.com>";

    await findExistingMessage(db, id);

    const sql = prepare.mock.calls[0][0];

    expect(sql).toContain(
      'WHERE message_id_header = ?'
    );

    expect(sql).not.toContain(id);

    expect(bind).toHaveBeenCalledWith(id);
  });

  it('limits lookup to one record', async () => {
    const { db, prepare } = mockDatabase();

    await findExistingMessage(
      db,
      '<new@example.com>',
    );

    expect(
      prepare.mock.calls[0][0]
    ).toContain('LIMIT 1');
  });

  it('propagates database failures', async () => {
    const { db, first } = mockDatabase();

    first.mockRejectedValueOnce(
      new Error('Database unavailable')
    );

    await expect(
      isDuplicateMessage(
        db,
        '<new@example.com>',
      )
    ).rejects.toThrow('Database unavailable');
  });
});
