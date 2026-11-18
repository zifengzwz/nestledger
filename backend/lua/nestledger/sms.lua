local sessions=require 'nestledger.session'
local v=require 'nestledger.validate'
local crypto=require 'nestledger.crypto'
local hmac=require 'resty.openssl.hmac'
local json=require 'cjson.safe'
local M={}
local function mac(key,data,algorithm)
 local ctx=assert(hmac.new(key,algorithm or 'sha256')); return assert(ctx:final(data))
end
local function unavailable() v.error(503,'SMS_UNAVAILABLE','短信服务暂不可用') end
function M.config(purpose)
 local c={}
 for _,key in ipairs{'SMS_HMAC_KEY','ALIYUN_ACCESS_KEY_ID','ALIYUN_ACCESS_KEY_SECRET','ALIYUN_SMS_SIGN_NAME','ALIYUN_SMS_REGISTER_TEMPLATE_CODE','ALIYUN_SMS_PHONE_CHANGE_TEMPLATE_CODE'} do
  c[key]=os.getenv(key); if not c[key] or not c[key]:match('%S') then unavailable() end
 end
 if #c.SMS_HMAC_KEY<32 then unavailable() end
 if purpose=='reset_password' then
  c.ALIYUN_SMS_RESET_PASSWORD_TEMPLATE_CODE=os.getenv('ALIYUN_SMS_RESET_PASSWORD_TEMPLATE_CODE')
  if not c.ALIYUN_SMS_RESET_PASSWORD_TEMPLATE_CODE or not c.ALIYUN_SMS_RESET_PASSWORD_TEMPLATE_CODE:match('%S') then unavailable() end
 end
 return c
end
local function escape(s) return (s:gsub('[^A-Za-z0-9_%.~%-]',function(ch) return string.format('%%%02X',ch:byte()) end)) end
local endpoint='https://dypnsapi.aliyuncs.com/'
local function transport(url,body)
 local http=require('resty.http').new(); http:set_timeouts(2000,2000,3000)
 local response,err=http:request_uri(url,{method='POST',body=body,ssl_verify=true,headers={['Content-Type']='application/x-www-form-urlencoded'}})
 if not response then
  local message=tostring(err):lower()
  local stage=message:find('timeout',1,true) and 'timeout' or message:find('certificate',1,true) and 'certificate' or message:find('resolv',1,true) and 'dns' or message:find('handshake',1,true) and 'tls' or 'connection'
  ngx.log(ngx.WARN,'SMS provider transport failed: ',stage)
  return false
 end
 local result=json.decode(response.body)
 if response.status==200 and type(result)=='table' and result.Code=='OK' and result.Success~=false then return true end
 local code=type(result)=='table' and result.Code
 if type(code)~='string' or #code>80 or not code:match('^[%w_.%-]+$') then code='unknown' end
 ngx.log(ngx.WARN,'SMS provider rejected request: HTTP ',response.status,', code=',code)
 return false
end
function M.deliver(c,phone,code,purpose,send)
 local template=({register=c.ALIYUN_SMS_REGISTER_TEMPLATE_CODE,phone_change=c.ALIYUN_SMS_PHONE_CHANGE_TEMPLATE_CODE,reset_password=c.ALIYUN_SMS_RESET_PASSWORD_TEMPLATE_CODE})[purpose]
 if not template then unavailable() end
 local params={AccessKeyId=c.ALIYUN_ACCESS_KEY_ID,Action='SendSmsVerifyCode',Version='2017-05-25',Format='JSON',SignatureMethod='HMAC-SHA1',SignatureVersion='1.0',SignatureNonce=crypto.random(16),Timestamp=os.date('!%Y-%m-%dT%H:%M:%SZ'),PhoneNumber=phone,SignName=c.ALIYUN_SMS_SIGN_NAME,TemplateCode=template,TemplateParam=assert(json.encode({code=code,min='5'})),ValidTime='300',ReturnVerifyCode='false'}
 local parts={}; for k,value in pairs(params) do parts[#parts+1]=escape(k)..'='..escape(value) end; table.sort(parts)
 local canonical=table.concat(parts,'&')
 local signature=ngx.encode_base64(mac(c.ALIYUN_ACCESS_KEY_SECRET..'&','POST&%2F&'..escape(canonical),'sha1'))
 return (send or transport)(endpoint,canonical..'&Signature='..escape(signature))
end
local reserve=[[
local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],3600) end
if n>10 then return 0 end
if not redis.call('SET',KEYS[2],ARGV[1],'EX',60,'NX') then return 0 end
return 1
]]
local activate=[[
if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end
redis.call('HMSET',KEYS[2],'digest',ARGV[2],'failures',0)
redis.call('EXPIRE',KEYS[2],300)
return 1
]]
local consume=[[
local digest=redis.call('HGET',KEYS[1],'digest'); if not digest then return 0 end
local mismatch=0
for i=1,#digest do if digest:byte(i)~=ARGV[1]:byte(i) then mismatch=mismatch+1 end end
if mismatch==0 then redis.call('DEL',KEYS[1]); return 1 end
if redis.call('HINCRBY',KEYS[1],'failures',1)>=5 then redis.call('DEL',KEYS[1]) end
return 0
]]
local function eval(script,key_count,...)
 local args={...}; return sessions.redis(function(r) return sessions.checked(r:eval(script,key_count,unpack(args))) end)
end
local function keys(c,phone,purpose,uid)
 local scope=phone..':'..purpose..':'..(uid or '')
 return 'sms:code:'..crypto.hex(mac(c.SMS_HMAC_KEY,'scope:'..scope)),scope
end
local function digest(c,scope,code) return crypto.hex(mac(c.SMS_HMAC_KEY,'code:'..scope..':'..code)) end
local function challenge_digest(c,id,phone,purpose,uid,code)
 return crypto.hex(mac(c.SMS_HMAC_KEY,table.concat({'captcha',id,phone,purpose,uid or '',code},':')))
end
-- Bitmap glyphs rendered as paths, not SVG text containing the answer.
local glyphs={A={14,17,17,31,17,17,17},B={30,17,17,30,17,17,30},E={31,16,16,30,16,16,31},H={17,17,17,31,17,17,17},K={17,18,20,24,20,18,17},M={17,27,21,21,17,17,17},N={17,25,21,19,17,17,17},R={30,17,17,30,20,18,17},W={17,17,17,21,21,27,17},X={17,17,10,4,10,17,17},Y={17,17,10,4,4,4,4},['2']={14,17,1,2,4,8,31},['3']={30,1,1,14,1,1,30},['4']={2,6,10,18,31,2,2},['5']={31,16,16,30,1,1,30},['6']={14,16,16,30,17,17,14},['7']={31,1,2,4,8,8,8},['8']={14,17,17,14,17,17,14},['9']={14,17,17,15,1,1,14}}
function M.challenge(c,phone,purpose,uid,ip)
 sessions.limit('sms_challenge',ip,60,3600)
 local id=crypto.random(16)
 local letters='ABEHKMNRWXY'; local digits='23456789'
 local function pick(chars) local n=tonumber(crypto.random(2),16)%#chars+1; return chars:sub(n,n) end
 local chars={pick(letters),pick(digits),pick(letters),pick(digits),pick(letters)}
 for i=#chars,2,-1 do local j=tonumber(crypto.random(2),16)%i+1; chars[i],chars[j]=chars[j],chars[i] end
 local svg={'<svg xmlns="http://www.w3.org/2000/svg" width="150" height="48" viewBox="0 0 150 48"><rect width="150" height="48" fill="#f5f5f5"/>'}
 for i=1,6 do svg[#svg+1]=string.format('<path d="M0 %d Q75 %d 150 %d" fill="none" stroke="#999"/>',i*7,tonumber(crypto.random(1),16)%48,48-i*6) end
 for i,ch in ipairs(chars) do
  local x=i*27-16; local dots={}
  for y,row in ipairs(glyphs[ch]) do for col=0,4 do
   if math.floor(row/2^(4-col))%2==1 then dots[#dots+1]=string.format('M%d %dh3v3h-3Z',x+col*3,12+(y-1)*3) end
  end end
  svg[#svg+1]=string.format('<path transform="rotate(%d %d 24)" fill="#161616" d="%s"/>',tonumber(crypto.random(1),16)%33-16,x+7,table.concat(dots))
 end
 svg[#svg+1]='</svg>'
 local digest=challenge_digest(c,id,phone,purpose,uid,table.concat(chars))
 sessions.redis(function(r) sessions.checked(r:setex('sms:challenge:'..id,120,digest)) end)
 return {challengeId=id,image='data:image/svg+xml;base64,'..ngx.encode_base64(table.concat(svg)),expiresIn=120}
end
function M.verify_challenge(c,phone,purpose,uid,id,answer)
 if type(id)~='string' or #id~=32 or not id:match('^[0-9a-f]+$') or type(answer)~='string' or #answer~=5 or not answer:match('^[A-Za-z0-9]+$') then
  v.error(400,'INVALID_SMS_CHALLENGE','请填写五位图形验证码')
 end
 local stored=eval([[local val=redis.call('GET',KEYS[1]); if val then redis.call('DEL',KEYS[1]) end; return val]],1,'sms:challenge:'..id)
 if type(stored)~='string' or not crypto.equal(stored,challenge_digest(c,id,phone,purpose,uid,answer:upper())) then
  v.error(400,'INVALID_SMS_CHALLENGE','图形验证码错误或已失效，请换一张')
 end
end
function M.send(c,phone,purpose,uid,ip,send)
 local key,scope=keys(c,phone,purpose,uid)
 local cooldown='sms:cooldown:'..phone; local nonce=crypto.random(16)
 if eval(reserve,2,'sms:ip:'..ip,cooldown,nonce)~=1 then v.error(429,'SMS_RATE_LIMITED','短信请求过于频繁，请稍后再试') end
 local number
 repeat number=tonumber(crypto.random(3),16) until number<16000000
 local code=string.format('%06d',number%1000000)
 local ok,sent=pcall(M.deliver,c,phone,code,purpose,send)
 if not ok or sent~=true then unavailable() end
 if eval(activate,2,cooldown,key,nonce,digest(c,scope,code))~=1 then unavailable() end
 return {retryAfter=60}
end
function M.consume(c,phone,purpose,uid,code)
 if type(code)~='string' or not code:match('^[0-9][0-9][0-9][0-9][0-9][0-9]$') then v.bad('请输入六位短信验证码') end
 local key,scope=keys(c,phone,purpose,uid)
 if eval(consume,1,key,digest(c,scope,code))~=1 then v.error(400,'INVALID_SMS_CODE','短信验证码错误或已失效') end
end
return M
