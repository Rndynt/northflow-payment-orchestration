# Northflow Dashboard — Roadmap

> **Stack:** Next.js 15 App Router · Tailwind CSS v4 · TypeScript · `@northflow/payment-orchestration-client-sdk`
> **Design system:** Zinc dark palette · handcrafted primitives (no shadcn CLI)

---

## Phase 1 — Foundation & Shell ✅ DONE

**Goal:** Running dashboard with all core pages, clean dark UI, responsive layout.

| Deliverable | Status |
|---|---|
| Next.js 15 + Tailwind v4 app (`apps/dashboard`) | ✅ |
| UI primitive layer (Button, Input, Card, Badge, Dialog, Toast, Skeleton, Separator, EmptyState) | ✅ |
| Layout (Sidebar desktop, MobileNav bottom bar, Header) | ✅ |
| Shared components (StatCard, DataTable, PageHeader, CopyId, AmountDisplay, StatusBadge) | ✅ |
| `/setup` — service URL + token configuration | ✅ |
| `/overview` — system health summary | ✅ |
| `/merchants` + `/merchants/[id]` — lookup & provider account management | ✅ |
| `/intents` + `/intents/[id]` — create, status, reconciliation, simulation | ✅ |
| `/transactions` + `/transactions/[id]` — lookup, refund, void | ✅ |
| `/events` — placeholder page | ✅ |
| `/devtools` — fake gateway confirm, manual reconciliation | ✅ |
| `/settings` — reconfigure service URL & token | ✅ |
| Two workflows: `Start service` (port 3001) + `Start dashboard` (port 5000) | ✅ |

---

## Phase 2 — Data & Interactivity

**Goal:** Make all pages fully live — real data, pagination, filtering, search.

### 2A — Persistent ID Store
The service has no list endpoints, so the dashboard must track IDs locally.

- [ ] `src/lib/store.ts` — localStorage-backed registry for merchant IDs, intent IDs, transaction IDs
- [ ] Auto-save any ID returned from a create or lookup operation
- [ ] Export/import store as JSON (for sharing between browsers/devices)

### 2B — Overview Page — Live Metrics
- [ ] Poll `getReadiness()` every 30 s with visual uptime indicator
- [ ] Aggregate stored IDs → show counts (merchants, intents, transactions)
- [ ] Recent activity feed — last 10 operations pulled from localStorage history log

### 2C — Merchants List
- [ ] Render all stored merchant IDs in a table (name, ID, created date from local store)
- [ ] Search/filter by name or ID
- [ ] Per-row quick actions: View, Copy ID

### 2D — Intents List
- [ ] Render all stored intent IDs
- [ ] Filter by status (pulled from intent status responses, cached per ID)
- [ ] Amount range filter
- [ ] Column sort (amount, created, status)

### 2E — Transactions List
- [ ] Render all stored transaction IDs
- [ ] Filter by status, provider, merchant
- [ ] Bulk refresh provider status action

### 2F — Events Page (full implementation)
- [ ] Fetch provider events for a given transaction via the SDK
- [ ] Tabular display: event type, provider, payload JSON viewer, timestamp
- [ ] Filter by event type, date range

---

## Phase 3 — Detail Page Upgrades

**Goal:** Make detail pages richer and more actionable.

### 3A — Merchant Detail
- [ ] List all provider accounts for the merchant (tabular)
- [ ] Provider account status chips with last-refreshed timestamp
- [ ] Edit merchant name (if API supports it)
- [ ] Danger zone: deactivate provider account

### 3B — Intent Detail
- [ ] Visual status timeline (Created → Pending → Captured / Failed)
- [ ] Linked transactions table — show all transactions belonging to the intent
- [ ] Reconciliation diff view: expected vs actual totals highlighted
- [ ] Simulate payment modal — pre-filled form with intent amount

### 3C — Transaction Detail
- [ ] Expandable raw provider response JSON viewer
- [ ] Status history log (from events linked to this transaction)
- [ ] Refund with partial amount support (input field)
- [ ] Void confirmation modal with reason field

---

## Phase 4 — Developer Experience

**Goal:** Make the dashboard a first-class debugging tool for engineers integrating the service.

### 4A — Dev Tools Expansion
- [ ] **Request log** — capture all SDK calls in session (method, payload, response, latency)
- [ ] **Raw API explorer** — send arbitrary requests to the service with a JSON editor
- [ ] **Webhook inspector** — show incoming webhook events (requires a `/webhooks/test` endpoint or polling)
- [ ] **Token validator** — test the current token and display scopes/permissions

### 4B — Keyboard Navigation
- [ ] Global command palette (`Cmd+K`) — fuzzy search pages, recent IDs, and actions
- [ ] Keyboard shortcuts: `G O` → overview, `G M` → merchants, `G I` → intents, `G T` → transactions
- [ ] Focus management across modals and drawers

### 4C — Notifications & Feedback
- [ ] Toast queue (already architected) — ensure all async actions surface success/error toasts
- [ ] Persistent notification bell for background events (e.g., stale intents found on load)

---

## Phase 5 — Operational Features

**Goal:** Support day-to-day payment operations beyond development.

### 5A — Bulk Operations
- [ ] Bulk reconcile selected intents
- [ ] Bulk refresh provider status for selected transactions
- [ ] CSV export of merchants / intents / transactions tables

### 5B — Search & Deep Links
- [ ] Universal ID search bar in header — detect ID type (merchant / intent / transaction) and navigate directly
- [ ] Shareable deep-link URLs that pre-fill lookup fields (e.g., `/intents?id=xxx`)
- [ ] Browser history integration so back/forward works correctly within SPA lookups

### 5C — Settings Expansion
- [ ] Multiple environment profiles (dev / staging / prod) with quick-switch
- [ ] Per-environment color accent to prevent accidental production ops
- [ ] Token expiry reminder (configurable warning threshold)

---

## Phase 6 — Production Readiness

**Goal:** Dashboard ready for real deployment alongside the service.

### 6A — Build & Deploy
- [ ] `next build` optimization — verify bundle size, tree-shaking, no secrets leaked
- [ ] Environment variable support (`NEXT_PUBLIC_SERVICE_URL`) as default for token-less setup
- [ ] Docker-friendly: `pnpm start` serving static export or SSR on port 5000
- [ ] Update root `[deployment]` in `.replit` to serve dashboard as primary webview

### 6B — Security
- [ ] Token stored in `sessionStorage` option (clears on tab close) vs. `localStorage` (persistent)
- [ ] Auto-logout after configurable idle timeout
- [ ] Content Security Policy headers via `next.config.ts`

### 6C — Observability
- [ ] Error boundary per page — graceful fallback instead of white screen
- [ ] Runtime error reporting hook (pluggable: Sentry, console, custom endpoint)
- [ ] Performance metrics in Dev Tools panel (API latency histogram)

---

## Phase 7 — Polish & Accessibility

**Goal:** Production-quality UX.

- [ ] Skeleton loading states on all data-fetching pages (architecture already in place)
- [ ] Empty states on all list pages with contextual call-to-action
- [ ] ARIA labels and roles on all interactive components
- [ ] Keyboard-accessible modals (focus trap, Escape to close)
- [ ] Reduced-motion respect (`prefers-reduced-motion`) for any future animations
- [ ] Dark/light mode toggle (current: dark only)
- [ ] Responsive table → card layout on mobile for all list pages

---

## Deferred / Out of Scope

| Item | Reason |
|---|---|
| Authentication / user accounts | Service uses a single service token; multi-user auth is a service-layer concern |
| Real-time WebSocket updates | Service does not expose a WebSocket endpoint |
| shadcn CLI components | Deliberate choice — handcrafted components give full control; revisit if component count grows |
| Internationalization (i18n) | Not requested; can add `next-intl` in a future phase |

---

## Quick Reference — File Locations

```
apps/dashboard/
├── src/
│   ├── app/                  Next.js App Router pages
│   │   ├── (dashboard)/      All authenticated routes
│   │   │   ├── overview/
│   │   │   ├── merchants/[id]/
│   │   │   ├── intents/[id]/
│   │   │   ├── transactions/[id]/
│   │   │   ├── events/
│   │   │   ├── devtools/
│   │   │   └── settings/
│   │   └── setup/            First-run token config
│   ├── components/
│   │   ├── ui/               Primitives (Button, Card, Input …)
│   │   ├── layout/           Sidebar, Header, MobileNav
│   │   └── shared/           DataTable, StatCard, StatusBadge …
│   ├── hooks/                use-config, use-toast
│   ├── lib/                  sdk.ts, config.ts, utils.ts, status.ts
│   └── types/                Shared TypeScript types
└── package.json
```
