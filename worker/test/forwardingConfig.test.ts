import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  resolveForwardingConfig,
  isAuthorizedRecipient,
} from '../src/services/forwardingConfig';

const OWNER = 'owner@example.com';
const DESTINATION = 'test@gmail.com';

describe('Secure forwarding configuration', () => {
  it('accepts valid configuration', () => {
    expect(resolveForwardingConfig(
      OWNER,
      DESTINATION,
    )).toEqual({
      ownerEmail: OWNER,
      destination: DESTINATION,
    });
  });

  it('normalizes email case', () => {
    expect(resolveForwardingConfig(
      'OWNER@EXAMPLE.COM',
      'TEST@GMAIL.COM',
    )).toEqual({
      ownerEmail: OWNER,
      destination: DESTINATION,
    });
  });

  it('normalizes surrounding whitespace', () => {
    expect(resolveForwardingConfig(
      ' ' + OWNER + ' ',
      ' ' + DESTINATION + ' ',
    )).toEqual({
      ownerEmail: OWNER,
      destination: DESTINATION,
    });
  });

  it('rejects missing owner', () => {
    expect(() => resolveForwardingConfig(
      undefined,
      DESTINATION,
    )).toThrow();
  });

  it('rejects missing destination', () => {
    expect(() => resolveForwardingConfig(
      OWNER,
      undefined,
    )).toThrow();
  });

  it('rejects empty destination', () => {
    expect(() => resolveForwardingConfig(
      OWNER,
      '',
    )).toThrow();
  });

  it('rejects direct forwarding loops', () => {
    expect(() => resolveForwardingConfig(
      OWNER,
      OWNER,
    )).toThrow(
      'Forwarding loop prohibited'
    );
  });

  it('rejects case-insensitive loops', () => {
    expect(() => resolveForwardingConfig(
      OWNER,
      OWNER.toUpperCase(),
    )).toThrow(
      'Forwarding loop prohibited'
    );
  });

  it('rejects same-domain forwarding', () => {
    expect(() => resolveForwardingConfig(
      OWNER,
      'another@example.com',
    )).toThrow(
      'Same-domain forwarding prohibited'
    );
  });

  it('rejects unauthorized providers', () => {
    expect(() => resolveForwardingConfig(
      OWNER,
      'test@outlook.com',
    )).toThrow(
      'Forwarding destination not permitted'
    );
  });

  it.each([
    'invalid',
    '@gmail.com',
    'test@',
    'test@gmail.com.evil.com',
    'test@gmail.com,other@gmail.com',
    'test@gmail.com\nother@gmail.com',
    'test\u0000@gmail.com',
    'test@@gmail.com',
    'x'.repeat(255) + '@gmail.com',
  ])('rejects invalid destination %#', value => {
    expect(() => resolveForwardingConfig(
      OWNER,
      value,
    )).toThrow();
  });
});

describe('Authorized inbound recipient', () => {
  const config = resolveForwardingConfig(
    OWNER,
    DESTINATION,
  );

  it('accepts the configured owner', () => {
    expect(isAuthorizedRecipient(
      OWNER,
      config,
    )).toBe(true);
  });

  it('accepts normalized owner address', () => {
    expect(isAuthorizedRecipient(
      OWNER.toUpperCase(),
      config,
    )).toBe(true);
  });

  it('rejects another mailbox', () => {
    expect(isAuthorizedRecipient(
      'another@example.com',
      config,
    )).toBe(false);
  });

  it('rejects the forwarding destination', () => {
    expect(isAuthorizedRecipient(
      DESTINATION,
      config,
    )).toBe(false);
  });

  it('rejects an empty recipient', () => {
    expect(isAuthorizedRecipient(
      '',
      config,
    )).toBe(false);
  });

  it('rejects multiple recipients', () => {
    expect(isAuthorizedRecipient(
      OWNER + ',other@example.com',
      config,
    )).toBe(false);
  });

  it('rejects malformed recipients', () => {
    expect(isAuthorizedRecipient(
      'invalid',
      config,
    )).toBe(false);
  });
});
