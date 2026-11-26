import { describe, expect, it } from 'vitest';

import {
  readBoundedStream,
  EmailTooLargeError,
  MAX_RAW_EMAIL_BYTES,
} from '../src/services/streams';

function makeStream(
  ...chunks: Uint8Array[]
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(chunk);
      }

      controller.close();
    },
  });
}

const bytes = (...values: number[]) =>
  new Uint8Array(values);

describe('Bounded email stream reader', () => {
  it('uses a 25 MB default limit', () => {
    expect(MAX_RAW_EMAIL_BYTES).toBe(25_000_000);
  });

  it('reads an empty stream', async () => {
    expect(await readBoundedStream(makeStream()))
      .toEqual(bytes());
  });

  it('reads a single chunk', async () => {
    expect(await readBoundedStream(
      makeStream(bytes(1, 2, 3))
    )).toEqual(bytes(1, 2, 3));
  });

  it('combines chunks in order', async () => {
    expect(await readBoundedStream(
      makeStream(bytes(1, 2), bytes(3, 4))
    )).toEqual(bytes(1, 2, 3, 4));
  });

  it('preserves binary data', async () => {
    expect(await readBoundedStream(
      makeStream(bytes(0, 255, 128))
    )).toEqual(bytes(0, 255, 128));
  });

  it('accepts an exact size boundary', async () => {
    expect(await readBoundedStream(
      makeStream(bytes(1, 2, 3)), 3
    )).toEqual(bytes(1, 2, 3));
  });

  it('rejects an oversized chunk', async () => {
    await expect(readBoundedStream(
      makeStream(bytes(1, 2, 3)), 2
    )).rejects.toBeInstanceOf(EmailTooLargeError);
  });

  it('rejects cumulative overflow', async () => {
    await expect(readBoundedStream(
      makeStream(bytes(1, 2), bytes(3, 4)), 3
    )).rejects.toBeInstanceOf(EmailTooLargeError);
  });

  it('cancels oversized streams', async () => {
    let cancelled = false;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes(1, 2, 3));
      },
      cancel() {
        cancelled = true;
      },
    });

    await expect(readBoundedStream(stream, 2))
      .rejects.toBeInstanceOf(EmailTooLargeError);

    expect(cancelled).toBe(true);
    expect(stream.locked).toBe(false);
  });

  it('releases the reader after success', async () => {
    const stream = makeStream(bytes(1));

    await readBoundedStream(stream);

    expect(stream.locked).toBe(false);
  });

  it('propagates stream failures', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error('Read failure'));
      },
    });

    await expect(readBoundedStream(stream))
      .rejects.toThrow('Read failure');

    expect(stream.locked).toBe(false);
  });

  it.each([0, -1, 1.5, NaN, Infinity])(
    'rejects invalid limit %s',
    async (limit) => {
      await expect(readBoundedStream(
        makeStream(), limit
      )).rejects.toBeInstanceOf(RangeError);
    },
  );
});
