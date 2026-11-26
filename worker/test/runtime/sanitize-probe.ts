import {
  sanitizeEmailHtml,
} from '../../src/services/sanitize';

import {
  MAX_BODY_BYTES,
} from '../../src/services/mime';

export default {
  async fetch(): Promise<Response> {
    const started = Date.now();

    const checks: Record<string, boolean> = {};

    checks.paragraph =
      sanitizeEmailHtml('<p>Hello</p>') ===
      '<p>Hello</p>';

    checks.unicode =
      sanitizeEmailHtml('<p>বাংলাদেশ 😀</p>') ===
      '<p>বাংলাদেশ 😀</p>';

    checks.script =
      sanitizeEmailHtml(
        '<script>alert(1)</script><p>Safe</p>'
      ) === '<p>Safe</p>';

    checks.eventHandler =
      sanitizeEmailHtml(
        '<p onclick="alert(1)">Safe</p>'
      ) === '<p>Safe</p>';

    checks.javascriptUrl =
      !sanitizeEmailHtml(
        '<a href="javascript:alert(1)">Click</a>'
      ).includes('href=');

    checks.encodedUrl =
      !sanitizeEmailHtml(
        '<a href="jav&#x61;script:alert(1)">Click</a>'
      ).includes('href=');

    checks.iframe =
      sanitizeEmailHtml(
        '<iframe src="https://example.com"></iframe>'
      ) === '';

    checks.form =
      sanitizeEmailHtml(
        '<form><input name="password"></form>'
      ) === '';

    checks.trackingPixel =
      sanitizeEmailHtml(
        '<img src="https://example.com/p.gif" width="1" height="1">'
      ) === '';

    checks.hiddenImage =
      sanitizeEmailHtml(
        '<img src="https://example.com/p.gif" style="display:none">'
      ) === '';

    checks.normalImage =
      sanitizeEmailHtml(
        '<img src="https://example.com/logo.png" width="200" height="100">'
      ).includes(
        'https://example.com/logo.png'
      );

    checks.httpsLink =
      sanitizeEmailHtml(
        '<a href="https://example.com">Visit</a>'
      ).includes(
        'href="https://example.com"'
      );

    checks.table =
      sanitizeEmailHtml(
        '<table><tr><td>Invoice</td></tr></table>'
      ).includes('<td>Invoice</td>');

    const large = sanitizeEmailHtml(
      '<p>' +
      'x'.repeat(MAX_BODY_BYTES) +
      '</p>'
    );

    checks.bodyLimit =
      new TextEncoder().encode(large).length
      <= MAX_BODY_BYTES;

    checks.outputExpansion =
      sanitizeEmailHtml(
        '&'.repeat(MAX_BODY_BYTES)
      ) === '';

    const nested = sanitizeEmailHtml(
      '<div>'.repeat(1000) +
      'Content' +
      '</div>'.repeat(1000)
    );

    checks.nestingLimit =
      (nested.match(/<div>/g) ?? []).length
      <= 64;

    const malformed = sanitizeEmailHtml(
      '<div><p>Hello<script>alert(1)</script>'
    );

    checks.malformed =
      malformed.includes('Hello') &&
      !malformed.includes('<script');

    const first = sanitizeEmailHtml(
      '<p onclick="test()">Hello</p>' +
      '<a href="https://example.com">Link</a>'
    );

    checks.idempotence =
      sanitizeEmailHtml(first) === first;

    const passed = Object.values(checks)
      .filter(Boolean).length;

    const total = Object.keys(checks).length;

    return Response.json({
      ok: passed === total,
      passed,
      total,
      elapsedMs: Date.now() - started,
      checks,
    }, {
      status: passed === total ? 200 : 500,
    });
  },
};
