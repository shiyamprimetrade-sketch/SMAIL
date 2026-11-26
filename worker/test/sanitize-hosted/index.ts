import {
  sanitizeEmailHtml,
} from '../../src/services/sanitize';

import {
  MAX_BODY_BYTES,
} from '../../src/services/mime';

import { timingSafeEqual } from 'node:crypto';

interface ProbeEnv {
  PROBE_KEY: string;
}

export default {
  async fetch(
    request: Request,
    env: ProbeEnv,
  ): Promise<Response> {
    const supplied = request.headers.get(
      'Authorization'
    ) ?? '';

    const expected = `Bearer ${env.PROBE_KEY}`;

    const encoder = new TextEncoder();

    const a = encoder.encode(supplied);
    const b = encoder.encode(expected);

    if (
      !env.PROBE_KEY ||
      a.length !== b.length ||
      !timingSafeEqual(a, b)
    ) {
      return new Response(
        'Unauthorized',
        { status: 401 }
      );
    }

    if (request.method !== 'POST') {
      return new Response(
        'Method not allowed',
        { status: 405 }
      );
    }

    const test = new URL(request.url).pathname;

    const started = Date.now();

    let ok = false;

    try {
      switch (test) {
        case '/basic':
          ok = sanitizeEmailHtml(
            '<p>Hello</p>'
          ) === '<p>Hello</p>';
          break;

        case '/unicode':
          ok = sanitizeEmailHtml(
            '<p>বাংলাদেশ 😀</p>'
          ) === '<p>বাংলাদেশ 😀</p>';
          break;

        case '/script':
          ok = sanitizeEmailHtml(
            '<script>alert(1)</script><p>Safe</p>'
          ) === '<p>Safe</p>';
          break;

        case '/encoded-url':
          ok = !sanitizeEmailHtml(
            '<a href="jav&#x61;script:alert(1)">Click</a>'
          ).includes('href=');
          break;

        case '/tracking':
          ok = sanitizeEmailHtml(
            '<img src="https://example.com/p.gif" width="1" height="1">'
          ) === '';
          break;

        case '/hidden-image':
          ok = sanitizeEmailHtml(
            '<img src="https://example.com/p.gif" style="display:none">'
          ) === '';
          break;

        case '/normal-image':
          ok = sanitizeEmailHtml(
            '<img src="https://example.com/logo.png">'
          ).includes(
            'https://example.com/logo.png'
          );
          break;

        case '/malformed':
          {
            const result = sanitizeEmailHtml(
              '<div><p>Hello<script>alert(1)</script>'
            );

            ok = result.includes('Hello') &&
              !result.includes('<script');
          }
          break;

        case '/nesting':
          {
            const result = sanitizeEmailHtml(
              '<div>'.repeat(1000) +
              'Content' +
              '</div>'.repeat(1000)
            );

            ok = (
              result.match(/<div>/g) ?? []
            ).length <= 64;
          }
          break;

        case '/large-body':
          {
            const result = sanitizeEmailHtml(
              '<p>' +
              'x'.repeat(MAX_BODY_BYTES) +
              '</p>'
            );

            ok = encoder.encode(result).length
              <= MAX_BODY_BYTES;
          }
          break;

        case '/expansion':
          ok = sanitizeEmailHtml(
            '&'.repeat(MAX_BODY_BYTES)
          ) === '';
          break;

        case '/idempotence':
          {
            const first = sanitizeEmailHtml(
              '<p onclick="test()">Hello</p>' +
              '<a href="https://example.com">Link</a>'
            );

            ok = sanitizeEmailHtml(first) === first;
          }
          break;

        default:
          return new Response(
            'Not found',
            { status: 404 }
          );
      }

      return Response.json({
        ok,
        test,
        elapsedMs: Date.now() - started,
      }, {
        status: ok ? 200 : 500,
      });

    } catch (error) {
      return Response.json({
        ok: false,
        test,
        error: String(error),
      }, {
        status: 500,
      });
    }
  },
};
