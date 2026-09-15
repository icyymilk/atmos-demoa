import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { ConnectionStore } from '../harness/connection-store.ts';
const origin=process.env.ATMOS_TEST_URL||'http://localhost:5173';
const accounts=[],projects=[],owners=[];
const tag=randomUUID(),email=`auth-${tag}@example.invalid`,password=`Test ${randomBytes(20).toString('hex')}`,newPassword=`New ${randomBytes(20).toString('hex')}`;
const store=new ConnectionStore(process.cwd());
function jar(){return new Map();}
const a=jar(),b=jar(),c=jar();
async function call(path,j,data,extra={}){
  const headers={'Content-Type':'application/json',Cookie:[...j].map(([k,v])=>`${k}=${v}`).join('; '),...extra};
  const response=await fetch(origin+path,{method:data===undefined?'GET':'POST',headers,...(data===undefined?{}:{body:JSON.stringify(data)})});
  for(const cookie of response.headers.getSetCookie()){const [pair]=cookie.split(';');const [name,value]=pair.split('=');if(value)j.set(name,value);else j.delete(name);}
  return response;
}
async function json(path,j,data,status=200,extra={}){const r=await call(path,j,data,extra);const text=await r.text();assert.equal(r.status,status,`${path}: ${text}`);return JSON.parse(text);}
async function guest(j){const identity=await json('/api/session',j,{});assert.equal(identity.kind,'guest');owners.push(identity.ownerId);return identity;}
async function template(j){const r=await call('/api/generate',j,{prompt:'账户隔离测试',mode:'template',templateId:'board'});assert.equal(r.status,200);const events=(await r.text()).split('\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5)));const id=events.find(e=>e.type==='done')?.projectId;assert.ok(id);projects.push({id,j});return id;}
try{
  const ga=await guest(a),oldGuest=new Map(a);const project=await template(a);
  await store.save(ga.ownerId,{provider:'github',account:'auth-fixture',verifiedAt:Date.now(),token:randomBytes(24).toString('hex')});
  const registration={name:'账户测试',email:email.toUpperCase(),password,confirmPassword:password};
  await json('/api/auth/register',a,{...registration,confirmPassword:'mismatch'},400);
  const account=await json('/api/auth/register',a,registration);accounts.push(account.userId);
  assert.equal(account.ownerId,ga.ownerId);assert.equal(account.email,email);
  assert.equal((await call('/api/projects',oldGuest)).status,401);
  assert.equal((await json('/api/projects/'+project,a)).versions.length,1);
  assert.equal((await json('/api/connections',a)).connections[0].account,'auth-fixture');
  const running=await call('/api/generate',a,{prompt:'运行互斥测试',mode:'ai',provider:'deepseek',model:'deepseek-flash',apiKey:'invalid-lock-test-key'});
  const reader=running.body.getReader(),decoder=new TextDecoder();let stream='';
  try{while(!stream.includes('"kind":"init"')){const chunk=await reader.read();assert.ok(!chunk.done);stream+=decoder.decode(chunk.value);}
    await json('/api/auth/logout',a,{},409);
  }finally{while(!(await reader.read()).done){} await reader.cancel();}
  const gb=await guest(b),guestProject=await template(b);
  await json('/api/auth/register',b,registration,409);
  await json('/api/auth/login',b,{email,password:'incorrect'},401);
  assert.equal((await json('/api/auth/me',b)).ownerId,gb.ownerId);
  await json('/api/auth/login',b,{email,password});
  assert.equal((await json('/api/auth/me',b)).ownerId,account.ownerId);
  assert.equal((await json('/api/projects/'+project,b)).id,project);
  assert.equal((await call('/api/projects/'+guestProject,b)).status,404);
  assert.equal((await json('/api/connections',b)).connections.length,1);
  await json('/api/auth/logout',b,{});
  assert.equal((await json('/api/auth/me',b)).ownerId,gb.ownerId);
  assert.equal((await json('/api/projects/'+guestProject,b)).id,guestProject);
  assert.deepEqual((await json('/api/connections',b)).connections,[]);
  await json('/api/auth/login',b,{email,password});
  const priorA=new Map(a),priorB=new Map(b);
  await json('/api/auth/password',a,{oldPassword:'bad',password:newPassword,confirmPassword:newPassword},400);
  await json('/api/auth/password',a,{oldPassword:password,password:newPassword,confirmPassword:newPassword});
  assert.equal((await call('/api/auth/me',priorA)).status,401);
  assert.equal((await call('/api/auth/me',priorB)).status,401);
  await guest(b); // restores its valid guest backup after account revocation
  assert.equal((await json('/api/auth/me',b)).ownerId,gb.ownerId);
  await json('/api/auth/login',b,{email,password},401);
  await json('/api/auth/login',b,{email,password:newPassword});
  await guest(c);
  const cAccount=await json('/api/auth/register',c,{name:'隔离账户',email:`other-${tag}@example.invalid`,password,confirmPassword:password});accounts.push(cAccount.userId);
  assert.equal((await call('/api/projects/'+project,c)).status,404);
  assert.deepEqual((await json('/api/connections',c)).connections,[]);
  assert.equal((await call('/api/projects',c,undefined,{'X-Atmos-Owner':ga.ownerId})).status,409);
  assert.equal((await call('/api/auth/logout',c,{}, {Origin:'https://untrusted.example'})).status,403);
  // A claimed guest cannot be revived as a backup cookie.
  const stale=jar();stale.set('atmos_guest_session',oldGuest.get('atmos_session'));const recovered=await guest(stale);assert.notEqual(recovered.ownerId,ga.ownerId);
  const rate=jar();await guest(rate);
  for(let n=0;n<10;n++)await json('/api/auth/login',rate,{email:`absent-${tag}@example.invalid`,password},401);
  await json('/api/auth/login',rate,{email:`absent-${tag}@example.invalid`,password},429);
  if(origin==='http://localhost:5173'){
    const expired=jar(),before=await guest(expired);
    const directory=path.join(process.cwd(),'.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
    const database=new DatabaseSync(path.join(directory,readdirSync(directory).find(n=>n.endsWith('.sqlite')&&n!=='metadata.sqlite')));
    try{database.prepare('UPDATE sessions SET expires_at=0 WHERE owner_id=?').run(before.ownerId);}finally{database.close();}
    assert.equal((await call('/api/auth/me',expired)).status,401);
    assert.notEqual((await guest(expired)).ownerId,before.ownerId);
  }
  // Same guest / concurrent registration: exactly one winner, no orphaned second user.
  const concurrent=jar();await guest(concurrent);const j1=new Map(concurrent),j2=new Map(concurrent);
  const results=await Promise.all([call('/api/auth/register',j1,{...registration,email:`race1-${tag}@example.invalid`}),call('/api/auth/register',j2,{...registration,email:`race2-${tag}@example.invalid`})]);
  assert.equal(results.filter(r=>r.status===200).length,1);assert.ok(results.every(r=>[200,401,409].includes(r.status)));
  accounts.push((await results.find(r=>r.status===200).json()).userId);
  console.log('PASS: register and inherit project/connections, normalized email, duplicate/conflicting registration, multi-browser login, guest restoration, password/session revocation, cross-account isolation, CSRF, stale-owner guard and rate limits.');
}finally{
  // Remove only this test's fixtures; random credentials are never printed.
  for(const owner of owners)await store.remove(owner,'github');
  for(const {id,j} of projects){await fetch(origin+'/api/projects/'+id,{method:'DELETE',headers:{Cookie:[...j].map(([k,v])=>`${k}=${v}`).join('; ')}});}
  if(origin==='http://localhost:5173'){
    const directory=path.join(process.cwd(),'.wrangler/state/v3/d1/miniflare-D1DatabaseObject');
    const file=readdirSync(directory).find(name=>name.endsWith('.sqlite')&&name!=='metadata.sqlite');
    const database=new DatabaseSync(path.join(directory,file));database.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
    try{for(const owner of new Set(owners)){
      database.prepare('DELETE FROM projects WHERE owner=?').run(owner);
      database.prepare('DELETE FROM sessions WHERE owner_id=?').run(owner);
      database.prepare('DELETE FROM users WHERE owner_id=?').run(owner);
      database.prepare('DELETE FROM owners WHERE id=?').run(owner);
    }}finally{database.close();}
  }

}
