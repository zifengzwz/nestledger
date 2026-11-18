-- Gregorian calendar arithmetic: no dependency on the host TZ or DST.
local M={}; local floor=math.floor
local function leap(y) return y%4==0 and (y%100~=0 or y%400==0) end
function M.month_days(y,m) return ({31,leap(y) and 29 or 28,31,30,31,30,31,31,30,31,30,31})[m] end
function M.valid(y,m,d) return y and y>=1 and y<=9999 and m>=1 and m<=12 and d>=1 and d<=M.month_days(y,m) end
function M.days(y,m,d)
 y=y-(m<=2 and 1 or 0); local era=floor(y/400); local yo=y-era*400
 local mp=m+(m>2 and -3 or 9); local doy=floor((153*mp+2)/5)+d-1
 return era*146097+yo*365+floor(yo/4)-floor(yo/100)+doy-719468
end
function M.civil(z)
 z=z+719468; local era=floor(z/146097); local doe=z-era*146097
 local yo=floor((doe-floor(doe/1460)+floor(doe/36524)-floor(doe/146096))/365)
 local y=yo+era*400; local doy=doe-(365*yo+floor(yo/4)-floor(yo/100))
 local mp=floor((5*doy+2)/153); local d=doy-floor((153*mp+2)/5)+1
 local m=mp+(mp<10 and 3 or -9); y=y+(m<=2 and 1 or 0); return y,m,d
end
function M.iso(t)
 local ms=floor(t*1000+0.5); local sec=floor(ms/1000); local day=floor(sec/86400)
 local y,m,d=M.civil(day); local s=sec-day*86400; local h=floor(s/3600); local min=floor(s%3600/60)
 return string.format('%04d-%02d-%02dT%02d:%02d:%02d.%03dZ',y,m,d,h,min,s%60,ms%1000)
end
function M.parse(s)
 if type(s)~='string' or #s>40 then return nil end
 local y,m,d,h,mi,se,tail=s:match('^(%d%d%d%d)%-(%d%d)%-(%d%d)T(%d%d):(%d%d):(%d%d)(.*)$')
 if not y then return nil end
 y,m,d,h,mi,se=tonumber(y),tonumber(m),tonumber(d),tonumber(h),tonumber(mi),tonumber(se)
 if not M.valid(y,m,d) or h>23 or mi>59 or se>59 then return nil end
 local fraction=0
 if tail:sub(1,1)=='.' then local f,rest=tail:match('^%.(%d+)(.*)$'); if not f or #f>9 then return nil end; fraction=tonumber('0.'..f); tail=rest end
 local offset=0
 if tail~='Z' then
  local sign,oh,om=tail:match('^([+-])(%d%d):(%d%d)$')
  oh,om=tonumber(oh),tonumber(om)
  if not sign or oh>14 or om>59 or (oh==14 and om~=0) then return nil end
  offset=(oh*60+om)*60*(sign=='+' and 1 or -1)
 end
 local t=M.days(y,m,d)*86400+h*3600+mi*60+se+fraction-offset
 if t<M.days(1,1,1)*86400 or t>=M.days(10000,1,1)*86400 then return nil end
 return t
end
function M.day(s)
 if type(s)~='string' then return nil end
 local y,m,d=s:match('^(%d%d%d%d)%-(%d%d)%-(%d%d)$'); y,m,d=tonumber(y),tonumber(m),tonumber(d)
 if not M.valid(y,m,d) then return nil end; return y,m,d
end
function M.range(period,date,now)
 local y,m,d
 if date then y,m,d=M.day(date); if not y then return nil end
 else y,m,d=M.civil(floor(((now or os.time())+28800)/86400)) end
 local start,finish,buckets={},{},{}
 if period=='week' then
  local day=M.days(y,m,d); local monday=day-(day+3)%7
  start=monday*86400-28800; finish=start+7*86400
  for i=0,6 do local a,b,c=M.civil(monday+i); buckets[#buckets+1]={label=string.format('%04d-%02d-%02d',a,b,c),incomeCents=0,expenseCents=0} end
 elseif period=='month' then
  start=M.days(y,m,1)*86400-28800
  finish=M.days(m==12 and y+1 or y,m==12 and 1 or m+1,1)*86400-28800
  for i=1,M.month_days(y,m) do buckets[#buckets+1]={label=string.format('%04d-%02d-%02d',y,m,i),incomeCents=0,expenseCents=0} end
 elseif period=='year' then
  start=M.days(y,1,1)*86400-28800; finish=M.days(y+1,1,1)*86400-28800
  for i=1,12 do buckets[#buckets+1]={label=string.format('%04d-%02d',y,i),incomeCents=0,expenseCents=0} end
 else return nil end
 return {period=period,from=M.iso(start),to=M.iso(finish),incomeCents=0,expenseCents=0,balanceCents=0,recordCount=0,trend=buckets,categories={}}
end
function M.bucket(iso,period)
 local t=M.parse(iso); local y,m,d=M.civil(floor((t+28800)/86400))
 return period=='year' and string.format('%04d-%02d',y,m) or string.format('%04d-%02d-%02d',y,m,d)
end
return M
