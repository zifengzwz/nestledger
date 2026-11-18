#!/usr/bin/env bash
# Create the first MongoDB administrator on a fresh, empty instance through the
# localhost exception. Only works while the instance still has no users.
# Requires MONGO_ADMIN_USERNAME and MONGO_ADMIN_PASSWORD, plus MONGO_HOST/MONGO_PORT.
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
: "${MONGO_ADMIN_USERNAME:?Export MONGO_ADMIN_USERNAME}"
: "${MONGO_ADMIN_PASSWORD:?Export MONGO_ADMIN_PASSWORD}"
command -v resty >/dev/null || { echo 'OpenResty resty is required.' >&2; exit 1; }
script=$(mktemp)
trap 'rm -f "$script"' EXIT
cat >"$script" <<'LUA'
local bson=require 'nestledger.bson'
local user=assert(os.getenv('APP_USER')); local pwd=assert(os.getenv('APP_PASSWORD'))
local ok,err=pcall(function()
  local mongo=require 'nestledger.mongo'
  mongo.command('createUser',{createUser=user,pwd=pwd,
    roles=bson.array({{role='userAdminAnyDatabase',db='admin'}}),mechanisms=bson.array({'SCRAM-SHA-256'})})
end)
if not ok then
  local code=type(err)=='table' and err.dbcode or nil
  if code==51003 then ngx.log(ngx.WARN,'admin user already exists')
  else error('admin bootstrap failed: '..(type(err)=='table' and tostring(err.message or err) or tostring(err))) end
end
ngx.log(ngx.WARN,'mongo administrator ready')
LUA
env -u MONGO_USERNAME -u MONGO_PASSWORD \
  MONGO_HOST="${MONGO_HOST:-127.0.0.1}" MONGO_PORT="${MONGO_PORT:-27028}" MONGO_DATABASE=admin \
  APP_USER="$MONGO_ADMIN_USERNAME" APP_PASSWORD="$MONGO_ADMIN_PASSWORD" \
  resty -I "$ROOT/backend/lua" "$script"
