-- Minimal BSON codec for MongoDB OP_MSG. Int64 values retain their raw bytes
-- (cursor IDs must never pass through an imprecise Lua double).
local ffi = require 'ffi'
local M = {}
local array_mt, int64_mt, ordered_mt, binary_mt = {}, {}, {}, {}
function M.binary(raw) assert(type(raw)=='string'); return setmetatable({raw=raw}, binary_mt) end
M.null = require('cjson').null
function M.array(t) return setmetatable(t or {}, array_mt) end
-- MongoDB index keys and multi-key sort precedence are order-sensitive.
-- Ordinary Lua pairs() order can differ between workers and restarts.
function M.ordered(pairs_list) return setmetatable(pairs_list, ordered_mt) end
function M.int64(raw) assert(#raw == 8); return setmetatable({raw=raw}, int64_mt) end
function M.iszero(v) return type(v)=='number' and v==0 or type(v)=='table' and v.raw=='\0\0\0\0\0\0\0\0' end
function M.i32(n)
 n=n%4294967296
 local b={}; for i=1,4 do b[i]=string.char(n%256); n=math.floor(n/256) end
 return table.concat(b)
end
function M.u32(s,p)
 p=p or 1; assert(p+3<=#s,'truncated int32')
 local a,b,c,d=s:byte(p,p+3); return a+b*256+c*65536+d*16777216
end
local function double(n) local v=ffi.new('double[1]',n); return ffi.string(v,8) end
local encode
local function element(k,v)
 assert(type(k)=='string' and not k:find('\0',1,true),'invalid BSON key')
 local typ,raw
 if v==M.null then typ,raw=10,''
 elseif type(v)=='string' then typ,raw=2,M.i32(#v+1)..v..'\0'
 elseif type(v)=='boolean' then typ,raw=8,v and '\1' or '\0'
 elseif type(v)=='number' then
  assert(v==v and v~=math.huge and v~=-math.huge,'invalid BSON number')
  if v%1==0 and v>=-2147483648 and v<=2147483647 then typ,raw=16,M.i32(v) else typ,raw=1,double(v) end
 elseif type(v)=='table' then
  if getmetatable(v)==binary_mt then typ,raw=5,M.i32(#v.raw)..'\0'..v.raw
   elseif getmetatable(v)==int64_mt then typ,raw=18,v.raw
  else typ=getmetatable(v)==array_mt and 4 or 3; raw=encode(v,typ==4) end
 else error('unsupported BSON value '..type(v)) end
 return string.char(typ)..k..'\0'..raw
end
encode=function(t,arr,first)
 local out={}
 if getmetatable(t)==ordered_mt then
  for _,pair in ipairs(t) do out[#out+1]=element(pair[1],pair[2]) end
 elseif arr then for i,v in ipairs(t) do out[#out+1]=element(tostring(i-1),v) end
 else
  if first then assert(t[first]~=nil); out[#out+1]=element(first,t[first]) end
  for k,v in pairs(t) do if k~=first then out[#out+1]=element(k,v) end end
 end
 local body=table.concat(out)..'\0'; return M.i32(#body+4)..body
end
function M.encode(t,first) return encode(t,false,first) end
local decode
local function cstring(s,p,finish)
 local z=s:find('\0',p,true); assert(z and z<finish,'invalid BSON cstring'); return s:sub(p,z-1),z+1
end
decode=function(s,p,arr)
 p=p or 1; local len=M.u32(s,p); assert(len>=5 and p+len-1<=#s,'invalid BSON length')
 local finish=p+len-1; p=p+4; local out=arr and M.array() or {}
 while p<finish do
  local typ=s:byte(p); p=p+1; local k; k,p=cstring(s,p,finish); local v
  if typ==1 then assert(p+7<finish); local n=ffi.new('double[1]'); ffi.copy(n,s:sub(p,p+7),8); v=tonumber(n[0]); p=p+8
  elseif typ==2 or typ==13 or typ==14 then local n=M.u32(s,p); p=p+4; assert(n>=1 and p+n-1<finish and s:byte(p+n-1)==0); v=s:sub(p,p+n-2); p=p+n
  elseif typ==3 or typ==4 then v,p=decode(s,p,typ==4)
  elseif typ==8 then assert(s:byte(p)==0 or s:byte(p)==1); v=s:byte(p)==1; p=p+1
  elseif typ==10 or typ==6 then v=M.null
  elseif typ==16 then v=M.u32(s,p); if v>=2147483648 then v=v-4294967296 end; p=p+4
  elseif typ==18 or typ==9 or typ==17 then assert(p+7<finish); v=M.int64(s:sub(p,p+7)); p=p+8
  elseif typ==7 then assert(p+11<finish); v=(s:sub(p,p+11):gsub('.',function(c) return string.format('%02x',c:byte()) end)); p=p+12
  elseif typ==5 then local n=M.u32(s,p); p=p+5; assert(p+n<=finish); v=s:sub(p,p+n-1); p=p+n
  elseif typ==11 then local a,b; a,p=cstring(s,p,finish); b,p=cstring(s,p,finish); v={pattern=a,options=b}
  elseif typ==127 or typ==255 then v=M.null
  else error('unsupported BSON type '..typ) end
  if arr then local i=tonumber(k); assert(i and i>=0 and i%1==0); out[i+1]=v else out[k]=v end
 end
 assert(p==finish and s:byte(p)==0,'invalid BSON terminator'); return out,finish+1
end
M.decode=decode
return M
