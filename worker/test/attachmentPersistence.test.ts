import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  safeAttachmentFilename,
  safeAttachmentMime,
  prepareAttachmentRecord,
  buildAttachmentStatements,
  MAX_STORED_FILENAME_BYTES,
} from '../src/services/attachmentPersistence';

import {
  MAX_ATTACHMENT_BYTES,
  type ParsedAttachment,
} from '../src/services/mime';

function attachment(
  overrides: Partial<ParsedAttachment> = {},
): ParsedAttachment {
  return {
    filename: 'invoice.txt',
    mime: 'text/plain',
    contentId: null,
    isInline: false,
    size: 4,
    data: new Uint8Array([0, 1, 128, 255]),
    ...overrides,
  };
}

describe('Attachment filename protection', () => {
  it('preserves ordinary filenames', () => {
    expect(safeAttachmentFilename(
      'invoice.pdf'
    )).toBe('invoice.pdf');
  });

  it('neutralizes path separators', () => {
    expect(safeAttachmentFilename(
      '../../invoice.pdf'
    )).not.toContain('/');
  });

  it('neutralizes Windows separators', () => {
    expect(safeAttachmentFilename(
      'folder\\invoice.pdf'
    )).toBe('folder_invoice.pdf');
  });

  it('removes control characters', () => {
    expect(safeAttachmentFilename(
      'invoice\u0000\r\n.pdf'
    )).toBe('invoice.pdf');
  });

  it.each([
    '',
    ' ',
    '.',
    '..',
  ])('uses fallback for filename %j', value => {
    expect(safeAttachmentFilename(
      value
    )).toBe('attachment');
  });

  it('preserves Bengali filenames', () => {
    expect(safeAttachmentFilename(
      'চালান.pdf'
    )).toBe('চালান.pdf');
  });

  it('bounds filename byte length', () => {
    const result = safeAttachmentFilename(
      '😀'.repeat(1000)
    );

    expect(new TextEncoder().encode(
      result
    ).length).toBeLessThanOrEqual(
      MAX_STORED_FILENAME_BYTES
    );

    expect(result).not.toContain('\uFFFD');
  });
});

describe('Attachment MIME protection', () => {
  it.each([
    'application/pdf',
    'image/png',
    'text/plain',
    'application/vnd.example+json',
  ])('preserves valid MIME %s', mime => {
    expect(safeAttachmentMime(
      mime
    )).toBe(mime);
  });

  it('normalizes MIME case', () => {
    expect(safeAttachmentMime(
      ' IMAGE/PNG '
    )).toBe('image/png');
  });

  it.each([
    '',
    'invalid',
    'text/plain\r\nInjected: yes',
    'x'.repeat(300) + '/plain',
  ])('rejects malformed MIME %#', mime => {
    expect(safeAttachmentMime(
      mime
    )).toBe('application/octet-stream');
  });
});

describe('Binary attachment record preparation', () => {
  it('generates unique identifiers', () => {
    expect(prepareAttachmentRecord(
      'message-1',
      attachment(),
    ).id).not.toBe(
      prepareAttachmentRecord(
        'message-1',
        attachment(),
      ).id
    );
  });

  it('preserves message relationship', () => {
    expect(prepareAttachmentRecord(
      'message-1',
      attachment(),
    ).message_id).toBe('message-1');
  });

  it('preserves exact binary bytes', () => {
    const result = prepareAttachmentRecord(
      'message-1',
      attachment(),
    );

    expect(Array.from(
      new Uint8Array(result.data)
    )).toEqual([0, 1, 128, 255]);
  });

  it('stores binary data as ArrayBuffer', () => {
    expect(prepareAttachmentRecord(
      'message-1',
      attachment(),
    ).data).toBeInstanceOf(ArrayBuffer);
  });

  it('copies only the selected binary view', () => {
    const original = new Uint8Array([
      9, 1, 2, 3, 9,
    ]);

    const result = prepareAttachmentRecord(
      'message-1',
      attachment({
        data: original.subarray(1, 4),
        size: 3,
      }),
    );

    expect(Array.from(
      new Uint8Array(result.data)
    )).toEqual([1, 2, 3]);
  });

  it('isolates stored bytes from source mutation', () => {
    const original = attachment();

    const result = prepareAttachmentRecord(
      'message-1',
      original,
    );

    original.data[0] = 99;

    expect(
      new Uint8Array(result.data)[0]
    ).toBe(0);
  });

  it('preserves actual binary size', () => {
    expect(prepareAttachmentRecord(
      'message-1',
      attachment(),
    ).size).toBe(4);
  });

  it('preserves inline attachment metadata', () => {
    const result = prepareAttachmentRecord(
      'message-1',
      attachment({
        isInline: true,
        contentId: '<logo@example.com>',
      }),
    );

    expect(result.is_inline).toBe(1);

    expect(result.content_id)
      .toBe('<logo@example.com>');
  });

  it('preserves ordinary attachment metadata', () => {
    const result = prepareAttachmentRecord(
      'message-1',
      attachment(),
    );

    expect(result.is_inline).toBe(0);
    expect(result.content_id).toBeNull();
  });

  it('accepts empty binary attachments', () => {
    expect(prepareAttachmentRecord(
      'message-1',
      attachment({
        size: 0,
        data: new Uint8Array(0),
      }),
    ).size).toBe(0);
  });

  it('accepts the exact size limit', () => {
    expect(prepareAttachmentRecord(
      'message-1',
      attachment({
        size: MAX_ATTACHMENT_BYTES,
        data: new Uint8Array(
          MAX_ATTACHMENT_BYTES
        ),
      }),
    ).size).toBe(MAX_ATTACHMENT_BYTES);
  });

  it('rejects attachments above the limit', () => {
    expect(() => prepareAttachmentRecord(
      'message-1',
      attachment({
        size: MAX_ATTACHMENT_BYTES + 1,
        data: new Uint8Array(
          MAX_ATTACHMENT_BYTES + 1
        ),
      }),
    )).toThrow(
      'Attachment exceeds storage limit'
    );
  });

  it('rejects inconsistent attachment sizes', () => {
    expect(() => prepareAttachmentRecord(
      'message-1',
      attachment({ size: 100 }),
    )).toThrow('Attachment size mismatch');
  });

  it('rejects missing message identifiers', () => {
    expect(() => prepareAttachmentRecord(
      '',
      attachment(),
    )).toThrow(
      'Missing attachment message identifier'
    );
  });

  it('rejects nonbinary data', () => {
    expect(() => prepareAttachmentRecord(
      'message-1',
      attachment({
        data: 'invalid' as unknown as Uint8Array,
      }),
    )).toThrow(
      'Invalid attachment binary data'
    );
  });
});

describe('Attachment SQL statements', () => {
  it('uses parameterized binary insertion', () => {
    const bind = vi.fn().mockReturnValue({});

    const prepare = vi.fn()
      .mockReturnValue({ bind });

    const db = {
      prepare,
    } as unknown as D1Database;

    const statements =
      buildAttachmentStatements(
        db,
        'message-1',
        [attachment()],
      );

    expect(statements).toHaveLength(1);

    expect(prepare.mock.calls[0][0])
      .toContain('INSERT INTO attachments');

    expect(bind.mock.calls[0])
      .toHaveLength(8);

    expect(bind.mock.calls[0][1])
      .toBe('message-1');

    expect(bind.mock.calls[0][7])
      .toBeInstanceOf(ArrayBuffer);
  });

  it('creates one statement per attachment', () => {
    const bind = vi.fn().mockReturnValue({});

    const db = {
      prepare: vi.fn().mockReturnValue({
        bind,
      }),
    } as unknown as D1Database;

    expect(buildAttachmentStatements(
      db,
      'message-1',
      [
        attachment(),
        attachment(),
        attachment(),
      ],
    )).toHaveLength(3);
  });

  it('creates no statements for empty attachments', () => {
    const prepare = vi.fn();

    const db = {
      prepare,
    } as unknown as D1Database;

    expect(buildAttachmentStatements(
      db,
      'message-1',
      [],
    )).toEqual([]);

    expect(prepare).not.toHaveBeenCalled();
  });
});
