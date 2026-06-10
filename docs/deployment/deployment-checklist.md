# Deployment Checklist

Use this checklist for every deployment of `northflow-payment-orchestration`.
All targets share the same commands — the difference is only in how env vars and
reverse-proxy are configured.

---

## Shared commands (all targets)

```bash
# Install dependencies
pnpm install --frozen-lockfile

# Type-check (recommended before build)
pnpm type-check

# Run migrations (requires DATABASE_URL)
pnpm db:migrate

# Start HTTP server
pnpm start:service           # NODE_ENV=production tsx src/index.ts

# Start webhook delivery worker (separate process)
pnpm worker

# Health check
curl http://localhost:3000/health

# Readiness check
curl -H "x-nf-ready-token: <token>" http://localhost:3000/ready

# Version check
curl http://localhost:3000/version

# Post-deploy smoke (requires API key + merchant)
pnpm s10:smoke
```

---

## Local / dev

- [ ] `cp .env.example .env` and fill values
- [ ] `NODE_ENV=development` (enables dev routes, optional legacy token)
- [ ] `PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED=true` (dev only)
- [ ] `PAYMENT_ORCHESTRATION_SIGNED_REQUESTS_MODE=optional`
- [ ] `PAYMENT_ORCHESTRATION_RATE_LIMIT_ENABLED=false` (optional in isolated dev)
- [ ] `DATABASE_URL` pointing to local PostgreSQL
- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm db:migrate`
- [ ] `pnpm dev:service` (hot reload)
- [ ] `pnpm worker` in a second terminal if webhook delivery is needed
- [ ] Verify `GET /health` → `{ ok: true }`
- [ ] Verify `GET /version` → returns version/phase

---

## Replit

> Support is manual. Replit does not have a native pnpm workflow but tsx runs directly.

- [ ] Set all env vars in Replit Secrets panel — **never in source files**
- [ ] `NODE_ENV=production` in Replit Secrets
- [ ] `PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED=false`
- [ ] `PAYMENT_ORCHESTRATION_CORS_ENABLED=false`
- [ ] `DATABASE_URL` pointing to external PostgreSQL (Supabase, Neon, etc.)
- [ ] Run `npm install -g pnpm` in Replit shell if pnpm not present
- [ ] `pnpm install --frozen-lockfile`
- [ ] `pnpm db:migrate` (run once before start)
- [ ] Start command: `pnpm start:service`
- [ ] Worker command (separate Replit background process): `pnpm worker`
- [ ] Replit does not support persistent workers natively — use a separate process or external worker host
- [ ] Verify `/health` via Replit's exposed URL

---

## VPS + Nginx (recommended production path)

- [ ] Provision VPS with Node.js 20+ and pnpm 9+
- [ ] Set all env vars in `/etc/environment` or systemd service `EnvironmentFile`
- [ ] `NODE_ENV=production`
- [ ] `PAYMENT_ORCHESTRATION_TRUST_PROXY=true` (Nginx is the proxy)
- [ ] `PAYMENT_ORCHESTRATION_CORS_ENABLED=false`
- [ ] `PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED=false`
- [ ] Clone repo and `pnpm install --frozen-lockfile`
- [ ] `pnpm db:migrate`
- [ ] Create systemd service for `pnpm start:service` and `pnpm worker`
- [ ] Nginx config: `proxy_pass http://127.0.0.1:3000;`
- [ ] Nginx: block direct port 3000 from public internet (UFW/iptables)
- [ ] Nginx: add `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`
- [ ] Nginx: strip `x-nf-ready-token` from external requests or block `/ready` at Nginx level
- [ ] SSL certificate via Certbot / Let's Encrypt on Nginx
- [ ] `GET /health` → 200 via Nginx
- [ ] `GET /ready` → 401 without token (token-protected), or 200 with token
- [ ] Rollback: `git checkout <previous-tag> && pnpm install && pnpm db:migrate && systemctl restart northflow`

---

## Coolify

> Coolify is a self-hosted PaaS. Support is manual via build/start commands.

- [ ] Set env vars in Coolify environment variables panel — **not in repo**
- [ ] Build command: `pnpm install --frozen-lockfile`
- [ ] Start command: `pnpm start:service`
- [ ] Worker: run as a separate Coolify service pointing to `pnpm worker`
- [ ] Set `PORT` to match Coolify's expected port
- [ ] `PAYMENT_ORCHESTRATION_TRUST_PROXY=true` (Coolify's Traefik proxy sits in front)
- [ ] `NODE_ENV=production`
- [ ] `PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED=false`
- [ ] Health check path: `/health`
- [ ] Run migration: Coolify pre-deploy hook or run `pnpm db:migrate` manually before first deploy
- [ ] Coolify exposes HTTPS via Traefik — no extra SSL config needed
- [ ] Rollback: redeploy previous image tag from Coolify dashboard

---

## Docker / container

- [ ] No Dockerfile is included in this repo — create one appropriate to your registry
- [ ] Recommended base: `node:20-alpine`
- [ ] Build: `pnpm install --frozen-lockfile && pnpm build` (type-check only; no separate compile step needed since tsx runs TS directly)
- [ ] Start: `node --import tsx/esm apps/service/src/index.ts` or `pnpm start:service`
- [ ] Worker: separate container or process running `pnpm worker`
- [ ] Inject env vars via Docker secrets or `--env-file` at runtime — never bake secrets into image
- [ ] `DATABASE_URL` must resolve to DB accessible from container network
- [ ] `PAYMENT_ORCHESTRATION_TRUST_PROXY=true` if behind a container ingress/proxy
- [ ] Expose container port matching `PORT` — do not expose to public without a reverse proxy
- [ ] Pre-migration: run `pnpm db:migrate` as an init container or job before traffic starts
- [ ] Health check probe: `GET /health`
- [ ] Rollback: re-tag and redeploy previous image

---

## Cloudflare / reverse proxy

> Cloudflare Workers or Tunnel can sit in front of the VPS/container.

- [ ] Northflow is backend-to-backend only — **do not use Cloudflare Workers to call Northflow from the browser**
- [ ] If using Cloudflare as a reverse proxy to VPS, set `PAYMENT_ORCHESTRATION_TRUST_PROXY` to Cloudflare's IP range or hop count
- [ ] Configure Cloudflare WAF to allow only backend IPs on the origin (origin firewall)
- [ ] Strip or block `x-nf-ready-token` at Cloudflare before public exposure
- [ ] Northflow does not use WebSockets — standard HTTP(S) proxying only

---

## Universal post-deploy checks

- [ ] `GET /health` → `{ ok: true, service: "payment-orchestration-service" }`
- [ ] `GET /version` → returns version and phase
- [ ] `GET /ready` → `{ ok: true, database: "configured" }` (with token if configured)
- [ ] `POST /v1/payment-intents` with invalid key → `401 UNAUTHORIZED`
- [ ] `POST /v1/payment-intents` with valid key, wrong scope → `403 SCOPE_DENIED`
- [ ] `pnpm s10:smoke` passes in sandbox/dev environment
- [ ] No secret values visible in `/health`, `/version`, `/ready` responses
- [ ] Rate limit headers visible on repeated requests if rate limit enabled
- [ ] `/v1/dev/fake-gateway/*` returns 404 in `NODE_ENV=production`

---

## Rollback checklist

1. Identify last known-good commit/image tag.
2. Redeploy previous version without running `db:migrate` (migrations are additive — do not roll back schema unless explicitly safe).
3. Verify `/health` and `/version` reflect the rolled-back version.
4. If schema rollback is required, restore from DB snapshot — document this as a separate DB restore operation.
5. Notify consumer apps (AuraPoS, Transity, Kioskoin) if contract-breaking change was involved.

---

## CORS policy

`PAYMENT_ORCHESTRATION_CORS_ENABLED=false` must be the production default.
Northflow is **backend-to-backend only**. Browser clients must never call this API directly.
If CORS is accidentally enabled in production, requests from unauthorized origins will succeed — treat this as a security incident.

---

## Ready token policy

If `PAYMENT_ORCHESTRATION_READY_TOKEN` is not set, `/ready` is public.
In production, either:
- Set `PAYMENT_ORCHESTRATION_READY_TOKEN` (recommended), or
- Block `/ready` at the reverse proxy for external requests.

Never expose `/ready` publicly without protection — it reveals database and provider configuration state.

---

## Request body limit policy

`PAYMENT_ORCHESTRATION_JSON_BODY_LIMIT=256kb` is the default.
Do not increase beyond `1mb` without reviewing payload size requirements.
Oversized provider webhook payloads should be handled at the reverse proxy level.

---

## Log redaction policy

Never log:
- `Authorization` header values
- `x-nf-api-key` header values
- `DATABASE_URL`
- Raw secrets, tokens, or provider credentials
- Full request bodies containing `rawSecret` or `signingSecret`

Use structured logging with field-level redaction where possible.
