import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  isKnownSender,
} from '../src/services/spamContacts';

import {
  classifyInboundSpam,
} from '../src/services/spamClassifier';

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
    prepare,
    bind,
    first,
  };
}

describe('Known sender database lookup', () => {
  it('recognizes existing contacts', async () => {
    const { db } = mockDatabase({
      email: 'sender@example.com',
    });

    expect(await isKnownSender(
      db,
      'sender@example.com',
    )).toBe(true);
  });

  it('recognizes unknown contacts', async () => {
    const { db } = mockDatabase();

    expect(await isKnownSender(
      db,
      'unknown@example.com',
    )).toBe(false);
  });

  it('normalizes domain case', async () => {
    const { db, bind } = mockDatabase();

    await isKnownSender(
      db,
      'sender@EXAMPLE.COM',
    );

    expect(bind).toHaveBeenCalledWith(
      'sender@example.com'
    );
  });

  it('preserves local-part case', async () => {
    const { db, bind } = mockDatabase();

    await isKnownSender(
      db,
      'Sender@EXAMPLE.COM',
    );

    expect(bind).toHaveBeenCalledWith(
      'Sender@example.com'
    );
  });

  it('removes surrounding whitespace', async () => {
    const { db, bind } = mockDatabase();

    await isKnownSender(
      db,
      ' sender@example.com ',
    );

    expect(bind).toHaveBeenCalledWith(
      'sender@example.com'
    );
  });

  it.each([
    '',
    'invalid',
    '@example.com',
    'sender@',
    'a@b@example.com',
    'sender name@example.com',
    'sender\u0000@example.com',
    'x'.repeat(321) + '@example.com',
  ])('rejects invalid sender %#', async sender => {
    const { db, prepare } = mockDatabase();

    expect(await isKnownSender(
      db,
      sender,
    )).toBe(false);

    expect(prepare).not.toHaveBeenCalled();
  });

  it('uses parameterized database queries', async () => {
    const { db, prepare, bind } =
      mockDatabase();

    const sender = "o'neil@example.com";

    await isKnownSender(db, sender);

    expect(
      prepare.mock.calls[0][0]
    ).not.toContain(sender);

    expect(bind).toHaveBeenCalledWith(
      sender
    );
  });

  it('propagates database failures', async () => {
    const { db, first } = mockDatabase();

    first.mockRejectedValueOnce(
      new Error('Database unavailable')
    );

    await expect(isKnownSender(
      db,
      'sender@example.com',
    )).rejects.toThrow(
      'Database unavailable'
    );
  });
});

describe('Unified inbound spam classification', () => {
  const input = {
    sender: 'sender@example.com',
    subject: 'Invoice',
    text: 'Thank you for your business.',
  };

  it('classifies normal correspondence', async () => {
    const { db } = mockDatabase();

    const result = await classifyInboundSpam(
      db,
      input,
    );

    expect(result.score).toBe(0);
    expect(result.folder).toBe('inbox');
  });

  it('applies known sender reduction', async () => {
    const { db } = mockDatabase({
      email: input.sender,
    });

    const result = await classifyInboundSpam(
      db,
      input,
    );

    expect(result.score).toBe(-3);
    expect(result.folder).toBe('inbox');
  });

  it('ignores untrusted authentication', async () => {
    const { db } = mockDatabase();

    const result = await classifyInboundSpam(
      db,
      {
        ...input,
        authentication: {
          trusted: false,
          authenticationResults: [
            'mx.example.com; spf=fail; dkim=fail',
          ],
          spamFlags: ['yes'],
        },
      },
    );

    expect(result.score).toBe(0);
  });

  it('classifies trusted authentication failures', async () => {
    const { db } = mockDatabase();

    const result = await classifyInboundSpam(
      db,
      {
        ...input,
        authentication: {
          trusted: true,
          authenticationResults: [
            'mx.example.com; spf=fail; dkim=fail',
          ],
          spamFlags: ['yes'],
        },
      },
    );

    expect(result.score).toBe(7);
    expect(result.folder).toBe('spam');
  });

  it('combines content and authentication', async () => {
    const { db } = mockDatabase();

    const result = await classifyInboundSpam(
      db,
      {
        ...input,
        subject: '',
        text: 'https://example.com',
        authentication: {
          trusted: true,
          spamFlags: ['yes'],
        },
      },
    );

    expect(result.score).toBe(5);
    expect(result.folder).toBe('spam');
  });

  it('combines all five scoring signals', async () => {
    const { db } = mockDatabase({
      email: input.sender,
    });

    const result = await classifyInboundSpam(
      db,
      {
        ...input,
        subject: '',
        text: 'https://example.com',
        authentication: {
          trusted: true,
          authenticationResults: [
            'mx.example.com; spf=fail; dkim=fail',
          ],
          spamFlags: ['yes'],
        },
      },
    );

    expect(result.score).toBe(6);
    expect(result.folder).toBe('spam');
    expect(result.evidence).toHaveLength(5);
  });

  it('preserves scoring evidence', async () => {
    const { db } = mockDatabase({
      email: input.sender,
    });

    const result = await classifyInboundSpam(
      db,
      input,
    );

    expect(result.evidence).toEqual([
      {
        signal: 'knownSender',
        points: -3,
      },
    ]);
  });

  it('does not modify contacts', async () => {
    const { db, prepare } = mockDatabase();

    await classifyInboundSpam(db, input);

    expect(prepare).toHaveBeenCalledTimes(1);

    expect(
      prepare.mock.calls[0][0]
    ).toContain('SELECT email');
  });

  it('propagates classification database errors', async () => {
    const { db, first } = mockDatabase();

    first.mockRejectedValueOnce(
      new Error('Database unavailable')
    );

    await expect(
      classifyInboundSpam(db, input)
    ).rejects.toThrow(
      'Database unavailable'
    );
  });
});
