import { describe, expect, it } from 'vitest';

import {
  prepareInboundEmail,
} from '../src/services/inbound';

import {
  MAX_BODY_BYTES,
  MAX_ATTACHMENT_BYTES,
} from '../src/services/mime';

const encoder = new TextEncoder();

function stream(raw: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(raw));
      controller.close();
    },
  });
}

function message(
  body: string,
  contentType = 'text/html; charset=UTF-8',
) {
  return [
    'From: Test Sender <sender@example.com>',
    'To: contact@example.com',
    'Subject: SMAIL integration test',
    'Message-ID: <integration@example.com>',
    'MIME-Version: 1.0',
    `Content-Type: ${contentType}`,
    '',
    body,
  ].join('\r\n');
}

async function prepare(raw: string) {
  return prepareInboundEmail(
    stream(raw),
    'sender@example.com',
  );
}

describe('Integrated inbound preparation', () => {
  it('preserves safe HTML', async () => {
    const result = await prepare(
      message('<p>Hello</p>')
    );

    expect(result.html).toBe('<p>Hello</p>');
    expect(result.htmlRemoved).toBe(false);
  });

  it('removes executable HTML', async () => {
    const result = await prepare(
      message(
        '<script>alert(1)</script><p>Safe</p>'
      )
    );

    expect(result.html).toBe('<p>Safe</p>');
  });

  it('removes inline event handlers', async () => {
    const result = await prepare(
      message('<p onclick="test()">Hello</p>')
    );

    expect(result.html).toBe('<p>Hello</p>');
  });

  it('removes malicious links', async () => {
    const result = await prepare(
      message(
        '<a href="javascript:alert(1)">Link</a>'
      )
    );

    expect(result.html).not.toContain('href=');
  });

  it('removes tracking pixels', async () => {
    const result = await prepare(
      message(
        '<img src="https://example.com/p.gif" width="1" height="1"><p>Hello</p>'
      )
    );

    expect(result.html).toBe('<p>Hello</p>');
  });

  it('preserves normal remote images', async () => {
    const result = await prepare(
      message(
        '<img src="https://example.com/logo.png">'
      )
    );

    expect(result.html).toContain(
      'https://example.com/logo.png'
    );
  });

  it('preserves plain text', async () => {
    const result = await prepare(
      message(
        'Professional email',
        'text/plain; charset=UTF-8',
      )
    );

    expect(result.text.trim()).toBe(
      'Professional email'
    );

    expect(result.html).toBe('');
  });

  it('preserves multilingual HTML', async () => {
    const result = await prepare(
      message('<p>বাংলাদেশ 😀</p>')
    );

    expect(result.html).toBe(
      '<p>বাংলাদেশ 😀</p>'
    );
  });

  it('preserves message identity', async () => {
    const result = await prepare(
      message('<p>Hello</p>')
    );

    expect(result.messageId).toBe(
      '<integration@example.com>'
    );

    expect(result.from.address).toBe(
      'sender@example.com'
    );

    expect(result.subject).toBe(
      'SMAIL integration test'
    );
  });

  it('reports completely removed HTML', async () => {
    const result = await prepare(
      message('<script>alert(1)</script>')
    );

    expect(result.html).toBe('');
    expect(result.htmlRemoved).toBe(true);

    expect(result.text).toContain(
      'HTML content removed'
    );
  });

  it('bounds prepared body sizes', async () => {
    const result = await prepare(
      message(
        '<p>' +
        'বাংলাদেশ😀'.repeat(100000) +
        '</p>'
      )
    );

    expect(
      encoder.encode(result.text).length
    ).toBeLessThanOrEqual(MAX_BODY_BYTES);

    expect(
      encoder.encode(result.html).length
    ).toBeLessThanOrEqual(MAX_BODY_BYTES);
  });

  it('reports omitted oversized attachments', async () => {
    const data = Buffer.alloc(
      MAX_ATTACHMENT_BYTES + 1,
      65,
    ).toString('base64');

    const encoded = data.match(/.{1,76}/g)!
      .join('\r\n');

    const raw = [
      'From: sender@example.com',
      'To: contact@example.com',
      'Subject: Attachment test',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="smail-boundary"',
      '',
      '--smail-boundary',
      'Content-Type: text/plain',
      '',
      'Invoice attached.',
      '--smail-boundary',
      'Content-Type: application/octet-stream',
      'Content-Disposition: attachment; filename="large.bin"',
      'Content-Transfer-Encoding: base64',
      '',
      encoded,
      '--smail-boundary--',
      '',
    ].join('\r\n');

    const result = await prepare(raw);

    expect(result.attachments).toHaveLength(0);

    expect(result.omittedAttachments).toContain(
      'large.bin'
    );

    expect(result.text).toContain(
      'Attachment omitted due to size: large.bin'
    );

    expect(result.text).toContain(
      'Invoice attached.'
    );
  });

  it('rejects empty raw messages', async () => {
    await expect(
      prepare('')
    ).rejects.toThrow();
  });
});
