import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  prepareMessageRecord,
  createMessageSnippet,
  serializeAddresses,
  MAX_SNIPPET_BYTES,
} from '../src/services/messageRecord';

import type {
  PreparedEmail,
} from '../src/services/inbound';

import {
  MAX_BODY_BYTES,
} from '../src/services/mime';

import type {
  SpamDecision,
} from '../src/services/spam';

const NOW = 1800000000000;

const clean: SpamDecision = {
  score: 0,
  folder: 'inbox',
  evidence: [],
};

function email(
  overrides: Partial<PreparedEmail> = {},
): PreparedEmail {
  return {
    from: {
      name: 'Customer',
      address: 'customer@example.com',
    },
    to: [{
      name: 'Owner',
      address: 'owner@example.com',
    }],
    cc: [],
    bcc: [],
    replyTo: [],
    subject: 'RE: Invoice',
    messageId: '<invoice@example.com>',
    inReplyTo: null,
    references: [],
    text: 'Thank you for your business.',
    html: '<p>Thank you.</p>',
    attachments: [],
    omittedAttachments: [],
    rawSize: 1024,
    htmlRemoved: false,
    ...overrides,
  };
}

function record(
  overrides: Partial<PreparedEmail> = {},
  decision = clean,
) {
  return prepareMessageRecord(
    email(overrides),
    'thread-test',
    decision,
    NOW,
  );
}

describe('Message record preparation', () => {
  it('generates a unique message identifier', () => {
    expect(record().id).not.toBe(
      record().id
    );
  });

  it('preserves thread identifier', () => {
    expect(record().thread_id)
      .toBe('thread-test');
  });

  it('normalizes thread subject', () => {
    expect(record().thread_subject)
      .toBe('invoice');
  });

  it('preserves original subject', () => {
    expect(record().subject)
      .toBe('RE: Invoice');
  });

  it('preserves valid message identity', () => {
    expect(record().message_id_header)
      .toBe('<invoice@example.com>');
  });

  it('handles missing message identity', () => {
    expect(record({
      messageId: null,
    }).message_id_header).toBeNull();
  });

  it('rejects malformed message identity', () => {
    expect(record({
      messageId: 'invalid',
    }).message_id_header).toBeNull();
  });

  it('preserves reply identity', () => {
    expect(record({
      inReplyTo: '<parent@example.com>',
    }).in_reply_to)
      .toBe('<parent@example.com>');
  });

  it('preserves ordered references', () => {
    expect(record({
      references: [
        '<root@example.com>',
        '<parent@example.com>',
      ],
    }).refs).toBe(
      '<root@example.com> <parent@example.com>'
    );
  });

  it('removes duplicate references', () => {
    expect(record({
      references: [
        '<root@example.com>',
        '<root@example.com>',
      ],
    }).refs).toBe(
      '<root@example.com>'
    );
  });

  it('stores null for missing references', () => {
    expect(record().refs).toBeNull();
  });

  it('preserves sender name', () => {
    expect(record().from_name)
      .toBe('Customer');
  });

  it('normalizes sender domain', () => {
    expect(record({
      from: {
        name: 'Customer',
        address: 'Customer@EXAMPLE.COM',
      },
    }).from_addr).toBe(
      'Customer@example.com'
    );
  });

  it('serializes recipients using schema keys', () => {
    expect(JSON.parse(
      record().to_addrs
    )).toEqual([{
      name: 'Owner',
      addr: 'owner@example.com',
    }]);
  });

  it('serializes empty recipients', () => {
    expect(serializeAddresses([]))
      .toBe('[]');
  });

  it('preserves CC recipients', () => {
    expect(JSON.parse(record({
      cc: [{
        name: 'CC',
        address: 'cc@example.com',
      }],
    }).cc_addrs)).toEqual([{
      name: 'CC',
      addr: 'cc@example.com',
    }]);
  });

  it('preserves BCC recipients', () => {
    expect(JSON.parse(record({
      bcc: [{
        name: 'BCC',
        address: 'bcc@example.com',
      }],
    }).bcc_addrs)).toEqual([{
      name: 'BCC',
      addr: 'bcc@example.com',
    }]);
  });

  it('preserves reply-to addresses', () => {
    expect(JSON.parse(record({
      replyTo: [{
        name: 'Support',
        address: 'support@example.com',
      }],
    }).reply_to!)).toEqual([{
      name: 'Support',
      addr: 'support@example.com',
    }]);
  });

  it('stores null for missing reply-to', () => {
    expect(record().reply_to).toBeNull();
  });

  it('preserves plain text', () => {
    expect(record().text_body)
      .toBe('Thank you for your business.');
  });

  it('preserves prepared HTML', () => {
    expect(record().html_body)
      .toBe('<p>Thank you.</p>');
  });

  it('preserves inbox classification', () => {
    expect(record().folder)
      .toBe('inbox');
  });

  it('preserves spam classification', () => {
    const result = record({}, {
      score: 7,
      folder: 'spam',
      evidence: [],
    });

    expect(result.folder).toBe('spam');
    expect(result.spam_score).toBe(7);
  });

  it('preserves negative spam scores', () => {
    expect(record({}, {
      score: -3,
      folder: 'inbox',
      evidence: [],
    }).spam_score).toBe(-3);
  });

  it('initializes unread messages', () => {
    expect(record().is_read).toBe(0);
  });

  it('initializes unstarred messages', () => {
    expect(record().is_starred).toBe(0);
  });

  it('marks inbound direction', () => {
    expect(record().direction).toBe('in');
  });

  it('preserves raw email size', () => {
    expect(record().raw_size).toBe(1024);
  });

  it('preserves all timestamps', () => {
    const result = record();

    expect(result.received_at).toBe(NOW);
    expect(result.created_at).toBe(NOW);
    expect(result.updated_at).toBe(NOW);
  });

  it('marks messages without attachments', () => {
    expect(record().has_attachments)
      .toBe(0);
  });

  it('marks messages with attachments', () => {
    expect(record({
      attachments: [{
        filename: 'invoice.txt',
        mime: 'text/plain',
        contentId: null,
        isInline: false,
        size: 4,
        data: new Uint8Array([
          1, 2, 3, 4,
        ]),
      }],
    }).has_attachments).toBe(1);
  });

  it('bounds stored plain text', () => {
    const result = record({
      text: 'x'.repeat(MAX_BODY_BYTES + 1),
    });

    expect(new TextEncoder().encode(
      result.text_body
    ).length).toBe(MAX_BODY_BYTES);
  });

  it('bounds stored HTML', () => {
    const result = record({
      html: 'x'.repeat(MAX_BODY_BYTES + 1),
    });

    expect(new TextEncoder().encode(
      result.html_body
    ).length).toBe(MAX_BODY_BYTES);
  });

  it('rejects invalid timestamps', () => {
    expect(() => prepareMessageRecord(
      email(),
      'thread-test',
      clean,
      -1,
    )).toThrow('Invalid message timestamp');
  });

  it('rejects missing thread identifiers', () => {
    expect(() => prepareMessageRecord(
      email(),
      '',
      clean,
      NOW,
    )).toThrow('Invalid thread identifier');
  });

  it('rejects invalid spam scores', () => {
    expect(() => record({}, {
      score: Infinity,
      folder: 'spam',
      evidence: [],
    })).toThrow('Invalid spam score');
  });

  it('rejects inconsistent classifications', () => {
    expect(() => record({}, {
      score: 7,
      folder: 'inbox',
      evidence: [],
    })).toThrow('Inconsistent spam decision');
  });

  it('rejects missing sender addresses', () => {
    expect(() => record({
      from: {
        name: '',
        address: '',
      },
    })).toThrow('Missing sender address');
  });
});

describe('Message snippet generation', () => {
  it('handles empty content', () => {
    expect(createMessageSnippet(''))
      .toBe('');
  });

  it('normalizes whitespace', () => {
    expect(createMessageSnippet(
      ' Hello \n\t world '
    )).toBe('Hello world');
  });

  it('bounds snippet length', () => {
    expect(createMessageSnippet(
      'x'.repeat(1000)
    ).length).toBe(MAX_SNIPPET_BYTES);
  });

  it('preserves Unicode boundaries', () => {
    const result = createMessageSnippet(
      '😀'.repeat(1000)
    );

    expect(new TextEncoder().encode(
      result
    ).length).toBeLessThanOrEqual(
      MAX_SNIPPET_BYTES
    );

    expect(result).not.toContain('\uFFFD');
  });

  it('preserves Bengali text', () => {
    expect(createMessageSnippet(
      'আপনাকে ধন্যবাদ'
    )).toBe('আপনাকে ধন্যবাদ');
  });
});
