local kdf=require 'resty.openssl.kdf'
local random=require 'resty.random'
local bit=require 'bit'
local M={}
local iterations=tonumber(os.getenv('PBKDF2_ITERATIONS') or '600000')
assert(iterations and iterations%1==0 and iterations>=100000 and iterations<=2000000,'PBKDF2_ITERATIONS must be 100000..2000000')
function M.hex(raw) return (raw:gsub('.',function(c) return string.format('%02x',c:byte()) end)) end
function M.random(n) local bytes,err=random.bytes(n,true); assert(bytes,err); return M.hex(bytes) end
function M.equal(a,b)
 if type(a)~='string' or type(b)~='string' then return false end
 local diff=bit.bxor(#a,#b)
 for i=1,math.max(#a,#b) do diff=bit.bor(diff,bit.bxor(a:byte(i) or 0,b:byte(i) or 0)) end
 return diff==0
end
local function derive(password,salt,count)
 local out,err=kdf.derive{type=kdf.PBKDF2,outlen=32,pass=password,salt=salt,md='sha256',pbkdf2_iter=count}
 assert(out,err); return M.hex(out)
end
function M.hash(password)
 local salt=M.random(16)
 return {algorithm='pbkdf2-sha256',salt=salt,iterations=iterations,hash=derive(password,salt,iterations)}
end
function M.verify(password,stored)
 if type(stored)~='table' or stored.algorithm~='pbkdf2-sha256' or type(stored.iterations)~='number' or stored.iterations<100000 or stored.iterations>2000000 then return false end
 return M.equal(derive(password,stored.salt,stored.iterations),stored.hash)
end
-- Fixed dummy salt/hash still performs the same expensive KDF for absent users.
function M.dummy(password) derive(password,'00000000000000000000000000000000',iterations) end
return M
