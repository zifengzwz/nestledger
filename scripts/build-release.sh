#!/usr/bin/env bash
# Build the frontend on this machine and package a deployment bundle.
# The deployment machine only needs OpenResty, MongoDB, Redis, Python and openssl;
# it does not need Node.js or npm and never runs a frontend build.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="${RELEASE_DIR:-$ROOT/release}"
STAMP="$(date +%Y%m%d-%H%M%S)"
NAME="nestledger"

command -v npm >/dev/null || { echo 'npm is required on the build machine only.' >&2; exit 1; }

echo '==> Building frontend'
npm --prefix "$ROOT/frontend" ci --no-audit --no-fund
npm --prefix "$ROOT/frontend" run build
[[ -f "$ROOT/frontend/dist/index.html" ]] || { echo 'frontend build did not produce dist/index.html' >&2; exit 1; }

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
dest="$stage/$NAME"
mkdir -p "$dest" "$OUT"

echo '==> Assembling release bundle'
cp -a "$ROOT/backend" "$ROOT/scripts" "$ROOT/docs" "$ROOT/tests" "$dest/"
cp -a "$ROOT/API_CONTRACT.md" "$ROOT/README.md" "$ROOT/.env.example" "$dest/"
[[ -f "$ROOT/需求.md" ]] && cp -a "$ROOT/需求.md" "$dest/"
mkdir -p "$dest/frontend"
cp -a "$ROOT/frontend/dist" "$dest/frontend/"
cp -a "$ROOT/frontend/package.json" "$dest/frontend/"
# Browser test dependencies are development-only and must not bloat the bundle.
rm -rf "$dest/tests/browser/node_modules" "$dest/tests/browser/test-results"
rm -rf "$dest/.env" "$dest/.runtime" "$dest/release"

bundle="$OUT/$NAME-$STAMP.tar.gz"
tar -czf "$bundle" -C "$stage" "$NAME"
(cd "$OUT" && sha256sum "$(basename "$bundle")" > "$(basename "$bundle").sha256")

cat <<MSG

Release bundle ready:
  $bundle
  $bundle.sha256

Deploy machine (no Node.js/npm required):
  tar -xzf $(basename "$bundle")
  cd $NAME
  cp .env.example .env && chmod 600 .env   # fill in credentials and APP_ENV
  # production: place the supplied certificate/key, set TLS_CERT_FILE/TLS_KEY_FILE
  set -a; source .env; set +a
  bash scripts/dev-mongo.sh          # terminal 1
  bash scripts/dev-redis.sh          # terminal 2
  bash scripts/dev-server.sh         # terminal 3
MSG
