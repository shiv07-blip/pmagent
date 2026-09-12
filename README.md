# pmagent

AI maintenance triage + tenant communications for property managers (150–500 doors).

A tenant texts "my dishwasher is leaking" → the system classifies the issue, drafts a
work order, picks a vendor, and communicates with the resident — with a human
approval gate for large or uncertain jobs.

## Architecture

Five TypeScript packages in an npm workspace:

| Package      | Role                                                                  |
| ------------ | --------------------------------------------------------------------- |
| `@pma/core`  | Shared contracts: job payloads (`events.ts`), domain enums, `AppError`, id/money/time utils |
| `@pma/db`    | Drizzle schema, RLS setup, migrations (versioned SQL), seed           |
| `@pma/agent` | Deterministic emergency rules, LLM classification, tool loop (`runTriage`) |
| `@pma/api`   | Fastify HTTP + WebSocket API, auth, webhooks, queues                  |
| `@pma/worker`| BullMQ consumers (ingest → agent → notify)                            |

Data flow:

```
Twilio SMS ──▶ POST /webhooks/sms ──▶ ingest queue ──▶ attach to open request / create
                                                          │
                                              agent queue (dedup by request+message)
                                                          │
                 emergency rules ──┐                      │
                 budget guard      ├─ runTriage ──▶ tool loop: request_info / search_policy
                 human gate        ─┘                  / create_work_order / resolve_first_touch
                                                          │
                                             notify queue ──▶ resident SMS / vendor SMS+email
                                                                 / PM alert (on-call + LLM budget)
                                                          │
                                         vendor accepts/declines via token link
                                               ──▶ GET /webhooks/vendor/:token/accept|decline
```

### Multi-tenancy (RLS)

- Every table carries `tenant_id`. The API runs as `pmagent_api`, which has RLS
  enabled; `withTenant(tenantId, userId, fn)` sets the session variable and executes
  the whole request in one transaction, so a query can never leak across tenants.
- The worker runs as `pmagent_worker` (BYPASSRLS) and scopes every query by
  `tenant_id` explicitly.
- Inserts must pass `tenantId` explicitly — RLS `WITH CHECK` validates it.

### Job contracts

Defined in `@pma/core` `events.ts` so packages don't depend on each other:
`IngestJobData`, `AgentJobData`, `NotifyJobData`. Dedup is two-layered: BullMQ
`jobId` (sanitized — `:` is reserved) and a unique partial index on
`(channel, dedupe_key)`. `dedupeKey` for SMS is `sms:<MessageSid>`.

### Agent

`runTriage` in `@pma/agent/src/triage/agent.ts`:

1. Deterministic emergency rules (before any LLM call) — configurable per tenant.
2. Budget guard — escalates if the tenant's monthly LLM budget is exhausted and
   warns the operator (pm_alert, once per month) at ≥80% spend.
3. Classification via LLM JSON mode (zod-validated), unless a human is already gating.
4. Tool loop (max 6 steps): `request_info` (terminal), `search_policy`,
   `create_work_order`, `resolve_first_touch`, `reply_to_resident`, `escalate`.
   Images attached to a request are sent to the LLM for multimodal triage.

LLM providers: Anthropic / OpenAI / mock. `createProvider()` reads
`LLM_PROVIDER`, `LLM_MODEL`, and the API key env vars.

### RAG policy search

`searchPolicy` (worker) answers "who pays for this?" from uploaded documents:
vector cosine search over `policy_chunks.embedding` (pgvector, HNSW index) plus a
keyword `ILIKE` fallback, deduplicated and capped at 3 hits. Upload via the admin
`POST /policies` endpoint (text is chunked, embedded, and indexed synchronously).
`EMBEDDING_PROVIDER=mock` gives a deterministic offline embedder; the seed writes
real vectors so the demo works without API keys.

### Work orders & vendors

When classified as a repair that needs a trade, the worker builds the work order,
auto-selects the preferred/emergency-capable vendor, and auto-dispatches it:
the vendor gets a token-scoped accept/decline link (`/webhooks/vendor/:token/accept|decline`).
Accept/decline transitions `assigned → accepted | rejected`; `accepted` enables
scheduling. `POST /work_orders/:id/approve` still gates large/uncertain jobs.

### Stalled-ticket recovery & CSAT

- A periodic check re-enqueues requests stuck in `awaiting_info` past
  `STALL_AGE_MIN` (a nudge), and escalates them after `STALL_MAX` nudges.
- Resolved/auto-completed requests get a delayed CSAT ask (default 24h); a lone
  `1–5` reply records the score (noted on `/dashboard`) without spinning up the agent.

### Dashboard & SLA

- `GET /dashboard` (admin) — aggregated metrics: request counts by status, work
  order status + costs, SLA breaches (requests unacknowledged > `ackSlaMinutes`),
  average CSAT, recent activity and recent requests.
- SLA monitor runs in the worker every 5 minutes. For each active tenant, it
  checks for requests where `firstAckAt` is null and `created_at` is older than
  `ackSlaMinutes`. Breaches are escalated, logged to the audit trail, and the PM
  is notified.
- `GET /metrics` (no auth) exposes Prometheus text metrics (HTTP latency/labels,
  active/escalated request gauges, uptime) for scraping.

## Getting started

Prereqs: Node ≥22, Docker.

```bash
npm install
npm run dev:db          # postgres (pgvector) + redis
cp .env.example .env    # edit URLs/secrets as needed
npm run db:migrate
npm run db:seed         # creates demo tenant acme-pm (admin@acme.example / admin123)
npm run dev:api         # http://localhost:8080
npm run dev:worker      # consumes ingest/agent/notify queues
```

Smoke test:

```bash
TOKEN=$(curl -s -X POST localhost:8080/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@acme.example","password":"admin123"}' | jq -r .token)
curl -s -X POST localhost:8080/webhooks/sms \
  -H 'content-type: application/x-www-form-urlencoded' \
  --data-urlencode 'MessageSid=SM0001' \
  --data-urlencode 'From=+12025550101' \
  --data-urlencode 'To=+15551230000' \
  --data-urlencode 'Body=my dishwasher is leaking, please repair'
curl -s localhost:8080/requests -H "Authorization: Bearer $TOKEN" | jq
```

With the default `LLM_PROVIDER=mock` and `NOTIFY_PROVIDER=console`, the whole
pipeline runs without any API keys.

## Webhook security

Webhooks verify sender signatures before trusting them (skipped when the secret
is unset, so local dev stays frictionless):

- **Twilio** SMS webhooks are verified with the Twilio signature
  (`X-Twilio-Signature`, HMAC-SHA1 over the request URL + sorted params) when
  `TWILIO_AUTH_TOKEN` is set.
- **MSG91 / email / portal / Telegram** webhooks use a shared secret:
  `X-Pma-Timestamp` (unix ms) + `X-Pma-Signature` =
  `hex(HMAC-SHA256(WEBHOOK_SECRET, "<ts>.<raw request body>"))`, accepted within
  a 5-minute clock window.

## Env vars

See `.env.example`. Key ones: `API_DATABASE_URL`, `WORKER_DATABASE_URL`,
`MIGRATE_DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `LLM_PROVIDER`, `LLM_MODEL`,
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY`, `NOTIFY_PROVIDER` (console | twilio |
smtp | msg91 | telegram), `EMBEDDING_PROVIDER` (mock | openai),
`WEBHOOK_SECRET`, `TWILIO_AUTH_TOKEN`, `STALL_*`, `SMTP_URL`/`SMTP_FROM`/`SMTP_TO`,
`PUBLIC_BASE_URL`, `AGENT_CONCURRENCY`.

Note: workspace scripts run from the package dir, so `migrate`/`seed`/`api`/`worker`
call `loadRootEnv()` to walk up to the repo root and load `.env`.

## Conventions

- Money is integer cents. Timestamps are UTC (`timestamptz`).
- Passwords are scrypt (`scrypt$saltHex$derivedHex`), never bcrypt.
- Work orders start as `proposed` when cost exceeds the owner-approval threshold or
  no vendor can be selected; an owner approves via `POST /work_orders/:id/approve`.
- Migrations are versioned SQL files in `packages/db/src/migrations/`; add a new
  numbered file, never edit an applied one.

## Tests & checks

```bash
npm run typecheck
npm run build
npm test
```

## API endpoints

| Method   | Path                        | Auth   | Description                             |
| -------- | --------------------------- | ------ | --------------------------------------- |
| POST     | /auth/register              | none   | Create user + tenant                    |
| POST     | /auth/login                 | none   | Login → JWT + tenant list               |
| GET      | /auth/me                    | yes    | Current user + tenants                  |
| GET      | /tenants                    | yes    | List tenants (all roles)                |
| GET      | /tenants/current            | yes    | Current tenant detail                   |
| PUT      | /tenants/current/config     | admin  | Update tenant config                    |
| GET/POST | /properties                 | yes    | List / create properties                |
| GET/POST | /residents                  | yes    | List / create residents                 |
| GET/POST | /vendors                    | yes    | List / create vendors                   |
| PATCH    | /vendors/:id                | admin  | Update vendor                           |
| GET      | /requests                   | yes    | List requests (filter: status, unit, resident) |
| GET      | /requests/:id               | yes    | Request detail + messages               |
| POST     | /requests/:id/messages      | yes    | Send outbound message to resident       |
| POST     | /requests/:id/close         | yes    | Close a request                         |
| GET      | /work_orders                | yes    | List work orders                        |
| GET      | /work_orders/:id            | yes    | Work order detail + events              |
| PATCH    | /work_orders/:id/status     | admin  | Transition WO status                    |
| POST     | /work_orders/:id/approve    | owner  | Approve proposed WO (owner gate)        |
| GET      | /dashboard                  | admin  | Aggregated metrics (incl. CSAT)        |
| GET      | /audit                      | admin  | Audit trail                             |
| GET/POST | /policies                   | admin  | List / upload policy docs (chunk + embed) |
| DELETE   | /policies/:id               | admin  | Delete a policy document               |
| GET      | /metrics                    | none   | Prometheus text metrics                |
| GET      | /metrics/usage              | admin  | LLM usage + cost                        |
| POST     | /webhooks/sms               | none   | Twilio-style SMS webhook (sig-verified) |
| POST     | /webhooks/msg91             | none   | MSG91 SMS webhook (HMAC-verified)       |
| POST     | /webhooks/email             | none   | Inbound email webhook (HMAC-verified)   |
| POST     | /webhooks/portal            | none   | Portal message webhook (HMAC-verified)  |
| POST     | /webhooks/telegram          | none   | Telegram webhook (HMAC-verified)        |
| GET      | /webhooks/vendor/:token/accept|decline | none | Vendor dispatch accept/decline link |
| WS       | /ws?token=&tenant=          | JWT    | Real-time event stream                  |
| GET      | /healthz                    | none   | Health check                            |

## Tests & checks

```bash
npm run typecheck
npm run build
npm test
```

Integration tests exercise real Postgres (RLS isolation) and the full
ingest → agent → notify pipeline against real Postgres + Redis. Run them with
Docker up:

```bash
docker compose up -d
RUN_INTEGRATION=1 npm --workspace @pma/db test
RUN_INTEGRATION=1 npm --workspace @pma/worker test
```

CI (`.github/workflows/ci.yml`) runs typecheck, build, unit tests, then the
integration tests against Postgres (pgvector) + Redis.

## Scaling levers

- Queue-backed, so API and worker scale independently (`AGENT_CONCURRENCY`).
- RLS keeps multi-tenancy safe at the DB layer — no per-tenant code paths.
- Vector search (`pgvector`) and keyword search are used today; swap
  `EMBEDDING_PROVIDER` to `openai` for real embeddings.
- Webhooks and outbound notifications are provider-swappable (Twilio / MSG91 /
  email / Telegram).
