import { describe, expect, it } from 'vitest';

import {
  isTrackingPixel,
} from '../src/services/tracking';

import {
  sanitizeEmailHtml,
} from '../src/services/sanitize';

describe('Tracking pixel detection', () => {
  it.each([
    { width: '1', height: '1' },
    { width: '0', height: '0' },
    { width: '0', height: '100' },
    { width: '100', height: '0' },
    { width: '1px', height: '1px' },
    { width: '0.5', height: '0.5' },
    { width: ' 1 ', height: ' 1 ' },
    { hidden: '' },
    { style: 'display:none' },
    { style: 'DISPLAY: NONE' },
    { style: 'display:none !important' },
    { style: 'visibility:hidden' },
    { style: 'visibility:collapse' },
    { style: 'opacity:0' },
    { style: 'opacity:0.0' },
    { style: 'width:1px;height:1px' },
    { style: 'width:0px;height:100px' },
    { style: 'width:100px;height:0px' },
  ])('detects tracking image %#', (attrs) => {
    expect(
      isTrackingPixel(
        attrs as Record<string, string>
      )
    ).toBe(true);
  });

  it.each([
    {},
    { width: '200', height: '100' },
    { width: '1', height: '100' },
    { width: '100', height: '1' },
    { width: '100%' },
    { style: 'display:block' },
    { style: 'opacity:1' },
    { style: 'width:100px;height:100px' },
  ])('preserves normal image %#', (attrs) => {
    expect(
      isTrackingPixel(
        attrs as Record<string, string>
      )
    ).toBe(false);
  });
});

describe('Tracking protection integration', () => {
  const url = 'https://example.com/pixel.gif';

  it('removes one-pixel images', () => {
    expect(sanitizeEmailHtml(
      `<img src="${url}" width="1" height="1">`
    )).toBe('');
  });

  it('removes CSS-sized tracking pixels', () => {
    expect(sanitizeEmailHtml(
      `<img src="${url}" style="width:1px;height:1px">`
    )).toBe('');
  });

  it('removes hidden images', () => {
    expect(sanitizeEmailHtml(
      `<img src="${url}" hidden>`
    )).toBe('');
  });

  it('removes display-none images', () => {
    expect(sanitizeEmailHtml(
      `<img src="${url}" style="display:none">`
    )).toBe('');
  });

  it('removes transparent images', () => {
    expect(sanitizeEmailHtml(
      `<img src="${url}" style="opacity:0">`
    )).toBe('');
  });

  it('preserves legitimate HTTPS images', () => {
    const result = sanitizeEmailHtml(
      '<img src="https://example.com/logo.png" width="200" height="100">'
    );

    expect(result).toContain(
      'https://example.com/logo.png'
    );
  });

  it('preserves original image query parameters', () => {
    const result = sanitizeEmailHtml(
      '<img src="https://example.com/logo.png?v=2&amp;size=200">'
    );

    expect(result).toContain(
      'https://example.com/logo.png?v=2&amp;size=200'
    );
  });

  it('preserves surrounding email content', () => {
    expect(sanitizeEmailHtml(
      `<p>Invoice</p><img src="${url}" width="1" height="1"><p>Thank you</p>`
    )).toBe(
      '<p>Invoice</p><p>Thank you</p>'
    );
  });
});
