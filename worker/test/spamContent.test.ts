import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  analyzeLinkContent,
  hasEmptySubjectLinkHeavyBody,
  LINK_HEAVY_THRESHOLD,
  MAX_CONTENT_SCAN_CHARS,
} from '../src/services/spamContent';

import {
  scoreSpam,
} from '../src/services/spam';

describe('Link-heavy content analysis', () => {
  it('uses the configured threshold', () => {
    expect(LINK_HEAVY_THRESHOLD).toBe(0.5);
  });

  it('handles empty content', () => {
    expect(analyzeLinkContent('')).toEqual({
      linkCount: 0,
      linkCharacters: 0,
      contentCharacters: 0,
      linkRatio: 0,
      linkHeavy: false,
      truncated: false,
    });
  });

  it('handles whitespace-only content', () => {
    expect(
      analyzeLinkContent(' \n\t ').linkRatio
    ).toBe(0);
  });

  it('accepts ordinary correspondence', () => {
    expect(analyzeLinkContent(
      'Thank you for your business.'
    ).linkHeavy).toBe(false);
  });

  it('recognizes HTTPS links', () => {
    expect(analyzeLinkContent(
      'https://example.com'
    ).linkCount).toBe(1);
  });

  it('recognizes HTTP links', () => {
    expect(analyzeLinkContent(
      'http://example.com'
    ).linkCount).toBe(1);
  });

  it('recognizes uppercase schemes', () => {
    expect(analyzeLinkContent(
      'HTTPS://example.com'
    ).linkCount).toBe(1);
  });

  it('recognizes multiple links', () => {
    expect(analyzeLinkContent(
      'https://example.com https://example.org'
    ).linkCount).toBe(2);
  });

  it('recognizes link-only messages', () => {
    const result = analyzeLinkContent(
      'https://example.com'
    );

    expect(result.linkHeavy).toBe(true);
    expect(result.linkRatio).toBe(1);
  });

  it('recognizes link-heavy messages', () => {
    expect(analyzeLinkContent(
      'Click https://example.com'
    ).linkHeavy).toBe(true);
  });

  it('accepts long correspondence with a link', () => {
    expect(analyzeLinkContent(
      'Business correspondence '.repeat(20) +
      'https://example.com'
    ).linkHeavy).toBe(false);
  });

  it('excludes surrounding whitespace', () => {
    expect(analyzeLinkContent(
      '\n https://example.com \t'
    ).linkRatio).toBe(1);
  });

  it('excludes trailing punctuation from links', () => {
    const url = 'https://example.com';

    expect(analyzeLinkContent(
      url + '.'
    ).linkCharacters).toBe(url.length);
  });

  it('recognizes links with query parameters', () => {
    expect(analyzeLinkContent(
      'https://example.com/?a=1&b=2'
    ).linkCount).toBe(1);
  });

  it('recognizes internationalized URLs', () => {
    expect(analyzeLinkContent(
      'https://example.com/বাংলা'
    ).linkCount).toBe(1);
  });

  it('handles Bengali correspondence', () => {
    expect(analyzeLinkContent(
      'আপনার সহযোগিতার জন্য ধন্যবাদ।'
    ).linkHeavy).toBe(false);
  });

  it('handles Unicode characters', () => {
    expect(analyzeLinkContent(
      '😀'
    ).contentCharacters).toBe(1);
  });

  it('rejects malformed URLs', () => {
    expect(analyzeLinkContent(
      'https://%'
    ).linkCount).toBe(0);
  });

  it('ignores javascript URLs', () => {
    expect(analyzeLinkContent(
      'javascript:alert(1)'
    ).linkCount).toBe(0);
  });

  it('ignores mailto URLs', () => {
    expect(analyzeLinkContent(
      'mailto:sender@example.com'
    ).linkCount).toBe(0);
  });

  it('ignores FTP URLs', () => {
    expect(analyzeLinkContent(
      'ftp://example.com'
    ).linkCount).toBe(0);
  });

  it('accepts exact threshold', () => {
    const url = 'https://example.com';

    const result = analyzeLinkContent(
      url + ' ' + 'x'.repeat(url.length)
    );

    expect(result.linkRatio).toBe(0.5);
    expect(result.linkHeavy).toBe(true);
  });

  it('rejects below threshold', () => {
    const url = 'https://example.com';

    expect(analyzeLinkContent(
      url + ' ' + 'x'.repeat(url.length + 1)
    ).linkHeavy).toBe(false);
  });

  it('bounds oversized content scans', () => {
    const result = analyzeLinkContent(
      'x'.repeat(MAX_CONTENT_SCAN_CHARS + 1)
    );

    expect(result.truncated).toBe(true);

    expect(result.contentCharacters).toBe(
      MAX_CONTENT_SCAN_CHARS
    );
  });

  it('does not truncate exact-limit content', () => {
    expect(analyzeLinkContent(
      'x'.repeat(MAX_CONTENT_SCAN_CHARS)
    ).truncated).toBe(false);
  });

  it('produces deterministic analysis', () => {
    const body = 'Click https://example.com';

    expect(analyzeLinkContent(body)).toEqual(
      analyzeLinkContent(body)
    );
  });
});

describe('Empty subject spam signal', () => {
  it('detects empty subject with links', () => {
    expect(hasEmptySubjectLinkHeavyBody(
      '',
      'https://example.com',
    )).toBe(true);
  });

  it('detects whitespace-only subject', () => {
    expect(hasEmptySubjectLinkHeavyBody(
      ' \t ',
      'https://example.com',
    )).toBe(true);
  });

  it('does not score a nonempty subject', () => {
    expect(hasEmptySubjectLinkHeavyBody(
      'Invoice',
      'https://example.com',
    )).toBe(false);
  });

  it('does not score an empty body', () => {
    expect(hasEmptySubjectLinkHeavyBody(
      '',
      '',
    )).toBe(false);
  });

  it('does not score ordinary text', () => {
    expect(hasEmptySubjectLinkHeavyBody(
      '',
      'Thank you for your business.',
    )).toBe(false);
  });

  it('integrates with spam scoring', () => {
    const signal =
      hasEmptySubjectLinkHeavyBody(
        '',
        'https://example.com',
      );

    const result = scoreSpam({
      spfFailed: false,
      dkimFailed: false,
      cloudflareSpam: true,
      emptySubjectLinkHeavy: signal,
      knownSender: false,
    });

    expect(result.score).toBe(5);
    expect(result.folder).toBe('spam');
  });
});
