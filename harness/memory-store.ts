import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { markdownIndex,rankMemories,type MemoryVault,type MemoryDocument } from '../lib/memory-types';
const locks=new Map<string,Promise<unknown>>();
export class MemoryError extends Error{constructor(message:string,readonly status=400){super(message);}}
const tags=z.array(z.string().trim().min(1).max(30).regex(/^[^#\s,，\[\]]+$/)).max(12).default([]);
const title=z.string().trim().min(1).max(80),content=z.string().max(20000);
const documentInput=z.object({title,content,tags,enabled:z.boolean().default(true),pinned:z.boolean().default(false)});
const proposalInput=z.object({title,content:z.string().min(1).max(6000),tags,reason:z.string().min(1).max(500),runId:z.string().max(100).optional()});
const vaultSchema=z.object({
 revision:z.number().int().min(0),enabled:z.boolean(),
 documents:z.array(documentInput.extend({id:z.string().uuid(),path:z.string().max(145),revision:z.number().int().min(1),createdAt:z.number(),updatedAt:z.number(),source:z.enum(['user','agent'])})).max(200),
 proposals:z.array(proposalInput.extend({id:z.string().uuid(),createdAt:z.number()})).max(30),
 recalls:z.array(z.object({at:z.number(),runId:z.string(),query:z.string().max(300),documents:z.array(z.object({id:z.string().uuid(),path:z.string(),revision:z.number().int()}))})).max(20),
});
export const memoryAction=z.discriminatedUnion('action',[
 z.object({action:z.literal('get')}),
 z.object({action:z.literal('create'),path:z.string().trim().min(1).max(140),...documentInput.shape}),
 z.object({action:z.literal('update'),id:z.string().uuid(),revision:z.number().int(),...documentInput.shape}),
 z.object({action:z.literal('delete'),id:z.string().uuid(),revision:z.number().int()}),
 z.object({action:z.literal('settings'),enabled:z.boolean(),revision:z.number().int()}),
 z.object({action:z.literal('approve'),id:z.string().uuid(),...documentInput.shape}),
 z.object({action:z.literal('reject'),id:z.string().uuid()}),
]);
function redact(text:string){return text.replace(/(?:\bsk-[a-zA-Z0-9_-]{16,}|\bgh[pousr]_[a-zA-Z0-9]{20,}|\bgithub_pat_[a-zA-Z0-9_]{20,})/g,'[访问密钥已移除]');}
function rejectSecrets(text:string){if(/(?:\bsk-[a-zA-Z0-9_-]{16,}|\bgh[pousr]_[a-zA-Z0-9]{20,}|\bgithub_pat_[a-zA-Z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/.test(text))throw new MemoryError('检测到疑似访问密钥或私钥，请移除后再保存。');}
function fresh():MemoryVault{
 const now=Date.now();return {revision:0,enabled:true,documents:[['USER.md','用户档案','# 用户档案\n\n'],['MEMORY.md','全局记忆','# 全局记忆\n\n']].map(([file,title,content])=>({id:randomUUID(),path:file,title,content,tags:[],enabled:true,pinned:true,revision:1,createdAt:now,updatedAt:now,source:'user' as const})),proposals:[],recalls:[]};
}
export class MemoryStore{
 constructor(private root:string){}
 private file(owner:string){if(!/^[a-f0-9]{64}$/.test(owner))throw new MemoryError('无效的数据归属。');return path.join(this.root,'.atmos/memory',owner,'vault.json');}
 private async write(file:string,vault:MemoryVault){await mkdir(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+randomUUID()+'.tmp';try{await writeFile(temp,JSON.stringify(vault),{mode:0o600});await rename(temp,file);}finally{await rm(temp,{force:true});}}
 private async transaction<T>(owner:string,fn:(vault:MemoryVault)=>T|Promise<T>,readOnly=false):Promise<T>{
  const file=this.file(owner),prior=locks.get(file)||Promise.resolve();
  const job=prior.catch(()=>{}).then(async()=>{let vault:MemoryVault,created=false;try{vault=vaultSchema.parse(JSON.parse(await readFile(file,'utf8')));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw new MemoryError('记忆库读取失败，请保留文件并检查本地存储。',503);vault=fresh();created=true;}
   const result=await fn(vault);if(!readOnly||created)await this.write(file,vault);return result;});
  locks.set(file,job);try{return await job;}finally{if(locks.get(file)===job)locks.delete(file);}
 }
 async get(owner:string){return this.transaction(owner,v=>structuredClone(v),true);}
 async action(owner:string,input:z.infer<typeof memoryAction>){return this.transaction(owner,v=>{
  if(input.action==='get')return structuredClone(v);
  rejectSecrets(JSON.stringify(input));
  if(input.action==='settings'){if(v.revision!==input.revision)throw new MemoryError('记忆库已更新，请刷新后重试。',409);v.enabled=input.enabled;}
  else if(input.action==='create'){
   let file=input.path;if(!/\.md$/i.test(file))file+='.md';
   if(file.startsWith('/')||file.includes('\\')||file.split('/').some(s=>!s||s==='.'||s==='..')||/[\x00-\x1f\[\]|#<>:]/.test(file)||file.toLowerCase()==='index.md')throw new MemoryError('请使用有效的相对 Markdown 文件名，如 notes/设计偏好.md。');
   if(v.documents.some(d=>d.path.toLowerCase()===file.toLowerCase()))throw new MemoryError('同名文档已存在。',409);
   if(v.documents.length>=200)throw new MemoryError('最多保存 200 篇记忆文档。');
   const now=Date.now();v.documents.push({id:randomUUID(),path:file,title:input.title,content:input.content,tags:[...new Set(input.tags)],enabled:input.enabled,pinned:input.pinned,revision:1,createdAt:now,updatedAt:now,source:'user'});
  }else if(input.action==='update'||input.action==='delete'){
   const doc=v.documents.find(d=>d.id===input.id);if(!doc)throw new MemoryError('文档不存在或不属于当前账户。',404);
   if(doc.revision!==input.revision)throw new MemoryError('文档已被其他窗口修改，请先刷新。当前草稿已保留。',409);
   if(input.action==='delete'){if(['USER.md','MEMORY.md'].includes(doc.path))throw new MemoryError('系统文档请清空内容或暂停使用。');v.documents=v.documents.filter(d=>d.id!==doc.id);}
   else Object.assign(doc,{title:input.title,content:input.content,tags:[...new Set(input.tags)],enabled:input.enabled,pinned:input.pinned,revision:doc.revision+1,updatedAt:Date.now(),source:'user'});
  }else {
   const proposal=v.proposals.find(p=>p.id===input.id);if(!proposal)throw new MemoryError('候选记忆已处理或不存在。',404);
   if(input.action==='approve'){
    if(v.documents.length>=200)throw new MemoryError('最多保存 200 篇记忆文档。');
    const now=Date.now();v.documents.push({id:randomUUID(),path:`memories/${proposal.id}.md`,title:input.title,content:input.content,tags:[...new Set(input.tags)],enabled:input.enabled,pinned:input.pinned,revision:1,createdAt:now,updatedAt:now,source:'agent'});
   }
   v.proposals=v.proposals.filter(p=>p.id!==input.id);
  }
  v.revision++;return structuredClone(v);
 });}
 async search(owner:string,query:string){const v=await this.get(owner);if(!v.enabled)return {disabled:true,documents:[]};return {documents:rankMemories(v.documents.filter(d=>d.enabled),query).slice(0,12).map(({doc,score})=>({id:doc.id,path:doc.path,title:doc.title,tags:doc.tags,score,excerpt:doc.content.slice(0,350)}))};}
 async read(owner:string,id:string,offset=0,length=8000){const v=await this.get(owner);if(!v.enabled)throw new MemoryError('用户已暂停全局记忆。');if(id==='INDEX.md'){const index=markdownIndex({...v,documents:v.documents.filter(d=>d.enabled)});return {path:id,content:index.slice(offset,offset+length),totalCharacters:index.length,truncated:offset+length<index.length};}const d=v.documents.find(d=>(d.id===id||d.path===id)&&d.enabled);if(!d)throw new MemoryError('记忆不存在、已暂停或无权读取。',404);return {id:d.id,path:d.path,title:d.title,revision:d.revision,content:d.content.slice(offset,offset+length),totalCharacters:d.content.length,truncated:offset+length<d.content.length};}
 async propose(owner:string,input:{title:string;content:string;tags:string[];reason:string;runId?:string}){const parsed=proposalInput.safeParse(input);if(!parsed.success)throw new MemoryError('候选记忆参数无效。');input=parsed.data;return this.transaction(owner,v=>{
  if(!v.enabled)throw new MemoryError('用户已暂停全局记忆。');
  rejectSecrets(JSON.stringify(input));
  if(v.proposals.length>=30)throw new MemoryError('已有 30 条候选记忆待确认，请不要继续新增。');
  const duplicate=v.proposals.find(p=>p.content.trim()===input.content.trim())||v.documents.find(d=>d.content.trim()===input.content.trim());if(duplicate)return {duplicate:true,id:duplicate.id};
  const proposal={...input,id:randomUUID(),createdAt:Date.now()};v.proposals.push(proposal);v.revision++;return {id:proposal.id,status:'pending',message:'候选已提交，用户确认后才会用于后续任务。'};
 });}
 async recall(owner:string,query:string,runId:string){return this.transaction(owner,v=>{
  if(!v.enabled)return {text:'',documents:[] as Pick<MemoryDocument,'id'|'path'|'revision'>[]};
  const eligible=v.documents.filter(d=>d.enabled&&d.content.replace(/^#+.*$/gm,'').trim());
  const pinned=eligible.filter(d=>d.pinned).sort((a,b)=>Number(['USER.md','MEMORY.md'].includes(b.path))-Number(['USER.md','MEMORY.md'].includes(a.path))).slice(0,4);
  const ranked=rankMemories(eligible.filter(d=>!pinned.includes(d)),query).slice(0,3).map(x=>x.doc);
  const chosen=[...pinned,...ranked];let remaining=8000;const selected:MemoryDocument[]=[];const chunks:string[]=[];
  for(const d of chosen){if(remaining<=0)break;const chunk=d.content.slice(0,Math.min(2000,remaining));chunks.push(`### ${d.path}（版本 ${d.revision}）\n${chunk}${chunk.length<d.content.length?'\n[节选，可通过记忆工具读取完整内容]':''}`);remaining-=chunk.length;selected.push(d);}
  const documents=selected.map(({id,path,revision})=>({id,path,revision}));v.recalls.unshift({at:Date.now(),runId,query:redact(query).slice(0,300),documents});v.recalls=v.recalls.slice(0,20);
  return {text:chunks.join('\n\n'),documents};
 });}
}
