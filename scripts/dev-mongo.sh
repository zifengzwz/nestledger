#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${MONGO_PORT:-27028}"
command -v mongod >/dev/null || { echo 'Install MongoDB locally and ensure mongod is on PATH.' >&2; exit 1; }
mkdir -p "$ROOT/.runtime/mongo"
exec mongod --bind_ip 127.0.0.1 --port "$PORT" --dbpath "$ROOT/.runtime/mongo" --auth --quiet
