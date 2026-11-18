-- Run from the project root: resty -I backend/lua backend/tests/mongo_scram.lua
local bson=require 'nestledger.bson'
local scram=require 'nestledger.mongo_scram'
require('resty.random').bytes=function(n,strong)
 assert(n==24 and strong)
 return string.rep('\0',n)
end
local nonce=string.rep('A',32)
local verifier='RyUf2pIyG7lvfhKxdsMz7UkbgqN1ygYo6v7SHsNz1MU='
local function run(case)
 local calls=0
 local ok=pcall(scram.authenticate,function(name,doc,source)
  calls=calls+1
  assert(source=='admin')
  local encoded=bson.encode({payload=doc.payload},'payload')
  assert(encoded:byte(5)==5 and encoded:byte(18)==0)
  local payload=bson.decode(encoded).payload
  if calls==1 then
   assert(name=='saslStart' and doc.mechanism=='SCRAM-SHA-256' and doc.options.skipEmptyExchange)
   assert(payload=='n,,n=u=2C=3D,r='..nonce)
   return {conversationId=7,done=false,payload='r='..(case=='nonce' and 'bad' or nonce..'server')..',s=c2FsdA==,i=4096'}
  end
  assert(name=='saslContinue' and doc.conversationId==7)
  if calls==2 then
   assert(payload=='c=biws,r='..nonce..'server,p=6emh93Sp7t2n/QMlLCkjIQzMZWqID4pCEiiXFqG+SxI=')
   return {conversationId=7,done=case~='legacy',payload='v='..(case=='verifier' and 'YQ==' or verifier)}
  end
  assert(calls==3 and payload=='')
  return {conversationId=7,done=true,payload=''}
 end,'admin','u,=','password')
 return ok,calls
end
for case,expected in pairs({normal=2,legacy=3,nonce=1,verifier=2}) do
 local ok,calls=run(case)
 assert(ok==(case=='normal' or case=='legacy') and calls==expected,case)
end
print('MongoDB SCRAM-SHA-256 fixtures passed')
