import { describe, expect, it } from 'vitest';

import {
  sanitizeEmailHtml,
} from '../src/services/sanitize';

import {
  MAX_BODY_BYTES,
} from '../src/services/mime';

describe('Adversarial email HTML security', () => {
  it.each([
    'JaVaScRiPt:alert(1)',
    'javascript&#58;alert(1)',
    '&#106;avascript:alert(1)',
    'java&#9;script:alert(1)',
    'java&#10;script:alert(1)',
    'java&#13;script:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,test',
    'blob:https://example.com/test',
    'ftp://example.com/test',
    'file:///etc/passwd',
    'intent://example.com',
  ])('rejects obfuscated URL %#', (url) => {
    const output = sanitizeEmailHtml(
      `<a href="${url}">Click</a>`
    );

    expect(output).not.toContain('href=');
  });

  it.each([
    '<SCRIPT>alert(1)</SCRIPT>',
    '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
    '<svg><script>alert(1)</script></svg>',
    '<math><script>alert(1)</script></math>',
    '<object><script>alert(1)</script></object>',
    '<form><button>Submit</button></form>',
    '<template><script>alert(1)</script></template>',
    '<style>body{display:none}</style>',
  ])('removes dangerous markup %#', (html) => {
    const output = sanitizeEmailHtml(html);

    expect(output).not.toMatch(
      /<(script|iframe|svg|math|object|form|button|template|style)\b/i
    );
  });

  it.each([
    'onclick',
    'onload',
    'onerror',
    'onfocus',
    'onpointerenter',
    'onanimationstart',
  ])('removes event attribute %s', (name) => {
    const output = sanitizeEmailHtml(
      `<p ${name}="alert(1)">Safe</p>`
    );

    expect(output).toBe('<p>Safe</p>');
  });

  it('removes unquoted event handlers', () => {
    expect(sanitizeEmailHtml(
      '<img src=https://example.com/a.png onerror=alert(1)>'
    )).not.toContain('onerror');
  });

  it('removes external stylesheet references', () => {
    expect(sanitizeEmailHtml(
      '<link rel="stylesheet" href="https://example.com/a.css">'
    )).toBe('');
  });

  it('removes base URL overrides', () => {
    expect(sanitizeEmailHtml(
      '<base href="https://example.com/">'
    )).toBe('');
  });

  it('removes image source alternatives', () => {
    const output = sanitizeEmailHtml(
      '<picture><source srcset="https://example.com/a.png"><img src="https://example.com/b.png"></picture>'
    );

    expect(output).not.toContain('<source');
    expect(output).not.toContain('srcset');
    expect(output).toContain(
      'https://example.com/b.png'
    );
  });

  it('removes encoded tracking dimensions', () => {
    expect(sanitizeEmailHtml(
      '<img src="https://example.com/pixel.gif" width="&#49;" height="&#49;">'
    )).toBe('');
  });

  it('removes uppercase tracking attributes', () => {
    expect(sanitizeEmailHtml(
      '<IMG SRC="https://example.com/pixel.gif" WIDTH="1" HEIGHT="1">'
    )).toBe('');
  });

  it('removes hidden tracking pixels', () => {
    expect(sanitizeEmailHtml(
      '<img src="https://example.com/pixel.gif" style="visibility:hidden!important">'
    )).toBe('');
  });

  it('preserves valid HTTPS query parameters', () => {
    const output = sanitizeEmailHtml(
      '<a href="https://example.com/?a=1&amp;b=2">Link</a>'
    );

    expect(output).toContain(
      'https://example.com/?a=1&amp;b=2'
    );
  });

  it('preserves multilingual text', () => {
    const output = sanitizeEmailHtml(
      '<p>বাংলাদেশ 日本語 العربية 😀</p>'
    );

    expect(output).toBe(
      '<p>বাংলাদেশ 日本語 العربية 😀</p>'
    );
  });

  it('handles malformed HTML safely', () => {
    const output = sanitizeEmailHtml(
      '<div><p>Hello<script>alert(1)</script>'
    );

    expect(output).toContain('Hello');
    expect(output).not.toContain('<script');
  });

  it('limits deeply nested markup', () => {
    const input =
      '<div>'.repeat(1000) +
      'Safe content' +
      '</div>'.repeat(1000);

    const output = sanitizeEmailHtml(input);

    const tags = output.match(/<div>/g) ?? [];

    expect(tags.length).toBeLessThanOrEqual(64);
  });

  it('bounds large multilingual input', () => {
    const input =
      '<p>' + 'বাংলাদেশ😀'.repeat(100000) + '</p>';

    const output = sanitizeEmailHtml(input);

    expect(
      new TextEncoder().encode(output).length
    ).toBeLessThanOrEqual(MAX_BODY_BYTES);
  });

  it('bounds repeated HTML entities', () => {
    const output = sanitizeEmailHtml(
      '&'.repeat(MAX_BODY_BYTES)
    );

    expect(
      new TextEncoder().encode(output).length
    ).toBeLessThanOrEqual(MAX_BODY_BYTES);
  });

  it('remains stable after repeated sanitization', () => {
    const input =
      '<div onclick="test()">' +
      '<a href="javascript:alert(1)">Unsafe</a>' +
      '<img src="https://example.com/p.gif" width="1" height="1">' +
      '<p>Safe content</p></div>';

    const first = sanitizeEmailHtml(input);

    expect(sanitizeEmailHtml(first)).toBe(first);
    expect(first).toContain('Safe content');
    expect(first).not.toContain('javascript:');
    expect(first).not.toContain('<img');
  });
});
