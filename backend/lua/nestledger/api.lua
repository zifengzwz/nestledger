local json=require 'cjson.safe'
-- Keep request array/object identity, including [] vs {}, without changing
-- the shared CJSON instance used by responses and session serialization.
local body_json=json.new()
body_json.decode_array_with_array_mt(true)
local db=require 'nestledger.mongo'
local bson=require 'nestledger.bson'
local v=require 'nestledger.validate'
local date=require 'nestledger.date'
local crypto=require 'nestledger.crypto'
local sessions=require 'nestledger.session'
local sms=require 'nestledger.sms'
local M={}
local function array(t) return #t==0 and json.empty_array or t end
local function now() return date.iso(ngx.now()) end
local function user_out(u) return {id=u._id,phone=u.phone,name=u.name,createdAt=u.createdAt,theme=u.theme or 'clay'} end
local function book_out(b,read_only,owner)
 local out={id=b._id,name=b.name,type=b.type,ownerId=b.ownerId,memberIds=array(b.memberIds or {}),createdAt=b.createdAt,readOnly=read_only==true}
 -- A read-only recipient must be able to tell whose ledger it is.
 if read_only and owner then out.ownerName=owner.name; out.ownerPhone=owner.phone end
 return out
end
local function invite_out(i) return {id=i._id,bookId=i.bookId,bookName=i.bookName,inviterName=i.inviterName,phone=i.phone,status=i.status,createdAt=i.createdAt} end
local function record_out(r)
 return {id=r._id,bookId=r.bookId,createdBy=r.createdBy,type=r.type,amountCents=r.amountCents,category=r.category,occurredAt=r.occurredAt,note=r.note,paymentSource=r.paymentSource,createdAt=r.createdAt,updatedAt=r.updatedAt}
end
local function contains(t,id) for _,x in ipairs(t or {}) do if x==id then return true end end; return false end
local function users_by_ids(ids)
 local map,order,seen={},{},{}
 for _,id in ipairs(ids or {}) do
  if id and not seen[id] then seen[id]=true; order[#order+1]=id end
 end
 if #order>0 then
  for _,x in ipairs(db.find('users',{_id={['$in']=bson.array(order)}})) do map[x._id]=x end
 end
 return map,order
end
local function missing() v.error(404,'NOT_FOUND','请求的资源不存在') end
local function denied() v.error(403,'FORBIDDEN','没有权限进行此操作') end
local function conflict(message) v.error(409,'CONFLICT',message) end
local function auth()
 local s,token=sessions.get()
 if not s then v.error(401,'UNAUTHORIZED','请先登录') end
 local u=db.one('users',{_id=s.uid})
 if not u or s.version~=(u.authVersion or 1) then sessions.destroy(token); v.error(401,'UNAUTHORIZED','登录已失效，请重新登录') end
 return u,token
end
local function is_member(b,u) return b.ownerId==u._id or (b.type=='family' and contains(b.memberIds,u._id)) end
local function share_status(s) return s.status or 'accepted' end
-- Legacy rows created before accept/reject existed have no status and remain accepted.
local function accepted_share_filter()
 return {['$or']=bson.array({{status='accepted'},{status={['$exists']=false}}})}
end
local function book_access(id,u,owner)
 v.id(id); local b=db.one('books',{_id=id,deleting={['$ne']=true}}); if not b then missing() end
 if not is_member(b,u) then denied() end
 if owner and b.ownerId~=u._id then denied() end
 return b
end
-- Read-only access: book owners/members plus users the owner explicitly shared it with.
local function book_view(id,u)
 v.id(id); local b=db.one('books',{_id=id,deleting={['$ne']=true}}); if not b then missing() end
 if not is_member(b,u) then
  local filter=accepted_share_filter(); filter.bookId=id; filter.userId=u._id
  if not db.one('bookShares',filter) then denied() end
 end
 return b
end
local function mutation_guard()
 local origin=ngx.var.http_origin
 local configured=os.getenv('APP_ORIGIN') or 'http://localhost:8080'
 if origin~=configured then v.error(403,'CSRF_REJECTED','请求来源不可信') end
 local ct=ngx.var.http_content_type or ''
 if not ct:lower():match('^application/json%s*;?') or not (ct:lower()=='application/json' or ct:lower():match('^application/json%s*;')) then
  v.error(415,'UNSUPPORTED_MEDIA_TYPE','请求必须使用application/json')
 end
end
local function body(max_bytes)
 max_bytes=max_bytes or 16384
 local length=tonumber(ngx.var.http_content_length)
 if length and length>max_bytes then v.error(413,'BODY_TOO_LARGE','请求内容过大') end
 ngx.req.read_body(); local raw=ngx.req.get_body_data()
 if not raw then
  local file=ngx.req.get_body_file(); if file then local f=io.open(file,'rb'); if not f then v.bad('请求体读取失败') end; raw=f:read(max_bytes+1); f:close() end
 end
 if not raw or raw=='' then return {} end
 if #raw>max_bytes then v.error(413,'BODY_TOO_LARGE','请求内容过大') end
 -- Distinguish object from [] and null even with Lua CJSON's table decoder.
 if not raw:match('^%s*{') then v.bad('请求内容必须为JSON对象') end
 local data=body_json.decode(raw); if type(data)~='table' then v.bad('JSON格式不正确') end
 return data
end
local function query(allowed)
 local args,err=ngx.req.get_uri_args(30); if err=='truncated' then v.bad('查询参数过多') end
 for k,value in pairs(args) do if not allowed[k] or type(value)~='string' then v.bad('查询参数不正确') end end
 return args
end
local function duplicate_safe(fn,message)
 local ok,res=pcall(fn)
 if not ok then if type(res)=='table' and res.dbcode==11000 then conflict(message) end; error(res,0) end
 return res
end
local function index_ready()
 if ngx.shared.nestledger:get('indexes_ready_shares_v1') then return end
 local lock=require('resty.lock'):new('nestledger',{timeout=5,exptime=20})
 local elapsed,err=lock:lock('indexes_lock'); if not elapsed then error({dependency='mongo',message=err},0) end
 if not ngx.shared.nestledger:get('indexes_ready_shares_v1') then
  local ok,result=pcall(db.indexes); if not ok then lock:unlock(); error(result,0) end
  ngx.shared.nestledger:set('indexes_ready_shares_v1',true,300)
 end
 lock:unlock()
end
local function available_phone(phone)
 if db.one('users',{phone=phone}) then conflict('该手机号已注册') end
end
local function sms_phone(value)
 local phone=v.phone(value)
 if not phone:match('^1[3-9]') then v.bad('请输入有效的中国大陆手机号') end
 return phone
end
local function reset_scope(u)
 return u and (u._id..':'..u.authVersion) or nil
end
local function sms_route(t,send)
 v.fields(t,send and {phone=true,purpose=true,challengeId=true,challengeCode=true} or {phone=true,purpose=true})
 local phone=sms_phone(t.phone)
 local purpose=v.enum(t.purpose,'用途',{'register','phone_change','reset_password'})
 local u=purpose=='phone_change' and auth() or nil
 local c=sms.config(purpose)
 if not send then return sms.challenge(c,phone,purpose,u and u._id,ngx.var.remote_addr) end
 sms.verify_challenge(c,phone,purpose,u and u._id,t.challengeId,t.challengeCode)
 if purpose=='reset_password' then
  local account=db.one('users',{phone=phone})
  return sms.send(c,phone,purpose,reset_scope(account),ngx.var.remote_addr,not account and function() return true end or nil)
 end
 available_phone(phone)
 return sms.send(c,phone,purpose,u and u._id,ngx.var.remote_addr)
end
local function password_reset(t)
 v.fields(t,{phone=true,newPassword=true,smsCode=true})
 local phone=sms_phone(t.phone); local new=v.password(t.newPassword); local c=sms.config('reset_password')
 sessions.limit('password_reset',ngx.var.remote_addr,30,3600)
 local u=db.one('users',{phone=phone})
 if not u then v.error(400,'INVALID_SMS_CODE','短信验证码错误或已失效') end
 sms.consume(c,phone,'reset_password',reset_scope(u),t.smsCode)
 local updated=db.modify('users',{_id=u._id,phone=phone,authVersion=u.authVersion},{['$set']={password=crypto.hash(new),phoneVerifiedAt=now()},['$inc']={authVersion=1}})
 if not updated then conflict('账户已更新，请重新获取验证码') end
 return {ok=true}
end
local function register(t)
 local c=sms.config()
 v.fields(t,{phone=true,password=true,name=true,smsCode=true}); local phone=sms_phone(t.phone); local password=v.password(t.password); local name=v.text(t.name,'昵称',1,40,true)
 sessions.limit('register',ngx.var.remote_addr,30,3600)
 available_phone(phone)
 sms.consume(c,phone,'register',nil,t.smsCode)
 local u={_id=crypto.random(12),phone=phone,name=name,password=crypto.hash(password),authVersion=1,createdAt=now(),phoneVerifiedAt=now()}
 duplicate_safe(function() return db.insert('users',u) end,'该手机号已注册')
 sessions.create(u); return user_out(u),201
end
local function login(t)
 v.fields(t,{phone=true,password=true}); local phone=v.phone(t.phone); local password=v.password(t.password)
 sessions.limit('login_ip',ngx.var.remote_addr,50,900); sessions.limit('login_phone',phone,15,900)
 local u=db.one('users',{phone=phone}); local good
 if u then good=crypto.verify(password,u.password) else crypto.dummy(password) end
 if not good then v.error(401,'INVALID_CREDENTIALS','手机号或密码不正确') end
 sessions.create(u); return user_out(u)
end
local function password_change(t,u,token)
 v.fields(t,{currentPassword=true,newPassword=true}); local old=v.password(t.currentPassword); local new=v.password(t.newPassword)
 sessions.limit('credentials',u._id,15,900)
 if not crypto.verify(old,u.password) then v.error(401,'INVALID_CREDENTIALS','当前密码不正确') end
 local updated=db.modify('users',{_id=u._id,authVersion=u.authVersion},{['$set']={password=crypto.hash(new)},['$inc']={authVersion=1}})
 if not updated then conflict('账户已更新，请重新登录') end
 sessions.refresh(token,updated); return {ok=true}
end
local function phone_change(t,u)
 local c=sms.config()
 v.fields(t,{phone=true,currentPassword=true,smsCode=true}); local phone=sms_phone(t.phone); local password=v.password(t.currentPassword)
 sessions.limit('credentials',u._id,15,900)
 if not crypto.verify(password,u.password) then v.error(401,'INVALID_CREDENTIALS','当前密码不正确') end
 available_phone(phone)
 sms.consume(c,phone,'phone_change',u._id,t.smsCode)
 local updated=duplicate_safe(function() return db.modify('users',{_id=u._id,authVersion=u.authVersion,phone=u.phone},{['$set']={phone=phone,phoneVerifiedAt=now()}}) end,'该手机号已注册')
 if not updated then conflict('账户已更新，请重新登录') end; return user_out(updated)
end
local function settings_change(t,u)
 v.fields(t,{theme=true})
 local theme=v.enum(t.theme,'主题',{'clay','forest','blue','plum','coral','mango','mint','berry','contrast-ink','contrast-navy','contrast-wine'})
 -- Preference-only update: no password, phone, authVersion or session changes.
 local updated=db.modify('users',{_id=u._id,authVersion=u.authVersion},{['$set']={theme=theme}})
 if not updated then v.error(401,'UNAUTHORIZED','账户已更新，请重新登录') end
 return user_out(updated)
end
local option_defaults={
 expenseCategories={'餐饮美食','日用百货','交通出行','住房物业','购物消费','休闲娱乐','医疗健康','教育学习','人情往来','其他支出'},
 incomeCategories={'工资薪酬','奖金收入','投资理财','兼职收入','礼金收入','其他收入'},
 paymentSources={'微信','支付宝','银行卡','现金','其他'}
}
local option_fields={expenseCategory='expenseCategories',incomeCategory='incomeCategories',paymentSource='paymentSources'}
local option_icon_defaults={expenseCategory='tag',incomeCategory='coins',paymentSource='wallet'}
local option_icons={'utensils','shopping-basket','bus-front','house','shopping-bag','gamepad','heart-pulse','graduation-cap','gift','circle-ellipsis','briefcase-business','award','chart','laptop','coins','message-circle','qr-code','credit-card','banknote','wallet','tag','paw-print','coffee','baby','smartphone','plane','bike','car','book-open','music','camera','sparkles','heart','shirt','wrench'}
local function record_options(u)
 local out={icons={}}
 for kind,field in pairs(option_fields) do
  local list,icons={},{}
  for _,name in ipairs(option_defaults[field]) do list[#list+1]=name end
  for _,name in ipairs((u.customOptions or {})[field] or {}) do
   list[#list+1]=name; icons[name]=option_icon_defaults[kind]
  end
  -- Legacy custom names without metadata retain a useful kind-specific icon.
  -- Names are JSON map keys only, never interpolated into Mongo field paths.
  for _,entry in ipairs((u.customOptionIcons or {})[field] or {}) do
   if icons[entry.name] and contains(option_icons,entry.icon) then icons[entry.name]=entry.icon end
  end
  out[field]=array(list); out.icons[kind]=icons -- Empty mappings encode as {}, not [].
 end
 return out
end
local function record_option_create(t,u)
 v.fields(t,{kind=true,name=true,icon=true})
 local kind=v.enum(t.kind,'选项类型',{'expenseCategory','incomeCategory','paymentSource'})
 local name=v.text(t.name,'选项名称',1,40,true); local field=option_fields[kind]
 local icon=t.icon==nil and option_icon_defaults[kind] or v.enum(t.icon,'图标',option_icons)
 if contains(option_defaults[field],name) or contains((u.customOptions or {})[field],name) then conflict('该选项已存在') end
 -- Check capacity and uniqueness in the same Mongo write, not just the
 -- request snapshot: concurrent additions must not exceed 50 or duplicate.
 local path='customOptions.'..field
 local filter={_id=u._id,authVersion=u.authVersion,[path]={['$ne']=name},[path..'.49']={['$exists']=false}}
 -- Both BSON arrays change in one atomic document update, so losing races
 -- cannot leave orphan icons or overwrite the winning request's selection.
 local updated=db.modify('users',filter,{['$addToSet']={[path]=name},['$push']={['customOptionIcons.'..field]={name=name,icon=icon}}})
 if not updated then
  local current=db.one('users',{_id=u._id,authVersion=u.authVersion})
  if not current then conflict('账户已更新，请重新登录') end
  if contains((current.customOptions or {})[field],name) then conflict('该选项已存在') end
  conflict('每种最多添加50个自定义选项')
 end
 return record_options(updated),201
end
local function books_available(u)
 local filter={deleting={['$ne']=true},['$or']=bson.array({{ownerId=u._id},{type='family',memberIds=u._id}})}
 local list=db.find('books',filter,{sort=bson.ordered({{'createdAt',-1},{'_id',-1}})})
 local owners={}
 local seen,ids={},{}
 for _,b in ipairs(list) do seen[b._id]=true end
 -- Books explicitly shared read-only with this account are listed after the
 -- account's own books; the owner keeps full control and can revoke at any time.
 local shared_filter=accepted_share_filter(); shared_filter.userId=u._id
 for _,s in ipairs(db.find('bookShares',shared_filter,{sort=bson.ordered({{'createdAt',-1},{'_id',-1}})})) do
  if not seen[s.bookId] then seen[s.bookId]=true; ids[#ids+1]=s.bookId end
 end
 if #ids>0 then
  local by_id,owner_ids={},{}
  for _,b in ipairs(db.find('books',{_id={['$in']=bson.array(ids)},deleting={['$ne']=true}})) do by_id[b._id]=b end
  for _,id in ipairs(ids) do
   local b=by_id[id]
   if b then list[#list+1]=b; owner_ids[#owner_ids+1]=b.ownerId end
  end
  if #owner_ids>0 then
   for _,x in ipairs(db.find('users',{_id={['$in']=bson.array(owner_ids)}})) do owners[x._id]=x end
  end
 end
 return list,owners
end
local function books_list(u)
 local list,owners=books_available(u); local by_id,out={},{}
 for _,b in ipairs(list) do by_id[b._id]=b end
 -- Removed/deleted books in old preferences are ignored. New accessible books
 -- follow the saved order in the original createdAt DESC / id DESC order.
 for _,id in ipairs(u.bookOrder or {}) do
  local b=by_id[id]; if b then out[#out+1]=book_out(b,not is_member(b,u),owners[b.ownerId]); by_id[id]=nil end
 end
 for _,b in ipairs(list) do if by_id[b._id] then out[#out+1]=book_out(b,not is_member(b,u),owners[b.ownerId]) end end
 return array(out)
end
local function books_order(t,u)
 v.fields(t,{bookIds=true})
 local ids=t.bookIds
 if type(ids)~='table' or getmetatable(ids)~=body_json.array_mt then v.bad('bookIds必须为JSON数组') end
 local seen={}
 for _,id in ipairs(ids) do
  v.id(id); if seen[id] then v.bad('bookIds不能包含重复账本') end; seen[id]=true
 end
 local list,owners=books_available(u); local by_id,out={},{}
 for _,b in ipairs(list) do by_id[b._id]=b end
 for _,id in ipairs(ids) do
  local b=by_id[id]
  if not b then
   -- A real but inaccessible book is forbidden; stale/nonexistent IDs mean
   -- the accessible set changed and the caller must refresh before retrying.
   if db.one('books',{_id=id,deleting={['$ne']=true}}) then denied() end
   conflict('账本列表已变化，请刷新后重试')
  end
  out[#out+1]=book_out(b,not is_member(b,u),owners[b.ownerId])
 end
 if #ids~=#list then conflict('账本列表已变化，请刷新后重试') end
 local updated=db.modify('users',{_id=u._id,authVersion=u.authVersion},{['$set']={bookOrder=bson.array(ids)}})
 if not updated then conflict('账户已更新，请重新登录') end
 return array(out)
end
local function book_create(t,u)
 v.fields(t,{name=true,type=true}); local b={_id=crypto.random(12),name=v.text(t.name,'账本名称',1,60,true),type=v.enum(t.type,'账本类型',{'personal','family'}),ownerId=u._id,memberIds=bson.array({u._id}),createdAt=now()}
 db.insert('books',b); return book_out(b),201
end
local function book_delete(id,u)
 v.id(id)
 local existing=db.one('books',{_id=id}); if not existing then missing() end
 if existing.ownerId~=u._id then denied() end
 -- A retry can finish cleanup after a transient dependency failure.
 local b=db.modify('books',{_id=id,ownerId=u._id},{['$set']={deleting=true}})
 if not b then missing() end
 db.delete('records',{bookId=id},true); db.delete('invitations',{bookId=id},true); db.delete('bookShares',{bookId=id},true); db.delete('books',{_id=id,ownerId=u._id})
 return {ok=true}
end
local function book_members(id,u)
 local b=book_access(id,u); local ids=b.memberIds or {b.ownerId}; local list=db.find('users',{_id={['$in']=bson.array(ids)}})
 local out={}; for _,member in ipairs(list) do out[#out+1]=user_out(member) end
 return {ownerId=b.ownerId,members=array(out)}
end
local function member_remove(id,member,u)
 local b=book_access(id,u); v.id(member)
 if member==b.ownerId then conflict('账本所有者不能退出账本') end
 if u._id~=b.ownerId and u._id~=member then denied() end
 if b.type~='family' then denied() end
 if not contains(b.memberIds,member) then missing() end
 db.update('books',{_id=id,deleting={['$ne']=true}},{['$pull']={memberIds=member}})
 return {ok=true}
end
local function invite_create(id,t,u)
 local b=book_access(id,u,true); if b.type~='family' then conflict('个人账本不能邀请成员') end
 v.fields(t,{phone=true}); local phone=v.phone(t.phone)
 if phone==u.phone then conflict('不能邀请自己') end
 local target=db.one('users',{phone=phone})
 if not target then v.error(404,'USER_NOT_REGISTERED','该手机号尚未注册，请对方先注册后再邀请') end
 if target._id==b.ownerId or contains(b.memberIds,target._id) then conflict('该用户已经是账本成员') end
 local i={_id=crypto.random(12),bookId=id,bookName=b.name,inviterName=u.name,inviterId=u._id,phone=phone,status='pending',createdAt=now()}
 duplicate_safe(function() return db.insert('invitations',i) end,'该手机号已有待处理邀请')
 -- Compensate an owner deleting the book concurrently with insertion.
 if not db.one('books',{_id=id,deleting={['$ne']=true}}) then db.delete('invitations',{_id=i._id}); missing() end
 return invite_out(i),201
end
local function invitations_list(u)
 local out={}; local list=db.find('invitations',{phone=u.phone,status='pending'},{sort=bson.ordered({{'createdAt',-1},{'_id',-1}})})
 for _,i in ipairs(list) do
  local b=db.one('books',{_id=i.bookId,deleting={['$ne']=true}})
  if b and b.type=='family' and b.ownerId==i.inviterId and b.ownerId~=u._id and not contains(b.memberIds,u._id) then i.bookName=b.name; out[#out+1]=invite_out(i) end
 end; return array(out)
end
local function invite_action(id,u,accept)
 v.id(id); local i=db.one('invitations',{_id=id}); if not i then missing() end
 if i.phone~=u.phone then denied() end
 if i.status~='pending' then conflict('邀请已处理') end
 -- Re-read the identity from Mongo, not from an earlier request/session snapshot.
 local current=db.one('users',{_id=u._id,phone=i.phone,authVersion=u.authVersion}); if not current then denied() end
 if not accept then
  if db.update('invitations',{_id=id,phone=current.phone,status='pending'},{['$set']={status='rejected'}})==0 then conflict('邀请已处理') end
  return {ok=true}
 end
 local b=db.one('books',{_id=i.bookId,deleting={['$ne']=true}})
 if not b then missing() end
 if b.type~='family' or b.ownerId~=i.inviterId or b.ownerId==u._id then denied() end
 if contains(b.memberIds,u._id) then conflict('你已经是账本成员') end
 -- Claim the invitation atomically first, so reject/accept races cannot both win.
 local claimed=db.modify('invitations',{_id=id,phone=current.phone,status='pending'},{['$set']={status='accepted'}})
 if not claimed then conflict('邀请已处理') end
 local updated=db.modify('books',{_id=b._id,type='family',ownerId=i.inviterId,deleting={['$ne']=true}},{['$addToSet']={memberIds=u._id}})
 if not updated then db.delete('invitations',{_id=id}); missing() end
 -- A read-only share is superseded by full family membership. Cleanup is
 -- best-effort: membership already succeeded and must not fail on this.
 pcall(db.delete,'bookShares',{bookId=b._id,userId=u._id})
 return book_out(updated)
end
local function record_filter(id,args)
 local f={bookId=id}
 if args.type then f.type=v.enum(args.type,'收支类型',{'income','expense'}) end
 if args.createdBy then f.createdBy=v.id(args.createdBy) end
 if args.category then f.category=v.text(args.category,'分类',1,40,false) end
 if args.from or args.to then
  local bounds={}; local a,b
  if args.from then a=date.parse(args.from); if not a then v.bad('from时间不正确') end; bounds['$gte']=date.iso(a) end
  if args.to then b=date.parse(args.to); if not b then v.bad('to时间不正确') end; bounds['$lt']=date.iso(b) end
  if a and b and a>=b then v.bad('开始时间必须早于结束时间') end
  f.occurredAt=bounds
 end
 if args.q then
  local q=v.text(args.q,'搜索关键词',1,100,true)
  -- Literal regex only: user-controlled regex syntax is never executed.
  local escaped=q:gsub('([\\%.%+%-%*%?%[%]%^%$%(%)%{%}%|])','\\%1')
  f['$or']=bson.array({{note={['$regex']=escaped,['$options']='i'}},{category={['$regex']=escaped,['$options']='i'}},{paymentSource={['$regex']=escaped,['$options']='i'}}})
 end
 return f
end
local function page_value(s,default,max,name)
 if s==nil then return default end
 if not s:match('^%d+$') then v.bad(name..'必须为正整数') end
 return v.integer(tonumber(s),name,1,max)
end
local function records_list(id,u)
 local b=book_view(id,u)
 local args=query({from=true,to=true,type=true,category=true,q=true,page=true,pageSize=true,createdBy=true})
 local page=page_value(args.page,1,1000000,'页码'); local size=page_value(args.pageSize,20,100,'每页条数')
 local filter=record_filter(id,args)
 local list=db.find('records',filter,{sort=bson.ordered({{'occurredAt',-1},{'_id',-1}}),skip=(page-1)*size,limit=size})
 -- Authors come from current members plus anyone who has ever recorded here,
 -- so historical records keep an owner even after a member leaves.
 local ids={}
 for _,uid in ipairs(b.memberIds or {b.ownerId}) do ids[#ids+1]=uid end
 for _,uid in ipairs(db.distinct('records','createdBy',{bookId=id})) do ids[#ids+1]=uid end
 local users,order=users_by_ids(ids)
 local authors={}; for _,uid in ipairs(order) do local x=users[uid]; if x then authors[#authors+1]={id=x._id,name=x.name} end end
 local out={}
 for _,r in ipairs(list) do
  local item=record_out(r); local x=users[r.createdBy]
  if x then item.createdByName=x.name end
  out[#out+1]=item
 end
 return {items=array(out),total=db.count('records',filter),page=page,pageSize=size,authors=array(authors)}
end
local function shares_list(id,u)
 book_access(id,u,true)
 local list=db.find('bookShares',{bookId=id},{sort=bson.ordered({{'createdAt',-1},{'_id',-1}})})
 local ids={}; for _,s in ipairs(list) do ids[#ids+1]=s.userId end
 local users={}
 if #ids>0 then for _,x in ipairs(db.find('users',{_id={['$in']=bson.array(ids)}})) do users[x._id]=x end end
 local out={}
 for _,s in ipairs(list) do
  local x=users[s.userId]
  if x then out[#out+1]={id=s._id,userId=x._id,name=x.name,phone=x.phone,status=share_status(s),createdAt=s.createdAt} end
 end
 return {ownerId=u._id,shares=array(out)}
end
local function share_create(id,t,u)
 local b=book_access(id,u,true)
 v.fields(t,{phone=true}); local phone=v.phone(t.phone)
 if phone==u.phone then conflict('不能分享给自己') end
 local target=db.one('users',{phone=phone})
 if not target then v.error(404,'USER_NOT_REGISTERED','该手机号尚未注册，请对方先注册后再分享') end
 if target._id==b.ownerId or contains(b.memberIds,target._id) then conflict('该用户已是账本成员，无需分享') end
 local existing=db.one('bookShares',{bookId=id,userId=target._id})
 if existing then
  local status=share_status(existing)
  if status=='accepted' then conflict('该用户已接受分享，无需重复分享') end
  if status=='pending' then conflict('已分享给该用户，等待对方接受') end
  -- A rejected invitation may be sent again by the owner.
  local changed=db.modify('bookShares',{_id=existing._id,status='rejected'},{['$set']={status='pending',sharedBy=u._id,createdAt=now()},['$unset']={respondedAt=''}})
  if not changed then conflict('分享状态已变化，请刷新后重试') end
  if not db.one('books',{_id=id,deleting={['$ne']=true}}) then db.delete('bookShares',{_id=changed._id}); missing() end
  return {id=changed._id,userId=target._id,name=target.name,phone=target.phone,status='pending',createdAt=changed.createdAt}
 end
 local s={_id=crypto.random(12),bookId=id,userId=target._id,sharedBy=u._id,status='pending',createdAt=now()}
 duplicate_safe(function() return db.insert('bookShares',s) end,'已分享给该用户')
 -- Compensate an owner deleting the book concurrently with insertion.
 if not db.one('books',{_id=id,deleting={['$ne']=true}}) then db.delete('bookShares',{_id=s._id}); missing() end
 return {id=s._id,userId=target._id,name=target.name,phone=target.phone,status='pending',createdAt=s.createdAt},201
end
local function share_remove(id,userId,t,u)
 book_access(id,u,true); v.id(userId); v.fields(t,{})
 if db.delete('bookShares',{bookId=id,userId=userId})==0 then missing() end
 return {ok=true}
end
local function received_shares(u)
 local list=db.find('bookShares',{userId=u._id,status='pending'},{sort=bson.ordered({{'createdAt',-1},{'_id',-1}})})
 local out={}
 for _,s in ipairs(list) do
  local b=db.one('books',{_id=s.bookId,deleting={['$ne']=true}})
  if b then
   local owner=db.one('users',{_id=b.ownerId})
   out[#out+1]={id=s._id,bookId=b._id,bookName=b.name,ownerName=owner and owner.name or '对方',ownerPhone=owner and owner.phone or '',createdAt=s.createdAt}
  end
 end
 return array(out)
end
local function share_respond(id,u,accept)
 v.id(id)
 local s=db.one('bookShares',{_id=id}); if not s then missing() end
 if s.userId~=u._id then denied() end
 if share_status(s)~='pending' then conflict('分享已处理') end
 local b=db.one('books',{_id=s.bookId,deleting={['$ne']=true}}); if not b then missing() end
 local changed=db.modify('bookShares',{_id=id,userId=u._id,status='pending'},{['$set']={status=accept and 'accepted' or 'rejected',respondedAt=now()}})
 if not changed then conflict('分享已处理') end
 if not accept then return {ok=true} end
 b=db.one('books',{_id=s.bookId,deleting={['$ne']=true}}); if not b then missing() end
 local read_only=not is_member(b,u)
 local owner=read_only and db.one('users',{_id=b.ownerId}) or nil
 return book_out(b,read_only,owner)
end
local function record_create(id,t,u)
 book_access(id,u); local r=v.record(t,false); r._id=crypto.random(12); r.bookId=id; r.createdBy=u._id; r.createdAt=now(); r.updatedAt=r.createdAt
 db.insert('records',r)
 if not db.one('books',{_id=id,deleting={['$ne']=true}}) then db.delete('records',{_id=r._id}); missing() end
 return record_out(r),201
end
local function record_mutate(id,rid,t,u,remove)
 local b=book_access(id,u); v.id(rid)
 local r=db.one('records',{_id=rid,bookId=id}); if not r then missing() end
 if b.ownerId~=u._id and r.createdBy~=u._id then denied() end
 if remove then db.delete('records',{_id=rid,bookId=id}); return {ok=true} end
 local updates=v.record(t,true); updates.updatedAt=now()
 local changed=db.modify('records',{_id=rid,bookId=id},{['$set']=updates}); if not changed then missing() end
 return record_out(changed)
end
local function analysis(id,u)
 local b=book_view(id,u); local args=query({period=true,date=true,member=true})
 local period=v.enum(args.period or 'month','分析周期',{'week','month','year'})
 local member=args.member and v.id(args.member)
 local result=date.range(period,args.date,ngx.time()); if not result then v.bad('分析日期必须为有效YYYY-MM-DD') end
 local buckets={}; for _,bucket in ipairs(result.trend) do buckets[bucket.label]=bucket end
 local categories={}
 local member_stats,member_order,seen={},{},{}
 for _,uid in ipairs(b.memberIds or {b.ownerId}) do
  if not seen[uid] then seen[uid]=true; member_order[#member_order+1]=uid
   member_stats[uid]={userId=uid,incomeCents=0,expenseCents=0,recordCount=0} end
 end
 db.each('records',{bookId=id,occurredAt={['$gte']=result.from,['$lt']=result.to}},nil,function(r)
  local key=r.type=='income' and 'incomeCents' or 'expenseCents'
  -- Totals, trend and category ranking honor an optional member filter.
  if not member or r.createdBy==member then
   -- Fail explicitly rather than emit silently imprecise financial totals.
   if result[key]+r.amountCents>9007199254740991 then v.error(422,'AMOUNT_OVERFLOW','统计金额超出安全范围') end
   result[key]=result[key]+r.amountCents; result.recordCount=result.recordCount+1
   local bucket=buckets[date.bucket(r.occurredAt,period)]; if bucket then bucket[key]=bucket[key]+r.amountCents end
   if r.type=='expense' then local c=categories[r.category] or {category=r.category,amountCents=0,count=0}; c.amountCents=c.amountCents+r.amountCents; c.count=c.count+1; categories[r.category]=c end
  end
  -- Per-member totals are computed for the whole period even when filtered.
  local s=member_stats[r.createdBy]
  if not s then
   s={userId=r.createdBy,incomeCents=0,expenseCents=0,recordCount=0}
   member_stats[r.createdBy]=s; member_order[#member_order+1]=r.createdBy
  end
  if s[key]+r.amountCents>9007199254740991 then v.error(422,'AMOUNT_OVERFLOW','统计金额超出安全范围') end
  s[key]=s[key]+r.amountCents; s.recordCount=s.recordCount+1
 end)
 result.balanceCents=result.incomeCents-result.expenseCents
 for _,c in pairs(categories) do result.categories[#result.categories+1]=c end
 table.sort(result.categories,function(a,b) if a.amountCents==b.amountCents then return a.category<b.category end; return a.amountCents>b.amountCents end)
 result.categories=array(result.categories)
 local users=users_by_ids(member_order)
 local members={}
 for _,uid in ipairs(member_order) do
  local s=member_stats[uid]; local x=users[uid]
  s.name=x and x.name or '已退出成员'
  s.balanceCents=s.incomeCents-s.expenseCents
  members[#members+1]=s
 end
 result.members=array(members)
 return result
end
local function analysis_all(u)
 local args=query({period=true,date=true})
 local period=v.enum(args.period or 'month','分析周期',{'week','month','year'})
 local result=date.range(period,args.date,ngx.time()); if not result then v.bad('分析日期必须为有效YYYY-MM-DD') end
 local buckets={}; for _,bucket in ipairs(result.trend) do buckets[bucket.label]=bucket end
 local categories={}
 local book_stats,book_order={},{}
 -- Aggregate only books the account owns or belongs to, and only records this
 -- account created. Read-only shared books are deliberately excluded.
 for _,b in ipairs(books_available(u)) do
  if is_member(b,u) then
   book_order[#book_order+1]=b._id
   book_stats[b._id]={bookId=b._id,name=b.name,incomeCents=0,expenseCents=0,recordCount=0}
  end
 end
 if #book_order>0 then
  db.each('records',{bookId={['$in']=bson.array(book_order)},createdBy=u._id,occurredAt={['$gte']=result.from,['$lt']=result.to}},nil,function(r)
   local key=r.type=='income' and 'incomeCents' or 'expenseCents'
   if result[key]+r.amountCents>9007199254740991 then v.error(422,'AMOUNT_OVERFLOW','统计金额超出安全范围') end
   result[key]=result[key]+r.amountCents; result.recordCount=result.recordCount+1
   local bucket=buckets[date.bucket(r.occurredAt,period)]; if bucket then bucket[key]=bucket[key]+r.amountCents end
   if r.type=='expense' then local c=categories[r.category] or {category=r.category,amountCents=0,count=0}; c.amountCents=c.amountCents+r.amountCents; c.count=c.count+1; categories[r.category]=c end
   local s=book_stats[r.bookId]
   if s then
    if s[key]+r.amountCents>9007199254740991 then v.error(422,'AMOUNT_OVERFLOW','统计金额超出安全范围') end
    s[key]=s[key]+r.amountCents; s.recordCount=s.recordCount+1
   end
  end)
 end
 result.balanceCents=result.incomeCents-result.expenseCents
 for _,c in pairs(categories) do result.categories[#result.categories+1]=c end
 table.sort(result.categories,function(a,b) if a.amountCents==b.amountCents then return a.category<b.category end; return a.amountCents>b.amountCents end)
 result.categories=array(result.categories)
 local books={}
 for _,bid in ipairs(book_order) do local s=book_stats[bid]; s.balanceCents=s.incomeCents-s.expenseCents; books[#books+1]=s end
 result.books=array(books)
 result.members=array({})
 return result
end
local function health()
 local mongo_ok=pcall(function() db.command('ping',{}); index_ready() end)
 local redis_ok=pcall(function() sessions.redis(function(r) local pong=sessions.checked(r:ping()); assert(pong=='PONG') end) end)
 return {status=mongo_ok and redis_ok and 'ok' or 'degraded',mongo=mongo_ok,redis=redis_ok},mongo_ok and redis_ok and 200 or 503
end
function M.dispatch()
 local path=ngx.var.uri; local method=ngx.req.get_method()
 if path=='/api/health' and method=='GET' then return health() end
 if method~='GET' then mutation_guard() end
 if method~='GET' and method~='POST' and method~='PATCH' and method~='DELETE' then v.error(405,'METHOD_NOT_ALLOWED','不支持此请求方法') end
 index_ready()
 local is_import=method=='POST' and path:match('^/api/books/[^/]+/import$')
 local u,token
 -- Authenticate and authorize large import bodies before reading/decoding them.
 if is_import then u,token=auth(); book_access(path:match('^/api/books/([^/]+)/import$'),u) end
 local t=method~='GET' and body(is_import and 10*1024*1024 or 16384) or nil
 if path=='/api/auth/sms/challenge' and method=='POST' then return sms_route(t,false) end
 if path=='/api/auth/sms/send' and method=='POST' then return sms_route(t,true) end
 if path=='/api/auth/register' and method=='POST' then return register(t) end
 if path=='/api/auth/password/reset' and method=='POST' then return password_reset(t) end
 if path=='/api/auth/login' and method=='POST' then return login(t) end
 if path=='/api/auth/logout' and method=='POST' then v.fields(t,{}); sessions.destroy(sessions.token()); return {ok=true} end
 if not u then u,token=auth() end
 if path=='/api/analysis' and method=='GET' then return analysis_all(u) end
 if path=='/api/shares' and method=='GET' then return received_shares(u) end
 local sid,action=path:match('^/api/shares/([^/]+)/([^/]+)$')
 if sid and method=='POST' and (action=='accept' or action=='reject') then v.fields(t,{}); return share_respond(sid,u,action=='accept') end
 if path=='/api/auth/me' and method=='GET' then return user_out(u) end
 if path=='/api/auth/password' and method=='PATCH' then return password_change(t,u,token) end
 if path=='/api/auth/phone' and method=='PATCH' then return phone_change(t,u) end
 if path=='/api/auth/settings' and method=='PATCH' then return settings_change(t,u) end
 if path=='/api/record-options' then if method=='GET' then return record_options(u) elseif method=='POST' then return record_option_create(t,u) end end
 if path=='/api/books' then if method=='GET' then return books_list(u) elseif method=='POST' then return book_create(t,u) end end
 if path=='/api/books/order' and method=='PATCH' then return books_order(t,u) end
 if path=='/api/invitations' and method=='GET' then return invitations_list(u) end
 local id,action=path:match('^/api/invitations/([^/]+)/([^/]+)$')
 if id and method=='POST' and (action=='accept' or action=='reject') then v.fields(t,{}); return invite_action(id,u,action=='accept') end
 local transfer_bid=path:match('^/api/books/([^/]+)/export$')
 if transfer_bid and method=='GET' then
  local b=book_access(transfer_bid,u)
  return require('nestledger.transfer').export(b,query({from=true,to=true}))
 end
 transfer_bid=path:match('^/api/books/([^/]+)/import$')
 if transfer_bid and method=='POST' then return require('nestledger.transfer').import(transfer_bid,t,u,book_access,body_json.array_mt) end
 local bid,rid=path:match('^/api/books/([^/]+)/records/([^/]+)$')
 if bid and (method=='PATCH' or method=='DELETE') then if method=='DELETE' then v.fields(t,{}) end; return record_mutate(bid,rid,t,u,method=='DELETE') end
 bid=path:match('^/api/books/([^/]+)/records$')
 if bid then if method=='GET' then return records_list(bid,u) elseif method=='POST' then return record_create(bid,t,u) end end
 bid=path:match('^/api/books/([^/]+)/analysis$'); if bid and method=='GET' then return analysis(bid,u) end
 local member; bid,member=path:match('^/api/books/([^/]+)/members/([^/]+)$')
 if bid and method=='DELETE' then v.fields(t,{}); return member_remove(bid,member,u) end
 bid=path:match('^/api/books/([^/]+)/members$'); if bid and method=='GET' then return book_members(bid,u) end
 bid=path:match('^/api/books/([^/]+)/invitations$'); if bid and method=='POST' then return invite_create(bid,t,u) end
 bid=path:match('^/api/books/([^/]+)/shares$')
 if bid then
  if method=='GET' then return shares_list(bid,u)
  elseif method=='POST' then return share_create(bid,t,u) end
 end
 local share_user; bid,share_user=path:match('^/api/books/([^/]+)/shares/([^/]+)$')
 if bid and method=='DELETE' then return share_remove(bid,share_user,t,u) end
 bid=path:match('^/api/books/([^/]+)$')
 if bid then
  if method=='DELETE' then v.fields(t,{}); return book_delete(bid,u)
  elseif method=='PATCH' then
   book_access(bid,u,true); v.fields(t,{name=true}); local name=v.text(t.name,'账本名称',1,60,true)
   local b=db.modify('books',{_id=bid,ownerId=u._id,deleting={['$ne']=true}},{['$set']={name=name}}); if not b then missing() end; return book_out(b)
  end
 end
 missing()
end
function M.run()
 ngx.header['Content-Type']='application/json; charset=utf-8'
 ngx.header['Cache-Control']='no-store'
 ngx.header['X-Content-Type-Options']='nosniff'
 local ok,data,status=xpcall(M.dispatch,function(e) return e end)
 if not ok then
  local e=data
  if type(e)=='table' and e.status then status=e.status; data={error={code=e.code,message=e.message}}
  elseif type(e)=='table' and e.dbcode==11000 then status=409; data={error={code='CONFLICT',message='数据已存在'}}
  else
   status=type(e)=='table' and e.dependency and 503 or 500
   ngx.log(ngx.ERR,'NestLedger API failure: ',type(e)=='table' and tostring(e.dependency or 'internal')..': '..tostring(e.message) or tostring(e))
   data={error={code=status==503 and 'DEPENDENCY_UNAVAILABLE' or 'INTERNAL_ERROR',message=status==503 and '数据库服务暂不可用，请稍后再试' or '服务异常，请稍后再试'}}
  end
 else status=status or 200; data={data=data} end
 local encoded,err=json.encode(data)
 if not encoded then ngx.log(ngx.ERR,'JSON encoding failure: ',err); status=500; encoded='{"error":{"code":"INTERNAL_ERROR","message":"服务异常，请稍后再试"}}' end
 ngx.status=status; ngx.say(encoded); return ngx.exit(status)
end
return M
