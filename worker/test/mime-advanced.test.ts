import { describe, expect, it } from 'vitest';

import {
  parseEmail,
  truncateUtf8,
  MAX_ATTACHMENT_BYTES,
  MAX_BODY_BYTES,
} from '../src/services/mime';

function stream(raw: string) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(raw)
      );
      controller.close();
    },
  });
}

async function parse(raw: string) {
  return parseEmail(
    stream(raw),
    'fallback@example.com'
  );
}

function attachmentEmail(size: number) {
  const encoded = Buffer.alloc(size, 65)
    .toString('base64')
    .match(/.{1,76}/g)?.join('\r\n') ?? '';

  return [
    'From: sender@example.com',
    'To: contact@slickk.online',
    'Subject: Attachment boundary test',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="test"',
    '',
    '--test',
    'Content-Type: text/plain',
    '',
    'Attachment test body',
    '--test',
    'Content-Type: application/octet-stream',
    'Content-Disposition: attachment; filename="sample.bin"',
    'Content-Transfer-Encoding: base64',
    '',
    encoded,
    '--test--',
  ].join('\r\n');
}

describe('Advanced inbound MIME validation', () => {
  it('accepts an attachment at the exact limit', async () => {
    const email = await parse(
      attachmentEmail(MAX_ATTACHMENT_BYTES)
    );

    expect(email.attachments).toHaveLength(1);

    expect(email.attachments[0].size)
      .toBe(MAX_ATTACHMENT_BYTES);

    expect(email.omittedAttachments)
      .toHaveLength(0);
  });

  it('omits an oversized attachment', async () => {
    const email = await parse(
      attachmentEmail(MAX_ATTACHMENT_BYTES + 1)
    );

    expect(email.attachments).toHaveLength(0);

    expect(email.omittedAttachments)
      .toEqual(['sample.bin']);

    expect(email.text)
      .toContain('Attachment test body');
  });

  it('decodes encoded Unicode subjects', async () => {
    const subject = 'বাংলাদেশ';

    const encoded = Buffer.from(subject)
      .toString('base64');

    const email = await parse([
      'From: sender@example.com',
      `Subject: =?UTF-8?B?${encoded}?=`,
      '',
      'Hello',
    ].join('\r\n'));

    expect(email.subject).toBe(subject);
  });

  it('preserves Bengali email content', async () => {
    const email = await parse([
      'From: sender@example.com',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'বাংলাদেশ থেকে শুভেচ্ছা',
    ].join('\r\n'));

    expect(email.text)
      .toContain('বাংলাদেশ থেকে শুভেচ্ছা');
  });

  it('decodes quoted printable content', async () => {
    const email = await parse([
      'From: sender@example.com',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Hello=20World=21',
    ].join('\r\n'));

    expect(email.text)
      .toContain('Hello World!');
  });

  it('extracts multiple recipients', async () => {
    const email = await parse([
      'From: sender@example.com',
      'To: a@example.com, b@example.com',
      'Cc: c@example.com',
      'Bcc: d@example.com',
      '',
      'Hello',
    ].join('\r\n'));

    expect(email.to.map(x => x.address))
      .toEqual(['a@example.com', 'b@example.com']);

    expect(email.cc[0].address)
      .toBe('c@example.com');

    expect(email.bcc[0].address)
      .toBe('d@example.com');
  });

  it('extracts reply-to address', async () => {
    const email = await parse([
      'From: sender@example.com',
      'Reply-To: reply@example.com',
      '',
      'Hello',
    ].join('\r\n'));

    expect(email.replyTo[0].address)
      .toBe('reply@example.com');
  });

  it('handles missing message identifiers', async () => {
    const email = await parse([
      'From: sender@example.com',
      '',
      'Hello',
    ].join('\r\n'));

    expect(email.messageId).toBeNull();
    expect(email.inReplyTo).toBeNull();
    expect(email.references).toEqual([]);
  });

  it('handles missing subject', async () => {
    const email = await parse([
      'From: sender@example.com',
      '',
      'Hello',
    ].join('\r\n'));

    expect(email.subject).toBe('');
  });

  it('preserves both multipart alternatives', async () => {
    const email = await parse([
      'From: sender@example.com',
      'MIME-Version: 1.0',
      'Content-Type: multipart/alternative; boundary="alt"',
      '',
      '--alt',
      'Content-Type: text/plain',
      '',
      'Plain message',
      '--alt',
      'Content-Type: text/html',
      '',
      '<p>HTML message</p>',
      '--alt--',
    ].join('\r\n'));

    expect(email.text)
      .toContain('Plain message');

    expect(email.html)
      .toContain('<p>HTML message</p>');
  });

  it('extracts inline attachment metadata', async () => {
    const email = await parse([
      'From: sender@example.com',
      'MIME-Version: 1.0',
      'Content-Type: multipart/related; boundary="inline"',
      '',
      '--inline',
      'Content-Type: text/html',
      '',
      '<img src="cid:logo@example.com">',
      '--inline',
      'Content-Type: image/png',
      'Content-Disposition: inline; filename="logo.png"',
      'Content-ID: <logo@example.com>',
      'Content-Transfer-Encoding: base64',
      '',
      'AAECAw==',
      '--inline--',
    ].join('\r\n'));

    expect(email.attachments).toHaveLength(1);

    expect(email.attachments[0].isInline)
      .toBe(true);

    expect(email.attachments[0].contentId)
      .toContain('logo@example.com');
  });

  it('preserves complete emoji boundaries', () => {
    expect(truncateUtf8('A😀B', 4))
      .toBe('A');

    expect(truncateUtf8('A😀B', 5))
      .toBe('A😀');
  });

  it('limits large multilingual bodies by bytes', () => {
    const input = 'বাংলা'.repeat(100000);
    const output = truncateUtf8(input);

    expect(
      new TextEncoder().encode(output).length
    ).toBeLessThanOrEqual(MAX_BODY_BYTES);

    expect(output.includes('\uFFFD'))
      .toBe(false);
  });

  it('limits large parsed email bodies', async () => {
    const email = await parse([
      'From: sender@example.com',
      'Content-Type: text/plain; charset=UTF-8',
      '',
      'x'.repeat(MAX_BODY_BYTES + 1000),
    ].join('\r\n'));

    expect(
      new TextEncoder().encode(email.text).length
    ).toBeLessThanOrEqual(MAX_BODY_BYTES);
  });
});
