import {
  parseEmail,
  MAX_ATTACHMENT_BYTES,
  MAX_BODY_BYTES,
} from '../../src/services/mime';

import {
  readBoundedStream,
  MAX_RAW_EMAIL_BYTES,
  EmailTooLargeError,
} from '../../src/services/streams';

function stream(data: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });
}

function rawEmail(body: string) {
  return new TextEncoder().encode([
    'From: Test Sender <sender@example.com>',
    'To: contact@slickk.online',
    'Subject: Hosted MIME verification',
    'Message-ID: <hosted@example.com>',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body,
  ].join('\r\n'));
}

export default {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    const started = Date.now();

    try {
      let ok = false;

      switch (path) {
        case '/small': {
          const email = await parseEmail(
            stream(rawEmail('Hello SMAIL')),
            '',
          );

          ok =
            email.from.address === 'sender@example.com' &&
            email.subject === 'Hosted MIME verification' &&
            email.text.includes('Hello SMAIL');

          break;
        }

        case '/unicode': {
          const email = await parseEmail(
            stream(rawEmail('বাংলাদেশ 😀')),
            '',
          );

          ok = email.text.includes('বাংলাদেশ 😀');
          break;
        }

        case '/body': {
          const email = await parseEmail(
            stream(rawEmail(
              'x'.repeat(MAX_BODY_BYTES + 100)
            )),
            '',
          );

          ok =
            new TextEncoder().encode(email.text)
              .byteLength === MAX_BODY_BYTES;

          break;
        }

        case '/attachment-small':
        case '/attachment-limit':
        case '/attachment-overflow': {
          const size =
            path === '/attachment-small'
              ? 1024
              : path === '/attachment-limit'
                ? MAX_ATTACHMENT_BYTES
                : MAX_ATTACHMENT_BYTES + 1;

          const encoded = Buffer.alloc(size, 65)
            .toString('base64')
            .match(/.{1,76}/g)?.join('\r\n') ?? '';

          const raw = new TextEncoder().encode([
            'From: sender@example.com',
            'Subject: Attachment verification',
            'MIME-Version: 1.0',
            'Content-Type: multipart/mixed; boundary="test"',
            '',
            '--test',
            'Content-Type: text/plain',
            '',
            'Test body',
            '--test',
            'Content-Type: application/octet-stream',
            'Content-Disposition: attachment; filename="test.bin"',
            'Content-Transfer-Encoding: base64',
            '',
            encoded,
            '--test--',
          ].join('\r\n'));

          const email = await parseEmail(
            stream(raw), ''
          );

          ok = size > MAX_ATTACHMENT_BYTES
            ? email.attachments.length === 0 &&
              email.omittedAttachments[0] === 'test.bin'
            : email.attachments.length === 1 &&
              email.attachments[0].size === size &&
              email.attachments[0].data[0] === 65;

          break;
        }

        case '/raw-limit': {
          const data = await readBoundedStream(
            stream(new Uint8Array(MAX_RAW_EMAIL_BYTES))
          );

          ok = data.byteLength === MAX_RAW_EMAIL_BYTES;
          break;
        }

        case '/raw-overflow': {
          try {
            await readBoundedStream(
              stream(new Uint8Array(
                MAX_RAW_EMAIL_BYTES + 1
              ))
            );
          } catch (error) {
            ok = error instanceof EmailTooLargeError;
          }

          break;
        }

        default:
          return new Response('Not found', {
            status: 404,
          });
      }

      return Response.json({
        ok,
        test: path,
        elapsedMs: Date.now() - started,
      }, {
        status: ok ? 200 : 500,
      });

    } catch (error) {
      return Response.json({
        ok: false,
        test: path,
        error: String(error),
      }, {
        status: 500,
      });
    }
  },
};
