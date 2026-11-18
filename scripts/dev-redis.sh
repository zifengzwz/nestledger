#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${REDIS_PORT:-6389}"
command -v redis-server >/dev/null || { echo 'Install Redis locally and ensure redis-server is on PATH.' >&2; exit 1; }
: "${REDIS_PASSWORD:?Export REDIS_PASSWORD before starting Redis}"
# Pass the secret through stdin, not the process arguments or a file.
PASSWORD_CONFIG=${REDIS_PASSWORD//\\/\\\\}
PASSWORD_CONFIG=${PASSWORD_CONFIG//\"/\\\"}
PASSWORD_CONFIG=${PASSWORD_CONFIG//$'\n'/\\n}
PASSWORD_CONFIG=${PASSWORD_CONFIG//$'\r'/\\r}
unset REDIS_PASSWORD
mkdir -p "$ROOT/.runtime/redis"
exec redis-server - --bind 127.0.0.1 --port "$PORT" --dir "$ROOT/.runtime/redis" --appendonly yes --maxmemory 128mb --maxmemory-policy noeviction < <(printf 'requirepass "%s"\n' "$PASSWORD_CONFIG")
