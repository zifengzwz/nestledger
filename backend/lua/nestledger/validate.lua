local M={}
function M.error(status,code,message) error({status=status,code=code,message=message},0) end
function M.bad(message) M.error(400,'VALIDATION_ERROR',message or '请求参数不正确') end
function M.length(s)
 if type(s)~='string' then return nil end
 local i,n=1,0
 while i<=#s do
  local b=s:byte(i); local size
  if b<128 then size=1 elseif b>=194 and b<=223 then size=2 elseif b>=224 and b<=239 then size=3 elseif b>=240 and b<=244 then size=4 else return nil end
  if i+size-1>#s then return nil end
  for j=i+1,i+size-1 do local c=s:byte(j); if c<128 or c>191 then return nil end end
  local c=s:byte(i+1)
  if (b==224 and c<160) or (b==237 and c>=160) or (b==240 and c<144) or (b==244 and c>=144) then return nil end
  i=i+size; n=n+1
 end
 return n
end
function M.text(v,name,min,max,trim)
 if type(v)~='string' then M.bad(name..'必须为字符串') end
 if trim then v=v:match('^%s*(.-)%s*$') end
 local len=M.length(v); if not len or len<min or len>max or v:find('%z') then M.bad(name..'长度或格式不正确') end
 return v
end
function M.phone(v) if type(v)~='string' or not v:match('^1%d%d%d%d%d%d%d%d%d%d$') then M.bad('请输入11位中国大陆手机号') end; return v end
function M.password(v) return M.text(v,'密码',8,72,false) end
function M.id(v) if type(v)~='string' or #v~=24 or not v:match('^[0-9a-f]+$') then M.bad('标识格式不正确') end; return v end
function M.enum(v,name,values) for _,item in ipairs(values) do if v==item then return v end end; M.bad(name..'不正确') end
function M.integer(v,name,min,max)
 if type(v)~='number' or v~=v or v%1~=0 or v<min or v>max then M.bad(name..'必须为范围内的整数') end; return v
end
function M.fields(t,allowed)
 if type(t)~='table' or getmetatable(t) then M.bad('请求内容必须为JSON对象') end
 for k in pairs(t) do if type(k)~='string' or not allowed[k] then M.bad('请求含不支持的字段') end end
end
function M.record(t,partial)
 M.fields(t,{type=true,amountCents=true,category=true,occurredAt=true,note=true,paymentSource=true})
 local out={}; local count=0
 for _,k in ipairs({'type','amountCents','category','occurredAt','note','paymentSource'}) do
  local v=t[k]
  if v~=nil or not partial then
   if k=='type' then v=M.enum(v,'收支类型',{'income','expense'})
   elseif k=='amountCents' then v=M.integer(v,'金额（分）',1,99999999999)
   elseif k=='occurredAt' then local date=require 'nestledger.date'; local ts=date.parse(v); if not ts then M.bad('日期必须为有效ISO8601时间') end; v=date.iso(ts)
   elseif k=='note' then if v==nil then v='' end; v=M.text(v, '备注',0,500,false)
   elseif k=='paymentSource' then if v==nil then v='' end; v=M.text(v, '支付方式',0,40,true)
   else v=M.text(v,'分类',1,40,true) end
   out[k]=v; count=count+1
  end
 end
 if count==0 then M.bad('请至少修改一个字段') end; return out
end
return M
