import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  interpretAuthentication,
  MAX_AUTH_HEADER_BYTES,
  MAX_AUTH_HEADERS,
} from '../src/services/spamAuthentication';

import {
  scoreSpam,
} from '../src/services/spam';

function interpret(
  header: string,
  trusted = true,
) {
  return interpretAuthentication({
    trusted,
    authenticationResults: [header],
  });
}

describe('Authentication interpretation', () => {
  it('recognizes SPF failure', () => {
    expect(interpret(
      'mx.example.com; spf=fail'
    ).spfFailed).toBe(true);
  });

  it('recognizes DKIM failure', () => {
    expect(interpret(
      'mx.example.com; dkim=fail'
    ).dkimFailed).toBe(true);
  });

  it('recognizes both failures', () => {
    expect(interpret(
      'mx.example.com; spf=fail; dkim=fail'
    )).toEqual({
      spfFailed: true,
      dkimFailed: true,
      cloudflareSpam: false,
    });
  });

  it('handles uppercase results', () => {
    expect(interpret(
      'mx.example.com; SPF=FAIL'
    ).spfFailed).toBe(true);
  });

  it('handles whitespace', () => {
    expect(interpret(
      'mx.example.com; spf = fail'
    ).spfFailed).toBe(true);
  });

  it('handles folded headers', () => {
    expect(interpret(
      'mx.example.com;\r\n spf=fail'
    ).spfFailed).toBe(true);
  });

  it.each([
    'pass',
    'neutral',
    'none',
    'softfail',
    'temperror',
    'permerror',
  ])('does not score SPF %s as fail', status => {
    expect(interpret(
      `mx.example.com; spf=${status}`
    ).spfFailed).toBe(false);
  });

  it('ignores untrusted authentication headers', () => {
    expect(interpret(
      'mx.example.com; spf=fail; dkim=fail',
      false,
    )).toEqual({
      spfFailed: false,
      dkimFailed: false,
      cloudflareSpam: false,
    });
  });

  it('ignores results inside comments', () => {
    expect(interpret(
      'mx.example.com; spf=pass (spf=fail)'
    ).spfFailed).toBe(false);
  });

  it('ignores nested comments', () => {
    expect(interpret(
      'mx.example.com; spf=pass (a (; spf=fail))'
    ).spfFailed).toBe(false);
  });

  it('ignores quoted fake results', () => {
    expect(interpret(
      'mx.example.com; spf=pass reason="; spf=fail"'
    ).spfFailed).toBe(false);
  });

  it('rejects malformed comments', () => {
    expect(interpret(
      'mx.example.com; spf=fail (unfinished'
    ).spfFailed).toBe(false);
  });

  it('rejects malformed quoted strings', () => {
    expect(interpret(
      'mx.example.com; spf=fail reason="unfinished'
    ).spfFailed).toBe(false);
  });

  it('rejects injected line breaks', () => {
    expect(interpret(
      'mx.example.com;\nspf=fail'
    ).spfFailed).toBe(false);
  });

  it('rejects control characters', () => {
    expect(interpret(
      'mx.example.com; spf=fail\u0000'
    ).spfFailed).toBe(false);
  });

  it('requires an authentication service identifier', () => {
    expect(interpret(
      '; spf=fail'
    ).spfFailed).toBe(false);
  });

  it('rejects oversized headers', () => {
    expect(interpret(
      'mx.example.com; spf=fail ' +
      'x'.repeat(MAX_AUTH_HEADER_BYTES)
    ).spfFailed).toBe(false);
  });

  it('bounds the number of interpreted headers', () => {
    const headers = Array.from(
      { length: MAX_AUTH_HEADERS },
      () => 'mx.example.com; spf=pass',
    );

    headers.push(
      'mx.example.com; spf=fail'
    );

    expect(interpretAuthentication({
      trusted: true,
      authenticationResults: headers,
    }).spfFailed).toBe(false);
  });

  it('does not count repeated failures twice', () => {
    const auth = interpretAuthentication({
      trusted: true,
      authenticationResults: [
        'mx.example.com; spf=fail',
        'mx.example.com; spf=fail',
      ],
    });

    expect(scoreSpam({
      ...auth,
      emptySubjectLinkHeavy: false,
      knownSender: false,
    }).score).toBe(2);
  });

  it('does not score unrelated methods', () => {
    expect(interpret(
      'mx.example.com; dmarc=fail'
    )).toEqual({
      spfFailed: false,
      dkimFailed: false,
      cloudflareSpam: false,
    });
  });
});

describe('Trusted spam flag interpretation', () => {
  it.each([
    'yes',
    'true',
    '1',
    'spam',
    'YES',
    ' true ',
  ])('accepts positive flag %s', flag => {
    expect(interpretAuthentication({
      trusted: true,
      spamFlags: [flag],
    }).cloudflareSpam).toBe(true);
  });

  it.each([
    '',
    'no',
    'false',
    '0',
    'ham',
    'unknown',
  ])('ignores nonpositive flag %s', flag => {
    expect(interpretAuthentication({
      trusted: true,
      spamFlags: [flag],
    }).cloudflareSpam).toBe(false);
  });

  it('ignores untrusted spam flags', () => {
    expect(interpretAuthentication({
      trusted: false,
      spamFlags: ['yes'],
    }).cloudflareSpam).toBe(false);
  });

  it('handles missing headers', () => {
    expect(interpretAuthentication({
      trusted: true,
    })).toEqual({
      spfFailed: false,
      dkimFailed: false,
      cloudflareSpam: false,
    });
  });

  it('integrates with the scoring engine', () => {
    const auth = interpretAuthentication({
      trusted: true,
      authenticationResults: [
        'mx.example.com; spf=fail',
      ],
      spamFlags: ['yes'],
    });

    const result = scoreSpam({
      ...auth,
      emptySubjectLinkHeavy: false,
      knownSender: false,
    });

    expect(result.score).toBe(5);
    expect(result.folder).toBe('spam');
  });
});
