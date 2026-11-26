import {
  timingSafeEqual,
} from 'node:crypto';

import inboundProbe from
  '../runtime/inbound-probe';

import {
  prepareMessageRecord,
} from '../../src/services/messageRecord';

import {
  persistMessage,
} from '../../src/services/messagePersistence';

import {
  MAX_ATTACHMENT_BYTES,
} from '../../src/services/mime';

import type {
  PreparedEmail,
} from '../../src/services/inbound';

interface Env {
  DB: D1Database;
  PROBE_KEY: string;
}

function authorized(
  request: Request,
  secret: string,
): boolean {
  if (!secret) return false;

  const actual = new TextEncoder().encode(
    request.headers.get(
      'Authorization'
    ) ?? ''
  );

  const expected = new TextEncoder().encode(
    `Bearer ${secret}`
  );

  return actual.length === expected.length &&
    timingSafeEqual(actual, expected);
}

async function digest(
  data: Uint8Array,
): Promise<string> {
  const buffer = new ArrayBuffer(
    data.byteLength
  );

  new Uint8Array(buffer).set(data);

  const hash = await crypto.subtle.digest(
    'SHA-256',
    buffer,
  );

  return Array.from(
    new Uint8Array(hash),
    byte => byte.toString(16).padStart(2, '0')
  ).join('');
}

async function verifyAttachment(
  db: D1Database,
): Promise<Response> {
  const checks: Record<string, boolean> = {};

  const data = new Uint8Array(
    MAX_ATTACHMENT_BYTES
  );

  for (let i = 0; i < data.length; i++) {
    data[i] = i % 256;
  }

  const expectedHash = await digest(data);

  const messageId =
    `<${crypto.randomUUID()}@example.com>`;

  const email: PreparedEmail = {
    from: {
      name: 'Synthetic Customer',
      address: 'hosted@example.com',
    },
    to: [],
    cc: [],
    bcc: [],
    replyTo: [],
    subject: 'Hosted attachment test',
    messageId,
    inReplyTo: null,
    references: [],
    text: 'Synthetic attachment verification.',
    html: '',
    attachments: [{
      filename: 'boundary.bin',
      mime: 'application/octet-stream',
      contentId: null,
      isInline: false,
      size: data.byteLength,
      data,
    }],
    omittedAttachments: [],
    rawSize: data.byteLength,
    htmlRemoved: false,
  };

  const record = prepareMessageRecord(
    email,
    crypto.randomUUID(),
    {
      score: 0,
      folder: 'inbox',
      evidence: [],
    },
  );

  const result = await persistMessage(
    db,
    record,
    email.attachments,
  );

  checks.maximumAttachmentStored =
    result.status === 'stored';

  const stored = await db.prepare(`
    SELECT
      id,
      filename,
      size,
      length(data) AS actual_size
    FROM attachments
    WHERE message_id = ?
  `).bind(
    result.messageId
  ).first<{
    id: string;
    filename: string;
    size: number;
    actual_size: number;
  }>();

  checks.attachmentExists =
    stored !== null;

  checks.filenamePreserved =
    stored?.filename === 'boundary.bin';

  checks.metadataSizeCorrect =
    stored?.size === MAX_ATTACHMENT_BYTES;

  checks.binarySizeCorrect =
    stored?.actual_size === MAX_ATTACHMENT_BYTES;

  // Read in bounded chunks to avoid an
  // unnecessarily large database response.

  const retrieved = new Uint8Array(
    MAX_ATTACHMENT_BYTES
  );

  let offset = 0;

  if (stored) {
    while (offset < retrieved.length) {
      const length = Math.min(
        250_000,
        retrieved.length - offset,
      );

      const row = await db.prepare(`
        SELECT hex(
          substr(data, ?, ?)
        ) AS chunk
        FROM attachments
        WHERE id = ?
      `).bind(
        offset + 1,
        length,
        stored.id,
      ).first<{ chunk: string }>();

      const hex = row?.chunk ?? '';

      if (
        hex.length !== length * 2 ||
        !/^[0-9a-f]+$/i.test(hex)
      ) {
        throw new Error(
          'Invalid binary retrieval'
        );
      }

      for (let i = 0; i < length; i++) {
        retrieved[offset + i] = parseInt(
          hex.slice(i * 2, i * 2 + 2),
          16,
        );
      }

      offset += length;
    }
  }

  checks.completeBinaryRetrieval =
    offset === MAX_ATTACHMENT_BYTES;

  checks.sha256Integrity =
    await digest(retrieved) === expectedHash;

  const duplicate = await persistMessage(
    db,
    record,
    email.attachments,
  );

  checks.duplicateRejected =
    duplicate.status === 'duplicate';

  const count = await db.prepare(`
    SELECT COUNT(*) AS count
    FROM attachments
    WHERE message_id = ?
  `).bind(
    result.messageId
  ).first<{ count: number }>();

  checks.noDuplicateAttachment =
    count?.count === 1;

  const total = Object.keys(checks).length;

  const passed = Object.values(checks)
    .filter(Boolean).length;

  const ok = total === 9 &&
    passed === total;

  return Response.json({
    ok,
    passed,
    total,
    checks,
    expectedHash,
  }, {
    status: ok ? 200 : 500,
  });
}

export default {
  async fetch(
    request: Request,
    env: Env,
  ): Promise<Response> {
    if (!authorized(
      request,
      env.PROBE_KEY,
    )) {
      return new Response(
        'Unauthorized',
        { status: 401 },
      );
    }

    if (request.method !== 'POST') {
      return new Response(
        'Method not allowed',
        { status: 405 },
      );
    }

    const path = new URL(
      request.url
    ).pathname;

    try {
      if (path === '/ready') {
        return Response.json({
          ok: true,
        });
      }

      if (path === '/inbound') {
        return inboundProbe.fetch(
          request,
          env,
        );
      }

      if (path === '/attachment') {
        return verifyAttachment(env.DB);
      }

      return new Response(
        'Not found',
        { status: 404 },
      );

    } catch {
      return Response.json({
        ok: false,
        error: 'Hosted verification failed',
      }, {
        status: 500,
      });
    }
  },
};
