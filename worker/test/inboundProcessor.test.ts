import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  createFallbackEmail,
  processInboundEmail,
  type InboundInput,
} from '../src/services/inboundProcessor';

import {
  prepareInboundEmail,
  type PreparedEmail,
} from '../src/services/inbound';

import {
  findExistingMessage,
} from '../src/services/deduplication';

import {
  resolveConversation,
} from '../src/services/subjectThread';

import {
  classifySecureInboundSpam,
} from '../src/services/secureSpamClassifier';

import {
  persistMessage,
} from '../src/services/messagePersistence';

import {
  EmailTooLargeError,
  MAX_RAW_EMAIL_BYTES,
} from '../src/services/mime';

vi.mock('../src/services/inbound', () => ({
  prepareInboundEmail: vi.fn(),
}));

vi.mock('../src/services/deduplication', () => ({
  findExistingMessage: vi.fn(),
}));

vi.mock('../src/services/subjectThread', () => ({
  resolveConversation: vi.fn(),
}));

vi.mock('../src/services/secureSpamClassifier', () => ({
  classifySecureInboundSpam: vi.fn(),
}));

vi.mock('../src/services/messagePersistence', () => ({
  persistMessage: vi.fn(),
}));

const NOW = 1800000000000;

const db = {} as D1Database;

function input(
  overrides: Partial<InboundInput> = {},
): InboundInput {
  return {
    raw: new Response(
      'Synthetic email'
    ).body!,
    envelopeFrom: 'customer@example.com',
    envelopeTo: 'owner@example.com',
    rawSubject: 'Invoice',
    rawMessageId: '<test@example.com>',
    rawSize: 1024,
    receivedAt: NOW,
    ...overrides,
  };
}

function prepared(
  overrides: Partial<PreparedEmail> = {},
): PreparedEmail {
  return {
    from: {
      name: 'Customer',
      address: 'customer@example.com',
    },
    to: [{
      name: '',
      address: 'owner@example.com',
    }],
    cc: [],
    bcc: [],
    replyTo: [],
    subject: 'Invoice',
    messageId: '<test@example.com>',
    inReplyTo: null,
    references: [],
    text: 'Business correspondence.',
    html: '<p>Business correspondence.</p>',
    attachments: [],
    omittedAttachments: [],
    rawSize: 1024,
    htmlRemoved: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(
    prepareInboundEmail
  ).mockResolvedValue(prepared());

  vi.mocked(
    findExistingMessage
  ).mockResolvedValue(null);

  vi.mocked(
    resolveConversation
  ).mockResolvedValue({
    threadId: 'thread-test',
    reason: 'new-thread',
  });

  vi.mocked(
    classifySecureInboundSpam
  ).mockResolvedValue({
    score: 0,
    folder: 'inbox',
    evidence: [],
  });

  vi.mocked(
    persistMessage
  ).mockResolvedValue({
    status: 'stored',
    messageId: 'message-test',
    threadId: 'thread-test',
  });
});

describe('Fallback email recovery', () => {
  it('preserves envelope sender', () => {
    expect(createFallbackEmail(
      input()
    ).from.address).toBe(
      'customer@example.com'
    );
  });

  it('preserves envelope recipient', () => {
    expect(createFallbackEmail(
      input()
    ).to[0].address).toBe(
      'owner@example.com'
    );
  });

  it('preserves raw subject', () => {
    expect(createFallbackEmail(
      input()
    ).subject).toBe('Invoice');
  });

  it('preserves valid message identity', () => {
    expect(createFallbackEmail(
      input()
    ).messageId).toBe(
      '<test@example.com>'
    );
  });

  it('rejects malformed message identity', () => {
    expect(createFallbackEmail(
      input({
        rawMessageId: 'invalid',
      })
    ).messageId).toBeNull();
  });

  it('provides a fallback subject', () => {
    expect(createFallbackEmail(
      input({
        rawSubject: null,
      })
    ).subject).toBe(
      '[Email recovery]'
    );
  });

  it('provides a missing sender placeholder', () => {
    expect(createFallbackEmail(
      input({
        envelopeFrom: '',
      })
    ).from.address).toBe(
      'unknown-sender'
    );
  });

  it('contains an explicit recovery notice', () => {
    expect(createFallbackEmail(
      input()
    ).text).toContain(
      'The original email could not be parsed.'
    );
  });

  it('does not fabricate original content', () => {
    const result = createFallbackEmail(
      input()
    );

    expect(result.html).toBe('');
    expect(result.attachments).toEqual([]);
  });

  it('preserves available raw size', () => {
    expect(createFallbackEmail(
      input()
    ).rawSize).toBe(1024);
  });

  it('handles invalid raw size', () => {
    expect(createFallbackEmail(
      input({
        rawSize: -1,
      })
    ).rawSize).toBe(0);
  });

  it('removes metadata control characters', () => {
    expect(createFallbackEmail(
      input({
        rawSubject: 'Invoice\r\nInjected',
      })
    ).subject).toBe(
      'Invoice  Injected'
    );
  });

  it('bounds recovery subject size', () => {
    const result = createFallbackEmail(
      input({
        rawSubject: 'x'.repeat(5000),
      })
    );

    expect(result.subject.length)
      .toBe(998);
  });
});

describe('Unified inbound processing', () => {
  it('stores a normal inbound email', async () => {
    expect(await processInboundEmail(
      db,
      input(),
    )).toEqual({
      status: 'stored',
      messageId: 'message-test',
      threadId: 'thread-test',
      recovered: false,
    });
  });

  it('passes raw stream to MIME preparation', async () => {
    const request = input();

    await processInboundEmail(db, request);

    expect(prepareInboundEmail)
      .toHaveBeenCalledWith(
        request.raw,
        request.envelopeFrom,
      );
  });

  it('checks duplicate message identity', async () => {
    await processInboundEmail(db, input());

    expect(findExistingMessage)
      .toHaveBeenCalledWith(
        db,
        '<test@example.com>',
      );
  });

  it('skips existing duplicate messages', async () => {
    vi.mocked(
      findExistingMessage
    ).mockResolvedValueOnce({
      id: 'existing-message',
      threadId: 'existing-thread',
      messageId: '<test@example.com>',
    });

    expect(await processInboundEmail(
      db,
      input(),
    )).toEqual({
      status: 'duplicate',
      messageId: 'existing-message',
      threadId: 'existing-thread',
      recovered: false,
    });

    expect(resolveConversation)
      .not.toHaveBeenCalled();

    expect(persistMessage)
      .not.toHaveBeenCalled();
  });

  it('resolves conversation metadata', async () => {
    await processInboundEmail(db, input());

    expect(resolveConversation)
      .toHaveBeenCalledWith(
        db,
        {
          subject: 'Invoice',
          sender: 'customer@example.com',
          inReplyTo: null,
          references: [],
        },
        NOW,
      );
  });

  it('does not trust raw authentication', async () => {
    await processInboundEmail(db, input());

    expect(classifySecureInboundSpam)
      .toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          senderIdentityVerified: false,
          authentication: {
            trusted: false,
          },
        }),
      );
  });

  it('preserves spam decisions', async () => {
    vi.mocked(
      classifySecureInboundSpam
    ).mockResolvedValueOnce({
      score: 7,
      folder: 'spam',
      evidence: [],
    });

    await processInboundEmail(db, input());

    expect(persistMessage)
      .toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          folder: 'spam',
          spam_score: 7,
        }),
        [],
      );
  });

  it('passes attachments to atomic persistence', async () => {
    const attachments = [{
      filename: 'invoice.txt',
      mime: 'text/plain',
      contentId: null,
      isInline: false,
      size: 4,
      data: new Uint8Array([
        1, 2, 3, 4,
      ]),
    }];

    vi.mocked(
      prepareInboundEmail
    ).mockResolvedValueOnce(
      prepared({ attachments })
    );

    await processInboundEmail(db, input());

    expect(persistMessage)
      .toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          has_attachments: 1,
        }),
        attachments,
      );
  });

  it('preserves receipt timestamps', async () => {
    await processInboundEmail(db, input());

    expect(persistMessage)
      .toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          received_at: NOW,
          created_at: NOW,
          updated_at: NOW,
        }),
        [],
      );
  });

  it('recovers MIME parsing failures', async () => {
    vi.mocked(
      prepareInboundEmail
    ).mockRejectedValueOnce(
      new Error('Malformed MIME')
    );

    const result =
      await processInboundEmail(db, input());

    expect(result.status).toBe('stored');

    expect(result).toHaveProperty(
      'recovered',
      true,
    );

    expect(persistMessage)
      .toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          subject: 'Invoice',
          html_body: '',
          has_attachments: 0,
        }),
        [],
      );
  });

  it('rejects oversized raw messages', async () => {
    vi.mocked(
      prepareInboundEmail
    ).mockRejectedValueOnce(
      new EmailTooLargeError(
        MAX_RAW_EMAIL_BYTES
      )
    );

    expect(await processInboundEmail(
      db,
      input(),
    )).toEqual({
      status: 'rejected',
      reason: 'email_too_large',
    });

    expect(persistMessage)
      .not.toHaveBeenCalled();
  });

  it('recovers missing parsed sender', async () => {
    vi.mocked(
      prepareInboundEmail
    ).mockResolvedValueOnce(
      prepared({
        from: {
          name: '',
          address: '',
        },
      })
    );

    await processInboundEmail(db, input());

    expect(persistMessage)
      .toHaveBeenCalledWith(
        db,
        expect.objectContaining({
          from_addr: 'customer@example.com',
        }),
        [],
      );
  });

  it('preserves concurrent duplicate results', async () => {
    vi.mocked(
      persistMessage
    ).mockResolvedValueOnce({
      status: 'duplicate',
      messageId: 'winning-message',
      threadId: 'winning-thread',
    });

    expect(await processInboundEmail(
      db,
      input(),
    )).toEqual({
      status: 'duplicate',
      messageId: 'winning-message',
      threadId: 'winning-thread',
      recovered: false,
    });
  });

  it('returns explicit duplicate lookup failure', async () => {
    vi.mocked(
      findExistingMessage
    ).mockRejectedValueOnce(
      new Error('Database unavailable')
    );

    expect(await processInboundEmail(
      db,
      input(),
    )).toEqual({
      status: 'failed',
      reason: 'processing_failed',
    });
  });

  it('returns explicit threading failure', async () => {
    vi.mocked(
      resolveConversation
    ).mockRejectedValueOnce(
      new Error('Thread resolution failed')
    );

    expect(await processInboundEmail(
      db,
      input(),
    )).toEqual({
      status: 'failed',
      reason: 'processing_failed',
    });
  });

  it('returns explicit classification failure', async () => {
    vi.mocked(
      classifySecureInboundSpam
    ).mockRejectedValueOnce(
      new Error('Classification failed')
    );

    expect(await processInboundEmail(
      db,
      input(),
    )).toEqual({
      status: 'failed',
      reason: 'processing_failed',
    });
  });

  it('returns explicit persistence failure', async () => {
    vi.mocked(
      persistMessage
    ).mockRejectedValueOnce(
      new Error('Private database details')
    );

    expect(await processInboundEmail(
      db,
      input(),
    )).toEqual({
      status: 'failed',
      reason: 'processing_failed',
    });
  });

  it('reports failed fallback persistence', async () => {
    vi.mocked(
      prepareInboundEmail
    ).mockRejectedValueOnce(
      new Error('Parse failed')
    );

    vi.mocked(
      persistMessage
    ).mockRejectedValueOnce(
      new Error('Storage failed')
    );

    expect(await processInboundEmail(
      db,
      input(),
    )).toEqual({
      status: 'failed',
      reason: 'processing_failed',
    });
  });
});
