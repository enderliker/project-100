#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env ]]; then
  echo "Missing .env file."
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

required_env=(
  "SERVICE_MODE"
  "REDIS_HOST"
  "REDIS_PORT"
  "REDIS_PASSWORD"
  "REDIS_CA_PATH"
  "PG_HOST"
  "PG_PORT"
  "PG_USER"
  "PG_PASSWORD"
  "PG_DATABASE"
)

for var in "${required_env[@]}"; do
  if [[ -z "${!var:-}" ]]; then
    echo "Missing required environment variable: $var"
    exit 1
  fi
done

if [[ -d .git ]]; then
  git fetch --all --prune
  git pull --ff-only
fi

if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi

npm run build

case "$SERVICE_MODE" in
  bot)
    entry="Bot/dist/index.js"
    ;;
  worker)
    entry="worker/dist/index.js"
    ;;
  worker2)
    entry="worker2/dist/index.js"
    ;;
  *)
    echo "Invalid SERVICE_MODE: $SERVICE_MODE"
    exit 1
    ;;
 esac

if [[ ! -f "$entry" ]]; then
  echo "Compiled entrypoint not found: $entry"
  exit 1
fi

exec node "$entry"
