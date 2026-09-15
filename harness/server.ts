import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { loadExtensions, connectPlugin, setPluginEnabled } from './extensions';
import { connectCore } from './core-tools';
import { Workspace } from './workspace';
import { LiveRun,readRunSnapshot } from './live-run';
import { runAgent } from './loop';
import { ConnectionStore } from './connection-store';
import { manageConnection, connectExternal } from './connections';
import { providers } from '../lib/connection-types';
import { mergeAgentEvent, clipped } from '../lib/agent-events';
import type { AgentEvent, AgentCatalog } from '../lib/agent-types';

const root=process.cwd(),token=process.env.ATMOS_HARNESS_TOKEN;
const connectionStore=new ConnectionStore(root);
const connectionBusy=new Set<string>();
if(!token)throw new Error('Harness requires a per-start authentication token.');
const inputSchema=z.object({owner:z.string().regex(/^[a-f0-9]{64}$/),runId:z.string().uuid().optional(),prompt:z.string().min(1).max(4000),config:z.object({provider:z.string(),model:z.string().min(1).max(150),apiKey:z.string().min(1).max(1000)}),files:z.record(z.string().max(180000)).default({}),history:z.array(z.object({prompt:z.string(),summary:z.string()})).max(8).default([])});
const active=new Set<string>();
const liveRuns=new Map<string,LiveRun>();
const controllers=new Set<AbortController>();
async function readBody(request:import('node:http').IncomingMessage){let body='';for await(const chunk of request){body+=chunk;if(Buffer.byteLength(body)>1100000)throw new Error('请求过大');}return JSON.parse(body||'{}');}
function authorised(header:string|undefined){const value=Buffer.from(header||''),expected=Buffer.from(`Bearer ${token}`);return value.length===expected.length&&timingSafeEqual(value,expected);}
const server=createServer(async(request,response)=>{
  if(!authorised(request.headers.authorization)){response.writeHead(401).end();return;}
  response.setHeader('Cache-Control','no-store');
  try{
    if(request.method!=='POST'){response.writeHead(405).end();return;}
    if(request.url==='/connections'){
      const schema=z.object({owner:z.string().regex(/^[a-f0-9]{64}$/),action:z.enum(['list','connect','test','disconnect']),provider:z.enum(providers).optional(),token:z.string().max(2000).optional()});
      const parsed=schema.safeParse(await readBody(request));
      if(!parsed.success){response.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({error:'连接参数格式无效。'}));return;}
      const input=parsed.data,key=`${input.owner}:${input.provider||'list'}`;
      if(connectionBusy.has(key)){response.writeHead(409,{'Content-Type':'application/json'}).end(JSON.stringify({error:'此连接正在更新，请稍后重试。'}));return;}
      const abort=new AbortController();response.on('close',()=>abort.abort());
      connectionBusy.add(key);
      try{const result=await manageConnection(connectionStore,input.owner,input,abort.signal);response.setHeader('Content-Type','application/json');response.end(JSON.stringify(result));}
      finally{connectionBusy.delete(key);}return;
    }
    if(request.url==='/catalog'){
      const extensions=await loadExtensions(root),abort=new AbortController();response.on('close',()=>abort.abort());
      const catalog:AgentCatalog={available:true,limits:extensions.limits,plugins:[],skills:extensions.skills.map(({id,name,plugin,description})=>({id,name,plugin,description}))};
      const workspace=new Workspace(path.join(root,'.atmos/catalog'));await workspace.init({});const core=await connectCore({workspace,skills:extensions.skills,signal:abort.signal});
      catalog.plugins.push({id:'core',name:'项目工作区',description:'隔离文件、网页、任务、记忆、Skill 与交付工具。',enabled:true,transport:'内置 MCP',tools:core.tools.map(t=>t.name)});await core.close();
      await Promise.all(extensions.plugins.map(async p=>{
        const item={id:p.id,name:p.name,description:p.description,enabled:p.enabled,transport:p.mcp?.transport||'Skill',tools:[] as string[],error:undefined as string|undefined};
        try{const c=await connectPlugin(p,abort.signal);if(c){item.tools=c.tools.map(t=>t.name);await c.close();}}catch{item.error='MCP 连接失败，请检查服务配置或网络。';}
        catalog.plugins.push(item);
      }));
      for(const error of extensions.errors)catalog.plugins.push({id:error.id,name:error.id,description:'插件配置有误',enabled:false,transport:'未知',tools:[],error:error.error});
      response.setHeader('Content-Type','application/json');response.end(JSON.stringify(catalog));return;
    }
    if(request.url==='/plugins'){
      const input=z.object({id:z.string(),enabled:z.boolean()}).parse(await readBody(request));await setPluginEnabled(root,input.id,input.enabled);response.setHeader('Content-Type','application/json');response.end('{"ok":true}');return;
    }
    if(request.url==='/snapshot'){
      const input=z.object({owner:z.string().regex(/^[a-f0-9]{64}$/),runId:z.string().uuid()}).parse(await readBody(request));
      try{const state=liveRuns.get(`${input.owner}:${input.runId}`)?.state||await readRunSnapshot(root,input.owner,input.runId);response.setHeader('Content-Type','application/json');response.end(JSON.stringify(state));}catch{response.writeHead(404,{'Content-Type':'application/json'}).end(JSON.stringify({error:'工作区快照不存在或不属于当前会话。'}));}return;
    }
    if(request.url!=='/run'){response.writeHead(404).end();return;}
    const input=inputSchema.parse(await readBody(request));
    if(active.has(input.owner)||active.size>=3){response.writeHead(409,{'Content-Type':'application/json'}).end(JSON.stringify({error:'已有任务运行中，请停止或等待完成后再开始。'}));return;}
    active.add(input.owner);
    const runId=input.runId||randomUUID(),directory=path.join(root,'.atmos/runs',input.owner,runId),workspace=new Workspace(path.join(directory,'workspace'));
    const abort=new AbortController();controllers.add(abort);response.on('close',()=>{if(!response.writableEnded)abort.abort();});request.on('aborted',()=>abort.abort());
    let trace:AgentEvent[]=[];
    const redact=(text:string)=>input.config.apiKey?text.replaceAll(input.config.apiKey,'[REDACTED]'):text;
    const emit=(data:object)=>{if(!response.destroyed)response.write(`data: ${redact(JSON.stringify(data))}\n\n`);};
    const live=new LiveRun(runId,directory,event=>emit({type:'workspace',event}));
    liveRuns.set(`${input.owner}:${runId}`,live);
    let heartbeat:ReturnType<typeof setInterval>|undefined;
    try{
      await workspace.init(input.files);const extensions=await loadExtensions(root);
      response.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'});
      await live.attach(workspace);
      heartbeat=setInterval(()=>{if(!response.destroyed)response.write(': heartbeat\n\n');},10000);
      const result=await runAgent(input,{workspace,extensions,signal:abort.signal,runId,connectExternal:async signal=>{
        const statuses=await connectionStore.list(input.owner);
        return Promise.all(statuses.map(status=>connectExternal(connectionStore,input.owner,status.provider,signal)));
      },workspaceEvent:event=>live.event(event),emit:event=>{const safe=JSON.parse(redact(JSON.stringify(event))) as AgentEvent;trace=mergeAgentEvent(trace,{...safe,input:safe.input?clipped(safe.input,600):undefined,output:safe.output?clipped(safe.output,1400):undefined});emit({type:'agent',event:safe});}});
      await writeFile(path.join(directory,'run.json'),redact(JSON.stringify({runId,status:'completed',trace,title:result.title,summary:result.summary},null,2)));
      await live.finish('completed');
      emit({type:'result',...result,trace});
    }catch(error){
      const message=abort.signal.aborted?'任务已停止。':(error as Error).message;
      await live.finish('stopped',message);
      emit({type:'error',message});
      await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'run.json'),redact(JSON.stringify({runId,status:'stopped',message,trace},null,2)));
    }finally{if(heartbeat)clearInterval(heartbeat);active.delete(input.owner);liveRuns.delete(`${input.owner}:${runId}`);controllers.delete(abort);response.end();}
  }catch(error){if(!response.headersSent)response.writeHead(400,{'Content-Type':'application/json'});response.end(JSON.stringify({error:(error as Error).message.slice(0,300)}));}
});
server.listen(0,'127.0.0.1',()=>{const address=server.address();if(address&&typeof address!=='string')process.send?.({port:address.port});});
function shutdown(){for(const controller of controllers)controller.abort();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),3000).unref();}
process.on('disconnect',shutdown);process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
