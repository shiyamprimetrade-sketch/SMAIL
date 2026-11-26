import {
  processInboundEmail,
} from '../../src/services/inboundProcessor';

interface Env {
  DB: D1Database;
}

const NOW = 1800000000000;

function originalEmail(): string {
  return [
    'From: Test Customer <customer@example.com>',
    'To: Owner <owner@example.com>',
    'Subject: Commercial Invoice',
    'Message-ID: <invoice@example.com>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="smail-test"',
    '',
    '--smail-test',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    'Invoice payment reference SMAILUNIQUE2026.',
    '--smail-test',
    'Content-Type: text/html; charset=UTF-8',
    '',
    '<p>Commercial invoice.</p>',
    '<script>alert(1)</script>',
    '<img src="https://example.com/pixel" width="1" height="1">',
    '<img src="https://example.com/logo.png" width="200" height="100">',
    '--smail-test',
    'Content-Type: application/octet-stream',
    'Content-Disposition: attachment; filename="invoice.bin"',
    'Content-Transfer-Encoding: base64',
    '',
    'AAGA/w==',
    '--smail-test--',
    '',
  ].join('\r\n');
}

function replyEmail(): string {
  return [
    'From: Test Customer <customer@example.com>',
    'To: Owner <owner@example.com>',
    'Subject: Re: Commercial Invoice',
    'Message-ID: <reply@example.com>',
    'In-Reply-To: <invoice@example.com>',
    'References: <invoice@example.com>',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    'Payment confirmed.',
  ].join('\r\n');
}

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    const db = env.DB;

    const checks: Record<string, boolean> = {};

    async function count(
      sql: string,
      ...values: unknown[]
    ): Promise<number> {
      const result = await db.prepare(sql)
        .bind(...values)
        .first<{ count: number }>();

      return result?.count ?? -1;
    }

    async function deliver(
      raw: string,
      receivedAt = NOW,
      rawSubject = 'Commercial Invoice',
      rawMessageId = '<invoice@example.com>',
    ) {
      return processInboundEmail(db, {
        raw: new Response(raw).body!,
        envelopeFrom: 'customer@example.com',
        envelopeTo: 'owner@example.com',
        rawSubject,
        rawMessageId,
        rawSize: new TextEncoder()
          .encode(raw).length,
        receivedAt,
      });
    }

    try {
      await db.batch([
        db.prepare('DELETE FROM attachments'),
        db.prepare('DELETE FROM messages'),
        db.prepare('DELETE FROM threads'),
        db.prepare('DELETE FROM contacts'),
      ]);

      const original = await deliver(
        originalEmail()
      );

      checks.originalStored =
        original.status === 'stored';

      if (original.status !== 'stored') {
        throw new Error(
          'Original email was not stored'
        );
      }

      checks.noFallbackRequired =
        original.recovered === false;

      const message = await db.prepare(`
        SELECT *
        FROM messages
        WHERE id = ?
      `).bind(
        original.messageId
      ).first<Record<string, unknown>>();

      checks.messageExists =
        message !== null;

      checks.subjectPreserved =
        message?.subject ===
          'Commercial Invoice';

      checks.senderPreserved =
        message?.from_addr ===
          'customer@example.com';

      checks.recipientPreserved =
        JSON.parse(
          String(message?.to_addrs)
        )[0].addr === 'owner@example.com';

      checks.messageIdPreserved =
        message?.message_id_header ===
          '<invoice@example.com>';

      checks.plainTextPreserved =
        String(message?.text_body)
          .includes('SMAILUNIQUE2026');

      checks.htmlPreserved =
        String(message?.html_body)
          .includes('Commercial invoice.');

      checks.scriptRemoved =
        !String(message?.html_body)
          .includes('<script');

      checks.trackingPixelRemoved =
        !String(message?.html_body)
          .includes('/pixel');

      checks.safeImagePreserved =
        String(message?.html_body)
          .includes(
            'https://example.com/logo.png'
          );

      checks.inboxClassification =
        message?.folder === 'inbox';

      checks.unreadByDefault =
        message?.is_read === 0;

      checks.inboundDirection =
        message?.direction === 'in';

      checks.attachmentFlag =
        message?.has_attachments === 1;

      const attachment = await db.prepare(`
        SELECT
          filename,
          mime,
          size,
          hex(data) AS binary_hex
        FROM attachments
        WHERE message_id = ?
      `).bind(
        original.messageId
      ).first<{
        filename: string;
        mime: string;
        size: number;
        binary_hex: string;
      }>();

      checks.attachmentExists =
        attachment !== null;

      checks.attachmentFilename =
        attachment?.filename ===
          'invoice.bin';

      checks.attachmentMime =
        attachment?.mime ===
          'application/octet-stream';

      checks.attachmentSize =
        attachment?.size === 4;

      checks.exactBinaryRoundTrip =
        attachment?.binary_hex ===
          '000180FF';

      checks.senderContactCreated =
        await count(`
          SELECT COUNT(*) AS count
          FROM contacts
          WHERE email = ?
        `, 'customer@example.com') === 1;

      const duplicate = await deliver(
        originalEmail(),
        NOW + 1,
      );

      checks.duplicateDetected =
        duplicate.status === 'duplicate';

      checks.duplicateIdentityPreserved =
        duplicate.status === 'duplicate' &&
        duplicate.messageId ===
          original.messageId;

      checks.noDuplicateAttachments =
        await count(`
          SELECT COUNT(*) AS count
          FROM attachments
        `) === 1;

      checks.noDuplicateContactUsage =
        await count(`
          SELECT use_count AS count
          FROM contacts
          WHERE email = ?
        `, 'customer@example.com') === 1;

      const reply = await deliver(
        replyEmail(),
        NOW + 1000,
        'Re: Commercial Invoice',
        '<reply@example.com>',
      );

      checks.replyStored =
        reply.status === 'stored';

      checks.replyUsesOriginalThread =
        reply.status === 'stored' &&
        reply.threadId === original.threadId;

      checks.threadMessageCount =
        await count(`
          SELECT message_count AS count
          FROM threads
          WHERE id = ?
        `, original.threadId) === 2;

      checks.threadLatestTimestamp =
        await count(`
          SELECT last_message_at AS count
          FROM threads
          WHERE id = ?
        `, original.threadId) === NOW + 1000;

      checks.contactUsageIncremented =
        await count(`
          SELECT use_count AS count
          FROM contacts
          WHERE email = ?
        `, 'customer@example.com') === 2;

      checks.fullTextSearch =
        await count(`
          SELECT COUNT(*) AS count
          FROM messages_fts
          WHERE messages_fts MATCH ?
        `, 'SMAILUNIQUE2026') === 1;

      checks.replySearchIndexed =
        await count(`
          SELECT COUNT(*) AS count
          FROM messages_fts
          WHERE messages_fts MATCH ?
        `, 'confirmed') === 1;

      const recovered = await deliver(
        '',
        NOW + 2000,
        'Recovery test',
        '<recovery@example.com>',
      );

      checks.fallbackStored =
        recovered.status === 'stored';

      checks.fallbackMarkedRecovered =
        recovered.status === 'stored' &&
        recovered.recovered === true;

      checks.fallbackNoticePreserved =
        await count(`
          SELECT COUNT(*) AS count
          FROM messages
          WHERE message_id_header = ?
            AND text_body LIKE ?
        `,
          '<recovery@example.com>',
          '%could not be parsed%'
        ) === 1;

      checks.fallbackHasNoAttachments =
        await count(`
          SELECT COUNT(*) AS count
          FROM messages
          WHERE message_id_header = ?
            AND has_attachments = 0
        `, '<recovery@example.com>') === 1;

      checks.finalMessageCount =
        await count(`
          SELECT COUNT(*) AS count
          FROM messages
        `) === 3;

      checks.finalAttachmentCount =
        await count(`
          SELECT COUNT(*) AS count
          FROM attachments
        `) === 1;

      checks.noOrphanAttachments =
        await count(`
          SELECT COUNT(*) AS count
          FROM attachments a
          LEFT JOIN messages m
            ON m.id = a.message_id
          WHERE m.id IS NULL
        `) === 0;

      checks.noOrphanMessages =
        await count(`
          SELECT COUNT(*) AS count
          FROM messages m
          LEFT JOIN threads t
            ON t.id = m.thread_id
          WHERE t.id IS NULL
        `) === 0;

      checks.consistentThreadCounts =
        await count(`
          SELECT COUNT(*) AS count
          FROM threads t
          WHERE t.message_count != (
            SELECT COUNT(*)
            FROM messages m
            WHERE m.thread_id = t.id
          )
        `) === 0;

      const total =
        Object.keys(checks).length;

      const passed =
        Object.values(checks)
          .filter(Boolean).length;

      const ok =
        total === 42 && passed === total;

      return Response.json({
        ok,
        passed,
        total,
        checks,
      }, {
        status: ok ? 200 : 500,
      });

    } catch (error) {
      return Response.json({
        ok: false,
        checks,
        error: String(error),
      }, {
        status: 500,
      });
    }
  },
};
