# Project Brief: "Ops Copilot" — AI Agent Automation Platform

## Role & Goal

You are acting as a senior full-stack engineer and AI systems architect. Build a production-quality portfolio project called **Ops Copilot**: a web platform where users upload documents and connect tools, then interact with an AI agent that can answer questions using RAG and execute multi-step actions (send data to APIs, query a database, run scheduled automations).

This project exists to demonstrate the following skill set to a technical hiring reviewer, so **every listed technology must actually be used meaningfully**, not just imported and left unused:
JavaScript/TypeScript, React/Next.js, Node.js, Python, FastAPI, MySQL, Redis, RESTful APIs, Docker, Linux server administration, Nginx, CI/CD, OpenAI API integration, AI Agent frameworks (OpenAI Agents SDK), RAG, Vector databases (ChromaDB), MCP (Model Context Protocol), AI workflow automation, prompt engineering, and cloud deployment (GCP).

Work in phases (outlined at the bottom). Confirm scope with me before generating large amounts of code. Ask clarifying questions if a requirement below is ambiguous — do not silently assume.

---

## 1. High-Level Architecture

Three services, containerized, communicating over REST/HTTP internally:

```
┌─────────────────┐      ┌──────────────────────┐      ┌─────────────────────┐
│  Next.js Frontend │ ───▶ │  Node.js API Gateway  │ ───▶ │  Python Agent Service│
│  (TypeScript,     │      │  (Express/Fastify,    │      │  (FastAPI,           │
│   Tailwind)        │      │   TypeScript, JWT)    │      │   OpenAI Agents SDK, │
└─────────────────┘      │                        │      │   ChromaDB client)   │
                          │  - Auth                │      └─────────┬───────────┘
                          │  - CRUD (users,        │                │
                          │    workflows, docs)     │                │
                          │  - Job queue producer   │                ▼
                          └─────────┬──────────────┘      ┌─────────────────────┐
                                    │                      │  ChromaDB (vector)  │
                          ┌─────────▼──────────────┐       └─────────────────────┘
                          │  MySQL   +   Redis      │
                          │  (data)     (cache/queue)│
                          └─────────────────────────┘
                                    ▲
                          ┌─────────┴──────────────┐
                          │  Worker (Node + BullMQ) │
                          │  runs scheduled agent   │
                          │  jobs via Redis queue    │
                          └─────────────────────────┘
```

**Why this split:** Node.js handles the web-app concerns (auth, CRUD, REST API, job queueing) — this is the "Full Stack Developer" half of the JD. Python/FastAPI hosts the actual agent runtime because the OpenAI Agents SDK, RAG tooling, and MCP ecosystem are strongest in Python — this is the "AI Agent" half. The two talk over a simple internal REST contract.

An **MCP server** (also Python, using the official `mcp` SDK) exposes custom tools (see Section 5) that the agent consumes — this is what lets you legitimately claim "MCP experience."

---

## 2. Tech Stack (final, do not substitute without asking)

| Layer | Choice |
|---|---|
| Frontend | Next.js 14+ (App Router), TypeScript, Tailwind CSS, shadcn/ui for components |
| API Gateway | Node.js, Express (or Fastify), TypeScript |
| Agent Service | Python 3.11+, FastAPI, OpenAI Agents SDK |
| LLM Provider | OpenAI API (gpt-4o / gpt-4o-mini) — build a thin provider-abstraction layer so Gemini/Claude could be swapped in later, but only implement OpenAI now |
| Vector DB | ChromaDB, self-hosted via Docker, persistent volume |
| Relational DB | MySQL 8, via Prisma (Node side) and SQLAlchemy (Python side) — or a single ORM if you prefer to keep it simpler; decide and document |
| Cache / Queue | Redis — session cache + BullMQ (Node) job queue for scheduled workflows |
| Agent Orchestration | OpenAI Agents SDK (handoffs + tools + guardrails) |
| Tool Protocol | MCP (Model Context Protocol) — custom MCP server exposing internal tools |
| Auth | JWT (access + refresh tokens), bcrypt for password hashing |
| Containerization | Docker + Docker Compose (local), same images redeployed to GCP |
| Reverse Proxy | Nginx (TLS termination via Let's Encrypt, routing to frontend/API) |
| CI/CD | GitHub Actions — lint, test, build image, push to Artifact Registry, deploy |
| Cloud | GCP — Compute Engine VM (Docker Compose) or Cloud Run for the two app services; Cloud SQL is optional/skip to save credits, self-host MySQL in a container instead unless told otherwise |
| Monitoring/Logs | Basic: structured JSON logs + a `/health` endpoint per service; stretch goal: Grafana/Prometheus if time allows |

---

## 3. Core Features (functional requirements)

### 3.1 Auth & Users
- Email/password signup + login, JWT access + refresh token flow.
- Basic user profile, API key storage (for the user's own OpenAI key, optional — default to system key from env for the demo).

### 3.2 Document Ingestion (RAG pipeline)
- User uploads PDF/DOCX/TXT files via the frontend.
- Node API stores the raw file (local disk or GCS bucket) and enqueues a processing job.
- A processing worker (can live in the Python service): extracts text → chunks (e.g., 500–1000 tokens with overlap) → generates embeddings via OpenAI `text-embedding-3-small` → stores vectors + metadata in ChromaDB, scoped per user/collection.
- Store ingestion status (`pending`, `processing`, `done`, `failed`) in MySQL so the frontend can poll/display progress.

### 3.3 Chat / Agent Interaction
- Chat UI (streaming responses) where the user talks to their agent.
- Agent has access to:
  1. A **retrieval tool** — queries ChromaDB for relevant chunks from the user's documents.
  2. **MCP tools** (see Section 5) — e.g., "create_task," "query_database," "send_webhook."
  3. Standard OpenAI Agents SDK function tools for anything not exposed via MCP.
- Conversation history persisted in MySQL (per user, per conversation thread).
- Use OpenAI Agents SDK's tracing/handoff features if a multi-agent split makes sense (e.g., a "router" agent that hands off to a "research agent" vs an "action agent").

### 3.4 Workflow Automation (scheduled agent runs)
- User can define a simple automation: "Every day at 9am, summarize new documents in collection X and post the summary to a webhook."
- Stored as a workflow definition (trigger type: cron or manual, steps: ordered list of agent/tool calls) in MySQL.
- Node worker (BullMQ + Redis, using `repeat` jobs for cron-like schedules) triggers the Python agent service via internal REST call at the scheduled time.
- Execution history/logs stored and viewable in the UI.

### 3.5 Dashboard
- List of documents + ingestion status.
- List of conversations.
- List of workflows + last run status/logs.
- Simple usage stats (token counts, request counts) pulled from logged agent calls — this also doubles as a demonstration of cost-awareness, which is a nice talking point in an interview.

---

## 4. Database Schema (MySQL) — minimum tables

- `users` (id, email, password_hash, created_at)
- `documents` (id, user_id, filename, status, chroma_collection_id, created_at)
- `conversations` (id, user_id, title, created_at)
- `messages` (id, conversation_id, role, content, tool_calls_json, created_at)
- `workflows` (id, user_id, name, trigger_type, cron_expression, steps_json, is_active, created_at)
- `workflow_runs` (id, workflow_id, status, output_json, started_at, finished_at)

Design this properly with foreign keys and indexes — this is one of the explicit JD line items ("design and optimize MySQL... databases"), so don't just dump JSON blobs everywhere; normalize where it makes sense and justify where you don't (e.g., `steps_json` for flexible workflow definitions is a reasonable denormalization — say so in a comment).

---

## 5. MCP Server — required tools to expose

Build a standalone MCP server (Python, official `mcp` package) exposing at minimum:

1. `query_database` — read-only tool that runs a whitelisted, parameterized query against MySQL (e.g., "get workflow run history") — **never allow arbitrary SQL from the LLM; validate against an allow-list of query templates.**
2. `search_documents` — wraps the ChromaDB retrieval so it's usable as an MCP tool (not just an in-process function), proving you understand MCP as a protocol boundary, not just a buzzword.
3. `send_webhook` — POSTs a JSON payload to a user-configured URL (for the "action" side of automation).
4. `create_reminder` or `create_task` — writes a row into a `tasks` table; simulates integrating with an external service (mimics "connect to your tools" pattern without needing real OAuth to Gmail/Slack for the MVP).

The Python Agent Service should connect to this MCP server as an MCP **client** using the OpenAI Agents SDK's MCP integration. Document the JSON-RPC handshake briefly in your README so you can explain it in an interview.

---

## 6. Security & Reliability Requirements

- Input validation on all REST endpoints (e.g., zod on Node side, pydantic on Python side).
- Rate limiting on the API gateway (e.g., `express-rate-limit` backed by Redis).
- Prompt-injection mitigation: system prompt explicitly instructs the agent to treat retrieved document content and tool outputs as untrusted data, not instructions; sanitize/flag suspicious retrieved content before it reaches the agent context.
- Secrets via environment variables / `.env` (never committed); document required env vars in a `.env.example`.
- HTTPS via Nginx + Let's Encrypt on the GCP deployment.
- Basic automated tests: at least unit tests for the RAG chunking logic and the MCP tool allow-list validation, plus one integration test hitting a real (test) MySQL instance.

---

## 7. Deployment Requirements

- `docker-compose.yml` for local dev spinning up: frontend, node-api, python-agent, mcp-server, mysql, redis, chromadb, nginx.
- Same containers pushed to Google Artifact Registry via GitHub Actions on merge to `main`.
- Deployed to a single GCP Compute Engine VM running Docker Compose (simplest, cheapest option within the $300 credit) — Nginx on the VM handles TLS and routes `/, /api, /agent` appropriately.
- GitHub Actions pipeline stages: lint → test → build images → push to Artifact Registry → SSH into GCP VM → `docker compose pull && docker compose up -d`.
- Document estimated monthly GCP cost in the README so it's clear this fits comfortably inside the free credit.

---

## 8. Deliverables

- Full source code in a monorepo with clear top-level folders: `/frontend`, `/api-gateway`, `/agent-service`, `/mcp-server`, `/infra` (docker-compose, nginx config, GitHub Actions workflows).
- `README.md` covering: architecture diagram, setup instructions, environment variables, how the MCP integration works, and a short "what I'd improve with more time" section (interviewers like seeing self-awareness of trade-offs).
- A 2–3 minute demo script/outline (I will record this myself) showing: document upload → RAG chat answer with citation to the uploaded doc → agent performing an action via an MCP tool → a scheduled workflow firing and showing its log.

---

## 9. Build Phases (do these in order; check in with me between phases)

1. **Scaffolding** — repo structure, Docker Compose skeleton, health-check endpoints on all three services, MySQL schema + migrations, basic auth (signup/login) end to end.
2. **RAG pipeline** — document upload → chunk → embed → store in ChromaDB → basic retrieval endpoint, tested via a script before wiring to the agent.
3. **Agent core** — OpenAI Agents SDK setup, retrieval tool wired in, basic chat endpoint with streaming, conversation persistence.
4. **MCP server** — build the 4 tools above, connect the agent service to it as an MCP client, verify tool calls end-to-end.
5. **Workflow automation** — BullMQ scheduled jobs, workflow CRUD, execution logging.
6. **Frontend** — chat UI, document upload UI, dashboard, workflow builder (simple form-based, not drag-and-drop, to keep scope sane).
7. **Hardening** — rate limiting, input validation, prompt-injection guardrails, tests.
8. **Deployment** — Nginx config, GitHub Actions CI/CD, GCP VM provisioning, live deploy.

Start with Phase 1 and stop for review before proceeding to Phase 2.
