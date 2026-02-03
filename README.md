# Project-100 Distributed System

## Overview
This monorepo provides a production-ready distributed system with a bot/gateway service and two worker services backed by Redis (TLS) for queueing and PostgreSQL (SSL) for persistence. The runtime is designed for Pterodactyl/Jexactyl and only runs compiled JavaScript from `dist/` after a build step.

## Repository Structure
```
/
├─ Bot/
├─ worker/
├─ worker2/
├─ shared/
├─ scripts/
├─ package.json
├─ tsconfig.base.json
├─ .env.example
├─ README.md
```

## Requirements
- Node.js 22+ (runtime)
- Redis with TLS enabled (CA file mounted at runtime)
- PostgreSQL with SSL enabled (CA file mounted at runtime)

## Setup
1. Copy `.env.example` to `.env` and fill in real values (no secrets are stored in repo).
2. Ensure TLS CA files are mounted in the paths referenced by `.env`.
3. Run the entrypoint script:
   ```bash
   ./scripts/entrypoint.sh
   ```

The entrypoint script performs the following in strict order:
1. Loads `.env`
2. Validates required environment variables (including `DISCORD_TOKEN` and `DISCORD_APP_ID` for `SERVICE_MODE=bot`)
3. Optionally updates the repo via `git fetch` + `git pull --ff-only`
4. Installs dependencies deterministically
5. Builds all workspaces
6. Resolves the service based on `SERVICE_MODE`
7. Starts the compiled JS from `dist/`

## Service Modes
Set `SERVICE_MODE` in `.env` to one of:
- `bot`
- `worker`
- `worker2`

An invalid or missing value causes the process to exit.

Each service uses the same entrypoint and working directory. Start the container
from the repository root and run either `node run.js` or `./scripts/entrypoint.sh`.
Switch behavior by changing `SERVICE_MODE` in the `.env` for that container.

## Health Endpoints
Each service exposes two health endpoints:
- `GET /healthz` — liveness only (fast). Returns `{"ok": true, "service": "...", "uptime_s": ..., "version": ...}`.
- `GET /readyz` — readiness check. Runs dependency checks and returns per-dependency status plus overall `ok`.

## Deployment on Pterodactyl (main bot + workers)
This repo is public, so **never commit secrets**. Configure a local `.env` inside each
Pterodactyl container.

### A) Create `.env` files (one per container)
1) In the Pterodactyl panel, open **File Manager** for the server/container.
2) Upload `.env.example` from this repo, rename it to `.env`, then fill in values.
3) Repeat for each container: main bot, worker1, worker2.

**Main bot container `.env` (SERVICE_MODE=bot)** — key variables:
- Discord:
  - `DISCORD_TOKEN=your_bot_token`
  - `DISCORD_APP_ID=your_application_id`
  - `DISCORD_GUILD_ID=optional_guild_id` (only if your commands use a single guild)
- Ports:
  - `HTTP_PORT=3028`
  - `HEALTH_PORT=3001`
- Command logging:
  - `LOG_COMMAND_EVENTS=0` (set to `1` to log per-command events)
- Worker URLs:
  - `WORKER1_URL=http://zac.hidencloud.com:24661`
  - `WORKER2_URL=http://june.hidencloud.com:25230`
- Redis (AWS TLS + auth):
  - `REDIS_HOST=your-redis-host`
  - `REDIS_PORT=6379`
  - `REDIS_PASSWORD=your_password`
  - `REDIS_TLS=true`
  - `REDIS_CA_PATH=/path/to/redis-ca.pem`
  - Example URL formats (if you use them outside this app): `redis://host:port` (no TLS) vs `rediss://host:port` (TLS)
- Postgres (AWS RDS, optional for bot health checks):
  - `PG_HOST=your-postgres-host`
  - `PG_PORT=5432`
  - `PG_DATABASE=project`
  - `PG_USER=your_user`
  - `PG_PASSWORD=your_password`
  - `PG_SSL_REJECT_UNAUTHORIZED=true` (set `false` for non-SSL dev)
  - Example connection string format: `postgresql://user:pass@host:5432/dbname?sslmode=require`

**Worker1 container `.env` (SERVICE_MODE=worker)** — key variables:
- `HEALTH_PORT=3001` (or any allocated port for this container)
- `WORKER_QUEUE_NAME=jobs:worker`
- `WORKER_DEAD_LETTER_QUEUE=jobs:dead-letter`
- `WORKER_MAX_ATTEMPTS=5`
- `WORKER_IDEMPOTENCY_TTL_SEC=86400`
- `WORKER_BACKOFF_BASE_MS=500`
- `BOT_HEALTH_URL=http://<bot-host>:<bot-health-port>/healthz`
- Same Redis + Postgres variables as above.

**Worker2 container `.env` (SERVICE_MODE=worker2)** — key variables:
- `HEALTH_PORT=3001` (or any allocated port for this container)
- `WORKER2_QUEUE_NAME=jobs:worker2`
- `WORKER2_DEAD_LETTER_QUEUE=jobs:dead-letter`
- `WORKER2_MAX_ATTEMPTS=5`
- `WORKER2_IDEMPOTENCY_TTL_SEC=86400`
- `WORKER2_BACKOFF_BASE_MS=500`
- `BOT_HEALTH_URL=http://<bot-host>:<bot-health-port>/healthz`
- Same Redis + Postgres variables as above.

### B) Pterodactyl panel steps (ports + binding)
1) **Allocations**: add two allocations for the bot container: one for `HTTP_PORT` and one for `HEALTH_PORT`.
2) For worker containers, add an allocation for `HEALTH_PORT`.
3) Set `HTTP_PORT`/`HEALTH_PORT` in each `.env` to match the allocation numbers.
4) Services bind to `0.0.0.0` by default, so the allocations are reachable externally.

### C) How to test health endpoints
**Inside the container:**
```bash
curl -s http://127.0.0.1:$HEALTH_PORT/healthz
curl -s http://127.0.0.1:$HEALTH_PORT/readyz
```

**From outside (browser or shell):**
```bash
curl -s http://<panel-domain-or-ip>:<allocation>/healthz
curl -s http://<panel-domain-or-ip>:<allocation>/readyz
```

**Worker checks:**
```bash
curl -s http://zac.hidencloud.com:24661/healthz
curl -s http://june.hidencloud.com:25230/healthz
```

### D) Handling `workers_down` / `partial_workers`
The main bot marks itself degraded when it cannot reach either worker’s `GET /healthz`
endpoint (HTTP 200 + JSON with `"ok": true`). To resolve:
1) Ensure each worker container is running with the correct `SERVICE_MODE` (`worker` or `worker2`).
2) Confirm the worker’s health server is listening on the `HEALTH_PORT` allocation.
3) Verify the worker responds to `curl http://<worker-host>:<worker-health-port>/healthz`.
4) Update `WORKER1_URL` / `WORKER2_URL` in the bot’s `.env` if the worker URL changed.

## Scripts
- `npm run build` — Builds all workspaces using TypeScript project references.
- `./scripts/entrypoint.sh` — Production entrypoint with full startup flow.

## Security Notes
- Redis connections require TLS and a CA certificate.
- PostgreSQL connections require SSL; CA verification is supported.
- No secrets are logged; configuration comes only from `.env`.
- Workers are stateless and idempotent.
