-- Real MongoDB driver integration test, explicitly against a development DB.
-- MONGO_HOST=127.0.0.1 MONGO_PORT=27028 MONGO_DATABASE=nestledger_dev \
-- resty --main-conf 'env MONGO_HOST; env MONGO_PORT; env MONGO_DATABASE;' \
--       -I backend/lua backend/tests/integration_cursor.lua
local db = require 'nestledger.mongo'
local bson = require 'nestledger.bson'
local crypto = require 'nestledger.crypto'
assert((os.getenv('MONGO_DATABASE') or ''):match('_dev$') or (os.getenv('MONGO_DATABASE') or ''):match('_test$'), 'Run only on a _dev or _test database')
local namespace = 'cursor_test_' .. crypto.random(8)
local collection = 'driver_integration'
local function cleanup() db.delete(collection, { namespace = namespace }, true) end
local ok, err = pcall(function()
  -- Rebuilding declarations in a fresh Lua VM must never conflict on key order.
  db.indexes()
  local docs = {}
  for i = 1, 1205 do docs[i] = { _id = namespace .. '_' .. i, namespace = namespace, value = i } end
  db.command('insert', {insert = collection, documents = bson.array(docs), writeConcern = {w = 1}})
  assert(db.count(collection, {namespace = namespace}) == 1205)
  local count, sum = 0, 0
  db.each(collection, {namespace = namespace}, {sort = {value = 1}}, function(row)
    count = count + 1
    assert(row.value == count)
    sum = sum + row.value
  end)
  assert(count == 1205 and sum == 1205 * 1206 / 2)
  local page = db.find(collection, {namespace = namespace}, {sort = {value = 1}, skip = 1200, limit = 5})
  assert(#page == 5 and page[1].value == 1201 and page[5].value == 1205)
  local updated = db.modify(collection, {_id = namespace .. '_1'}, {['$set'] = {value = 9999}})
  assert(updated.value == 9999)
  local aborted, why = pcall(function()
    db.each(collection, {namespace = namespace}, nil, function() error('intentional callback failure') end)
  end)
  assert(not aborted and tostring(why):find('intentional callback failure', 1, true))
end)
cleanup()
assert(ok, tostring(err))
print('PASS: MongoDB real OP_MSG multi-batch cursor, pagination, atomic modification and cleanup (1205 documents)')
