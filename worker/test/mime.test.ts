import { describe, expect, it } from 'vitest';

import {
  parseEmail,
  truncateUtf8,
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

const basic = [
  'From: Test Sender <sender@example.com>',
  'To: contact@slickk.online',
  'Subject: SMAIL Test',
  'Message-ID: <test@example.com>',
  'MIME-Version: 1.0',
  'Content-Type: text/plain; charset=UTF-8',
  '',
  'Hello SMAIL',
].join('\r\n');

describe('Inbound MIME processing', () => {
  it('extracts sender information', async () => {
    const result = await parseEmail(
      stream(basic), 'fallback@example.com'
    );

    expect(result.from.address)
      .toBe('sender@example.com');

    expect(result.from.name)
      .toBe('Test Sender');
  });

  it('extracts recipients', async () => {
    const result = await parseEmail(
      stream(basic), ''
    );

    expect(result.to[0].address)
      .toBe('contact@slickk.online');
  });

  it('extracts subject and message ID', async () => {
    const result = await parseEmail(
      stream(basic), ''
    );

    expect(result.subject).toBe('SMAIL Test');

    expect(result.messageId)
      .toBe('<test@example.com>');
  });

  it('extracts plain text', async () => {
    const result = await parseEmail(
      stream(basic), ''
    );

    expect(result.text).toContain('Hello SMAIL');
  });

  it('records raw message size', async () => {
    const result = await parseEmail(
      stream(basic), ''
    );

    expect(result.rawSize).toBe(
      new TextEncoder().encode(basic).length
    );
  });

  it('extracts conversation references', async () => {
    const raw = basic.replace(
      'MIME-Version:',
      'In-Reply-To: <parent@example.com>\r\n' +
      'References: <first@example.com> ' +
      '<parent@example.com>\r\nMIME-Version:'
    );

    const result = await parseEmail(
      stream(raw), ''
    );

    expect(result.inReplyTo)
      .toBe('<parent@example.com>');

    expect(result.references).toEqual([
      '<first@example.com>',
      '<parent@example.com>',
    ]);
  });

  it('uses envelope sender when missing', async () => {
    const raw = 'Subject: Test\r\n\r\nHello';

    const result = await parseEmail(
      stream(raw), 'fallback@example.com'
    );

    expect(result.from.address)
      .toBe('fallback@example.com');
  });

  it('rejects empty raw email', async () => {
    await expect(parseEmail(stream(''), ''))
      .rejects.toThrow('Empty email');
  });

  it('preserves short Unicode text', () => {
    expect(truncateUtf8('বাংলাদেশ', 100))
      .toBe('বাংলাদেশ');
  });

  it('does not split Unicode characters', () => {
    expect(truncateUtf8('A€B', 3))
      .toBe('A');
  });

  it('enforces the stored body limit', () => {
    const value = 'x'.repeat(MAX_BODY_BYTES + 10);

    expect(truncateUtf8(value).length)
      .toBe(MAX_BODY_BYTES);
  });

  it('extracts HTML content', async () => {
    const raw = [
      'From: sender@example.com',
      'Subject: HTML test',
      'Content-Type: text/html; charset=UTF-8',
      '',
      '<p>Hello SMAIL</p>',
    ].join('\r\n');

    const result = await parseEmail(
      stream(raw), ''
    );

    expect(result.html)
      .toContain('<p>Hello SMAIL</p>');
  });

  it('decodes a binary attachment', async () => {
    const raw = [
      'From: sender@example.com',
      'Subject: Attachment test',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="abc"',
      '',
      '--abc',
      'Content-Type: text/plain',
      '',
      'Attached file',
      '--abc',
      'Content-Type: application/octet-stream',
      'Content-Disposition: attachment; filename="test.bin"',
      'Content-Transfer-Encoding: base64',
      '',
      'AAH/',
      '--abc--',
    ].join('\r\n');

    const result = await parseEmail(
      stream(raw), ''
    );

    expect(result.attachments.length).toBe(1);

    expect(result.attachments[0].filename)
      .toBe('test.bin');

    expect(result.attachments[0].data)
      .toEqual(new Uint8Array([0, 1, 255]));

    expect(result.attachments[0].size).toBe(3);
  });
});
