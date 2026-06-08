import { createHash, randomBytes } from 'crypto';

export function generateMerchantWebhookSecret(): { rawSecret: string; secretPrefix: string; secretHash: string } {
  const rawSecret = `nfwhsec_${randomBytes(32).toString('base64url')}`;
  const secretPrefix = rawSecret.slice(0, 16);
  return { rawSecret, secretPrefix, secretHash: hashMerchantWebhookSecret(rawSecret) };
}

export function hashMerchantWebhookSecret(rawSecret: string): string {
  return createHash('sha256').update(rawSecret).digest('hex');
}
