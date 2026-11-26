export const MAX_RAW_EMAIL_BYTES = 25_000_000;

export class EmailTooLargeError extends Error {
  constructor(public readonly limit: number) {
    super(`Email exceeds ${limit} bytes`);
    this.name = 'EmailTooLargeError';
  }
}

export async function readBoundedStream(
  stream: ReadableStream<Uint8Array>,
  limit = MAX_RAW_EMAIL_BYTES,
): Promise<Uint8Array> {
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError('Invalid stream size limit');
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      if (!(value instanceof Uint8Array)) {
        throw new TypeError('Invalid stream chunk');
      }

      if (value.byteLength > limit - total) {
        throw new EmailTooLargeError(limit);
      }

      total += value.byteLength;
      chunks.push(value);
    }

    const result = new Uint8Array(total);
    let offset = 0;

    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }

    return result;
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // Preserve the original error.
    }

    throw error;
  } finally {
    reader.releaseLock();
  }
}
