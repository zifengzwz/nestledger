-- Real development MongoDB + real transfer module. Only failures are injected:
-- bulk insert acknowledgements, rollback dependency outage, final receipt ack.
-- No production database and no public HTTP fault-injection route.
-- MONGO_PORT=27028 MONGO_DATABASE=nestledger_dev resty -I backend/lua backend/tests/integration_transfer.lua
local db=require 'nestledger.mongo'
local bson=require 'nestledger.bson'
local crypto=require 'nestledger.crypto'
local date=require 'nestledger.date'
local transfer=require 'nestledger.transfer'
local v=require 'nestledger.validate'
local json=require('cjson.safe').new(); json.decode_array_with_array_mt(true)
assert((os.getenv('MONGO_DATABASE') or ''):match('_dev$') or (os.getenv('MONGO_DATABASE') or ''):match('_test$'),'development/test DB required')
local uid,bid=crypto.random(12),crypto.random(12)
local u={_id=uid,authVersion=1,phone='integration-'..uid,name='transfer failure test',createdAt=date.iso(ngx.now())}
local base={type='expense',amountCents=1,category='回滚测试',occurredAt='2026-11-17T00:00:00.000Z',note='',paymentSource='现金'}
local original_insert,original_delete,original_modify=db.insert_many,db.delete,db.modify
local function payload(token,count)
 local rows={}; for i=1,count do local r={}; for k,value in pairs(base) do r[k]=value end; r.note='row '..i; rows[i]=r end
 return assert(json.decode(assert(json.encode({requestId=token,records=rows}))))
end
local function access(id,user)
 local book=db.one('books',{_id=id,deleting={['$ne']=true}})
 if not book then v.error(404,'NOT_FOUND','missing') end
 if book.ownerId~=user._id then v.error(403,'FORBIDDEN','denied') end
 return book
end
local function rejected(fn,code)
 local ok,err=pcall(fn); assert(not ok,'expected injected failure'); assert(type(err)=='table',tostring(err)); if code then assert(err.code==code,tostring(err.code)) end
end
local function count() return db.count('records',{bookId=bid}) end
local ok,err=xpcall(function()
 db.indexes(); db.insert('users',u)
 db.insert('books',{_id=bid,name='transfer isolated test',type='personal',ownerId=uid,memberIds=bson.array({uid}),createdAt=u.createdAt})
 db.insert('records',{_id=crypto.random(12),bookId=bid,createdBy=uid,importBatchId='older-batch',note='must survive'})
 db.insert('records',{_id=crypto.random(12),bookId=bid,createdBy='other-user',note='other must survive'})
 local t=payload(crypto.random(16),201); local chunks=0
 local invalid=payload(crypto.random(16),201); invalid.records[201].amountCents=0
 rejected(function() transfer.import(bid,invalid,u,access,json.array_mt) end,'VALIDATION_ERROR')
 assert(count()==2 and db.count('importReceipts',{userId=uid,bookId=bid})==0)
 local dry=payload(t.requestId,1); dry.dryRun=true
 local validated,dry_status=transfer.import(bid,dry,u,access,json.array_mt)
 assert(validated.validated and validated.count==1 and dry_status==nil)
 assert(count()==2 and db.count('importReceipts',{userId=uid,bookId=bid})==0)
 print('REAL Mongo invalid final row and dryRun: zero business writes and zero receipts')
 db.insert_many=function(collection,docs)
  chunks=chunks+1
  if chunks==2 then
   local partial={}; for i=1,50 do partial[i]=docs[i] end
   original_insert(collection,partial) -- Actual Mongo partial batch, then lost ack.
   error({dependency='mongo',message='simulated bulk acknowledgement lost'},0)
  end
  return original_insert(collection,docs)
 end
 rejected(function() transfer.import(bid,t,u,access,json.array_mt) end)
 assert(count()==2,'rollback touched older records or left failed batch')
 local receipt=db.one('importReceipts',{userId=uid,bookId=bid,requestId=t.requestId})
 assert(receipt.state=='retryable')
 print('REAL Mongo partial bulk + SIMULATED lost ack: rollback isolated and receipt retryable')
 -- Another failed attempt also loses rollback service: pending state is durable.
 chunks=0
 db.insert_many=function(collection,docs)
  original_insert(collection,docs)
  error({dependency='mongo',message='simulated insert ack lost again'},0)
 end
 db.delete=function(collection,filter,multi)
  if collection=='records' and filter.importBatchId and db.count('records',filter)>0 then error({dependency='mongo',message='simulated rollback outage'},0) end
  return original_delete(collection,filter,multi)
 end
 rejected(function() transfer.import(bid,t,u,access,json.array_mt) end,'IMPORT_RECOVERY_REQUIRED')
 assert(count()==102)
 receipt=db.one('importReceipts',{userId=uid,bookId=bid,requestId=t.requestId}); assert(receipt.state=='rollback_pending')
 db.insert_many,db.delete=original_insert,original_delete
 local result,status=transfer.import(bid,t,u,access,json.array_mt)
 assert(status==201 and result.importedCount==201 and not result.replayed)
 assert(count()==203,'recovery duplicated partial rows or removed old rows')
 local replay,replay_status=transfer.import(bid,t,u,access,json.array_mt)
 assert(replay_status==200 and replay.replayed and count()==203)
 local changed=payload(t.requestId,1)
 rejected(function() transfer.import(bid,changed,u,access,json.array_mt) end,'IMPORT_CONFLICT')
 assert(count()==203)
 print('REAL Mongo rollback_pending recovery + completed replay/conflict: no duplication or old-record change')
 -- Simulate final response loss AFTER the receipt was really committed.
 local final=payload(crypto.random(16),1)
 db.modify=function(collection,filter,changes)
  local result=original_modify(collection,filter,changes)
  if collection=='importReceipts' and changes['$set'].state=='committed' then
   error({dependency='mongo',message='simulated committed receipt ack lost'},0)
  end
  return result
 end
 local committed,committed_status=transfer.import(bid,final,u,access,json.array_mt)
 assert(committed_status==201 and committed.importedCount==1 and count()==204)
 db.modify=original_modify
 local again,again_status=transfer.import(bid,final,u,access,json.array_mt)
 assert(again_status==200 and again.replayed and count()==204)
 print('REAL durable commit + SIMULATED final receipt ack loss: confirmed success/replay, never rollback committed data')
 -- A processing receipt is never stolen by a lease-expiry heuristic.
 receipt=db.one('importReceipts',{userId=uid,bookId=bid,requestId=final.requestId})
 original_modify('importReceipts',{_id=receipt._id},{['$set']={state='processing'}})
 rejected(function() transfer.import(bid,final,u,access,json.array_mt) end,'IMPORT_IN_PROGRESS')
 assert(count()==204)
 print('Processing crash boundary: conservative 409, no unsafe automatic takeover')
end,debug.traceback)
db.insert_many,db.delete,db.modify=original_insert,original_delete,original_modify
-- Resolved absolute deletion targets are Mongo filters on generated test IDs only.
db.delete('records',{bookId=bid},true); db.delete('importReceipts',{userId=uid,bookId=bid},true)
db.delete('books',{_id=bid}); db.delete('users',{_id=uid})
if not ok then error(err) end
print('Transfer recovery integration checks passed; isolated test documents removed')
