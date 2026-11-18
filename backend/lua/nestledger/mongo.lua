local bson=require 'nestledger.bson'
local M={}; local seq=0
local host=os.getenv('MONGO_HOST') or '127.0.0.1'
local port=tonumber(os.getenv('MONGO_PORT') or '27017')
local database=os.getenv('MONGO_DATABASE') or 'nestledger'
local function fail(message,code) error({dependency='mongo',message=message,dbcode=code},0) end
local username=os.getenv('MONGO_USERNAME')
local password=os.getenv('MONGO_PASSWORD')
local source=os.getenv('MONGO_AUTH_SOURCE') or 'admin'
local function command(sock,name,doc,db)
 doc[name]=doc[name] or 1; doc['$db']=db
 seq=(seq+1)%2147483647
 local request_id=seq
 local payload=bson.i32(0)..'\0'..bson.encode(doc,name)
 local wire=bson.i32(#payload+16)..bson.i32(request_id)..bson.i32(0)..bson.i32(2013)..payload
 local ok,err=sock:send(wire); if not ok then sock:close(); fail(err) end
 local header; header,err=sock:receive(16)
 if not header then sock:close(); fail(err) end
 local len=bson.u32(header); if len<21 or len>48*1024*1024 or bson.u32(header,13)~=2013 or bson.u32(header,9)~=request_id then sock:close(); fail('invalid OP_MSG response') end
 local body; body,err=sock:receive(len-16); if not body then sock:close(); fail(err) end
 -- OP_MSG bit 0 is checksumPresent; bit 1 moreToCome is not used here.
 local flags=bson.u32(body); if flags%2==1 then body=body:sub(1,-5) end
 if math.floor(flags/2)%2==1 or body:byte(5)~=0 then sock:close(); fail('unsupported OP_MSG section') end
 local success,res=pcall(bson.decode,body,6)
 if not success then sock:close(); fail('malformed BSON response: '..tostring(res)) end
 if res.ok~=1 then fail(res.errmsg or 'command failed',res.code) end
 if res.writeErrors and #res.writeErrors>0 then fail(res.writeErrors[1].errmsg,res.writeErrors[1].code) end
 if res.writeConcernError then fail(res.writeConcernError.errmsg,res.writeConcernError.code) end
 return res
end
function M.command(name,doc)
 local auth=username~=nil or password~=nil
 if auth and (not username or username=='' or not password or password=='' or source=='') then
  fail('MongoDB authentication requires MONGO_USERNAME, MONGO_PASSWORD and a nonempty auth source')
 end
 local sock=ngx.socket.tcp(); sock:settimeouts(2000,3000,5000)
 local pool=auth and ('nestledger:mongo:scram256:'..host..':'..port) or ('nestledger:mongo:plain:'..host..':'..port)
 local connected,err=sock:connect(host,port,{pool=pool}); if not connected then fail(err) end
 if auth then
  local reused=sock:getreusedtimes()
  if not reused then sock:close(); fail('cannot determine MongoDB socket reuse') end
  if reused==0 then
   local ok=pcall(function()
    require('nestledger.mongo_scram').authenticate(function(n,d,db) return command(sock,n,d,db) end,source,username,password)
   end)
   if not ok then sock:close(); fail('MongoDB SCRAM-SHA-256 authentication failed') end
  end
 end
 local ok,res=pcall(command,sock,name,doc,database)
 if not ok then sock:close(); error(res,0) end
 if not sock:setkeepalive(30000,100) then sock:close() end
 return res
end
function M.one(collection,filter)
 local r=M.command('find',{find=collection,filter=filter or {},limit=1,singleBatch=true})
 return r.cursor.firstBatch[1]
end
function M.each(collection,filter,opts,callback)
 opts=opts or {}; local doc={find=collection,filter=filter or {},batchSize=500}
 for _,key in ipairs({'sort','skip','limit','projection'}) do doc[key]=opts[key] end
 local r=M.command('find',doc); local cursor=r.cursor
 local ok,err=xpcall(function()
  for _,v in ipairs(cursor.firstBatch) do callback(v) end
  while not bson.iszero(cursor.id) do
   r=M.command('getMore',{getMore=cursor.id,collection=collection,batchSize=500}); cursor=r.cursor
   for _,v in ipairs(cursor.nextBatch) do callback(v) end
  end
 end,function(e) return e end)
 if not ok then
  if not bson.iszero(cursor.id) then pcall(M.command,'killCursors',{killCursors=collection,cursors=bson.array({cursor.id})}) end
  error(err,0)
 end
end
function M.find(collection,filter,opts)
 local out={}; M.each(collection,filter,opts,function(v) out[#out+1]=v end); return out
end
function M.insert(collection,doc)
 M.command('insert',{insert=collection,documents=bson.array({doc}),ordered=true,writeConcern={w=1}}); return doc
end
function M.insert_many(collection,docs)
 M.command('insert',{insert=collection,documents=bson.array(docs),ordered=true,writeConcern={w=1}})
 return #docs
end
function M.update(collection,filter,changes,multi)
 return M.command('update',{update=collection,updates=bson.array({{q=filter,u=changes,multi=multi or false,upsert=false}}),writeConcern={w=1}}).n
end
function M.modify(collection,filter,changes)
 local r=M.command('findAndModify',{findAndModify=collection,query=filter,update=changes,new=true,writeConcern={w=1}})
 if r.value==bson.null then return nil end; return r.value
end
function M.delete(collection,filter,multi)
 return M.command('delete',{delete=collection,deletes=bson.array({{q=filter,limit=multi and 0 or 1}}),writeConcern={w=1}}).n
end
function M.count(collection,filter) return M.command('count',{count=collection,query=filter or {}}).n end
function M.indexes()
 local indexes={
  users={{key={phone=1},name='unique_phone',unique=true}},
  books={{key={ownerId=1},name='owner'},{key={memberIds=1},name='members'}},
  invitations={{key=bson.ordered({{'bookId',1},{'phone',1}}),name='unique_pending',unique=true,partialFilterExpression={status='pending'}},{key=bson.ordered({{'phone',1},{'status',1}}),name='recipient'}},
  records={{key=bson.ordered({{'bookId',1},{'occurredAt',1}}),name='book_date'},{key=bson.ordered({{'bookId',1},{'createdBy',1}}),name='book_creator'},{key=bson.ordered({{'bookId',1},{'importBatchId',1}}),name='book_import_batch'}},
  importReceipts={{key=bson.ordered({{'userId',1},{'bookId',1},{'requestId',1}}),name='unique_user_book_request',unique=true}}
 }
 for collection,list in pairs(indexes) do M.command('createIndexes',{createIndexes=collection,indexes=bson.array(list)}) end
end
return M
