import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
const root=await mkdtemp(path.join(tmpdir(),'atmos-guard-http-')),token=randomBytes(32).toString('hex'),owner='a'.repeat(64),other='b'.repeat(64);
const child=fork(fileURLToPath(new URL('../harness/server.ts',import.meta.url)),[],{cwd:root,execArgv:['--import',fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs',import.meta.url)),'--import',fileURLToPath(new URL('./fixtures/model-for-approval.mjs',import.meta.url))],env:{...process.env,ATMOS_HARNESS_TOKEN:token},stdio:['ignore','ignore','inherit','ipc']});
try{
 const port=await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Harness startup timeout')),10000);child.once('message',m=>{clearTimeout(timeout);resolve(m.port);});child.once('exit',code=>{clearTimeout(timeout);reject(new Error('Harness stopped '+code));});});
 const url=`http://127.0.0.1:${port}`;
 async function post(route,data,status=200){const r=await fetch(url+route,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(data)});assert.equal(r.status,status);return r;}
 const html='<!DOCTYPE html><html><body><button onclick="this.textContent=\'好\'">点击</button></body></html>';
 for(const decision of ['deny','allow']){
  const runId=randomUUID(),response=await post('/run',{owner,runId,prompt:'清理旧文件',config:{provider:'deepseek',model:'guard-test',apiKey:'fake-test-only'},files:{'index.html':html,'obsolete.txt':'original'},history:[]});
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',request,seenResult=false;
  async function consume(handler){while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop()||'';for(const line of lines)if(line.startsWith('data: ')){const e=JSON.parse(line.slice(6));if(e.type==='result')seenResult=true;await handler(e);}}}
  await consume(async event=>{if(event.type!=='agent'||event.event.type!=='approval'||event.event.approval.status!=='pending')return;request=event.event.approval;
   assert.equal(request.name,'core__delete_file');const file=path.join(root,'.atmos/runs',owner,runId,'workspace','obsolete.txt');assert.equal(await readFile(file,'utf8'),'original');
   await post('/approval',{owner:other,runId,id:request.id,decision:'allow'},404);
   await post('/approval',{owner,runId:randomUUID(),id:request.id,decision:'allow'},404);
   await post('/approval',{owner,runId,id:request.id,decision});
   await post('/approval',{owner,runId,id:request.id,decision},404);
  });
  assert.ok(request);assert.ok(seenResult);const file=path.join(root,'.atmos/runs',owner,runId,'workspace','obsolete.txt');
  if(decision==='deny')assert.equal(await readFile(file,'utf8'),'original');else await assert.rejects(()=>readFile(file));
 }
 await post('/security',{owner,action:'set',mode:'allow',revision:0});
 const runId=randomUUID(),response=await post('/run',{owner,runId,prompt:'允许清理',config:{provider:'deepseek',model:'guard-test',apiKey:'fake-test-only'},files:{'index.html':html,'obsolete.txt':'original'}}),stream=await response.text();assert.doesNotMatch(stream,/"status":"pending"/);assert.match(stream,/完全允许/);assert.match(stream,/"type":"result"/);
 console.log('PASS: isolated real HTTP Harness + MCP execution waits for owner/run-bound approval, denial preserves files, approval executes once, stale replay fails and allow mode bypasses prompts. Model decisions are deterministic test fixtures.');
}finally{child.kill('SIGTERM');await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));await rm(root,{recursive:true,force:true});}
