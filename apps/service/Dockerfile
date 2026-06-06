# ──────────────────────────────────────────────────────────────────────────────
# Northflow Payment Orchestration Service — Dockerfile
# Multi-stage build: install → build → production
# ──────────────────────────────────────────────────────────────────────────────

FROM node:20-alpine AS base
RUN corepack enable pnpm
WORKDIR /app

# ── Stage 1: Install workspace dependencies ───────────────────────────────────
FROM base AS deps

COPY package.json pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/package.json
COPY packages/client-sdk/package.json packages/client-sdk/package.json
COPY apps/service/package.json apps/service/package.json

# This repository currently does not commit pnpm-lock.yaml, so frozen-lockfile
# cannot be used in Docker/Coolify builds. Switch to --no-frozen-lockfile until
# a lockfile is generated and committed.
RUN pnpm install --no-frozen-lockfile

# ── Stage 2: Build / type-check ───────────────────────────────────────────────
FROM base AS build

COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/ packages/core/
COPY packages/client-sdk/ packages/client-sdk/
COPY apps/service/ apps/service/
COPY migrations/ migrations/

# Type-check only (tsx runs source directly; no transpile artifact is required)
RUN pnpm --filter @northflow/payment-orchestration-service type-check

# ── Stage 3: Production runtime ────────────────────────────────────────────────
FROM base AS production

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY --from=build /app/packages/core/ packages/core/
COPY --from=build /app/packages/client-sdk/ packages/client-sdk/
COPY --from=build /app/apps/service/ apps/service/
COPY --from=build /app/migrations/ migrations/

EXPOSE 5100

CMD ["node", "--loader", "tsx/esm", "apps/service/src/index.ts"]
