import {
  prepareInboundEmail,
} from '../../src/services/inbound';

import {
  classifySecureInboundSpam,
  type SecureSpamInput,
} from '../../src/services/secureSpamClassifier';

import {
  isKnownSender,
} from '../../src/services/spamContacts';

interface Env {
  DB: D1Database;
}

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    const db = env.DB;

    const checks: Record<string, boolean> = {};

    try {
      await db.prepare(
        'DELETE FROM contacts'
      ).run();

      await db.prepare(`
        INSERT INTO contacts (
          email,
          name,
          last_used,
          use_count
        )
        VALUES (?, ?, ?, ?)
      `).bind(
        'customer@example.com',
        'Test Customer',
        Date.now(),
        1,
      ).run();

      const normal: SecureSpamInput = {
        sender: 'customer@example.com',
        subject: 'Invoice',
        text: 'Thank you for your business.',
      };

      const verified = {
        senderIdentityVerified: true,
        authentication: {
          trusted: true,
        },
      };

      async function classify(
        overrides: Partial<SecureSpamInput> = {},
      ) {
        return classifySecureInboundSpam(
          db,
          {
            ...normal,
            ...overrides,
          },
        );
      }

      checks.knownContact =
        await isKnownSender(
          db,
          'customer@example.com',
        );

      checks.unknownContact =
        !(await isKnownSender(
          db,
          'unknown@example.com',
        ));

      checks.normalizedDomain =
        await isKnownSender(
          db,
          'customer@EXAMPLE.COM',
        );

      checks.localPartCase =
        !(await isKnownSender(
          db,
          'Customer@example.com',
        ));

      checks.normalEmail =
        (await classify()).folder === 'inbox';

      checks.unverifiedContact =
        (await classify()).score === 0;

      checks.verifiedContact =
        (await classify(verified)).score === -3;

      checks.verifiedUnknownSender =
        (await classify({
          ...verified,
          sender: 'unknown@example.com',
        })).score === 0;

      checks.spoofedContact =
        (await classify({
          senderIdentityVerified: true,
          authentication: {
            trusted: false,
          },
        })).score === 0;

      checks.spfFailure =
        (await classify({
          ...verified,
          authentication: {
            trusted: true,
            authenticationResults: [
              'mx.example.com; spf=fail',
            ],
          },
        })).score === 2;

      checks.dkimFailure =
        (await classify({
          ...verified,
          authentication: {
            trusted: true,
            authenticationResults: [
              'mx.example.com; dkim=fail',
            ],
          },
        })).score === 2;

      checks.spamFlag =
        (await classify({
          ...verified,
          authentication: {
            trusted: true,
            spamFlags: ['yes'],
          },
        })).score === 3;

      checks.untrustedHeaders =
        (await classify({
          authentication: {
            trusted: false,
            authenticationResults: [
              'mx.example.com; spf=fail; dkim=fail',
            ],
            spamFlags: ['yes'],
          },
        })).score === 0;

      const threshold = await classify({
        subject: '',
        text: 'https://example.com',
        authentication: {
          trusted: true,
          spamFlags: ['yes'],
        },
      });

      checks.exactSpamThreshold =
        threshold.score === 5 &&
        threshold.folder === 'spam';

      const maximum = await classify({
        subject: '',
        text: 'https://example.com',
        ...verified,
        authentication: {
          trusted: true,
          authenticationResults: [
            'mx.example.com; spf=fail; dkim=fail',
          ],
          spamFlags: ['yes'],
        },
      });

      checks.maximumSpamScore =
        maximum.score === 9 &&
        maximum.folder === 'spam';

      checks.evidenceIntegrity =
        maximum.evidence.reduce(
          (sum, item) => sum + item.points,
          0,
        ) === maximum.score;

      checks.parameterizedContactQuery =
        !(await isKnownSender(
          db,
          "x'OR'1'='1@example.com",
        ));

      const raw = [
        'From: Customer <customer@example.com>',
        'To: owner@example.com',
        'Subject: Invoice',
        'Message-ID: <spam-probe@example.com>',
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=UTF-8',
        '',
        '<p>Invoice attached.</p>',
        '<script>alert(1)</script>',
        '<img src="https://example.com/pixel" width="1" height="1">',
      ].join('\r\n');

      const stream =
        new Response(raw).body!;

      const prepared =
        await prepareInboundEmail(
          stream,
          'customer@example.com',
        );

      checks.mimeParsing =
        prepared.from.address ===
          'customer@example.com' &&
        prepared.subject === 'Invoice';

      checks.htmlSanitization =
        !prepared.html.includes('<script') &&
        !prepared.html.includes('/pixel') &&
        prepared.html.includes('Invoice attached.');

      const preparedDecision =
        await classifySecureInboundSpam(
          db,
          {
            sender: prepared.from.address,
            subject: prepared.subject,
            text: prepared.text,
          },
        );

      checks.preparedEmailClassification =
        preparedDecision.folder === 'inbox' &&
        preparedDecision.score === 0;

      const contactCount =
        await db.prepare(`
          SELECT COUNT(*) AS count
          FROM contacts
        `).first<{ count: number }>();

      checks.noContactMutation =
        contactCount?.count === 1;

      const contact =
        await db.prepare(`
          SELECT use_count
          FROM contacts
          WHERE email = ?
        `).bind(
          'customer@example.com'
        ).first<{ use_count: number }>();

      checks.contactUsageUnchanged =
        contact?.use_count === 1;

      const total =
        Object.keys(checks).length;

      const passed =
        Object.values(checks)
          .filter(Boolean).length;

      const ok =
        passed === total && total === 22;

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
