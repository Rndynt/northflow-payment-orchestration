# Network-Level Service Protection — Northflow Payment Orchestration

**Phase S9.3**

This document describes the recommended production network model for `northflow.space`,
the HTTP hardening applied in code, and the deployment checklist for Cloudflare/Nginx/VPS/Coolify/Replit deployments.

---

## 1. Subdomain Layout

Recommended production subdomain layout:

```
Internal service API:
  pay-svc-<random-slug>.northflow.space
  e.g.  pay-svc-k7m2p9.northflow.space

Management dashboard:
  dashboard.northflow.space
  or console.northflow.space

Provider webhooks:
  webhook.northflow.space
```

### Hard-to-guess subdomain

A non-obvious service subdomain reduces casual scanning and credential-stuffing noise.

**It is NOT a security boundary.**

An attacker who discovers the subdomain can still attempt authentication bypass, credential brute-force, or
rate-limit evasion. Real security is provided by:

- API client credentials (S9.1)
- Per-client rate limiting (S9.2)
- Cloudflare proxy / reverse proxy in front of origin
- Origin firewall that blocks direct-to-origin requests
- No direct public port exposure

Do not rely on subdomain obscurity in threat models.

---

## 2. Cloudflare / Reverse Proxy Model

### Recommended traffic flow

```
consumer backend ──► Cloudflare / Nginx proxy ──► Northflow origin (not public)
```

### Prohibited traffic path

```
attacker ──► origin-ip:port   ← BLOCK THIS
```

### Required settings

| Setting                         | Value                                      |
|---------------------------------|--------------------------------------------|
| Cloudflare proxy (orange cloud) | ON for all service subdomains              |
| Origin firewall                 | Allow inbound only from Cloudflare IP ranges |
| Direct origin port              | Not exposed publicly (firewall block)      |
| TLS                             | HTTPS only; no HTTP                        |
| Swagger / OpenAPI docs          | Disabled in production                     |

### Trust proxy configuration

When running behind Cloudflare or Nginx, enable Express trusted proxy so that `req.ip`
reflects the real client IP (needed for rate limiting auth failures):

```
PAYMENT_ORCHESTRATION_TRUST_PROXY=loopback     # Nginx on same host
PAYMENT_ORCHESTRATION_TRUST_PROXY=uniquelocal  # Docker bridge / VPS LAN
PAYMENT_ORCHESTRATION_TRUST_PROXY=true         # Trust all (use with strict origin firewall only)
```

**You must pair `trust proxy = true` with an origin firewall that allows only Cloudflare IP ranges.**
Without the origin firewall, `trust proxy = true` allows IP spoofing via X-Forwarded-For.

Default (no env var set): `trust proxy = false`. Safe for direct-origin deployments.

Do NOT hard-code Cloudflare IP ranges in application code. They change. Maintain them in infrastructure / firewall rules only.

---

## 3. Origin Firewall Checklist

Apply at VPS / cloud security group / iptables level:

```
☐ Allow inbound TCP 443 from Cloudflare IP ranges only (see https://www.cloudflare.com/ips/)
☐ Allow inbound TCP 80 from Cloudflare IP ranges only (redirect to HTTPS)
☐ Block direct inbound access to service port (default 5100) from public internet
☐ Block all other inbound ports except SSH (and restrict SSH to known IPs or key-only)
☐ Allow outbound HTTPS for provider APIs (Xendit, etc.)
☐ No direct database port exposure to the internet
```

For Coolify / Replit deployments:
- Use Coolify's built-in Traefik proxy; configure Cloudflare to proxy → Coolify origin only.
- Replit published apps: hide the `.replit.app` origin domain; only publish the Cloudflare-proxied `northflow.space` URL.

---

## 4. CORS Policy

Northflow internal service API is **backend-to-backend only**.

Consumer browser frontends must NOT call the payment orchestration service directly.
They must call their own backend, which in turn calls Northflow.

```
browser ──► consumer backend ──► Northflow API
browser ──✗─► Northflow API   ← DO NOT ALLOW
```

### Policy

| Setting                      | Value                                |
|------------------------------|--------------------------------------|
| Default CORS                 | Disabled                             |
| Wildcard (`*`)               | Never allowed                        |
| Arbitrary origin reflection  | Never allowed                        |
| Allowed origins              | Env-configurable allowlist only      |

### Configuration

```
PAYMENT_ORCHESTRATION_CORS_ENABLED=false                         # default
PAYMENT_ORCHESTRATION_CORS_ENABLED=true                          # enable if needed
PAYMENT_ORCHESTRATION_CORS_ALLOWED_ORIGINS=https://console.northflow.space,https://dashboard.northflow.space
```

If CORS is enabled, only origins in the allowlist receive `Access-Control-Allow-Origin`.
Disallowed or absent origins receive no CORS headers.
OPTIONS preflight for disallowed origins returns 403.

CORS is not the primary security boundary. Browser frontends should still call their own backend first.

---

## 5. Health / Version / Readiness Policy

| Endpoint   | Default exposure | Secrets exposed | Recommended production policy          |
|------------|------------------|-----------------|----------------------------------------|
| `GET /health`   | Public      | None            | Public OK — minimal response           |
| `GET /version`  | Public      | None            | Public OK — only phase/version/service |
| `GET /ready`    | Public or protected | None     | Restrict via token or origin firewall  |

### /ready token protection (optional)

If `PAYMENT_ORCHESTRATION_READY_TOKEN` is set, `/ready` requires:

```
x-nf-ready-token: <token>
```

Missing or wrong token → 401.

```
PAYMENT_ORCHESTRATION_READY_TOKEN=<secure-random-value>
```

If unset, `/ready` is public. Recommended: restrict it at the reverse proxy / origin firewall level instead,
or set the token for production deployments.

### What is NEVER exposed in health/version/ready

- Database URL or credentials
- Service token or API keys
- Provider secrets (Xendit API key, etc.)
- `readyToken` value
- Internal paths or file system details
- Stack traces

---

## 6. Request Size and Security Headers

### JSON body size limit

Default: `256kb`. Configurable:

```
PAYMENT_ORCHESTRATION_JSON_BODY_LIMIT=256kb
```

Keep the default unless there is a specific documented need for larger bodies.
Webhook routes still capture raw body for provider signature/HMAC verification, but JSON webhook requests are still subject to the configured body size limit because the JSON parser is applied globally before webhook routing. If a provider later requires larger webhook bodies, increase the limit deliberately and document the reason.

### Security headers applied globally

| Header                          | Value        | Purpose                              |
|---------------------------------|--------------|--------------------------------------|
| `X-Powered-By`                  | Absent       | Not emitted — `app.disable('x-powered-by')` |
| `X-Content-Type-Options`        | `nosniff`    | Prevent MIME sniffing                |
| `X-Frame-Options`               | `DENY`       | Prevent clickjacking                 |
| `Referrer-Policy`               | `no-referrer`| No referrer leak on redirects        |
| `Cache-Control`                 | `no-store`   | API responses must not be cached     |
| `Cross-Origin-Resource-Policy`  | `same-site`  | Defence-in-depth for CORP            |

CSP is intentionally omitted — not meaningful for a pure JSON API and can interfere with proxy error pages.

### Content-type

Express's built-in JSON parser rejects non-JSON `Content-Type` for POST/PATCH routes.

---

## 7. Deployment Checklist

Complete this checklist before going live with a new deployment.

### Cloudflare / DNS

```
☐ DNS record for service subdomain proxied through Cloudflare (orange cloud ON)
☐ Cloudflare SSL/TLS mode set to Full (strict)
☐ Cloudflare always-use-HTTPS rule active
☐ Origin certificate or public CA cert installed on origin server
```

### Origin server / VPS / Coolify

```
☐ Origin firewall: allow only Cloudflare IP ranges on ports 80/443
☐ Service port (5100 default) not reachable from public internet
☐ Database port not reachable from public internet
☐ SSH restricted to known IPs or key-only, port-changed or protected by fail2ban
☐ HTTPS-only on origin; HTTP redirects to HTTPS
```

### Application configuration

```
☐ PAYMENT_ORCHESTRATION_SERVICE_TOKEN set to a strong, randomly generated value
☐ PAYMENT_ORCHESTRATION_DATABASE_URL set to production DB URL (not shared with dev)
☐ PAYMENT_ORCHESTRATION_TRUST_PROXY set correctly for the proxy topology
☐ PAYMENT_ORCHESTRATION_CORS_ENABLED=false (or strict allowlist if management dashboard needs CORS)
☐ PAYMENT_ORCHESTRATION_JSON_BODY_LIMIT=256kb (default; increase only if required)
☐ PAYMENT_ORCHESTRATION_READY_TOKEN set if /ready endpoint should be access-controlled
☐ PAYMENT_ORCHESTRATION_RATE_LIMIT_ENABLED=true (default)
☐ PAYMENT_ORCHESTRATION_LEGACY_SERVICE_TOKEN_ENABLED=false for production
☐ NODE_ENV=production
```

### Production runtime checks

```
☐ GET /health returns 200 { ok: true }
☐ GET /version returns expected version and phase (no secrets)
☐ GET /ready returns expected status (if token set, verify token header works)
☐ POST to /v1/merchants with wrong credentials returns 401 (auth is enforced)
☐ 100+ rapid requests from same client trigger rate limit (429 returned)
☐ Direct origin access (bypassing Cloudflare) is blocked by origin firewall
☐ No Swagger / OpenAPI docs accessible in production
☐ No X-Powered-By header in any response
☐ Security headers present on all responses
```

### Xendit (if using Xendit Sandbox or production)

```
☐ PAYMENT_ORCHESTRATION_XENDIT_SANDBOX_ENABLED=false for production
☐ PAYMENT_ORCHESTRATION_XENDIT_CALLBACK_TOKEN set
☐ Xendit webhook configured to send to https://webhook.northflow.space/v1/webhooks/xendit
```

---

*Related docs:*
- `docs/security/api-key-rotation.md` — S9.1 credential lifecycle
- `docs/security/rate-limits.md` — S9.2 rate limiting
