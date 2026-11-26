import {
  parseEmail,
  truncateUtf8,
  MAX_BODY_BYTES,
  type ParsedEmail,
} from './mime';

import {
  sanitizeEmailHtml,
} from './sanitize';

export interface PreparedEmail extends ParsedEmail {
  htmlRemoved: boolean;
}

export async function prepareInboundEmail(
  stream: ReadableStream<Uint8Array>,
  envelopeFrom: string,
): Promise<PreparedEmail> {
  const parsed = await parseEmail(
    stream,
    envelopeFrom,
  );

  // Normalize trailing MIME whitespace after sanitization.
  // Whitespace-only output must not count as safe HTML.
  const html = sanitizeEmailHtml(parsed.html).trimEnd();

  const htmlRemoved =
    parsed.html.length > 0 &&
    html.length === 0;

  const notices: string[] = [];

  if (htmlRemoved) {
    notices.push(
      '[HTML content removed by email security protection.]'
    );
  }

  for (const filename of parsed.omittedAttachments) {
    const safeName = truncateUtf8(
      filename.replace(/[\u0000-\u001f\u007f]/g, ' '),
      512,
    );

    notices.push(
      `[Attachment omitted due to size: ${safeName}]`
    );
  }

  let text = parsed.text;

  if (!text.trim() && parsed.html) {
    text = html
      ? '[This message contains HTML content.]'
      : '[No safe HTML content is available.]';
  }

  if (notices.length > 0) {
    const notice = truncateUtf8(
      notices.join('\n'),
      64_000,
    );

    const noticeBytes =
      new TextEncoder().encode(notice).length;

    text =
      truncateUtf8(
        text,
        MAX_BODY_BYTES - noticeBytes - 2,
      ) +
      '\n\n' +
      notice;
  }

  return {
    ...parsed,
    text: truncateUtf8(text),
    html,
    htmlRemoved,
  };
}
