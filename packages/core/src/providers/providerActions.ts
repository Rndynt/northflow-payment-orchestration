/**
 * providerActions — canonical provider action types for the standalone payment engine.
 *
 * TODO(Phase 8B): migrate existing types from packages/domain/payments/provider.ts
 * into this file and have the embedded legacy system re-export from here.
 *
 * Phase 8A: standalone definitions — does NOT import from @pos/domain.
 * These mirror the embedded types to ensure contract alignment.
 */

/**
 * PaymentProviderActionType — the category of customer action required.
 *
 * - `redirect_customer` — customer must be redirected to a URL (3DS, e-wallet, hosted checkout)
 * - `present_qr`        — customer scans a QR code displayed in the UI
 * - `display_code`      — customer enters a code manually (VA number, retail payment code)
 * - `poll`              — no customer action; caller polls for status updates
 * - `none`              — no action required (settled or failed immediately)
 */
export type PaymentProviderActionType =
  | 'redirect_customer'
  | 'present_qr'
  | 'display_code'
  | 'poll'
  | 'none';

/**
 * PaymentProviderActionDescriptor — machine-readable tag for the value inside a ProviderAction.
 *
 * | Descriptor     | Meaning                                     | type                |
 * |----------------|---------------------------------------------|---------------------|
 * | `WEB_URL`      | value is a full HTTPS URL to open           | redirect_customer   |
 * | `QR_STRING`    | value is a raw QR-code payload to render    | present_qr          |
 * | `VA_NUMBER`    | value is a numeric virtual account number   | display_code        |
 * | `PAYMENT_CODE` | value is a retail payment code              | display_code        |
 * | `NONE`         | no value needed; action is informational    | poll / none         |
 */
export type PaymentProviderActionDescriptor =
  | 'WEB_URL'
  | 'QR_STRING'
  | 'VA_NUMBER'
  | 'PAYMENT_CODE'
  | 'NONE';

/**
 * PaymentProviderAction — canonical unit describing what the customer must do.
 *
 * Returned by createGatewayPayment in the `providerActions` array.
 */
export interface PaymentProviderAction {
  type: PaymentProviderActionType;
  descriptor: PaymentProviderActionDescriptor;
  label: string;
  value: string | null;
  url: string | null;
}
