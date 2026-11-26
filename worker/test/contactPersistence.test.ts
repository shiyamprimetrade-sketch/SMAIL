import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  prepareContactRecord,
  buildContactStatement,
  MAX_CONTACT_NAME_BYTES,
} from '../src/services/contactPersistence';

const NOW = 1800000000000;

describe('Contact record preparation', () => {
  it('prepares valid contacts', () => {
    expect(prepareContactRecord(
      'customer@example.com',
      'Customer',
      NOW,
    )).toEqual({
      email: 'customer@example.com',
      name: 'Customer',
      last_used: NOW,
    });
  });

  it('normalizes email domain case', () => {
    expect(prepareContactRecord(
      'Customer@EXAMPLE.COM',
      'Customer',
      NOW,
    )?.email).toBe(
      'Customer@example.com'
    );
  });

  it('removes surrounding whitespace', () => {
    expect(prepareContactRecord(
      ' customer@example.com ',
      ' Customer ',
      NOW,
    )?.email).toBe(
      'customer@example.com'
    );
  });

  it('normalizes name whitespace', () => {
    expect(prepareContactRecord(
      'customer@example.com',
      ' Test \n Customer ',
      NOW,
    )?.name).toBe(
      'Test Customer'
    );
  });

  it('removes name control characters', () => {
    expect(prepareContactRecord(
      'customer@example.com',
      'Test\u0000Customer',
      NOW,
    )?.name).toBe(
      'Test Customer'
    );
  });

  it('preserves missing names as null', () => {
    expect(prepareContactRecord(
      'customer@example.com',
      null,
      NOW,
    )?.name).toBeNull();
  });

  it('preserves empty names as null', () => {
    expect(prepareContactRecord(
      'customer@example.com',
      ' ',
      NOW,
    )?.name).toBeNull();
  });

  it('preserves Bengali contact names', () => {
    expect(prepareContactRecord(
      'customer@example.com',
      'বাংলাদেশ',
      NOW,
    )?.name).toBe('বাংলাদেশ');
  });

  it('bounds contact name bytes', () => {
    const contact = prepareContactRecord(
      'customer@example.com',
      '😀'.repeat(1000),
      NOW,
    );

    expect(new TextEncoder().encode(
      contact?.name ?? ''
    ).length).toBeLessThanOrEqual(
      MAX_CONTACT_NAME_BYTES
    );

    expect(contact?.name)
      .not.toContain('\uFFFD');
  });

  it.each([
    '',
    'invalid',
    '@example.com',
    'customer@',
    'a@b@example.com',
    'a b@example.com',
    'a\u0000@example.com',
    'x'.repeat(321) + '@example.com',
  ])('skips invalid contact %#', email => {
    expect(prepareContactRecord(
      email,
      'Customer',
      NOW,
    )).toBeNull();
  });

  it.each([
    -1,
    Infinity,
    NaN,
    1.5,
  ])('rejects invalid timestamp %#', now => {
    expect(() => prepareContactRecord(
      'customer@example.com',
      'Customer',
      now,
    )).toThrow(
      'Invalid contact timestamp'
    );
  });
});

describe('Contact upsert statements', () => {
  function mockDatabase() {
    const bind = vi.fn()
      .mockReturnValue({});

    const prepare = vi.fn()
      .mockReturnValue({ bind });

    return {
      db: {
        prepare,
      } as unknown as D1Database,
      prepare,
      bind,
    };
  }

  it('creates parameterized contact insertion', () => {
    const { db, prepare, bind } =
      mockDatabase();

    buildContactStatement(
      db,
      'customer@example.com',
      'Customer',
      NOW,
    );

    expect(prepare.mock.calls[0][0])
      .toContain('INSERT INTO contacts');

    expect(bind).toHaveBeenCalledWith(
      'customer@example.com',
      'Customer',
      NOW,
    );
  });

  it('updates existing contacts', () => {
    const { db, prepare } = mockDatabase();

    buildContactStatement(
      db,
      'customer@example.com',
      'Customer',
      NOW,
    );

    expect(prepare.mock.calls[0][0])
      .toContain(
        'ON CONFLICT(email) DO UPDATE'
      );
  });

  it('increments contact usage', () => {
    const { db, prepare } = mockDatabase();

    buildContactStatement(
      db,
      'customer@example.com',
      'Customer',
      NOW,
    );

    expect(prepare.mock.calls[0][0])
      .toContain(
        'use_count = contacts.use_count + 1'
      );
  });

  it('prevents timestamp regression', () => {
    const { db, prepare } = mockDatabase();

    buildContactStatement(
      db,
      'customer@example.com',
      'Customer',
      NOW,
    );

    expect(prepare.mock.calls[0][0])
      .toContain('last_used = MAX');
  });

  it('protects existing contact names', () => {
    const { db, prepare } = mockDatabase();

    buildContactStatement(
      db,
      'customer@example.com',
      null,
      NOW,
    );

    const sql = prepare.mock.calls[0][0];

    expect(sql)
      .toContain('excluded.name IS NOT NULL');

    expect(sql)
      .toContain('ELSE contacts.name');
  });

  it('protects newer contact names', () => {
    const { db, prepare } = mockDatabase();

    buildContactStatement(
      db,
      'customer@example.com',
      'Customer',
      NOW,
    );

    expect(prepare.mock.calls[0][0])
      .toContain(
        'excluded.last_used >= contacts.last_used'
      );
  });

  it('binds potentially unsafe names as data', () => {
    const { db, prepare, bind } =
      mockDatabase();

    const name = "Customer's Company";

    buildContactStatement(
      db,
      'customer@example.com',
      name,
      NOW,
    );

    expect(prepare.mock.calls[0][0])
      .not.toContain(name);

    expect(bind).toHaveBeenCalledWith(
      'customer@example.com',
      name,
      NOW,
    );
  });

  it('skips invalid contacts without SQL', () => {
    const { db, prepare } = mockDatabase();

    expect(buildContactStatement(
      db,
      'invalid',
      'Customer',
      NOW,
    )).toBeNull();

    expect(prepare).not.toHaveBeenCalled();
  });
});
