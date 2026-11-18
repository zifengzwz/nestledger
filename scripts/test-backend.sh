#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
command -v resty >/dev/null || { echo 'OpenResty resty CLI is required' >&2; exit 1; }
# Lower cost for unit tests only; the application retains its 600000 default.
export PBKDF2_ITERATIONS="${PBKDF2_ITERATIONS:-100000}"
resty --main-conf 'env PBKDF2_ITERATIONS; env MONGO_DATABASE;' -I "$ROOT/backend/lua" "$ROOT/backend/tests/unit.lua"
