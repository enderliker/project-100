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
- Node.js 18+ (runtime)
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
2. Validates required environment variables
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

## Scripts
- `npm run build` — Builds all workspaces using TypeScript project references.
- `./scripts/entrypoint.sh` — Production entrypoint with full startup flow.

## Security Notes
- Redis connections require TLS and a CA certificate.
- PostgreSQL connections require SSL; CA verification is supported.
- No secrets are logged; configuration comes only from `.env`.
- Workers are stateless and idempotent.
