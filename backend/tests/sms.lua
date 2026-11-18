-- Point at a disposable loopback Redis instance, never a production database.
local sms=require 'nestledger.sms'
local sessions=require 'nestledger.session'
local crypto=require 'nestledger.crypto'
assert(os.getenv('REDIS_HOST')=='127.0.0.1' and tonumber(os.getenv('REDIS_PORT'))~=6379 and tonumber(os.getenv('REDIS_PORT')))
assert(not os.getenv('SMS_HMAC_KEY'))
local function rejects(status,fn)
 local ok,err=pcall(fn); assert(not ok and type(err)=='table' and err.status==status,tostring(err))
end
rejects(503,sms.config)
local c={SMS_HMAC_KEY=crypto.random(32),ALIYUN_ACCESS_KEY_ID='mock',ALIYUN_ACCESS_KEY_SECRET='mock-secret',ALIYUN_SMS_SIGN_NAME='mock name',ALIYUN_SMS_REGISTER_TEMPLATE_CODE='100001',ALIYUN_SMS_PHONE_CHANGE_TEMPLATE_CODE='100002'}
local code,calls=nil,0
local function send(url,body)
 calls=calls+1
 assert(url=='https://dypnsapi.aliyuncs.com/')
 local p=ngx.decode_args(body); assert(p.Action=='SendSmsVerifyCode' and p.Signature and p.ValidTime=='300' and p.ReturnVerifyCode=='false')
 assert(p.TemplateCode==(calls==1 and '100002' or '100001'))
  local params=require('cjson').decode(p.TemplateParam); assert(params.min=='5')
  code=params.code; assert(type(code)=='string' and #code==6 and code:match('^%d+$'))
 return true
end
local ip=crypto.random(12)
local phone='138'..tostring(tonumber(crypto.random(3),16)+100000000):sub(-8)
local phone2='139'..phone:sub(4)
local random=crypto.random
crypto.random=function(bytes) return string.rep('00',bytes) end
local challenge=sms.challenge(c,phone,'phone_change','user1',ip)
crypto.random=random
assert(challenge.expiresIn==120 and challenge.image:match('^data:image/svg%+xml;base64,'))
rejects(400,function() sms.verify_challenge(c,phone,'register',nil,challenge.challengeId,'2A2AA') end)
rejects(400,function() sms.verify_challenge(c,phone,'phone_change','user1',challenge.challengeId,'2A2AA') end)
crypto.random=function(bytes) return string.rep('00',bytes) end
challenge=sms.challenge(c,phone,'phone_change','user1',ip)
crypto.random=random
sms.verify_challenge(c,phone,'phone_change','user1',challenge.challengeId,'2a2aa')
rejects(400,function() sms.verify_challenge(c,phone,'phone_change','user1',challenge.challengeId,'2A2AA') end)
assert(sms.send(c,phone,'phone_change','user1',ip,send).retryAfter==60)
rejects(429,function() sms.send(c,phone,'register',nil,ip,send) end)
assert(calls==1)
rejects(400,function() sms.consume(c,phone,'register',nil,code) end)
rejects(400,function() sms.consume(c,phone,'phone_change','user2',code) end)
local function attempt() return pcall(sms.consume,c,phone,'phone_change','user1',code) end
local a=ngx.thread.spawn(attempt)
local b=ngx.thread.spawn(attempt)
local oka,won_a=ngx.thread.wait(a); local okb,won_b=ngx.thread.wait(b)
assert(oka and okb and won_a~=won_b)
sms.send(c,phone2,'register',nil,ip,send)
local keys=sessions.redis(function(r) return sessions.checked(r:keys('sms:code:*')) end)
assert(#keys==1)
sessions.redis(function(r)
 local ttl=sessions.checked(r:ttl(keys[1])); assert(ttl>295 and ttl<=300)
 local digest=sessions.checked(r:hget(keys[1],'digest')); assert(#digest==64 and digest~=code)
end)
local wrong=code=='000000' and '000001' or '000000'
for _=1,5 do rejects(400,function() sms.consume(c,phone2,'register',nil,wrong) end) end
rejects(400,function() sms.consume(c,phone2,'register',nil,code) end)
for i=1,7 do sms.send(c,'1370000000'..i,'register',nil,ip,send) end
rejects(429,function() sms.send(c,'13700000008','register',nil,ip,send) end)
rejects(503,function() sms.send(c,'13700000009','register',nil,ip..'-failure',function() return false end) end)
print('SMS tests passed (mock transport)')
