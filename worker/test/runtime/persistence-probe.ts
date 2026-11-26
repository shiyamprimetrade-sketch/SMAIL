import {
  prepareMessageRecord,
} from '../../src/services/messageRecord';

import {
  persistMessage,
} from '../../src/services/messagePersistence';

import type {
  PreparedEmail,
} from '../../src/services/inbound';

interface Env {
  DB: D1Database;
}

const NOW = 1800000000000;

function email(
  messageId: string,
  text = 'Synthetic business email',
): PreparedEmail {
  return {
    from: {
      name: 'Test Customer',
      address: 'customer@example.com',
    },
    to: [{
      name: 'Owner',
      address: 'owner@example.com',
    }],
    cc: [],
    bcc: [],
    replyTo: [],
    subject: 'Invoice',
    messageId,
    inReplyTo: null,
    references: [],
    text,
    html: '<p>Synthetic email</p>',
    attachments: [{
      filename: 'invoice.bin',
      mime: 'application/octet-stream',
      contentId: null,
      isInline: false,
      size: 4,
      data: new Uint8Array([
        0, 1, 128, 255,
      ]),
    }],
    omittedAttachments: [],
    rawSize: 1024,
    htmlRemoved: false,
  };
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

    async function store(
      messageId: string,
      threadId: string,
      timestamp = NOW,
      text = 'Synthetic business email',
    ) {
      const prepared = email(
        messageId,
        text,
      );

      const record = prepareMessageRecord(
        prepared,
        threadId,
        {
          score: 0,
          folder: 'inbox',
          evidence: [],
        },
        timestamp,
      );

      return persistMessage(
        db,
        record,
        prepared.attachments,
      );
    }

    try {
      // Synthetic local database only.

      await db.batch([
        db.prepare('DELETE FROM attachments'),
        db.prepare('DELETE FROM messages'),
        db.prepare('DELETE FROM threads'),
        db.prepare('DELETE FROM contacts'),
      ]);

      const duplicates =
        await Promise.all(
          Array.from(
            { length: 12 },
            (_, index) => store(
              '<duplicate@example.com>',
              `duplicate-thread-${index}`,
            )
          )
        );

      checks.oneWinningDelivery =
        duplicates.filter(
          result => result.status === 'stored'
        ).length === 1;

      checks.elevenDuplicateDeliveries =
        duplicates.filter(
          result => result.status === 'duplicate'
        ).length === 11;

      checks.sameMessageIdentity =
        new Set(
          duplicates.map(
            result => result.messageId
          )
        ).size === 1;

      checks.sameThreadIdentity =
        new Set(
          duplicates.map(
            result => result.threadId
          )
        ).size === 1;

      checks.noDuplicateMessages =
        await count(
          'SELECT COUNT(*) AS count FROM messages'
        ) === 1;

      checks.noOrphanThreads =
        await count(
          'SELECT COUNT(*) AS count FROM threads'
        ) === 1;

      checks.noDuplicateAttachments =
        await count(
          'SELECT COUNT(*) AS count FROM attachments'
        ) === 1;

      checks.singleContact =
        await count(
          'SELECT COUNT(*) AS count FROM contacts'
        ) === 1;

      checks.singleContactUsage =
        await count(`
          SELECT use_count AS count
          FROM contacts
          WHERE email = ?
        `, 'customer@example.com') === 1;

      const distinct =
        await Promise.all(
          Array.from(
            { length: 12 },
            (_, index) => store(
              `<distinct-${index}@example.com>`,
              'shared-thread',
              NOW + index,
              `Message ${index}`,
            )
          )
        );

      checks.allDistinctMessagesStored =
        distinct.every(
          result => result.status === 'stored'
        );

      checks.correctSharedThreadCount =
        await count(`
          SELECT message_count AS count
          FROM threads
          WHERE id = ?
        `, 'shared-thread') === 12;

      checks.correctTotalMessageCount =
        await count(
          'SELECT COUNT(*) AS count FROM messages'
        ) === 13;

      checks.correctTotalAttachmentCount =
        await count(
          'SELECT COUNT(*) AS count FROM attachments'
        ) === 13;

      checks.correctContactUsage =
        await count(`
          SELECT use_count AS count
          FROM contacts
          WHERE email = ?
        `, 'customer@example.com') === 13;

      const latest = await db.prepare(`
        SELECT last_message_at, snippet
        FROM threads
        WHERE id = ?
      `).bind('shared-thread').first<{
        last_message_at: number;
        snippet: string;
      }>();

      checks.latestTimestampPreserved =
        latest?.last_message_at === NOW + 11;

      checks.latestSnippetPreserved =
        latest?.snippet === 'Message 11';

      await store(
        '<older@example.com>',
        'shared-thread',
        NOW - 1000,
        'Older email',
      );

      const afterOlder = await db.prepare(`
        SELECT last_message_at, snippet
        FROM threads
        WHERE id = ?
      `).bind('shared-thread').first<{
        last_message_at: number;
        snippet: string;
      }>();

      checks.outOfOrderTimestampProtected =
        afterOlder?.last_message_at === NOW + 11;

      checks.outOfOrderSnippetProtected =
        afterOlder?.snippet === 'Message 11';

      checks.outOfOrderContactProtected =
        await count(`
          SELECT last_used AS count
          FROM contacts
          WHERE email = ?
        `, 'customer@example.com') === NOW + 11;

      // Inject an actual SQL failure after
      // thread and message insertion.

      await db.prepare(`
        CREATE TRIGGER IF NOT EXISTS
          test_attachment_failure
        BEFORE INSERT ON attachments
        BEGIN
          SELECT RAISE(
            ABORT,
            'Synthetic attachment failure'
          );
        END
      `).run();

      let attachmentFailed = false;

      try {
        await store(
          '<rollback@example.com>',
          'rollback-thread',
        );
      } catch {
        attachmentFailed = true;
      } finally {
        await db.prepare(`
          DROP TRIGGER IF EXISTS
            test_attachment_failure
        `).run();
      }

      checks.attachmentFailureDetected =
        attachmentFailed;

      checks.failedMessageRolledBack =
        await count(`
          SELECT COUNT(*) AS count
          FROM messages
          WHERE message_id_header = ?
        `, '<rollback@example.com>') === 0;

      checks.failedThreadRolledBack =
        await count(`
          SELECT COUNT(*) AS count
          FROM threads
          WHERE id = ?
        `, 'rollback-thread') === 0;

      checks.attachmentCountUnchanged =
        await count(
          'SELECT COUNT(*) AS count FROM attachments'
        ) === 14;

      checks.contactUsageUnchanged =
        await count(`
          SELECT use_count AS count
          FROM contacts
          WHERE email = ?
        `, 'customer@example.com') === 14;

      // Fail the final contact write, after
      // attachment and thread updates.

      await db.prepare(`
        CREATE TRIGGER IF NOT EXISTS
          test_contact_failure
        BEFORE INSERT ON contacts
        BEGIN
          SELECT RAISE(
            ABORT,
            'Synthetic contact failure'
          );
        END
      `).run();

      let contactFailed = false;

      try {
        await store(
          '<contact-rollback@example.com>',
          'shared-thread',
          NOW + 1000,
          'Must not persist',
        );
      } catch {
        contactFailed = true;
      } finally {
        await db.prepare(`
          DROP TRIGGER IF EXISTS
            test_contact_failure
        `).run();
      }

      checks.contactFailureDetected =
        contactFailed;

      checks.contactFailureMessageRollback =
        await count(`
          SELECT COUNT(*) AS count
          FROM messages
          WHERE message_id_header = ?
        `, '<contact-rollback@example.com>') === 0;

      checks.contactFailureAttachmentRollback =
        await count(
          'SELECT COUNT(*) AS count FROM attachments'
        ) === 14;

      checks.contactFailureThreadRollback =
        await count(`
          SELECT message_count AS count
          FROM threads
          WHERE id = ?
        `, 'shared-thread') === 13;

      checks.contactFailureTimestampRollback =
        await count(`
          SELECT last_message_at AS count
          FROM threads
          WHERE id = ?
        `, 'shared-thread') === NOW + 11;

      const retry = await store(
        '<rollback@example.com>',
        'rollback-thread',
      );

      checks.retryAfterRollback =
        retry.status === 'stored';

      checks.finalMessageCount =
        await count(
          'SELECT COUNT(*) AS count FROM messages'
        ) === 15;

      checks.finalAttachmentCount =
        await count(
          'SELECT COUNT(*) AS count FROM attachments'
        ) === 15;

      checks.finalContactUsage =
        await count(`
          SELECT use_count AS count
          FROM contacts
          WHERE email = ?
        `, 'customer@example.com') === 15;

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

      checks.allThreadCountsConsistent =
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
        total === 36 && passed === total;

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
