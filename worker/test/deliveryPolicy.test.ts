import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  evaluateDelivery,
  createDeliveryEvent,
} from '../src/services/deliveryPolicy';

import type {
  DeliveryResult,
} from '../src/services/deliveryOrchestrator';

import type {
  InboundResult,
} from '../src/services/inboundProcessor';

const stored: InboundResult = {
  status: 'stored',
  messageId: 'private-message-id',
  threadId: 'private-thread-id',
  recovered: false,
};

const duplicate: InboundResult = {
  ...stored,
  status: 'duplicate',
};

const recovered: InboundResult = {
  ...stored,
  recovered: true,
};

const failed: InboundResult = {
  status: 'failed',
  reason: 'processing_failed',
};

const oversized: InboundResult = {
  status: 'rejected',
  reason: 'email_too_large',
};

function result(
  forwarding: 'accepted' | 'failed',
  storage: InboundResult,
): DeliveryResult {
  const stored =
    storage.status === 'stored' ||
    storage.status === 'duplicate';

  const forwarded =
    forwarding === 'accepted';

  return {
    status:
      stored && forwarded
        ? 'complete'
        : stored || forwarded
          ? 'partial'
          : 'failed',
    forwarding,
    storage,
  };
}

describe('Delivery recovery policy', () => {
  it('accepts complete delivery', () => {
    expect(evaluateDelivery(
      result('accepted', stored)
    )).toEqual({
      action: 'accept',
      code: 'delivery_complete',
      severity: 'info',
      rejectionReason: null,
      recoveryRequired: false,
    });
  });

  it('accepts duplicate storage', () => {
    expect(evaluateDelivery(
      result('accepted', duplicate)
    ).action).toBe('accept');
  });

  it('flags recovered content', () => {
    expect(evaluateDelivery(
      result('accepted', recovered)
    )).toMatchObject({
      action: 'accept_with_warning',
      code: 'recovered_content',
      recoveryRequired: true,
    });
  });

  it('preserves successful Gmail forwarding', () => {
    expect(evaluateDelivery(
      result('accepted', failed)
    )).toMatchObject({
      action: 'accept_with_warning',
      code: 'storage_failed',
      rejectionReason: null,
    });
  });

  it('preserves forwarding for oversized mail', () => {
    expect(evaluateDelivery(
      result('accepted', oversized)
    )).toMatchObject({
      action: 'accept_with_warning',
      code: 'storage_size_limit',
    });
  });

  it('preserves stored mail after forwarding failure', () => {
    expect(evaluateDelivery(
      result('failed', stored)
    )).toMatchObject({
      action: 'accept_with_warning',
      code: 'forwarding_failed',
      recoveryRequired: true,
    });
  });

  it('preserves existing duplicate after forwarding failure', () => {
    expect(evaluateDelivery(
      result('failed', duplicate)
    ).code).toBe('forwarding_failed');
  });

  it('flags recovered mail after forwarding failure', () => {
    expect(evaluateDelivery(
      result('failed', recovered)
    ).recoveryRequired).toBe(true);
  });

  it('rejects complete delivery failure', () => {
    expect(evaluateDelivery(
      result('failed', failed)
    )).toEqual({
      action: 'reject',
      code: 'delivery_failed',
      severity: 'error',
      rejectionReason:
        'Mail delivery unavailable',
      recoveryRequired: true,
    });
  });

  it('rejects oversized mail if forwarding fails', () => {
    expect(evaluateDelivery(
      result('failed', oversized)
    )).toMatchObject({
      action: 'reject',
      code: 'message_too_large',
    });
  });

  it('rejects unauthorized recipients', () => {
    expect(evaluateDelivery({
      status: 'blocked',
      reason: 'unauthorized_recipient',
    })).toEqual({
      action: 'reject',
      code: 'unauthorized_recipient',
      severity: 'error',
      rejectionReason:
        'Recipient unavailable',
      recoveryRequired: false,
    });
  });

  it('rejects invalid configuration', () => {
    expect(evaluateDelivery({
      status: 'blocked',
      reason: 'invalid_configuration',
    })).toEqual({
      action: 'reject',
      code: 'invalid_configuration',
      severity: 'error',
      rejectionReason:
        'Mail service unavailable',
      recoveryRequired: true,
    });
  });

  it.each([
    stored,
    duplicate,
    recovered,
    failed,
    oversized,
  ])('never rejects accepted forwarding %#', storage => {
    expect(evaluateDelivery(
      result('accepted', storage)
    ).action).not.toBe('reject');
  });

  it.each([
    stored,
    duplicate,
    recovered,
  ])('never rejects persisted mail %#', storage => {
    expect(evaluateDelivery(
      result('failed', storage)
    ).action).not.toBe('reject');
  });
});

describe('Privacy-safe delivery events', () => {
  it('creates structured delivery events', () => {
    const policy = evaluateDelivery(
      result('accepted', stored)
    );

    expect(createDeliveryEvent(
      policy
    )).toEqual({
      event: 'delivery_complete',
      severity: 'info',
      action: 'accept',
      recoveryRequired: false,
    });
  });

  it('excludes private message identifiers', () => {
    const event = createDeliveryEvent(
      evaluateDelivery(
        result('accepted', stored)
      )
    );

    expect(JSON.stringify(event))
      .not.toContain('private-message-id');

    expect(JSON.stringify(event))
      .not.toContain('private-thread-id');
  });

  it('flags failed forwarding for recovery', () => {
    const event = createDeliveryEvent(
      evaluateDelivery(
        result('failed', stored)
      )
    );

    expect(event.recoveryRequired)
      .toBe(true);

    expect(event.severity)
      .toBe('error');
  });

  it('excludes rejection reason from logs', () => {
    const event = createDeliveryEvent(
      evaluateDelivery(
        result('failed', failed)
      )
    );

    expect(event)
      .not.toHaveProperty('rejectionReason');
  });
});
