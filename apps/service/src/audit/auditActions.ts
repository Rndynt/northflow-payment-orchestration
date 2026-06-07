/**
 * auditActions — S8: central audit action name registry.
 *
 * Prevents arbitrary strings from being scattered across route handlers.
 * Every audited action must appear here.
 *
 * Naming convention: <domain>.<verb>  (e.g. merchant.create, payment_intent.create)
 */

export const AuditAction = {
  // Merchant
  MERCHANT_CREATE:                'merchant.create',
  MERCHANT_READ:                  'merchant.read',

  // Provider Account
  PROVIDER_ACCOUNT_CREATE:        'provider_account.create',
  PROVIDER_ACCOUNT_READ:          'provider_account.read',

  // Payment Method (S7.5)
  PAYMENT_METHOD_LIST:            'payment_method.list',
  PAYMENT_METHOD_UPSERT:          'payment_method.upsert',
  PAYMENT_METHOD_SYNC:            'payment_method.sync',
  PAYMENT_OPTIONS_READ:           'payment_options.read',

  // Payment Intent
  PAYMENT_INTENT_CREATE:          'payment_intent.create',
  PAYMENT_INTENT_STATUS:          'payment_intent.status.read',
  PAYMENT_INTENT_REFUND_CHECK:    'payment_intent.refundability.read',

  // Gateway / Transaction
  GATEWAY_PAYMENT_CREATE:         'gateway_payment.create',
  PAYMENT_REFUND:                 'payment.refund',
  PAYMENT_VOID:                   'payment.void',
  PAYMENT_RECONCILE:              'payment.reconcile',

  // Provider Events
  PROVIDER_EVENT_REPROCESS:       'provider_event.reprocess',

  // Audit Logs (read)
  AUDIT_LOG_READ:                 'audit_log.read',

  // S9.1: API Client Credential Lifecycle
  API_CLIENT_CREDENTIAL_CREATE:   'api_client.credential.create',
  API_CLIENT_CREDENTIAL_READ:     'api_client.credential.read',
  API_CLIENT_CREDENTIAL_REVOKE:   'api_client.credential.revoke',
  API_CLIENT_CREDENTIAL_ROTATE:   'api_client.credential.rotate',

  // S9.2: Rate Limit
  RATE_LIMIT_DENIED:              'rate_limit.denied',

  // S9.4: Signing Key Lifecycle
  API_CLIENT_SIGNING_KEY_CREATE:  'api_client.signing_key.create',
  API_CLIENT_SIGNING_KEY_READ:    'api_client.signing_key.read',
  API_CLIENT_SIGNING_KEY_ROTATE:  'api_client.signing_key.rotate',
  API_CLIENT_SIGNING_KEY_REVOKE:  'api_client.signing_key.revoke',

  // S9.4: Signed Request Auth
  SIGNED_REQUEST_AUTH_SUCCESS:    'signed_request.auth.success',
  SIGNED_REQUEST_AUTH_FAILURE:    'signed_request.auth.failure',
  SIGNED_REQUEST_NONCE_REPLAY:    'signed_request.nonce_replay',

  // S10: Admin CLI operations
  ADMIN_API_CLIENT_CREATE:        'admin.api_client.create',
  ADMIN_CLIENT_CREDENTIAL_CREATE: 'admin.client_credential.create',
  ADMIN_CLIENT_CREDENTIAL_REVOKE: 'admin.client_credential.revoke',
  ADMIN_CLIENT_SIGNING_KEY_CREATE:'admin.client_signing_key.create',
  ADMIN_CLIENT_SIGNING_KEY_REVOKE:'admin.client_signing_key.revoke',
  ADMIN_MERCHANT_CREATE:          'admin.merchant.create',
  ADMIN_MERCHANT_GRANT:           'admin.merchant.grant',
  ADMIN_MERCHANT_REVOKE:          'admin.merchant.revoke',
  ADMIN_PROVIDER_ACCOUNT_CREATE:  'admin.provider_account.create',
  ADMIN_PAYMENT_METHOD_ENABLE:    'admin.payment_method.enable',
  ADMIN_PAYMENT_METHOD_DISABLE:   'admin.payment_method.disable',
  ADMIN_BOOTSTRAP_BUNDLE:         'admin.bootstrap_bundle',
} as const;

export type AuditActionValue = typeof AuditAction[keyof typeof AuditAction];
