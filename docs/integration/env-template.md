# Merchant Backend Environment Template

```env
NORTHFLOW_BASE_URL=https://your-northflow-service.example.com
NORTHFLOW_API_KEY=nf.<env>.<credentialId>.<secret>
NORTHFLOW_MERCHANT_ID=mer_xxx
NORTHFLOW_SOURCE_APP=checkout-backend

# Optional signed requests
NORTHFLOW_CLIENT_ID=client_xxx
NORTHFLOW_SIGNING_KEY_ID=sk_xxx
NORTHFLOW_SIGNING_SECRET=copy-once-secret
```

Never use `NEXT_PUBLIC_`, `VITE_`, `EXPO_PUBLIC_`, or frontend/public env prefixes for secrets. These values belong in backend-only secret storage.
