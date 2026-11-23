-- Append-only backups. Standalone MongoDB has no cross-collection transaction:
-- receipts serialize attempts and failures clean up only their own generated batch.
local json=require 'cjson.safe'
local db=require 'nestledger.mongo'
local bson=require 'nestledger.bson'
local v=require 'nestledger.validate'
local crypto=require 'nestledger.crypto'
local date=require 'nestledger.date'
local digest=require 'resty.openssl.digest'
local M={}
local fields={'type','amountCents','category','subcategory','occurredAt','note','paymentSource'}
local function now() return date.iso(ngx.now()) end
local function hash(text)
 local d=assert(digest.new('sha256')); assert(d:update(text)); return crypto.hex(assert(d:final()))
end
local function issue(code,message) v.error(409,code,message) end
local function tuple(r)
 local out={}; for _,field in ipairs(fields) do out[#out+1]=r[field] end; return out
end
local function backup_record(r)
 local out={}
 for _,field in ipairs(fields) do
  out[field]=field=='subcategory' and (r.subcategory or '') or r[field]
 end
 return out
end
function M.export(book,args)
 local filter={bookId=book._id}
 if args.from or args.to then
  local a=args.from and date.parse(args.from); local b=args.to and date.parse(args.to)
  if args.from and not a then v.bad('from时间不正确') end
  if args.to and not b then v.bad('to时间不正确') end
  if a and b and a>=b then v.bad('开始时间必须早于结束时间') end
  filter.occurredAt={}; if a then filter.occurredAt['$gte']=date.iso(a) end; if b then filter.occurredAt['$lt']=date.iso(b) end
 end
 local list=db.find('records',filter,{sort=bson.ordered({{'occurredAt',1},{'_id',1}}),limit=5001})
 if #list>5000 then v.error(422,'EXPORT_LIMIT_EXCEEDED','导出最多5000条记录，请缩小日期范围后重试') end
 local records={}; for _,r in ipairs(list) do records[#records+1]=backup_record(r) end
 return {format='nestledger',version=1,exportedAt=now(),book={name=book.name,type=book.type},records=#records==0 and json.empty_array or records}
end
local function validate(t,array_mt)
 v.fields(t,{requestId=true,records=true,dryRun=true})
 if type(t.requestId)~='string' or #t.requestId<16 or #t.requestId>64 or not t.requestId:match('^[A-Za-z0-9%-]+$') then v.bad('requestId必须为16至64位字母、数字或连字符') end
 if t.dryRun~=nil and type(t.dryRun)~='boolean' then v.bad('dryRun必须为布尔值') end
 if type(t.records)~='table' or getmetatable(t.records)~=array_mt then v.bad('records必须为JSON数组') end
 if #t.records<1 or #t.records>5000 then v.bad('导入记录必须为1至5000条') end
 local rows,tuples={},{}
 for i,input in ipairs(t.records) do
  local ok,row=pcall(v.record,input,false)
  if not ok then
   if type(row)=='table' and row.status==400 then v.bad('第'..i..'行：'..row.message) end
   error(row,0)
  end
  rows[i]=row; tuples[i]=tuple(row)
 end
 -- JSON arrays, fixed field order and normalized values: never hash pairs()
 -- serialization. Row ordering is part of the normalized payload identity.
 return rows,hash(assert(json.encode(tuples)))
end
local function state(receipt,changes)
 local updated=db.modify('importReceipts',{_id=receipt._id,state='processing',attempt=receipt.attempt},{['$set']=changes})
 if not updated then issue('IMPORT_IN_PROGRESS','导入状态已变化，请稍后使用相同requestId重试') end
 return updated
end
local function cleanup(receipt,u)
 db.delete('records',{bookId=receipt.bookId,createdBy=u._id,importBatchId=receipt.batchId},true)
end
function M.import(bookId,t,u,access,array_mt)
 access(bookId,u)
 local rows,fingerprint=validate(t,array_mt)
 if t.dryRun then return {validated=true,count=#rows,dryRun=true} end
 local key=hash(assert(json.encode({u._id,bookId,t.requestId})))
 local attempt=crypto.random(16)
 local receipt=db.one('importReceipts',{_id=key})
 if not receipt then
  local fresh={_id=key,userId=u._id,bookId=bookId,requestId=t.requestId,fingerprint=fingerprint,count=#rows,state='processing',attempt=attempt,batchId=crypto.random(16),createdAt=now(),updatedAt=now()}
  local ok,err=pcall(db.insert,'importReceipts',fresh)
  if ok then receipt=fresh
  elseif type(err)=='table' and err.dbcode==11000 then receipt=db.one('importReceipts',{_id=key})
  else error(err,0) end
 end
 if not receipt then issue('IMPORT_IN_PROGRESS','导入正在处理，请稍后使用相同requestId重试') end
 if receipt.fingerprint~=fingerprint then issue('IMPORT_CONFLICT','该requestId已用于不同导入内容，请使用新的requestId') end
 if receipt.state=='committed' then
  access(bookId,u)
  return {importedCount=receipt.count,replayed=true,requestId=t.requestId},200
 end
 if receipt.attempt~=attempt then
  if receipt.state~='retryable' and receipt.state~='rollback_pending' then
   issue('IMPORT_IN_PROGRESS','导入正在处理或等待安全恢复，请稍后使用相同requestId重试')
  end
  receipt=db.modify('importReceipts',{_id=key,state=receipt.state,attempt=receipt.attempt},{['$set']={state='processing',attempt=attempt,updatedAt=now()}})
  if not receipt then issue('IMPORT_IN_PROGRESS','导入正在处理，请稍后使用相同requestId重试') end
 end
 local finalizing=false
 local ok,result=xpcall(function()
  -- Retry cleanup is idempotent and cannot touch ordinary or older batches.
  cleanup(receipt,u)
  receipt=state(receipt,{batchId=crypto.random(16),updatedAt=now()})
  access(bookId,u)
  local current=db.one('users',{_id=u._id,authVersion=u.authVersion})
  if not current then v.error(401,'UNAUTHORIZED','账户已更新，请重新登录') end
  local timestamp=now()
  for start=1,#rows,100 do
   access(bookId,u)
   local chunk={}
   for i=start,math.min(start+99,#rows) do
    local r=rows[i]; r._id=crypto.random(12); r.bookId=bookId; r.createdBy=u._id; r.importBatchId=receipt.batchId
    r.createdAt=timestamp; r.updatedAt=timestamp; chunk[#chunk+1]=r
   end
   db.insert_many('records',chunk)
  end
  access(bookId,u)
  if not db.one('users',{_id=u._id,authVersion=u.authVersion}) then v.error(401,'UNAUTHORIZED','账户已更新，请重新登录') end
  -- If acknowledgement is lost here, never undo a possibly committed batch.
  -- A durable committed receipt is replayable; unresolved processing is 409.
  finalizing=true
  receipt=state(receipt,{state='committed',updatedAt=now()})
  return {importedCount=#rows,replayed=false,requestId=t.requestId}
 end,function(e) return e end)
 if ok then return result,201 end
 if finalizing then
  local checked,found=pcall(db.one,'importReceipts',{_id=key})
  if checked and found and found.state=='committed' then return {importedCount=found.count,replayed=false,requestId=t.requestId},201 end
  error({dependency='mongo',message='import commit acknowledgement unresolved; retry same requestId'},0)
 end
 local rolled,rollback_error=pcall(cleanup,receipt,u)
 local marked,mark_error=pcall(state,receipt,{state=rolled and 'retryable' or 'rollback_pending',updatedAt=now()})
 if not rolled or not marked then
  ngx.log(ngx.ERR,'import rollback/recovery pending: ',tostring(rollback_error or mark_error))
  v.error(503,'IMPORT_RECOVERY_REQUIRED','导入未完成，部分写入清理待恢复；请保留相同requestId重试，勿更换requestId重复导入')
 end
 error(result,0)
end
return M
