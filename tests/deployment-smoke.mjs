import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const temp=await mkdtemp(path.join(tmpdir(),'atmos-release-'));
const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
const origin=`http://127.0.0.1:${port}`,publicOrigin='https://release.atmos.test',owners=[];
const env={...process.env,ATMOS_LOCAL_STATE_DIR:temp,PORT:String(port),ATMOS_PUBLIC_ORIGIN:publicOrigin,WRANGLER_HIDE_BANNER:'true'};
let server,logs='';
function launch(file){const p=spawn(process.execPath,[file],{env,stdio:['ignore','pipe','pipe']});p.stdout.on('data',d=>logs+=d);p.stderr.on('data',d=>logs+=d);return p;}
async function stop(){if(!server)return;const p=server;server=undefined;if(p.exitCode!==null)return;p.kill('SIGTERM');await Promise.race([new Promise(resolve=>p.once('exit',resolve)),new Promise((_,reject)=>{const t=setTimeout(()=>reject(new Error('service did not stop')),10000);t.unref();})]);}
async function start(){server=launch('scripts/start-local.mjs');for(let i=0;i<90;i++){if(server.exitCode!==null)throw new Error('compiled service exited: '+logs.slice(-3000));try{if((await fetch(origin+'/api/health')).ok)return;}catch{}await new Promise(resolve=>setTimeout(resolve,300));}throw new Error('service health timed out: '+logs.slice(-3000));}
let cookie='';
async function call(url,data,method,extra={}){return fetch(origin+url,{method:method||(data?'POST':'GET'),headers:{Origin:publicOrigin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...extra},...(data?{body:JSON.stringify(data)}:{})});}
try{
 const migration=launch('scripts/setup-local-db.mjs');const code=await new Promise(resolve=>migration.once('exit',resolve));assert.equal(code,0,logs.slice(-2000));
 await start();assert.deepEqual(await (await call('/api/health')).json(),{ok:true,database:true,agent:true});
 assert.equal((await call('/')).status,200);
 assert.equal((await call('/api/session',{},undefined,{Origin:'https://wrong.example'})).status,403);
 const guest=await call('/api/session',{});assert.equal(guest.status,200);assert.match(guest.headers.get('set-cookie'),/; Secure/);cookie=guest.headers.get('set-cookie').split(';')[0];owners.push((await guest.json()).ownerId);
 const password='release-pass-'+randomUUID();const account=await call('/api/auth/register',{name:'部署验收',email:randomUUID()+'@example.test',password,confirmPassword:password});assert.equal(account.status,200,await account.clone().text());cookie=account.headers.get('set-cookie').split(';')[0];
 const created=await call('/api/generate',{mode:'template',templateId:'board',prompt:'部署持久化验收'});const events=(await created.text()).split('\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5)));const id=events.find(e=>e.type==='done')?.projectId;assert.ok(id);
 assert.equal((await call('/api/projects/'+id,{action:'state',state:{releaseVerified:true}},'PATCH')).status,200);
 const memory=await call('/api/memory',{action:'create',path:'release.md',title:'部署验收',content:'服务重启后保留',tags:[],enabled:true,pinned:false});assert.equal(memory.status,200);
 await stop();await start();assert.equal((await (await call('/api/auth/me')).json()).kind,'account');assert.equal((await (await call('/api/projects/'+id)).json()).state.releaseVerified,true);assert.ok((await (await call('/api/memory')).json()).documents.some(d=>d.path==='release.md'));
 console.log('PASS: compiled service with fresh migrations, health, HTTPS-origin guard, Secure Cookie, registration, template generation and database/memory persistence after process restart. No paid model request.');
}finally{await stop();await rm(temp,{recursive:true,force:true});for(const owner of owners)for(const folder of ['memory','owners','connections'])await rm(path.join('.atmos',folder,owner),{recursive:true,force:true});}
