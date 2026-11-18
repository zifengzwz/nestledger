local bson=require 'nestledger.bson'
local kdf=require 'resty.openssl.kdf'
local hmac=require 'resty.openssl.hmac'
local digest=require 'resty.openssl.digest'
local random=require 'resty.random'
local equal=require('nestledger.crypto').equal
local bxor=require('bit').bxor
local M={}
local function attributes(payload)
 assert(type(payload)=='string' and #payload<=4096,'invalid SCRAM payload')
 local out={}
 for part in (payload..','):gmatch('([^,]*),') do
  local key,value=part:match('^([a-zA-Z])=(.+)$')
  assert(key and not out[key],'invalid SCRAM attribute')
  out[key]=value
 end
 assert(not out.m and not out.e,'SCRAM exchange rejected')
 return out
end
local function mac(key,data)
 local ctx=assert(hmac.new(key,'sha256'))
 return assert(ctx:final(data))
end
function M.authenticate(command,source,user,password)
 -- Printable ASCII is unchanged by SASLprep. Reject other passwords rather
 -- than silently deriving the wrong key without Unicode SASLprep support.
 assert(not password:find('[^ -~]'),'MongoDB password must be printable ASCII')
 assert(not user:find('%c'),'invalid MongoDB username')
 local nonce=ngx.encode_base64(assert(random.bytes(24,true)))
 local first='n='..user:gsub('=','=3D'):gsub(',','=2C')..',r='..nonce
 local start=command('saslStart',{mechanism='SCRAM-SHA-256',payload=bson.binary('n,,'..first),options={skipEmptyExchange=true}},source)
 local id=start.conversationId
 assert(type(id)=='number' and id%1==0 and start.done==false,'invalid SCRAM start response')
 local fields=attributes(start.payload)
 assert(fields.r and fields.r:sub(1,#nonce)==nonce and #fields.r>#nonce and not fields.r:find('[^!-~]'),'invalid SCRAM nonce')
 local salt=fields.s and ngx.decode_base64(fields.s)
 local count=fields.i and fields.i:match('^[1-9][0-9]*$') and tonumber(fields.i)
 assert(salt and #salt>0 and count and count>=4096 and count<=1000000,'invalid SCRAM parameters')
 local salted=assert(kdf.derive{type=kdf.PBKDF2,outlen=32,pass=password,salt=salt,md='sha256',pbkdf2_iter=count})
 local key=mac(salted,'Client Key')
 local stored=assert(assert(digest.new('sha256')):final(key))
 local final='c=biws,r='..fields.r
 local transcript=first..','..start.payload..','..final
 local signature=mac(stored,transcript)
 local proof={}
 for i=1,#key do proof[i]=string.char(bxor(key:byte(i),signature:byte(i))) end
 local function continue(payload)
  local response=command('saslContinue',{conversationId=id,payload=bson.binary(payload)},source)
  assert(response.conversationId==id and type(response.done)=='boolean','invalid SCRAM continuation')
  return response
 end
 local response=continue(final..',p='..ngx.encode_base64(table.concat(proof)))
 local verifier=attributes(response.payload).v
 assert(verifier and equal(ngx.decode_base64(verifier),mac(mac(salted,'Server Key'),transcript)),'invalid SCRAM server signature')
 if not response.done then
  response=continue('')
  assert(response.done and response.payload=='','invalid SCRAM completion')
 end
end
return M
