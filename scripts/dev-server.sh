#!/usr/bin/env bash
# Start OpenResty with a generated configuration.
# APP_ENV selects the environment profile:
#   test       -> https://127.0.0.1:8443, loopback only, self-signed certificate
#   production -> https://zifeng.net:8001, public bind, certificate supplied by the operator
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
export MONGO_HOST="${MONGO_HOST:-127.0.0.1}"
export MONGO_PORT="${MONGO_PORT:-27028}"
export MONGO_DATABASE="${MONGO_DATABASE:-nestledger_dev}"
export REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
export REDIS_PORT="${REDIS_PORT:-6389}"

export APP_ENV="${APP_ENV:-test}"
case "$APP_ENV" in
  test)
    export APP_PORT="${APP_PORT:-8443}"
    export APP_BIND="${APP_BIND:-127.0.0.1}"
    ;;
  production)
    export APP_PORT="${APP_PORT:-8001}"
    export APP_BIND="${APP_BIND:-0.0.0.0}"
    ;;
  *)
    echo "APP_ENV must be 'test' or 'production' (got '$APP_ENV')." >&2
    exit 1
    ;;
esac
export APP_TLS="${APP_TLS:-true}"
if [[ "$APP_TLS" == "true" ]]; then
  if [[ "$APP_ENV" == "production" ]]; then
    export APP_ORIGIN="${APP_ORIGIN:-https://zifeng.net:$APP_PORT}"
  else
    export APP_ORIGIN="${APP_ORIGIN:-https://127.0.0.1:$APP_PORT}"
  fi
else
  export APP_ORIGIN="${APP_ORIGIN:-http://127.0.0.1:$APP_PORT}"
fi
export COOKIE_SECURE="${COOKIE_SECURE:-$([[ "$APP_TLS" == "true" ]] && echo true || echo false)}"

if [[ -n "${OPENRESTY_BIN:-}" ]]; then
  NGINX="$OPENRESTY_BIN"
elif command -v openresty >/dev/null 2>&1; then
  NGINX="$(command -v openresty)"
elif [[ -x /usr/local/openresty/nginx/sbin/nginx ]]; then
  NGINX=/usr/local/openresty/nginx/sbin/nginx
else
  echo 'OpenResty is required (not plain nginx). Set OPENRESTY_BIN to its nginx binary.' >&2
  exit 1
fi
[[ -f "$ROOT/frontend/dist/index.html" ]] || {
  echo 'frontend/dist/index.html is missing. Use a release bundle built with scripts/build-release.sh.' >&2
  exit 1
}
mkdir -p "$ROOT/.runtime/nginx/logs"

TLS_DIR="$ROOT/.runtime/nginx/tls"
CERT_FILE=""
KEY_FILE=""
if [[ "$APP_TLS" == "true" ]]; then
  if [[ -n "${TLS_CERT_FILE:-}" || -n "${TLS_KEY_FILE:-}" ]]; then
    : "${TLS_CERT_FILE:?Set both TLS_CERT_FILE and TLS_KEY_FILE}"
    : "${TLS_KEY_FILE:?Set both TLS_CERT_FILE and TLS_KEY_FILE}"
    [[ -r "$TLS_CERT_FILE" ]] || { echo "TLS_CERT_FILE is not readable: $TLS_CERT_FILE" >&2; exit 1; }
    [[ -r "$TLS_KEY_FILE" ]] || { echo "TLS_KEY_FILE is not readable: $TLS_KEY_FILE" >&2; exit 1; }
    CERT_FILE="$TLS_CERT_FILE"
    KEY_FILE="$TLS_KEY_FILE"
  elif [[ "$APP_ENV" == "production" ]]; then
    echo 'Production requires TLS_CERT_FILE and TLS_KEY_FILE pointing at the supplied certificate.' >&2
    exit 1
  else
    mkdir -p "$TLS_DIR"
    if [[ ! -s "$TLS_DIR/cert.pem" || ! -s "$TLS_DIR/key.pem" ]]; then
      command -v openssl >/dev/null || { echo 'openssl is required to create the local TLS certificate.' >&2; exit 1; }
      openssl req -x509 -nodes -newkey rsa:2048 -sha256 -days 3650 \
        -keyout "$TLS_DIR/key.pem" -out "$TLS_DIR/cert.pem" \
        -subj '/CN=NestLedger local' \
        -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' \
        -addext 'basicConstraints=critical,CA:FALSE' 2>/dev/null
      chmod 600 "$TLS_DIR/key.pem"
      chmod 644 "$TLS_DIR/cert.pem"
      echo "NestLedger: created local self-signed certificate in $TLS_DIR"
    fi
    CERT_FILE="$TLS_DIR/cert.pem"
    KEY_FILE="$TLS_DIR/key.pem"
  fi
fi

python3 - "$ROOT" "$APP_PORT" "$APP_BIND" "$APP_TLS" "$CERT_FILE" "$KEY_FILE" <<'PY'
import pathlib, sys
root = pathlib.Path(sys.argv[1]).resolve()
port = int(sys.argv[2])
bind = sys.argv[3]
tls = sys.argv[4] == 'true'
cert, key = sys.argv[5], sys.argv[6]
if not 1024 <= port <= 65535:
    raise SystemExit('APP_PORT must be 1024..65535')
# Only generated runtime configuration is written; the repository config is unchanged.
source = (root / 'backend/nginx.conf').read_text()
source = source.replace('__PROJECT_ROOT__', str(root))
# Use the host DNS configuration for optional hostname-based database addresses.
import os
resolver = os.environ.get('DNS_RESOLVER')
if not resolver:
    nameservers = [line.split()[1] for line in pathlib.Path('/etc/resolv.conf').read_text().splitlines()
                   if line.strip().startswith('nameserver ') and len(line.split()) >= 2]
    resolver = nameservers[0] if nameservers else '127.0.0.1'
import ipaddress
address = ipaddress.ip_address(resolver)
resolver = f'[{address}]' if address.version == 6 else str(address)
source = source.replace('__DNS_RESOLVER__', resolver)
source = source.replace('pid /tmp/nestledger-nginx.pid;', f'pid {root}/.runtime/nginx/nginx.pid;')
source = source.replace('worker_processes auto;', 'worker_processes 2;')
source = source.replace('error_log /dev/stderr warn;', f'error_log {root}/.runtime/nginx/logs/error.log warn;')
source = source.replace('access_log /dev/stdout;', f'access_log {root}/.runtime/nginx/logs/access.log;')
if tls:
    tls_config = f"""ssl_certificate {cert};
        ssl_certificate_key {key};
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_prefer_server_ciphers off;
        ssl_session_cache shared:NestLedgerTLS:2m;
        ssl_session_timeout 1d;
        add_header Strict-Transport-Security "max-age=31536000" always;"""
    source = source.replace('listen __SERVER_LISTEN__;', f'listen {bind}:{port} ssl;')
    source = source.replace('# __TLS_CONFIG__', tls_config)
else:
    source = source.replace('listen __SERVER_LISTEN__;', f'listen {bind}:{port};')
    source = source.replace('        # __TLS_CONFIG__\n', '')
(root / '.runtime/nginx/nginx.conf').write_text(source)
PY

"$NGINX" -t -p "$ROOT/.runtime/nginx/" -c "$ROOT/.runtime/nginx/nginx.conf"
printf 'NestLedger [%s]: %s on %s:%s (Mongo %s:%s/%s, Redis %s:%s)\n' \
  "$APP_ENV" "$APP_ORIGIN" "$APP_BIND" "$APP_PORT" \
  "$MONGO_HOST" "$MONGO_PORT" "$MONGO_DATABASE" "$REDIS_HOST" "$REDIS_PORT"
exec "$NGINX" -p "$ROOT/.runtime/nginx/" -c "$ROOT/.runtime/nginx/nginx.conf" -g 'daemon off;'
