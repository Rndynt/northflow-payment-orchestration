const SENSITIVE_KEY_RE = /authorization|cookie|set-cookie|token|secret|signature|api-key|apikey|x-callback-token|x-fakegateway-signature/i;

export function redactSensitiveRecord(input: unknown): unknown {
  if (Array.isArray(input)) return input.map((v) => redactSensitiveRecord(v));
  if (!input || typeof input !== 'object') return input;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY_RE.test(key) ? '[redacted]' : redactSensitiveRecord(value);
  }
  return out;
}
