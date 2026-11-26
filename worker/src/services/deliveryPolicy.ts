import type {
  DeliveryResult,
} from './deliveryOrchestrator';

export type DeliveryAction =
  | 'accept'
  | 'accept_with_warning'
  | 'reject';

export type DeliveryCode =
  | 'delivery_complete'
  | 'recovered_content'
  | 'storage_failed'
  | 'storage_size_limit'
  | 'forwarding_failed'
  | 'delivery_failed'
  | 'message_too_large'
  | 'invalid_configuration'
  | 'unauthorized_recipient';

export interface DeliveryPolicy {
  action: DeliveryAction;
  code: DeliveryCode;
  severity: 'info' | 'warn' | 'error';
  rejectionReason: string | null;
  recoveryRequired: boolean;
}

export function evaluateDelivery(
  result: DeliveryResult,
): DeliveryPolicy {
  if (result.status === 'blocked') {
    return {
      action: 'reject',
      code: result.reason,
      severity: 'error',
      rejectionReason:
        result.reason === 'unauthorized_recipient'
          ? 'Recipient unavailable'
          : 'Mail service unavailable',
      recoveryRequired:
        result.reason === 'invalid_configuration',
    };
  }

  const forwarded =
    result.forwarding === 'accepted';

  const stored =
    result.storage.status === 'stored' ||
    result.storage.status === 'duplicate';

  if (forwarded && stored) {
    const recovered =
      result.storage.recovered;

    return {
      action: recovered
        ? 'accept_with_warning'
        : 'accept',
      code: recovered
        ? 'recovered_content'
        : 'delivery_complete',
      severity: recovered
        ? 'warn'
        : 'info',
      rejectionReason: null,
      recoveryRequired: recovered,
    };
  }

  if (forwarded) {
    return {
      action: 'accept_with_warning',
      code:
        result.storage.status === 'rejected'
          ? 'storage_size_limit'
          : 'storage_failed',
      severity: 'warn',
      rejectionReason: null,
      recoveryRequired: true,
    };
  }

  if (stored) {
    return {
      action: 'accept_with_warning',
      code: 'forwarding_failed',
      severity: 'error',
      rejectionReason: null,
      recoveryRequired: true,
    };
  }

  const oversized =
    result.storage.status === 'rejected';

  return {
    action: 'reject',
    code: oversized
      ? 'message_too_large'
      : 'delivery_failed',
    severity: 'error',
    rejectionReason: oversized
      ? 'Message exceeds storage size limit'
      : 'Mail delivery unavailable',
    recoveryRequired: true,
  };
}

export function createDeliveryEvent(
  policy: DeliveryPolicy,
): {
  event: string;
  severity: string;
  action: string;
  recoveryRequired: boolean;
} {
  return {
    event: policy.code,
    severity: policy.severity,
    action: policy.action,
    recoveryRequired:
      policy.recoveryRequired,
  };
}
