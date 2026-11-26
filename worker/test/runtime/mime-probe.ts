import {
  parseEmail,
  MAX_ATTACHMENT_BYTES,
  MAX_BODY_BYTES,
} from '../../src/services/mime';

import {
  readBoundedStream,
  EmailTooLargeError,
} from '../../src/services/streams';

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

export default {
  async fetch(request: Request): Promise<Response> {
    const checks: Record<string, boolean> = {};

    const started = Date.now();

    try {
      const raw = [
        'From: Test Sender <sender@example.com>',
        'To: contact@slickk.online',
        'Subject: Runtime verification',
        'Message-ID: <runtime@example.com>',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary="test"',
        '',
        '--test',
        'Content-Type: text/plain; charset=UTF-8',
        '',
        'Hello বাংলাদেশ',
        '--test',
        'Content-Type: application/octet-stream',
        'Content-Disposition: attachment; filename="test.bin"',
        'Content-Transfer-Encoding: base64',
        '',
        'AAH/',
        '--test--',
      ].join('\r\n');

      const email = await parseEmail(
        stream(raw),
        'fallback@example.com',
      );

      checks.sender =
        email.from.address === 'sender@example.com';

      checks.senderName =
        email.from.name === 'Test Sender';

      checks.recipient =
        email.to[0]?.address === 'contact@slickk.online';

      checks.subject =
        email.subject === 'Runtime verification';

      checks.messageId =
        email.messageId === '<runtime@example.com>';

      checks.unicode =
        email.text.includes('বাংলাদেশ');

      checks.attachmentCount =
        email.attachments.length === 1;

      checks.attachmentName =
        email.attachments[0]?.filename === 'test.bin';

      checks.attachmentBytes =
        Array.from(
          email.attachments[0]?.data ?? []
        ).join(',') === '0,1,255';

      checks.rawSize =
        email.rawSize ===
        new TextEncoder().encode(raw).length;

      const large = await parseEmail(
        stream([
          'From: sender@example.com',
          'Content-Type: text/plain',
          '',
          'x'.repeat(MAX_BODY_BYTES + 100),
        ].join('\r\n')),
        '',
      );

      checks.bodyLimit =
        new TextEncoder().encode(large.text)
          .byteLength <= MAX_BODY_BYTES;

      const attachment = new Uint8Array(
        MAX_ATTACHMENT_BYTES + 1
      );

      const encoded = Buffer.from(attachment)
        .toString('base64')
        .match(/.{1,76}/g)?.join('\r\n') ?? '';

      const oversized = await parseEmail(
        stream([
          'From: sender@example.com',
          'MIME-Version: 1.0',
          'Content-Type: multipart/mixed; boundary="large"',
          '',
          '--large',
          'Content-Type: text/plain',
          '',
          'Test body',
          '--large',
          'Content-Type: application/octet-stream',
          'Content-Disposition: attachment; filename="large.bin"',
          'Content-Transfer-Encoding: base64',
          '',
          encoded,
          '--large--',
        ].join('\r\n')),
        '',
      );

      checks.oversizedAttachment =
        oversized.attachments.length === 0 &&
        oversized.omittedAttachments[0] === 'large.bin';

      try {
        await readBoundedStream(
          stream('123456'), 5
        );

        checks.streamOverflow = false;
      } catch (error) {
        checks.streamOverflow =
          error instanceof EmailTooLargeError;
      }

      const passed = Object.values(checks)
        .filter(Boolean).length;

      const total = Object.keys(checks).length;

      return Response.json({
        ok: passed === total,
        passed,
        total,
        checks,
        elapsedMs: Date.now() - started,
      }, {
        status: passed === total ? 200 : 500,
      });

    } catch (error) {
      return Response.json({
        ok: false,
        error: String(error),
        checks,
      }, { status: 500 });
    }
  },
};
