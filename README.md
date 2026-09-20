# Ops Copilot

Ops Copilot is a portfolio-grade agent operations platform. Users can upload private documents, ask grounded questions, connect safe tools through MCP, and run scheduled agent workflows with a complete execution trail.

This repository contains **Phases 1–8: scaffolding, authentication, RAG ingestion, the streaming agent runtime, MCP tools, scheduled workflow automation, the complete product UI, application hardening, and production deployment infrastructure**. The checked-in deployment is ready for activation once a GCP project, GitHub repository, and public domain are supplied.

## Architecture

```text
Browser
  |
  v
Nginx :8080
  |-- /        -> Next.js frontend :3000
  |-- /api/*   -> Express API gateway :4000 -> MySQL + Redis
  `-- /agent/* -> FastAPI agent service :8000 -> MySQL + OpenAI Agents SDK

Redis -> BullMQ worker -> FastAPI document ingestion and workflow execution
ChromaDB <- per-user document vectors and citation metadata
Client <- SSE <- Express streaming proxy <- FastAPI streamed agent run
Agent service -> MCP Streamable HTTP :8100 -> MySQL + ChromaDB + public webhooks
API -> BullMQ manual/UTC cron job -> Agent ordered steps -> MCP tools -> MySQL run log
```

The split is deliberate: Next.js owns the product experience, Express owns web concerns and the canonical relational model, and FastAPI will own AI/agent execution. Prisma owns schema migrations. SQLAlchemy is the Python service's database access layer, avoiding competing migration systems while still giving Python typed, pooled access to the same MySQL database.

## Phase 1 capabilities

- Responsive Next.js App Router authentication surface using Tailwind CSS and shadcn/ui primitives.
- Email/password signup and login with bcrypt cost factor 12.
- Short-lived JWT access tokens and opaque, rotating refresh tokens.
- Refresh tokens are SHA-256 hashed at rest and sent only in HTTP-only cookies.
- Prisma-managed MySQL schema with foreign keys and workload-oriented indexes.
- Structured JSON logging and liveness/readiness endpoints.
- Redis-backed BullMQ worker process shared by ingestion and workflow queues.
- Multi-stage, non-root Docker images and a local Compose topology.
- Nginx routing for the frontend, REST API, and agent service.

## Phase 2 capabilities

- Authenticated PDF, DOCX, and UTF-8 TXT upload with a 15 MiB default limit, MIME checks, and file-signature checks.
- A Redis/BullMQ ingestion queue with bounded retries and durable `PENDING` → `PROCESSING` → `DONE`/`FAILED` status in MySQL.
- PDF page-aware extraction, DOCX/TXT extraction, and `tiktoken` chunks targeting 700 tokens with 100-token overlap.
- Batched OpenAI `text-embedding-3-small` calls behind a small provider interface.
- Per-user ChromaDB collections containing raw chunk text, embeddings, document IDs, filenames, chunk indexes, and page citations.
- Authenticated document listing/status and semantic retrieval REST endpoints.
- A deterministic Chroma integration check and a full upload-to-retrieval smoke script.

## Phase 3 capabilities

- OpenAI Agents SDK runtime behind a small provider interface, currently configured for `gpt-4o-mini`.
- A user-scoped `search_documents` tool backed by the Phase 2 embedding and Chroma retrieval path, now served through MCP.
- Server-Sent Events (SSE) streaming through FastAPI, Express, and Nginx with proxy buffering disabled.
- Authenticated conversation create/list/detail endpoints with ownership checks at both service boundaries.
- Bounded conversation history loaded from MySQL for every run; user and completed assistant turns are persisted.
- Assistant audit metadata stores the model, aggregate input/output/total tokens, retrieval calls, and citations.
- Agents SDK tracing groups each run by conversation. The single-agent Phase 3 flow deliberately has no handoff; specialized handoffs can be added only when Phase 4 tools make routing useful.
- The system instruction treats retrieved text and tool output as untrusted evidence and requires grounded citations. Phase 7 adds deterministic detection, trust metadata, and workflow-output fencing.

The runtime follows the official [Agents SDK quickstart](https://developers.openai.com/api/docs/guides/agents/quickstart) for agents and function tools, and the [streaming run pattern](https://developers.openai.com/api/docs/guides/agents/running-agents) for token deltas. Built-in SDK tracing is enabled as described in the [observability guide](https://developers.openai.com/api/docs/guides/agents/integrations-observability).

## Phase 4 capabilities

- A standalone Python server built with the official `mcp` SDK and exposed only on the Compose network through Streamable HTTP at `/mcp`.
- `search_documents` performs authenticated, per-user ChromaDB retrieval and returns citation metadata.
- `query_database` accepts only three code-owned, parameterized report names: `document_status_summary`, `recent_tasks`, and `recent_workflow_runs`. It never accepts SQL from the model.
- `create_task` validates input and creates a user-owned MySQL task. `send_webhook` caps JSON at 32 KiB, rejects credentials and redirects, resolves DNS, and blocks private, loopback, link-local, and non-global destinations.
- The Agents SDK connects as an MCP client for each run, discovers the server tools, and attaches the authenticated user scope in trusted internal headers. The model cannot choose a different user ID.
- MCP calls, safe argument summaries, results, and document citations are persisted with the assistant message. Webhook payload values are deliberately excluded from the audit record.
- The agent prompt only permits action tools when the current user message explicitly requests the action. A first-class human approval/resume UI remains a future policy enhancement.

### MCP JSON-RPC lifecycle

The pinned MCP 2.x stack uses the current stateless Streamable HTTP lifecycle. There is no legacy `initialize`/`initialized` session handshake: every request carries protocol/client metadata, the Agents SDK discovers tools with `tools/list`, and a selected tool is invoked with `tools/call`. The server returns structured JSON-RPC content, which the SDK feeds back into the agent run. Older MCP protocol revisions used an explicit initialization handshake; this project documents that distinction so the wire flow is not described using an obsolete sequence.

The integration follows OpenAI's [Agents SDK MCP guide](https://developers.openai.com/api/docs/guides/agents-api/tools/mcp) and [MCP/connectors security guidance](https://developers.openai.com/api/docs/guides/tools-connectors-mcp). The modern stateless lifecycle is described in the [MCP 2026-07-28 specification announcement](https://blog.modelcontextprotocol.io/posts/2026-07-28/).

## Phase 5 capabilities

- Authenticated workflow create, list, detail, update, delete, manual-run, and run-history REST endpoints with ownership checks.
- Strict, versionable ordered steps: an `agent` prompt or one of the four allow-listed MCP tools. Unknown tools, extra fields, invalid arguments, duplicate step IDs, and malformed cron expressions are rejected before storage.
- Manual jobs and recurring cron jobs use BullMQ and Redis. Active schedules are reconciled from MySQL whenever the worker starts, so recreating Redis does not silently lose schedules.
- Cron expressions run in UTC. Five-field expressions support normal schedules such as `0 9 * * *`; six-field expressions are also supported for testing or sub-minute automation.
- The Node worker creates a durable `workflow_runs` row, transitions it through `QUEUED` → `RUNNING` → `SUCCEEDED`/`FAILED`, then calls the internal FastAPI workflow endpoint.
- The Python runtime executes steps in order through one tenant-scoped MCP connection. `{{previous.output}}` and `{{steps.<id>.output}}` references pass earlier outputs into later prompts or tool arguments.
- Each run stores per-step timestamps, duration, status, bounded output, error details, token usage, tool calls, and citations in MySQL. A failed step stops the remaining sequence while preserving completed and failed step logs.
- Workflow action jobs deliberately use one delivery attempt because an ambiguous retry could duplicate an external webhook or task. Ingestion jobs retain bounded automatic retries; production workflow retries should be added only with per-step idempotency keys.

## Phase 6 capabilities

- Authenticated, responsive operations workspace with an overview dashboard and navigation for chat, knowledge, and automations.
- Dashboard usage summary backed by an authenticated aggregate endpoint: agent request counts, input/output token totals, document readiness, workflow activation, and run success.
- Persisted conversation list and SSE chat composer with incremental responses, citations, MCP tool indicators, model metadata, and token usage.
- Drag-and-drop document upload with client validation, automatic ingestion polling, failure details, chunk counts, and processed timestamps.
- Form-based workflow builder for agent prompts and all four approved MCP tools, including ordered step controls, manual/UTC cron triggers, activation, editing, manual execution, and live run-history polling.
- Accessible empty, loading, failure, and mobile navigation states. The production Compose path is browser-tested through Nginx at `http://localhost:8080`.

## Phase 7 capabilities

- Atomic Redis-backed quotas for global traffic, authentication attempts, chat/retrieval, uploads, and workflow actions. Sensitive operations fail closed if Redis is unavailable; the broad availability limiter fails open.
- Strict Zod and Pydantic request schemas reject unknown fields, malformed UUIDs, oversized values, malformed JSON, and unsupported JWT algorithms, issuers, or audiences.
- Retrieved document chunks carry explicit untrusted-content metadata. Unicode control characters are removed, content is bounded, and deterministic indicators flag instruction overrides, prompt extraction, role reassignment, tool coercion, and secret exfiltration.
- Prior workflow output is wrapped in an `untrusted_workflow_output` boundary before it reaches an agent step, so a previous tool or agent result cannot silently become authorization.
- Expanded API, chunking, MCP allow-list, prompt-guard, workflow-boundary, and validation tests, plus an opt-in integration test that persists data through the real Compose MySQL service and verifies cascade deletion.

## Phase 8 capabilities

- Production-only Compose topology using immutable Artifact Registry image tags, a dedicated Prisma migrator image, persistent data volumes, service health gates, and no public database or internal-service ports.
- TLS Nginx routing with an ACME webroot, hardened protocol settings, SSE-safe proxying, a self-signed first-deploy bootstrap, and automatic Certbot renewal/reload hooks.
- Idempotent GCP provisioning for Artifact Registry, least-privilege VM and GitHub service accounts, a reserved IP, HTTP/HTTPS firewall rules, OS Login, Ubuntu 24.04, Docker Compose, and unattended security updates.
- GitHub Actions CI on pull requests and `main`: frontend linting, TypeScript checks, Node/Python tests, a real MySQL integration test, application builds, SBOM/provenance-enabled container publishing, and production deployment.
- Keyless GitHub-to-GCP authentication through repository-scoped Workload Identity Federation. The VM pulls images with its own read-only runtime identity.
- SHA-pinned releases, readiness verification, automatic image rollback, a manual rollback procedure, live verification commands, and a documented monthly cost envelope.

## Repository layout

```text
frontend/       Next.js 16, React, Tailwind, shadcn/ui
api-gateway/    Express 5, TypeScript, Prisma, JWT auth, uploads, BullMQ worker
agent-service/  FastAPI, SQLAlchemy, extraction, embeddings, Chroma retrieval
mcp-server/     Official Python MCP server and tenant-scoped tools
infra/nginx/    Local and production reverse-proxy configuration
infra/gcp/      VM provisioning, deployment, rollback, and TLS scripts
.github/        CI/CD workflow for Artifact Registry and Compute Engine
docs/           Review notes and later demo material
```

## Data model

The first migration creates normalized tables for users, refresh tokens, documents, conversations, messages, workflows, workflow runs, and tasks. Foreign keys use cascade deletion for user-owned aggregates. Composite indexes match the expected dashboard access paths.

`workflows.steps_json` is intentionally denormalized: ordered steps have heterogeneous, versioned tool payloads. Workflow identity, ownership, scheduling, activation, and run history remain relational and queryable.

## Run locally with Docker

Prerequisites: Docker Engine with Compose v2.

1. Copy `.env.example` to `.env`.
2. Replace the database passwords, `JWT_ACCESS_SECRET`, and `INTERNAL_API_TOKEN`. Set `OPENAI_API_KEY` to process documents end to end.
3. Start the stack:

   ```bash
   docker compose up --build
   ```

4. Open `http://localhost:8080`.

The one-shot `migrate` container applies the committed Prisma migration before the API, worker, and Python service start.

## Run services directly

### Frontend

```bash
cd frontend
npm install
NEXT_PUBLIC_API_URL=http://localhost:4000/api npm run dev
```

### API gateway

Run MySQL and Redis, set the variables shown in `.env.example`, then:

```bash
cd api-gateway
npm install
npx prisma generate
npx prisma migrate deploy
npm run dev
```

### Python agent service

```bash
cd agent-service
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

On Windows PowerShell, activate the virtual environment with `.venv\Scripts\Activate.ps1`.

## Environment variables

| Variable | Service | Purpose |
|---|---|---|
| `DATABASE_URL` | API / agent / MCP | MySQL connection string; Python services use the `mysql+pymysql` form |
| `REDIS_URL` | API / worker | Cache and BullMQ connection |
| `JWT_ACCESS_SECRET` | API | Signs access tokens; minimum 32 characters |
| `JWT_ISSUER` / `JWT_AUDIENCE` | API | Restricts accepted access tokens to this API and web client |
| `RATE_LIMIT_*_MAX` | API | Redis-backed per-window quotas for global and sensitive operations |
| `ACCESS_TOKEN_TTL` | API | Access-token lifetime, default `15m` |
| `REFRESH_TOKEN_TTL_DAYS` | API | Refresh-session lifetime, default 30 days |
| `COOKIE_SECURE` | API | Set `true` behind production HTTPS |
| `FRONTEND_ORIGIN` | API | Allowed credentialed CORS origin |
| `NEXT_PUBLIC_API_URL` | Frontend | Browser-facing API base URL |
| `AGENT_SERVICE_URL` | API / worker | Internal FastAPI base URL |
| `WORKFLOW_EXECUTION_TIMEOUT_MS` | Worker | Maximum workflow execution request duration; defaults to 300,000 ms |
| `MCP_SERVER_URL` | Agent | Internal Streamable HTTP MCP base URL |
| `CHROMA_URL` | Agent / MCP | Internal ChromaDB base URL |
| `INTERNAL_API_TOKEN` | Worker / agent / MCP | Authenticates internal service and MCP calls |
| `UPLOAD_DIR` | API / agent | Shared raw-document volume path |
| `MAX_UPLOAD_BYTES` | API | Upload limit; defaults to 15 MiB |
| `OPENAI_API_KEY` | Agent / MCP | Generates document and query embeddings and runs the agent; never commit it |
| `OPENAI_MODEL` | Agent | Chat model used by the Agents SDK; defaults to `gpt-4o-mini` |
| `OPENAI_EMBEDDING_MODEL` | Agent / MCP | Embedding model; defaults to `text-embedding-3-small` |
| `AGENT_HISTORY_MESSAGES` | Agent | Maximum recent user/assistant messages sent to each run; defaults to 24 |
| `AGENT_MAX_TURNS` | Agent | Agents SDK turn ceiling for one response; defaults to 8 |
| `WEBHOOK_TIMEOUT_SECONDS` | MCP | Outbound webhook timeout; defaults to 10 seconds |

See `.env.example` for the complete list.

For production provisioning, GitHub OIDC, TLS, deployment, rollback, operating commands, and the monthly cost estimate, see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Health endpoints

| Endpoint | Meaning |
|---|---|
| `GET /api/health` | API liveness |
| `GET /api/ready` | API connectivity to MySQL and Redis |
| `GET /api/health` on frontend port 3000 | Frontend liveness |
| `GET /agent/health` | Agent-service liveness |
| `GET /agent/ready` | Agent connectivity to MySQL, ChromaDB, and the MCP server; also reports whether an OpenAI key is configured |
| `GET /mcp/health` on internal port 8100 | MCP service liveness |

## Verification

For a complete browser-driven demonstration with ready-to-upload documents, exact chat prompts, all four MCP tools, manual and scheduled workflows, failure logging, and security checks, follow [`docs/demo-kit/FULL_PRODUCT_TEST.md`](docs/demo-kit/FULL_PRODUCT_TEST.md).

```bash
npm run typecheck
npm test
npm run build
```

The full container smoke test is:

```bash
docker compose config
docker compose up --build -d
curl http://localhost:8080/api/ready
```

Phase 7 unit tests and the real-MySQL integration test can be run without installing Python locally:

```bash
docker compose --profile test run --rm --no-deps agent-test
docker compose --profile test run --rm --no-deps mcp-test
docker compose --profile test run --rm api-integration-test
```

The Phase 2 RAG smoke test creates a temporary account, uploads a document, polls ingestion, and verifies a cited retrieval result:

```bash
npm run smoke:rag
```

It requires a valid `OPENAI_API_KEY` in `.env` and a rebuilt/restarted `agent-service`. Without a key, ingestion deliberately records `FAILED` with an actionable reason instead of silently using mock vectors.

The Phase 3 smoke test additionally creates a conversation, streams an agent answer, verifies that the deltas reconstruct the final cited response, and reads the persisted messages and usage metadata back from MySQL:

```bash
npm run smoke:agent
```

The Phase 4 smoke test drives the agent through the MCP boundary to create a real MySQL task, read it back through the whitelisted query tool, deliver a harmless public webhook, and verify the persisted tool audit metadata:

```bash
npm run smoke:mcp
```

Together, `smoke:agent` and `smoke:mcp` exercise all four MCP tools end to end. They require a valid `OPENAI_API_KEY`; the webhook check also requires outbound access to `https://httpbingo.org`.

The Phase 5 smoke test validates rejected unknown tools, CRUD, a manual three-step agent/MCP run, output templating, a real cron firing, schedule deactivation, successful logs, and a deliberately failed step with a durable error record:

```bash
npm run smoke:workflow
```

### Document REST API

All endpoints require `Authorization: Bearer <access-token>`.

| Endpoint | Purpose |
|---|---|
| `POST /api/documents` | Multipart upload using field name `file`; returns `202 Accepted` |
| `GET /api/documents` | List the current user's documents and ingestion states |
| `GET /api/documents/:id` | Poll one document's state and failure details |
| `POST /api/documents/search` | Semantic search with `query`, optional `documentId`, and optional `topK` |

### Conversation REST API

All endpoints require `Authorization: Bearer <access-token>`.

| Endpoint | Purpose |
|---|---|
| `POST /api/conversations` | Create a conversation with an optional `title` |
| `GET /api/conversations` | List conversations with message counts and last-message previews |
| `GET /api/conversations/:id` | Read up to 200 recent persisted messages and their audit metadata |
| `POST /api/conversations/:id/messages/stream` | Send a message and receive `start`, `delta`, `done`, or `error` SSE events |

### Workflow REST API

All endpoints require `Authorization: Bearer <access-token>`.

| Endpoint | Purpose |
|---|---|
| `POST /api/workflows` | Create and, for active cron workflows, schedule a validated definition |
| `GET /api/workflows` | List workflows with next-run and last-run metadata |
| `GET /api/workflows/:id` | Read one workflow definition |
| `PATCH /api/workflows/:id` | Update its definition and atomically reconcile the schedule |
| `DELETE /api/workflows/:id` | Remove its schedule and delete the workflow and run history |
| `POST /api/workflows/:id/runs` | Queue an immediate manual run; returns `202 Accepted` |
| `GET /api/workflows/:id/runs` | List recent execution history, up to 100 runs |
| `GET /api/workflows/:id/runs/:runId` | Read one run and its step-level logs |

## Security notes

- Passwords are never logged and are stored only as bcrypt hashes.
- Refresh tokens are rotated on use, revocable, and hashed in MySQL.
- Access tokens are short-lived and are not persisted to local storage.
- Helmet supplies baseline HTTP security headers; request payloads are size-limited.
- Strict Zod and Pydantic schemas validate every external and internal request boundary; malformed JSON and oversized bodies produce stable client errors.
- Redis-backed rate limits protect authentication and resource-intensive actions. Keys contain hashed identities, and successful responses expose limit, remaining, and reset metadata.
- Raw uploads are type/size checked, stored outside the web root, and accessed only through a path-containment check in the internal agent service.
- Chroma collections are scoped by authenticated user ID; optional document filters are ownership-checked in MySQL.
- Retrieved documents, database rows, prior workflow output, and tool responses are explicitly untrusted. Suspicious content is normalized, bounded, flagged, and kept inside an evidence-only boundary rather than being treated as instructions.
- MCP calls require a shared internal token before the server accepts the user-scoping header. The MCP port is not published to the host by Compose.
- Database access is allow-listed and parameterized; arbitrary model-provided SQL is rejected before execution.
- Webhooks are size-limited and protected against obvious SSRF targets. Production hardening should additionally use an outbound proxy with DNS pinning and a destination allow-list.
- Workflow definitions are parsed independently by Zod in Node and Pydantic in Python. Only allow-listed agent/MCP steps can cross the worker boundary.
- Schedules are server-owned Redis records derived from tenant-owned MySQL workflows; clients cannot provide queue job IDs or another user's identity.
- Automatic workflow action retries are disabled until side-effecting tools support idempotency keys, avoiding silent duplicate tasks or webhooks.

## Roadmap

1. **Complete:** scaffolding, health checks, database migration, signup/login.
2. **Complete:** document upload, extraction, chunking, embeddings, and ChromaDB retrieval.
3. **Complete:** Agents SDK runtime, retrieval function tool, SSE chat, conversation persistence, tracing, and usage metadata.
4. **Complete:** MCP tools, Agents SDK client integration, tenant scoping, tool audit metadata, and end-to-end action verification.
5. **Complete:** workflow CRUD, BullMQ manual/cron scheduling, ordered agent/MCP execution, schedule reconciliation, and durable run logs.
6. **Complete:** responsive dashboard, streaming chat, document library, form-based workflow builder, and live execution history.
7. **Complete:** Redis-backed rate limiting, strict validation, injection guardrails, workflow-output fencing, and expanded unit/integration tests.
8. **Deployment infrastructure complete:** production Compose, GCP provisioning, TLS, keyless GitHub Actions CI/CD, health-gated rollout, and rollback. Live activation requires the target GCP project, GitHub repository, domain, and production secrets.

## What I would improve with more time

Beyond the planned phases: hardware-backed secrets, per-tenant envelope encryption, distributed traces, workflow dead-letter handling, per-step idempotency keys, policy-based tool approvals, browser and load testing, and a migration from the single-VM topology when usage justifies managed services.
