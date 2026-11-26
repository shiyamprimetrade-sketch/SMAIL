import sanitizeHtml from 'sanitize-html';
import { isTrackingPixel } from './tracking';

import {
  truncateUtf8,
  MAX_BODY_BYTES,
} from './mime';

export const ALLOWED_EMAIL_TAGS = [
  'p', 'div', 'span', 'br', 'hr',
  'strong', 'b', 'em', 'i', 'u',
  's', 'del', 'sub', 'sup',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'code',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tfoot',
  'tr', 'td', 'th', 'caption',
  'a', 'img',
];

function safeUrl(
  value: string | undefined,
  image: boolean,
): boolean {
  if (!value) return false;

  if (/[\u0000-\u0020\u007f]/.test(value)) {
    return false;
  }

  try {
    const url = new URL(value);

    if (url.protocol === 'https:') {
      return Boolean(url.hostname) &&
        !url.username &&
        !url.password;
    }

    return !image &&
      url.protocol === 'mailto:' &&
      Boolean(url.pathname);

  } catch {
    return false;
  }
}

export function sanitizeEmailHtml(
  html: string,
): string {
  if (!html) return '';

  const input = truncateUtf8(
    html,
    MAX_BODY_BYTES,
  );

  const output = sanitizeHtml(input, {
    allowedTags: ALLOWED_EMAIL_TAGS,

    allowedAttributes: {
      a: ['href', 'title', 'rel'],
      img: ['src', 'alt', 'width', 'height'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan'],
    },

    allowedSchemes: ['https', 'mailto'],

    allowedSchemesByTag: {
      img: ['https'],
    },

    allowProtocolRelative: false,

    disallowedTagsMode: 'discard',

    nonTextTags: [
      'script', 'style', 'textarea',
      'option', 'iframe', 'object',
      'embed', 'form', 'svg', 'math',
      'noscript', 'template',
    ],

    nestingLimit: 64,

    transformTags: {
      a: (_tagName, attribs) => {
        const attrs = { ...attribs };

        if (!safeUrl(attrs.href, false)) {
          delete attrs.href;
        }

        attrs.rel = 'noopener noreferrer';

        return {
          tagName: 'a',
          attribs: attrs,
        };
      },

      img: (_tagName, attribs) => {
        const attrs = { ...attribs };

        if (
          isTrackingPixel(attrs) ||
          !safeUrl(attrs.src, true)
        ) {
          delete attrs.src;
        }

        return {
          tagName: 'img',
          attribs: attrs,
        };
      },
    },

    exclusiveFilter: (frame) =>
      frame.tag === 'img' &&
      !frame.attribs.src,
  });

  // Fail closed rather than truncate serialized
  // HTML inside a tag or attribute.
  if (
    new TextEncoder().encode(output).byteLength >
    MAX_BODY_BYTES
  ) {
    return '';
  }

  return output;
}
