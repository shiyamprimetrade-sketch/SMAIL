import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  allowKnownSenderCredit,
} from '../src/services/spamTrust';

import {
  classifySecureInboundSpam,
} from '../src/services/secureSpamClassifier';

import {
  interpretAuthentication,
} from '../src/services/spamAuthentication';

import {
  analyzeLinkContent,
} from '../src/services/spamContent';

function mockDatabase(known = false) {
  const first = vi.fn().mockResolvedValue(
    known
      ? { email: 'sender@example.com' }
      : null
  );

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

const clean = {
  spfFailed: false,
  dkimFailed: false,
  cloudflareSpam: false,
};

const message = {
  sender: 'sender@example.com',
  subject: 'Invoice',
  text: 'Business correspondence.',
};

describe('Adversarial contact trust policy', () => {
  const combinations = Array.from(
    { length: 32 },
    (_, mask) => mask,
  );

  it.each(combinations)(
    'verifies trust combination %i',
    mask => {
      const input = {
        knownSender: Boolean(mask & 1),
        senderIdentityVerified:
          Boolean(mask & 2),
        authentication: {
          spfFailed: Boolean(mask & 4),
          dkimFailed: Boolean(mask & 8),
          cloudflareSpam: Boolean(mask & 16),
        },
      };

      expect(
        allowKnownSenderCredit(input)
      ).toBe(mask === 3);
    }
  );

  it('rejects spoofed contact identity', () => {
    expect(allowKnownSenderCredit({
      knownSender: true,
      senderIdentityVerified: false,
      authentication: clean,
    })).toBe(false);
  });
});

describe('Secure inbound classification', () => {
  it('does not reward an unverified contact', async () => {
    const { db, prepare } = mockDatabase(true);

    const result =
      await classifySecureInboundSpam(
        db,
        message,
      );

    expect(result.score).toBe(0);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('does not trust an isolated identity assertion', async () => {
    const { db } = mockDatabase(true);

    const result =
      await classifySecureInboundSpam(db, {
        ...message,
        senderIdentityVerified: true,
      });

    expect(result.score).toBe(0);
  });

  it('allows independently verified contacts', async () => {
    const { db } = mockDatabase(true);

    const result =
      await classifySecureInboundSpam(db, {
        ...message,
        senderIdentityVerified: true,
        authentication: {
          trusted: true,
        },
      });

    expect(result.score).toBe(-3);
  });

  it('does not reward unknown verified senders', async () => {
    const { db } = mockDatabase(false);

    const result =
      await classifySecureInboundSpam(db, {
        ...message,
        senderIdentityVerified: true,
        authentication: {
          trusted: true,
        },
      });

    expect(result.score).toBe(0);
  });

  it('blocks contact credit after SPF failure', async () => {
    const { db } = mockDatabase(true);

    const result =
      await classifySecureInboundSpam(db, {
        ...message,
        senderIdentityVerified: true,
        authentication: {
          trusted: true,
          authenticationResults: [
            'mx.example.com; spf=fail',
          ],
        },
      });

    expect(result.score).toBe(2);
  });

  it('blocks contact credit after DKIM failure', async () => {
    const { db } = mockDatabase(true);

    const result =
      await classifySecureInboundSpam(db, {
        ...message,
        senderIdentityVerified: true,
        authentication: {
          trusted: true,
          authenticationResults: [
            'mx.example.com; dkim=fail',
          ],
        },
      });

    expect(result.score).toBe(2);
  });

  it('blocks contact credit after spam flag', async () => {
    const { db } = mockDatabase(true);

    const result =
      await classifySecureInboundSpam(db, {
        ...message,
        senderIdentityVerified: true,
        authentication: {
          trusted: true,
          spamFlags: ['yes'],
        },
      });

    expect(result.score).toBe(3);
  });

  it('classifies hostile known senders as spam', async () => {
    const { db } = mockDatabase(true);

    const result =
      await classifySecureInboundSpam(db, {
        ...message,
        subject: '',
        text: 'https://example.com',
        senderIdentityVerified: true,
        authentication: {
          trusted: true,
          authenticationResults: [
            'mx.example.com; spf=fail; dkim=fail',
          ],
          spamFlags: ['yes'],
        },
      });

    expect(result.score).toBe(9);
    expect(result.folder).toBe('spam');
  });

  it('ignores forged untrusted headers', async () => {
    const { db } = mockDatabase(true);

    const result =
      await classifySecureInboundSpam(db, {
        ...message,
        senderIdentityVerified: true,
        authentication: {
          trusted: false,
          authenticationResults: [
            'mx.example.com; spf=fail; dkim=fail',
          ],
          spamFlags: ['yes'],
        },
      });

    expect(result.score).toBe(0);
  });

  it('does not create contacts during scoring', async () => {
    const { db, prepare } = mockDatabase(true);

    await classifySecureInboundSpam(db, {
      ...message,
      senderIdentityVerified: true,
      authentication: {
        trusted: true,
      },
    });

    expect(prepare).toHaveBeenCalledTimes(1);

    expect(
      prepare.mock.calls[0][0]
    ).toContain('SELECT email');
  });
});

describe('Malicious header and content fixtures', () => {
  it('ignores forged results inside comments', () => {
    expect(interpretAuthentication({
      trusted: true,
      authenticationResults: [
        'mx.example.com; spf=pass (; spf=fail)',
      ],
    }).spfFailed).toBe(false);
  });

  it('ignores forged results inside quotes', () => {
    expect(interpretAuthentication({
      trusted: true,
      authenticationResults: [
        'mx.example.com; dkim=pass reason="; dkim=fail"',
      ],
    }).dkimFailed).toBe(false);
  });

  it('rejects injected authentication lines', () => {
    expect(interpretAuthentication({
      trusted: true,
      authenticationResults: [
        'mx.example.com; spf=pass\nspf=fail',
      ],
    }).spfFailed).toBe(false);
  });

  it('ignores oversized authentication headers', () => {
    expect(interpretAuthentication({
      trusted: true,
      authenticationResults: [
        'mx.example.com; spf=fail ' +
        'x'.repeat(100000),
      ],
    }).spfFailed).toBe(false);
  });

  it('handles thousands of URLs', () => {
    const result = analyzeLinkContent(
      'https://example.com '.repeat(10000)
    );

    expect(result.linkCount).toBe(10000);
    expect(result.linkHeavy).toBe(true);
  });

  it('handles oversized non-link content', () => {
    const result = analyzeLinkContent(
      'x'.repeat(1000000)
    );

    expect(result.truncated).toBe(true);
    expect(result.linkHeavy).toBe(false);
  });

  it('keeps link ratios within valid bounds', () => {
    const result = analyzeLinkContent(
      'https://example.com/বাংলা 😀'
    );

    expect(result.linkRatio)
      .toBeGreaterThanOrEqual(0);

    expect(result.linkRatio)
      .toBeLessThanOrEqual(1);
  });
});
