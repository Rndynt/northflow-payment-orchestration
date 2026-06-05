# ──────────────────────────────────────────────────────────────────────────────
# Northflow Payment Orchestration Service — Dockerfile
# Multi-stage build: install → build → production
# ──────────────────────────────────────────────────────────────────────────────

FROM node:20-alpine AS base
RUN corepack enable pnpm

# ── Stage 1: Install dependencies ─────────────────────────────────────────────
FROM base AS deps
WORKDIR /app

COPY package.json pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/client-sdk/package.json packages/client-sdk/
COPY apps/service/package.json apps/service/

RUN pnpm install --frozen-lockfile

# ── Stage 2: Build (type-check only — no transpile step, tsx runs TS directly) ─
FROM base AS build
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/core/node_modules packages/core/node_modules 2>/dev/null || true
COPY --from=deps /app/packages/client-sdk/node_modules packages/client-sdk/node_modules 2>/dev/null || true
COPY --from=deps /app/apps/service/node_modules apps/service/node_modules 2>/dev/null || true

COPY tsconfig.base.json ./
COPY packages/core/ packages/core/
COPY packages/client-sdk/ packages/client-sdk/
COPY apps/service/ apps/service/
COPY migrations/ migrations/

# Type-check only (tsx runs source directly; no transpile needed)
RUN pnpm --filter @northflow/payment-orchestration-service type-check

# ── Stage 3: Production runtime ────────────────────────────────────────────────
FROM base AS production
WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/packages/core/ packages/core/
COPY --from=build /app/packages/client-sdk/ packages/client-sdk/
COPY --from=build /app/apps/service/ apps/service/
COPY --from=build /app/migrations/ migrations/
COPY tsconfig.base.json ./
COPY package.json pnpm-workspace.yaml ./

EXPOSE 5100

CMD ["node", "--loader", "tsx/esm", "apps/service/src/index.ts"]
