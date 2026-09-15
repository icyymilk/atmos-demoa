import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {readdir,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
import {MemoryStore} from '../harness/memory-store.ts';
const origin=process.env.ATMOS_TEST_URL||'http://localhost:5173',owners=[],tag=randomUUID();
const store=new MemoryStore(process.cwd()),a=new Map(),b=new Map();
async function call(route,jar,data,extra={}){const r=await fetch(origin+route,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...extra},...(data?{body:JSON.stringify(data)}:{})});for(const c of r.headers.getSetCookie()){const [name,value]=c.split(';')[0].split('=');if(value)jar.set(name,value);else jar.delete(name);}return r;}
async function json(route,jar,data,status=200,extra={}){const r=await call(route,jar,data,extra),text=await r.text();assert.equal(r.status,status,route+': '+text);return text.startsWith('{')?JSON.parse(text):{message:text};}
try{
 await json('/api/memory',new Map(),undefined,401);
 const ga=await json('/api/session',a,{}),gb=await json('/api/session',b,{});owners.push(ga.ownerId,gb.ownerId);
 const oldGuest=new Map(a);
 let v=await json('/api/memory',a);assert.equal(v.documents.length,2);
 const create={action:'create',path:'notes/ui.md',title:'设计偏好',content:'我偏好天蓝色界面。[[USER.md]]',tags:['设计']};
 await json('/api/memory',a,create,403,{Origin:'https://untrusted.invalid'});
 v=await json('/api/memory',a,{...create,owner:gb.ownerId});const d=v.documents.at(-1);
 assert.equal((await json('/api/memory',b)).documents.length,2); // Body cannot forge ownership.
 await json('/api/memory',b,{...d,action:'update'},404);
 await json('/api/memory',a,{...d,action:'update',content:'变更为天蓝色和留白'});
 await json('/api/memory',a,{...d,action:'update',content:'旧草稿覆盖'},409);
 await json('/api/memory',a,{...create,path:'../escape.md'},400);
 await json('/api/memory',a,{...create,path:'large.md',content:'a'.repeat(31000)},413);
 const pending=await store.propose(ga.ownerId,{title:'布局偏好',content:'喜欢紧凑布局',tags:[],reason:'用户明确表达'});
 v=await json('/api/memory',a);assert.equal(v.proposals[0].id,pending.id);assert.equal((await store.search(ga.ownerId,'紧凑')).documents.length,0);
 await json('/api/memory',b,{action:'approve',id:pending.id,title:'他人的记忆',content:'无权'},404);
 await json('/api/memory',a,{action:'approve',id:pending.id,title:'布局偏好',content:'喜欢宽松布局',tags:['设计']});
 assert.equal((await store.search(ga.ownerId,'宽松')).documents.length,1);
 const password='Memory '+randomBytes(24).toString('hex'),email=`memory-${tag}@example.invalid`;
 const account=await json('/api/auth/register',a,{name:'记忆验收',email,password,confirmPassword:password});assert.equal(account.ownerId,ga.ownerId);
 await json('/api/memory',oldGuest,undefined,401);
 assert.equal((await json('/api/memory',a)).documents.length,4);
 await json('/api/auth/login',b,{email,password});assert.equal((await json('/api/memory',b)).documents.length,4);
 await json('/api/memory',b,undefined,409,{'X-Atmos-Owner':gb.ownerId});
 await json('/api/auth/logout',b,{});assert.equal((await json('/api/memory',b)).documents.length,2);
 const catalog=await json('/api/harness',a);assert.equal(catalog.plugins.find(p=>p.id==='memory').tools.length,3);
 console.log('PASS: memory API auth, origin and owner guards, revision conflicts, pending/approval, registration inheritance, cross-browser account access, guest restoration and real MCP catalog.');
}finally{
 if(origin==='http://localhost:5173'){
  const dir=path.join(process.cwd(),'.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
  const db=new DatabaseSync(path.join(dir,(await readdir(dir)).find(n=>n.endsWith('.sqlite')&&n!=='metadata.sqlite')));db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
  try{for(const owner of owners){db.prepare('DELETE FROM sessions WHERE owner_id=?').run(owner);db.prepare('DELETE FROM users WHERE owner_id=?').run(owner);db.prepare('DELETE FROM owners WHERE id=?').run(owner);}}finally{db.close();}
  for(const owner of owners)await rm(path.join(process.cwd(),'.atmos/memory',owner),{recursive:true,force:true});
 }
}
