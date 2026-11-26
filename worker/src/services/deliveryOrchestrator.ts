import {
  resolveForwardingConfig,
  isAuthorizedRecipient,
} from './forwardingConfig';

import {
  processInboundEmail,
  type InboundResult,
} from './inboundProcessor';

export interface IncomingDelivery {
  readonly from: string;
  readonly to: string;
  readonly headers: Headers;
  readonly raw: ReadableStream<Uint8Array>;
  readonly rawSize: number;

  forward(
    destination: string,
  ): Promise<unknown>;
}

export interface DeliveryEnvironment {
  DB: D1Database;
  OWNER_EMAIL?: string;
  FORWARD_TO_EMAIL?: string;
}

export type DeliveryResult =
  | {
      status: 'blocked';
      reason:
        | 'invalid_configuration'
        | 'unauthorized_recipient';
    }
  | {
      status:
        | 'complete'
        | 'partial'
        | 'failed';

      forwarding:
        | 'accepted'
        | 'failed';

      storage: InboundResult;
    };

export async function orchestrateDelivery(
  message: IncomingDelivery,
  env: DeliveryEnvironment,
): Promise<DeliveryResult> {
  let config;

  try {
    config = resolveForwardingConfig(
      env.OWNER_EMAIL,
      env.FORWARD_TO_EMAIL,
    );
  } catch {
    return {
      status: 'blocked',
      reason: 'invalid_configuration',
    };
  }

  if (!isAuthorizedRecipient(
    message.to,
    config,
  )) {
    return {
      status: 'blocked',
      reason: 'unauthorized_recipient',
    };
  }

  const receivedAt = Date.now();

  let forwarding:
    | 'accepted'
    | 'failed' = 'failed';

  // Preserve the existing Gmail delivery path
  // before starting database processing.

  try {
    await message.forward(
      config.destination
    );

    forwarding = 'accepted';
  } catch {
    forwarding = 'failed';
  }

  let storage: InboundResult;

  try {
    storage = await processInboundEmail(
      env.DB,
      {
        raw: message.raw,
        envelopeFrom: message.from,
        envelopeTo: message.to,
        rawSubject: message.headers.get(
          'subject'
        ),
        rawMessageId: message.headers.get(
          'message-id'
        ),
        rawSize: message.rawSize,
        receivedAt,
      },
    );

  } catch {
    storage = {
      status: 'failed',
      reason: 'processing_failed',
    };
  }

  const stored =
    storage.status === 'stored' ||
    storage.status === 'duplicate';

  const forwarded =
    forwarding === 'accepted';

  const status =
    forwarded && stored
      ? 'complete'
      : forwarded || stored
        ? 'partial'
        : 'failed';

  return {
    status,
    forwarding,
    storage,
  };
}
