-- Run from repository root: resty -I backend/lua backend/tests/unit.lua
local bson=require 'nestledger.bson'
local date=require 'nestledger.date'
local v=require 'nestledger.validate'
local crypto=require 'nestledger.crypto'
local total=0
local function eq(a,b,label) total=total+1; assert(a==b,(label or 'equality')..': '..tostring(a)..' ~= '..tostring(b)) end
local function rejected(fn,status)
 total=total+1; local ok,err=pcall(fn); assert(not ok,'expected rejection'); if status then assert(type(err)=='table' and err.status==status) end
end
local input={str='你好\0world',number=99999999999,negative=-2147483648,float=1.25,truth=true,falsity=false,nilValue=bson.null,nested={a=7},list=bson.array({'a',2}),empty=bson.array(),cursor=bson.int64('\255\255\255\255\255\255\255\127')}
local wire=bson.encode(input); local decoded,endpos=bson.decode(wire)
eq(endpos,#wire+1); eq(decoded.str,input.str); eq(decoded.number,input.number); eq(decoded.negative,input.negative); eq(decoded.float,input.float)
eq(decoded.truth,true); eq(decoded.falsity,false); eq(decoded.nilValue,bson.null); eq(decoded.nested.a,7); eq(decoded.list[2],2); eq(#decoded.empty,0); eq(decoded.cursor.raw,input.cursor.raw)
eq(bson.iszero(bson.int64(string.rep('\0',8))),true); eq(bson.iszero(decoded.cursor),false)
eq(bson.u32(bson.i32(-1)),4294967295); eq(bson.encode({ping=1,['$db']='test'},'ping'):sub(5,10),'\16ping\0')
local ordered_wire=bson.encode(bson.ordered({{'z',1},{'a',2}}))
eq(ordered_wire,bson.i32(19)..'\16z\0'..bson.i32(1)..'\16a\0'..bson.i32(2)..'\0','ordered BSON document')
local ordered_nested=bson.encode({key=bson.ordered({{'bookId',1},{'occurredAt',-1}})})
eq(ordered_nested:find('bookId',1,true)<ordered_nested:find('occurredAt',1,true),true,'compound key precedence')
rejected(function() bson.decode(wire:sub(1,-2)) end)
rejected(function() bson.encode({['x\0y']=1}) end)
rejected(function() bson.encode({bad=math.huge}) end)
rejected(function() bson.decode('\5\0\0\0\1') end)
for _,s in ipairs({'1970-01-01T00:00:00.000Z','2024-02-29T16:34:12.123Z','2000-01-01T00:00:00.000Z','1960-06-01T00:00:00.000Z','9999-12-31T23:59:59.999Z'}) do eq(date.iso(assert(date.parse(s))),s) end
eq(date.parse('2026-01-01T08:00:00+08:00'),date.parse('2026-01-01T00:00:00Z'))
eq(date.parse('2026-01-01T01:00:00+01:00'),date.parse('2026-01-01T00:00:00Z'))
for _,s in ipairs({'2026-02-30T00:00:00Z','2025-02-29T00:00:00Z','2026-01-01T24:00:00Z','2026-01-01T00:00:60Z','2026-01-01','2026-01-01T00:00:00','2026-01-01T00:00:00+14:01','2026-01-01T00:00:00+15:00','2026-01-01T00:00:00.Z','0000-01-01T00:00:00Z'}) do eq(date.parse(s),nil,s) end
local week=date.range('week','2026-11-16')
eq(week.from,'2026-11-15T16:00:00.000Z'); eq(week.to,'2026-11-22T16:00:00.000Z'); eq(#week.trend,7); eq(week.trend[1].label,'2026-11-16')
local sunday=date.range('week','2026-11-22'); eq(sunday.from,week.from)
local month=date.range('month','2024-02-29'); eq(month.from,'2024-01-31T16:00:00.000Z'); eq(month.to,'2024-02-29T16:00:00.000Z'); eq(#month.trend,29)
local year=date.range('year','2026-01-01'); eq(year.from,'2025-12-31T16:00:00.000Z'); eq(year.to,'2026-12-31T16:00:00.000Z'); eq(#year.trend,12)
eq(date.bucket('2026-11-15T16:00:00.000Z','week'),'2026-11-16'); eq(date.bucket('2026-02-28T16:00:00.000Z','year'),'2026-03')
eq(date.range('bad','2026-01-01'),nil); eq(date.range('week','2026-02-30'),nil)
for y=1900,2100,5 do for m=1,12 do local d=date.month_days(y,m); local a,b,c=date.civil(date.days(y,m,d)); eq(a,y); eq(b,m); eq(c,d) end end
eq(v.phone('13800138000'),'13800138000'); rejected(function() v.phone('23800138000') end,400); rejected(function() v.phone({['$ne']=''}) end,400)
eq(v.length('家😊a'),3); eq(v.length('\192\128'),nil); eq(v.length('\237\160\128'),nil); eq(v.length('\244\144\128\128'),nil)
eq(v.text(string.rep('账',40),'test',1,40,true),string.rep('账',40)); rejected(function() v.text(string.rep('账',41),'test',1,40,true) end,400)
rejected(function() v.password('1234567') end,400); rejected(function() v.password(string.rep('x',73)) end,400)
eq(v.integer(99999999999,'money',1,99999999999),99999999999)
for _,n in ipairs({0,-1,1.5,100000000000,math.huge}) do rejected(function() v.integer(n,'money',1,99999999999) end,400) end
rejected(function() v.id('bad') end,400); eq(v.id(string.rep('a',24)),string.rep('a',24))
rejected(function() v.fields({admin=true},{name=true}) end,400)
local record=v.record({type='expense',amountCents=1,category='餐饮',occurredAt='2026-01-01T08:00:00+08:00'},false)
eq(record.note,''); eq(record.paymentSource,''); eq(record.occurredAt,'2026-01-01T00:00:00.000Z')
eq(v.record({note='更新'},true).note,'更新')
rejected(function() v.record({},true) end,400)
rejected(function() v.record({note=false},true) end,400)
rejected(function() v.record({occurredAt='2026-02-30T00:00:00Z'},true) end,400)
rejected(function() v.record({createdBy='fake'},true) end,400)
eq(crypto.equal('same','same'),true); eq(crypto.equal('same','sami'),false); eq(crypto.equal('same','same\0'),false); eq(crypto.equal('', ''),true)
local hash=crypto.hash('password123'); eq(hash.algorithm,'pbkdf2-sha256'); eq(#hash.salt,32); eq(#hash.hash,64)
eq(crypto.verify('password123',hash),true); eq(crypto.verify('wrongpassword',hash),false)
eq(crypto.verify('password123',{}),false)
local hash2=crypto.hash('password123'); eq(hash.salt~=hash2.salt,true); eq(hash.hash~=hash2.hash,true)
-- Actual Mongo wire driver exercised with stubbed cosockets. Decode outgoing
-- OP_MSG to assert command first, database field, and write-error handling.
local original_tcp=ngx.socket.tcp
local responses={{ok=1,n=1},{ok=1,writeErrors=bson.array({{code=11000,errmsg='duplicate'}})},{ok=0,code=13,errmsg='denied'}}
ngx.socket.tcp=function()
 local sock={}
 function sock:settimeouts() end
 function sock:connect() return true end
 function sock:send(bytes)
  eq(bson.u32(bytes),#bytes); eq(bson.u32(bytes,13),2013); eq(bytes:byte(21),0)
  self.id=bson.u32(bytes,5); self.command=bson.decode(bytes,22)
  eq(self.command['$db'],os.getenv('MONGO_DATABASE') or 'nestledger')
  local res=table.remove(responses,1); self.payload=bson.i32(0)..'\0'..bson.encode(res)
  return #bytes
 end
 function sock:receive(n)
  if n==16 then return bson.i32(#self.payload+16)..bson.i32(888)..bson.i32(self.id)..bson.i32(2013) end
  eq(n,#self.payload); return self.payload
 end
 function sock:setkeepalive() return true end
 function sock:close() end
 return sock
end
local mongo=require 'nestledger.mongo'
eq(mongo.command('ping',{}).n,1)
local ok,err=pcall(mongo.insert,'test',{_id='one'}); eq(ok,false); eq(err.dbcode,11000)
ok,err=pcall(mongo.command,'ping',{}); eq(ok,false); eq(err.dbcode,13)
ngx.socket.tcp=original_tcp
print('PASS: '..total..' assertions (BSON, calendar, validation, PBKDF2, OP_MSG)')
