import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readdir,rm} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import path from 'node:path';
const origin=process.env.ATMOS_TEST_URL||'http://localhost:5173',owners=[],a=new Map(),b=new Map();
async function call(route,jar,data,extra={}){const r=await fetch(origin+route,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',Cookie:[...jar].map(([k,v])=>`${k}=${v}`).join('; '),...extra},...(data?{body:JSON.stringify(data)}:{})});for(const c of r.headers.getSetCookie()){const [name,value]=c.split(';')[0].split('=');if(value)jar.set(name,value);else jar.delete(name);}return r;}
async function json(route,jar,data,status=200,extra={}){const r=await call(route,jar,data,extra),text=await r.text();assert.equal(r.status,status,route+': '+text);return text.startsWith('{')?JSON.parse(text):{message:text};}
try{
 await json('/api/security',new Map(),undefined,401);
 const ga=await json('/api/session',a,{}),gb=await json('/api/session',b,{});owners.push(ga.ownerId,gb.ownerId);
 assert.equal((await json('/api/security',a)).mode,'important');
 await json('/api/security',a,{mode:'allow',revision:0},403,{Origin:'https://untrusted.invalid'});
 await json('/api/security',a,{mode:'allow',revision:0,owner:gb.ownerId});assert.equal((await json('/api/security',a)).mode,'allow');assert.equal((await json('/api/security',b)).mode,'important');
 await json('/api/security',a,{mode:'always',revision:0},409);await json('/api/security',a,{mode:'bogus',revision:1},400);
 await json('/api/security',a,undefined,409,{'X-Atmos-Owner':gb.ownerId});
 await json(`/api/runs/${randomUUID()}/approval`,a,{id:randomUUID(),decision:'allow'},404);
 await json(`/api/runs/${randomUUID()}/approval`,new Map(),{id:randomUUID(),decision:'allow'},401);
 await json('/api/generate',a,{mode:'ai',prompt:'validate only',provider:'deepseek',model:'test',apiKey:'test',reasoningEffort:'unsupported'},400);
 await json('/api/models/test',a,{provider:'qwen',model:'test',apiKey:'test',reasoningEffort:'high',thinkingBudget:4096,maxOutputTokens:4096},400);
 await json('/api/models/list',a,{provider:'custom',apiKey:'test'},400);
 const r=await call('/api/generate',a,{mode:'template',prompt:'渐进加载回归',templateId:'board'});assert.equal(r.status,200);const id=(await r.text()).split('\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5))).find(e=>e.type==='done').projectId;
 for(let i=0;i<7;i++)await json(`/api/projects/${id}/restore`,a,{number:1});
 const initial=await json(`/api/projects/${id}?view=progressive`,a);assert.equal(initial.versions.length,3);assert.equal(initial.versions[0].number,6);assert.equal(initial.versions[0].code,'');assert.equal(initial.versions[0].files,undefined);assert.equal(initial.versions[2].artifactLoaded,true);assert.equal(initial.historyBefore,6);
 const older=await json(`/api/projects/${id}/history?before=6`,a);assert.deepEqual(older.versions.map(v=>v.number),[1,2,3,4,5]);assert.equal(older.before,null);assert.ok(older.versions.every(v=>v.code===''&&v.files===undefined));
 assert.ok((await json(`/api/projects/${id}/versions/1`,a)).code.includes('<html'));
 await json(`/api/projects/${id}/versions/1`,b,undefined,404);await json(`/api/projects/${id}/history?before=6`,b,undefined,404);await json(`/api/projects/${id}/history?before=-1`,a,undefined,400);
 console.log('PASS: actual auth-scoped trust APIs, origin/stale-owner guards, invalid/stale approvals, model parameter validation, paginated history and on-demand artifacts with account isolation.');
}finally{
 if(origin==='http://localhost:5173'){const dir='.wrangler/state/v3/d1/miniflare-D1DatabaseObject',db=new DatabaseSync(path.join(dir,(await readdir(dir)).find(n=>n.endsWith('.sqlite')&&n!=='metadata.sqlite')));db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');try{for(const owner of owners){db.prepare('DELETE FROM projects WHERE owner=?').run(owner);db.prepare('DELETE FROM sessions WHERE owner_id=?').run(owner);db.prepare('DELETE FROM owners WHERE id=?').run(owner);await rm(path.join('.atmos/owners',owner),{recursive:true,force:true});await rm(path.join('.atmos/memory',owner),{recursive:true,force:true});}}finally{db.close();}}
}
