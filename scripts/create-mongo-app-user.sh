#!/usr/bin/env bash
# Create the least-privilege application user.
# Requires MONGO_HOST, MONGO_PORT, MONGO_DATABASE, MONGO_USERNAME, MONGO_PASSWORD and
# MONGO_AUTH_SOURCE. On an instance that already has users, also export
# MONGO_ADMIN_USERNAME and MONGO_ADMIN_PASSWORD (created by create-mongo-admin.sh);
# on a brand-new instance without authentication it works unauthenticated.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
: "${MONGO_USERNAME:?Export MONGO_USERNAME}"
: "${MONGO_PASSWORD:?Export MONGO_PASSWORD}"
: "${MONGO_AUTH_SOURCE:?Export MONGO_AUTH_SOURCE}"
command -v resty >/dev/null || { echo 'OpenResty resty is required.' >&2; exit 1; }
script=$(mktemp)
trap 'rm -f "$script"' EXIT
cat >"$script" <<'LUA'
local bson=require 'nestledger.bson'
local user=assert(os.getenv('APP_USER')); local pwd=assert(os.getenv('APP_PASSWORD'))
local src=assert(os.getenv('APP_SOURCE'))
local ok,err=pcall(function()
  local mongo=require 'nestledger.mongo'
  mongo.command('createUser',{createUser=user,pwd=pwd,
    roles=bson.array({{role='readWrite',db=src}}),mechanisms=bson.array({'SCRAM-SHA-256'})})
end)
if not ok then
  local code=type(err)=='table' and err.dbcode or nil
  if code==51003 then ngx.log(ngx.WARN,'application user already exists')
  else error('application user creation failed: '..(type(err)=='table' and tostring(err.message or err) or tostring(err))) end
end
ngx.log(ngx.WARN,'mongo application user ready')
LUA
common=(MONGO_HOST="${MONGO_HOST:-127.0.0.1}" MONGO_PORT="${MONGO_PORT:-27028}" \
  MONGO_DATABASE="$MONGO_AUTH_SOURCE" APP_USER="$MONGO_USERNAME" \
  APP_PASSWORD="$MONGO_PASSWORD" APP_SOURCE="$MONGO_AUTH_SOURCE")
if [[ -n "${MONGO_ADMIN_USERNAME:-}" || -n "${MONGO_ADMIN_PASSWORD:-}" ]]; then
  : "${MONGO_ADMIN_USERNAME:?Set both MONGO_ADMIN_USERNAME and MONGO_ADMIN_PASSWORD}"
  : "${MONGO_ADMIN_PASSWORD:?Set both MONGO_ADMIN_USERNAME and MONGO_ADMIN_PASSWORD}"
  env "${common[@]}" MONGO_USERNAME="$MONGO_ADMIN_USERNAME" MONGO_PASSWORD="$MONGO_ADMIN_PASSWORD" \
    MONGO_AUTH_SOURCE=admin resty -I "$ROOT/backend/lua" "$script"
else
  env -u MONGO_USERNAME -u MONGO_PASSWORD "${common[@]}" \
    resty -I "$ROOT/backend/lua" "$script"
fi
