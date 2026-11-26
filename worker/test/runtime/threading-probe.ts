import {
  findExistingMessage,
  isDuplicateMessage,
} from '../../src/services/deduplication';

import {
  resolveConversation,
  resolveSubjectThread,
} from '../../src/services/subjectThread';

import {
  resolveHeaderThread,
} from '../../src/services/threadResolution';

import {
  THREAD_WINDOW_MS,
} from '../../src/services/threadIdentity';

interface Env {
  DB: D1Database;
}

const NOW = 1800000000000;

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    const db = env.DB;

    const checks: Record<string, boolean> = {};

    try {
      await db.batch([
        db.prepare('DELETE FROM attachments'),
        db.prepare('DELETE FROM messages'),
        db.prepare('DELETE FROM threads'),
      ]);

      async function seed(
        threadId: string,
        messageId: string,
        subject: string,
        sender: string,
        date = NOW,
        to = '[]',
        cc = '[]',
        bcc = '[]',
      ) {
        await db.batch([
          db.prepare(`
            INSERT INTO threads (
              id, subject,
              last_message_at,
              message_count
            )
            VALUES (?, ?, ?, 1)
          `).bind(
            threadId,
            subject,
            date,
          ),

          db.prepare(`
            INSERT INTO messages (
              id, thread_id,
              message_id_header,
              from_addr,
              subject,
              direction,
              to_addrs,
              cc_addrs,
              bcc_addrs,
              created_at,
              updated_at
            )
            VALUES (
              ?, ?, ?, ?, ?, 'in',
              ?, ?, ?, ?, ?
            )
          `).bind(
            crypto.randomUUID(),
            threadId,
            messageId,
            sender,
            subject,
            to,
            cc,
            bcc,
            date,
            date,
          ),
        ]);
      }

      await seed(
        'thread-parent',
        '<parent@example.com>',
        'invoice',
        'sender@example.com',
      );

      await seed(
        'thread-root',
        '<root@example.com>',
        'report',
        'other@example.com',
        NOW - 1000,
      );

      await seed(
        'thread-expired',
        '<expired@example.com>',
        'expired',
        'sender@example.com',
        NOW - THREAD_WINDOW_MS - 1,
      );

      await seed(
        'thread-boundary',
        '<boundary@example.com>',
        'boundary',
        'sender@example.com',
        NOW - THREAD_WINDOW_MS,
      );

      await seed(
        'thread-recipient',
        '<recipient@example.com>',
        'recipient',
        'owner@example.com',
        NOW,
        JSON.stringify([
          {
            name: 'Customer',
            addr: 'customer@example.com',
          },
        ]),
        JSON.stringify([
          {
            name: 'CC',
            addr: 'cc@example.com',
          },
        ]),
        JSON.stringify([
          {
            name: 'BCC',
            addr: 'bcc@example.com',
          },
        ]),
      );

      checks.existingMessage =
        (await findExistingMessage(
          db,
          '<parent@example.com>',
        ))?.threadId === 'thread-parent';

      checks.duplicateDetected =
        await isDuplicateMessage(
          db,
          '<parent@example.com>',
        );

      checks.newMessageAccepted =
        !(await isDuplicateMessage(
          db,
          '<new@example.com>',
        ));

      checks.missingIdAccepted =
        !(await isDuplicateMessage(
          db,
          null,
        ));

      checks.directReply =
        (await resolveHeaderThread(db, {
          inReplyTo: '<parent@example.com>',
        }))?.threadId === 'thread-parent';

      checks.parentPriority =
        (await resolveHeaderThread(db, {
          inReplyTo: '<parent@example.com>',
          references: ['<root@example.com>'],
        }))?.threadId === 'thread-parent';

      checks.referenceFallback =
        (await resolveHeaderThread(db, {
          inReplyTo: '<unknown@example.com>',
          references: ['<root@example.com>'],
        }))?.threadId === 'thread-root';

      checks.subjectMatch =
        (await resolveSubjectThread(
          db,
          'RE: FWD: Invoice',
          'sender@example.com',
          NOW,
        ))?.threadId === 'thread-parent';

      checks.unrelatedSender =
        (await resolveSubjectThread(
          db,
          'Invoice',
          'unrelated@example.com',
          NOW,
        )) === null;

      checks.expiredConversation =
        (await resolveSubjectThread(
          db,
          'Expired',
          'sender@example.com',
          NOW,
        )) === null;

      checks.exactTimeBoundary =
        (await resolveSubjectThread(
          db,
          'Boundary',
          'sender@example.com',
          NOW,
        ))?.threadId === 'thread-boundary';

      checks.toParticipant =
        (await resolveSubjectThread(
          db,
          'Recipient',
          'customer@example.com',
          NOW,
        ))?.threadId === 'thread-recipient';

      checks.ccParticipant =
        (await resolveSubjectThread(
          db,
          'Recipient',
          'cc@example.com',
          NOW,
        ))?.threadId === 'thread-recipient';

      checks.bccParticipant =
        (await resolveSubjectThread(
          db,
          'Recipient',
          'bcc@example.com',
          NOW,
        ))?.threadId === 'thread-recipient';

      checks.domainNormalization =
        (await resolveSubjectThread(
          db,
          'Invoice',
          'sender@EXAMPLE.COM',
          NOW,
        ))?.threadId === 'thread-parent';

      checks.exactParticipant =
        (await resolveSubjectThread(
          db,
          'Invoice',
          'other-sender@example.com',
          NOW,
        )) === null;

      checks.messageIdCase =
        !(await isDuplicateMessage(
          db,
          '<PARENT@example.com>',
        ));

      checks.sqlInjectionRejected =
        (await resolveSubjectThread(
          db,
          "invoice' OR 1=1 --",
          'sender@example.com',
          NOW,
        )) === null;

      checks.newConversation =
        (await resolveConversation(
          db,
          {
            subject: 'New subject',
            sender: 'new@example.com',
          },
          NOW,
        )).reason === 'new-thread';

      checks.completeFallback =
        (await resolveConversation(
          db,
          {
            subject: 'RE: Invoice',
            sender: 'sender@example.com',
            inReplyTo: '<unknown@example.com>',
          },
          NOW,
        )).reason === 'subject-participant';

      const passed = Object.values(
        checks
      ).filter(Boolean).length;

      const total = Object.keys(
        checks
      ).length;

      const ok =
        passed === total && total === 20;

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
