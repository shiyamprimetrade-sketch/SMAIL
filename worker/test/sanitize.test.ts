import { describe, expect, it } from 'vitest';

import {
  sanitizeEmailHtml,
} from '../src/services/sanitize';

import {
  MAX_BODY_BYTES,
} from '../src/services/mime';

describe('Email HTML security engine', () => {
  it('handles empty HTML', () => {
    expect(sanitizeEmailHtml('')).toBe('');
  });

  it('preserves paragraphs', () => {
    expect(sanitizeEmailHtml('<p>Hello</p>'))
      .toBe('<p>Hello</p>');
  });

  it('preserves formatted text', () => {
    expect(sanitizeEmailHtml(
      '<strong>Hello</strong>'
    )).toBe('<strong>Hello</strong>');
  });

  it('preserves Bengali text', () => {
    expect(sanitizeEmailHtml(
      '<p>বাংলাদেশ</p>'
    )).toContain('বাংলাদেশ');
  });

  it('preserves email tables', () => {
    expect(sanitizeEmailHtml(
      '<table><tr><td>Invoice</td></tr></table>'
    )).toContain('<td>Invoice</td>');
  });

  it.each([
    'script',
    'iframe',
    'object',
    'embed',
    'form',
    'svg',
    'math',
    'template',
  ])('removes forbidden tag %s', (tag) => {
    const input = `<${tag}>unsafe</${tag}>`;

    expect(sanitizeEmailHtml(input))
      .not.toContain(`<${tag}`);
  });

  it('removes script contents', () => {
    expect(sanitizeEmailHtml(
      '<script>alert(1)</script><p>Safe</p>'
    )).toBe('<p>Safe</p>');
  });

  it('removes event handlers', () => {
    const result = sanitizeEmailHtml(
      '<p onclick="alert(1)" onmouseover="test()">Hello</p>'
    );

    expect(result).toBe('<p>Hello</p>');
  });

  it('removes inline CSS', () => {
    expect(sanitizeEmailHtml(
      '<p style="color:red">Hello</p>'
    )).toBe('<p>Hello</p>');
  });

  it.each([
    'javascript:alert(1)',
    'jav&#x61;script:alert(1)',
    'data:text/html,test',
    'vbscript:test',
    'file:///private/file',
    '//example.com',
    '/relative/path',
    'http://example.com',
    'https://user:pass@example.com',
  ])('rejects unsafe link %s', (url) => {
    const result = sanitizeEmailHtml(
      `<a href="${url}">Click</a>`
    );

    expect(result).not.toContain('href=');
  });

  it('preserves HTTPS links', () => {
    const result = sanitizeEmailHtml(
      '<a href="https://example.com">Visit</a>'
    );

    expect(result).toContain(
      'href="https://example.com"'
    );

    expect(result).toContain(
      'rel="noopener noreferrer"'
    );
  });

  it('preserves mailto links', () => {
    expect(sanitizeEmailHtml(
      '<a href="mailto:test@example.com">Email</a>'
    )).toContain('mailto:test@example.com');
  });

  it('preserves HTTPS images', () => {
    expect(sanitizeEmailHtml(
      '<img src="https://example.com/logo.png">'
    )).toContain(
      'https://example.com/logo.png'
    );
  });

  it('removes unsafe image sources', () => {
    expect(sanitizeEmailHtml(
      '<img src="data:image/svg+xml,test">'
    )).toBe('');
  });

  it('removes image event handlers', () => {
    expect(sanitizeEmailHtml(
      '<img src="https://example.com/a.png" onerror="alert(1)">'
    )).not.toContain('onerror');
  });

  it('removes alternate image sources', () => {
    expect(sanitizeEmailHtml(
      '<img src="https://example.com/a.png" srcset="https://example.com/b.png 2x">'
    )).not.toContain('srcset');
  });

  it('removes document redirects', () => {
    expect(sanitizeEmailHtml(
      '<meta http-equiv="refresh" content="0;url=https://example.com">'
    )).toBe('');
  });

  it('enforces output byte limit', () => {
    const result = sanitizeEmailHtml(
      '<p>' + 'x'.repeat(MAX_BODY_BYTES) + '</p>'
    );

    expect(
      new TextEncoder().encode(result).length
    ).toBeLessThanOrEqual(MAX_BODY_BYTES);
  });

  it('fails closed on excessive output', () => {
    const result = sanitizeEmailHtml(
      '&'.repeat(MAX_BODY_BYTES)
    );

    expect(result).toBe('');
  });

  it('is stable under repeated sanitization', () => {
    const input =
      '<p onclick="test()">Hello</p>' +
      '<a href="https://example.com">Link</a>';

    const first = sanitizeEmailHtml(input);

    expect(sanitizeEmailHtml(first))
      .toBe(first);
  });
});
