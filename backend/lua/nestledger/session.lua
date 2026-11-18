local redis=require 'resty.redis'
local json=require 'cjson.safe'
local crypto=require 'nestledger.crypto'
local validate=require 'nestledger.validate'
local M={}; M.ttl=604800
local function fail(err) error({dependency='redis',message=err},0) end
function M.redis(callback)
 local r=redis:new(); r:set_timeout(2000)
 local ok,err=r:connect(os.getenv('REDIS_HOST') or '127.0.0.1',tonumber(os.getenv('REDIS_PORT') or '6379'))
 if not ok then fail(err) end
 local password=os.getenv('REDIS_PASSWORD')
 if password and password~='' then ok,err=r:auth(password); if not ok then r:close(); fail(err) end end
 local db=tonumber(os.getenv('REDIS_DATABASE') or '0')
 if db~=0 then ok,err=r:select(db); if not ok then r:close(); fail(err) end end
 local good,result=xpcall(function() return callback(r) end,function(e) return e end)
 local pooled=r:set_keepalive(30000,100); if not pooled then r:close() end
 if not good then error(result,0) end; return result
end
function M.checked(value,err) if not value then fail(err) end; return value end
function M.token()
 local header=ngx.var.http_cookie or ''; local token; local count=0
 for item in header:gmatch('[^;]+') do local k,v=item:match('^%s*([^=]+)=(.*)$'); if k=='nestledger_session' then token=v; count=count+1 end end
 if count~=1 or not token or #token~=64 or not token:match('^[0-9a-f]+$') then return nil end; return token
end
local secure=(os.getenv('COOKIE_SECURE') or 'false'):lower()=='true'
function M.cookie(token,age)
 ngx.header['Set-Cookie']='nestledger_session='..(token or '')..'; Path=/; Max-Age='..(age or M.ttl)..'; HttpOnly; SameSite=Lax'..(secure and '; Secure' or '')
end
function M.create(user)
 local token=crypto.random(32)
 M.redis(function(r) M.checked(r:setex('session:'..token,M.ttl,assert(json.encode({uid=user._id,version=user.authVersion or 1})))) end)
 local old=M.token(); if old then M.destroy(old,false) end
 M.cookie(token); return token
end
function M.destroy(token,clear)
 if token then M.redis(function(r) M.checked(r:del('session:'..token)) end) end
 if clear~=false then M.cookie(nil,0) end
end
function M.get()
 local token=M.token(); if not token then return nil end
 local raw=M.redis(function(r) return M.checked(r:get('session:'..token)) end)
 if raw==ngx.null then return nil end
 local s=json.decode(raw); if type(s)~='table' or type(s.uid)~='string' then return nil end
 return s,token
end
function M.refresh(token,user)
 M.redis(function(r) M.checked(r:setex('session:'..token,M.ttl,assert(json.encode({uid=user._id,version=user.authVersion})))) end)
 M.cookie(token)
end
function M.limit(namespace,key,max,seconds)
 local n=M.redis(function(r)
  return M.checked(r:eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n",1,'rate:'..namespace..':'..key,seconds))
 end)
 if n>max then ngx.header['Retry-After']=tostring(seconds); validate.error(429,'RATE_LIMITED','操作过于频繁，请稍后再试') end
end
return M
