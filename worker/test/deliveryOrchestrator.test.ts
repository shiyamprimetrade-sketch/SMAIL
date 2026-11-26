import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  orchestrateDelivery,
  type IncomingDelivery,
} from '../src/services/deliveryOrchestrator';

import {
  processInboundEmail,
} from '../src/services/inboundProcessor';

vi.mock(
  '../src/services/inboundProcessor',
  () => ({
    processInboundEmail: vi.fn(),
  }),
);

const env = {
  DB: {} as D1Database,
  OWNER_EMAIL: 'owner@example.com',
  FORWARD_TO_EMAIL: 'test@gmail.com',
};

function delivery(
  overrides: Partial<IncomingDelivery> = {},
) {
  const forward = vi.fn()
    .mockResolvedValue(undefined);

  const message: IncomingDelivery = {
    from: 'customer@example.com',
    to: 'owner@example.com',
    headers: new Headers({
      subject: 'Business invoice',
      'message-id': '<invoice@example.com>',
    }),
    raw: new Response(
      'Synthetic MIME'
    ).body!,
    rawSize: 14,
    forward,
    ...overrides,
  };

  return { message, forward };
}

const stored = {
  status: 'stored' as const,
  messageId: 'message-test',
  threadId: 'thread-test',
  recovered: false,
};

beforeEach(() => {
  vi.resetAllMocks();

  vi.mocked(
    processInboundEmail
  ).mockResolvedValue(stored);
});

describe('Delivery orchestration', () => {
  it('completes forwarding and storage', async () => {
    const { message } = delivery();

    expect(await orchestrateDelivery(
      message,
      env,
    )).toEqual({
      status: 'complete',
      forwarding: 'accepted',
      storage: stored,
    });
  });

  it('forwards only to configured destination', async () => {
    const { message, forward } = delivery();

    await orchestrateDelivery(
      message,
      env,
    );

    expect(forward)
      .toHaveBeenCalledWith(
        'test@gmail.com'
      );
  });

  it('attempts forwarding before storage', async () => {
    const order: string[] = [];

    const { message } = delivery({
      forward: async () => {
        order.push('forward');
      },
    });

    vi.mocked(
      processInboundEmail
    ).mockImplementationOnce(
      async () => {
        order.push('store');
        return stored;
      }
    );

    await orchestrateDelivery(
      message,
      env,
    );

    expect(order).toEqual([
      'forward',
      'store',
    ]);
  });

  it('passes original MIME stream', async () => {
    const { message } = delivery();

    await orchestrateDelivery(
      message,
      env,
    );

    expect(processInboundEmail)
      .toHaveBeenCalledWith(
        env.DB,
        expect.objectContaining({
          raw: message.raw,
        }),
      );
  });

  it('passes envelope and raw metadata', async () => {
    const { message } = delivery();

    await orchestrateDelivery(
      message,
      env,
    );

    expect(processInboundEmail)
      .toHaveBeenCalledWith(
        env.DB,
        expect.objectContaining({
          envelopeFrom:
            'customer@example.com',
          envelopeTo:
            'owner@example.com',
          rawSubject:
            'Business invoice',
          rawMessageId:
            '<invoice@example.com>',
          rawSize: 14,
        }),
      );
  });

  it('records receipt timestamp', async () => {
    const { message } = delivery();

    await orchestrateDelivery(
      message,
      env,
    );

    expect(processInboundEmail)
      .toHaveBeenCalledWith(
        env.DB,
        expect.objectContaining({
          receivedAt: expect.any(Number),
        }),
      );
  });

  it('blocks missing forwarding configuration', async () => {
    const { message, forward } = delivery();

    expect(await orchestrateDelivery(
      message,
      {
        ...env,
        FORWARD_TO_EMAIL: undefined,
      },
    )).toEqual({
      status: 'blocked',
      reason: 'invalid_configuration',
    });

    expect(forward)
      .not.toHaveBeenCalled();

    expect(processInboundEmail)
      .not.toHaveBeenCalled();
  });

  it('blocks unauthorized recipient', async () => {
    const { message, forward } = delivery({
      to: 'other@example.com',
    });

    expect(await orchestrateDelivery(
      message,
      env,
    )).toEqual({
      status: 'blocked',
      reason: 'unauthorized_recipient',
    });

    expect(forward)
      .not.toHaveBeenCalled();

    expect(processInboundEmail)
      .not.toHaveBeenCalled();
  });

  it('blocks forwarding loops', async () => {
    const { message } = delivery();

    expect(await orchestrateDelivery(
      message,
      {
        ...env,
        FORWARD_TO_EMAIL:
          env.OWNER_EMAIL,
      },
    )).toEqual({
      status: 'blocked',
      reason: 'invalid_configuration',
    });
  });

  it('preserves forwarding after database failure', async () => {
    const { message } = delivery();

    vi.mocked(
      processInboundEmail
    ).mockResolvedValueOnce({
      status: 'failed',
      reason: 'processing_failed',
    });

    expect(await orchestrateDelivery(
      message,
      env,
    )).toEqual({
      status: 'partial',
      forwarding: 'accepted',
      storage: {
        status: 'failed',
        reason: 'processing_failed',
      },
    });
  });

  it('stores email after forwarding failure', async () => {
    const { message, forward } = delivery();

    forward.mockRejectedValueOnce(
      new Error('Forwarding unavailable')
    );

    expect(await orchestrateDelivery(
      message,
      env,
    )).toEqual({
      status: 'partial',
      forwarding: 'failed',
      storage: stored,
    });
  });

  it('detects failure of both operations', async () => {
    const { message, forward } = delivery();

    forward.mockRejectedValueOnce(
      new Error('Forwarding unavailable')
    );

    vi.mocked(
      processInboundEmail
    ).mockResolvedValueOnce({
      status: 'failed',
      reason: 'processing_failed',
    });

    expect(await orchestrateDelivery(
      message,
      env,
    )).toEqual({
      status: 'failed',
      forwarding: 'failed',
      storage: {
        status: 'failed',
        reason: 'processing_failed',
      },
    });
  });

  it('contains unexpected processor exceptions', async () => {
    const { message } = delivery();

    vi.mocked(
      processInboundEmail
    ).mockRejectedValueOnce(
      new Error('Private database error')
    );

    expect(await orchestrateDelivery(
      message,
      env,
    )).toEqual({
      status: 'partial',
      forwarding: 'accepted',
      storage: {
        status: 'failed',
        reason: 'processing_failed',
      },
    });
  });

  it('preserves duplicate storage result', async () => {
    const { message } = delivery();

    vi.mocked(
      processInboundEmail
    ).mockResolvedValueOnce({
      ...stored,
      status: 'duplicate',
    });

    expect(await orchestrateDelivery(
      message,
      env,
    )).toEqual({
      status: 'complete',
      forwarding: 'accepted',
      storage: {
        ...stored,
        status: 'duplicate',
      },
    });
  });

  it('preserves fallback recovery result', async () => {
    const { message } = delivery();

    vi.mocked(
      processInboundEmail
    ).mockResolvedValueOnce({
      ...stored,
      recovered: true,
    });

    expect(await orchestrateDelivery(
      message,
      env,
    )).toEqual({
      status: 'complete',
      forwarding: 'accepted',
      storage: {
        ...stored,
        recovered: true,
      },
    });
  });

  it('preserves forwarding when storage rejects size', async () => {
    const { message } = delivery();

    vi.mocked(
      processInboundEmail
    ).mockResolvedValueOnce({
      status: 'rejected',
      reason: 'email_too_large',
    });

    expect(await orchestrateDelivery(
      message,
      env,
    )).toEqual({
      status: 'partial',
      forwarding: 'accepted',
      storage: {
        status: 'rejected',
        reason: 'email_too_large',
      },
    });
  });

  it('does not expose forwarding error details', async () => {
    const { message, forward } = delivery();

    forward.mockRejectedValueOnce(
      new Error('PRIVATE_PROVIDER_DETAILS')
    );

    const result = await orchestrateDelivery(
      message,
      env,
    );

    expect(JSON.stringify(result))
      .not.toContain(
        'PRIVATE_PROVIDER_DETAILS'
      );
  });

  it('attempts forwarding only once per invocation', async () => {
    const { message, forward } = delivery();

    await orchestrateDelivery(
      message,
      env,
    );

    expect(forward)
      .toHaveBeenCalledTimes(1);
  });

  it('attempts storage only once per invocation', async () => {
    const { message } = delivery();

    await orchestrateDelivery(
      message,
      env,
    );

    expect(processInboundEmail)
      .toHaveBeenCalledTimes(1);
  });

  it('handles absent optional headers', async () => {
    const { message } = delivery({
      headers: new Headers(),
    });

    await orchestrateDelivery(
      message,
      env,
    );

    expect(processInboundEmail)
      .toHaveBeenCalledWith(
        env.DB,
        expect.objectContaining({
          rawSubject: null,
          rawMessageId: null,
        }),
      );
  });
});
