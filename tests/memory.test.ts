import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {MemoryStore,memoryAction} from '../harness/memory-store';
import {connectMemory} from '../harness/memory-tools';
import {markdownIndex,memoryLinks,rankMemories,type MemoryDocument} from '../lib/memory-types';
import {runAgent} from '../harness/loop';
import {Workspace} from '../harness/workspace';
import type {AgentEvent} from '../lib/agent-types';
const a='a'.repeat(64),b='b'.repeat(64);
async function temporary(fn:(store:MemoryStore,root:string)=>Promise<void>){const root=await mkdtemp(path.join(tmpdir(),'atmos-memory-'));try{await fn(new MemoryStore(root),root);}finally{await rm(root,{recursive:true,force:true});}}
const create=(file='notes/design.md',content='偏好天蓝色，布局留白。')=>memoryAction.parse({action:'create',path:file,title:'设计偏好',content,tags:['设计']});

test('memory persists by stable owner across store restarts and rejects cross-owner IDs',()=>temporary(async(store,root)=>{
 const v=await store.action(a,create()),d=v.documents.at(-1)!;
 assert.equal((await new MemoryStore(root).read(a,d.id)).content,d.content);
 assert.equal((await store.get(b)).documents.length,2);
 await assert.rejects(()=>store.read(b,d.id),/无权/);
 await assert.rejects(()=>store.action(b,memoryAction.parse({...d,action:'update'})),/不属于/);
 await assert.rejects(()=>store.get('../a'),/无效/);
}));
test('agent proposals are absent from retrieval until edited approval, and cannot be approved twice',()=>temporary(async store=>{
 const p=await store.propose(a,{title:'界面偏好',content:'候选紫色界面',tags:['设计'],reason:'用户本次表达的偏好'});
 assert.equal((await store.search(a,'紫色')).documents.length,0);
 assert.doesNotMatch((await store.recall(a,'紫色','r1')).text,/紫色/);
 await assert.rejects(()=>store.read(a,p.id),/无权/);
 const v=await store.action(a,memoryAction.parse({action:'approve',id:p.id,title:'确认后的界面偏好',content:'确认天蓝色界面',tags:['设计'],pinned:true}));
 assert.equal(v.proposals.length,0);assert.equal((await store.search(a,'天蓝色')).documents.length,1);
 assert.match((await store.recall(a,'界面','r2')).text,/确认天蓝色/);
 await assert.rejects(()=>store.action(a,memoryAction.parse({action:'approve',id:p.id,title:'二次确认',content:'不能重复'})),/已处理/);
}));
test('paused documents, global disable and deletions stop future reads and recalls',()=>temporary(async store=>{
 let v=await store.action(a,create());let d=v.documents.at(-1)!;
 v=await store.action(a,memoryAction.parse({...d,action:'update',enabled:false}));d=v.documents.at(-1)!;
 assert.equal((await store.search(a,'天蓝色')).documents.length,0);assert.equal((await store.recall(a,'天蓝色','r1')).documents.length,0);
 await assert.rejects(()=>store.read(a,d.id),/已暂停/);
 v=await store.action(a,memoryAction.parse({...d,action:'update',enabled:true}));d=v.documents.at(-1)!;
 v=await store.action(a,{action:'settings',enabled:false,revision:v.revision});
 assert.equal((await store.search(a,'天蓝色')).disabled,true);assert.equal((await store.recall(a,'天蓝色','r2')).text,'');
 await assert.rejects(()=>store.propose(a,{title:'测试',content:'新记忆',tags:[],reason:'明确要求'}),/暂停/);
 v=await store.action(a,{action:'settings',enabled:true,revision:v.revision});
 await store.action(a,{action:'delete',id:d.id,revision:d.revision});
 assert.equal((await store.search(a,'天蓝色')).documents.length,0);
 await assert.rejects(()=>store.action(a,{action:'delete',id:v.documents[0].id,revision:1}),/系统文档/);
}));
test('concurrent edits use optimistic revision checks and rejected writes leave original data intact',()=>temporary(async store=>{
 const v=await store.action(a,create()),d=v.documents.at(-1)!;
 const results=await Promise.allSettled(['甲','乙'].map(content=>store.action(a,memoryAction.parse({...d,action:'update',content}))));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const failed=results.find(r=>r.status==='rejected') as PromiseRejectedResult;assert.equal(failed.reason.status,409);
 const next=await store.get(a);assert.equal(next.documents.at(-1)?.revision,2);
 await assert.rejects(()=>store.action(a,{action:'settings',enabled:false,revision:v.revision}),/已更新/);
 for(const file of ['../escape.md','/absolute.md','notes/../bad.md','notes\\bad.md','INDEX.md','bad[[x]].md'])await assert.rejects(()=>store.action(a,create(file)),/文件名/);
 await assert.rejects(()=>store.action(a,create('NOTES/DESIGN.MD')),/同名/);
}));
test('known access tokens are rejected; MCP proposals also reject the active arbitrary model secret',()=>temporary(async(store,root)=>{
 await assert.rejects(()=>store.action(a,create('secret.md','sk-'+ 'x'.repeat(30))),/密钥/);
 const connection=await connectMemory(store,a,'run','arbitrary-secret-exact-value');
 try{const result=await connection.client.callTool({name:'propose',arguments:{title:'bad',content:'arbitrary-secret-exact-value',reason:'不能保存',tags:[]}});assert.equal(result.isError,true);assert.equal((await store.get(a)).proposals.length,0);}finally{await connection.close();}
 await store.recall(a,'token sk-'+ 'x'.repeat(30),'r');
 assert.doesNotMatch(await readFile(path.join(root,'.atmos/memory',a,'vault.json'),'utf8'),/sk-x{30}/);
}));
test('recall bounds document context and history, read supports exact continuation',()=>temporary(async store=>{
 for(let i=0;i<6;i++)await store.action(a,memoryAction.parse({...create(`long/${i}.md`,'长'.repeat(12000)),pinned:true}));
 for(let i=0;i<22;i++){const recall=await store.recall(a,'长',String(i));assert.ok(recall.text.length<4500);assert.ok(recall.documents.length<=7);}
 const v=await store.get(a);assert.equal(v.recalls.length,20);
 const read=await store.read(a,v.documents[2].id,11000,2000);assert.equal(read.content.length,1000);assert.equal('truncated' in read&&read.truncated,false);
}));
test('wikilinks resolve paths and unique names, preserve unresolved references and skip fenced code',()=>{
 const make=(id:string,file:string,title:string,content=''):MemoryDocument=>({id,path:file,title,content,tags:[],enabled:true,pinned:false,revision:1,createdAt:0,updatedAt:0,source:'user'});
 const docs=[make('1','USER.md','档案','[[notes/design|设计]] [[重复]] [[missing]]\n```\n[[MEMORY.md]]\n```'),make('2','notes/design.md','设计偏好'),make('3','notes/a.md','重复'),make('4','other/a.md','重复'),make('5','MEMORY.md','记忆','[[USER]]')];
 const {links,unresolved}=memoryLinks(docs);assert.deepEqual(links.map(l=>[l.source,l.target]),[['1','2'],['5','1']]);assert.equal(unresolved.length,2);
 assert.equal(rankMemories(docs,'设计偏好')[0].doc.id,'2');assert.match(markdownIndex({documents:docs,revision:0,enabled:true,proposals:[],recalls:[]}),/\[\[USER.md\|档案\]\]/);
});
test('agent injects confirmed memory, calls real memory MCP tools and leaves new facts pending',()=>temporary(async(store,root)=>{
 await store.action(a,create());const pending=await store.propose(a,{title:'待确认',content:'待确认神秘偏好',tags:[],reason:'test'});
 const w=new Workspace(path.join(root,'work'));await w.init({});await w.write('index.html','<!doctype html><html><body><button onclick="this.textContent=\'已点击\'">测试</button></body></html>');
 let round=0;const events:AgentEvent[]=[];
 await runAgent({prompt:'设计一个应用，请记住我喜欢简洁导航',config:{provider:'deepseek',model:'test',apiKey:'unused-local-test-secret'}},{workspace:w,memory:{store,owner:a},runId:'run-test',extensions:{plugins:[],skills:[],errors:[],limits:{maxIterations:8,maxToolCalls:12,maxResearchCalls:0,maxCallsPerTurn:4,maxOutputRetries:2,timeoutSeconds:30}},signal:new AbortController().signal,emit:e=>events.push(e),turn:async(_c,messages,tools)=>{
  assert.match(JSON.stringify(messages),/天蓝色/);assert.doesNotMatch(JSON.stringify(messages),/待确认神秘偏好/);
  assert.ok(tools.some(t=>t.function.name==='memory__search'));
  const n=++round,name=n===1?'memory__search':n===2?'memory__propose':'core__complete_task',args=n===1?{query:'设计'}:n===2?{title:'导航偏好',content:'喜欢简洁导航',tags:['设计'],reason:'用户明确说请记住我喜欢简洁导航'}:{title:'测试应用',summary:'已完成应用，导航偏好等待确认。'};
  return {content:'正在使用已确认记忆。',finish:'tool_calls',calls:[{id:String(n),type:'function',function:{name,arguments:JSON.stringify(args)}}]};
 }});
 assert.equal(round,3);assert.ok(events.some(e=>e.type==='notice'&&e.text?.includes('加载')));assert.ok(events.filter(e=>e.type==='budget').every(e=>e.researchUsed===0));
 const v=await store.get(a);assert.equal(v.proposals.length,2);assert.ok(v.proposals.some(p=>p.id===pending.id));assert.ok(v.recalls[0].documents.length>0);
}));

test('pending queue is bounded and rejects invalid proposals without replacing stored memory',()=>temporary(async store=>{
 for(let n=0;n<30;n++)await store.propose(a,{title:'偏好 '+n,content:'唯一记忆 '+n,tags:[],reason:'明确用户表达'});
 await assert.rejects(()=>store.propose(a,{title:'超额',content:'第31条',tags:[],reason:'明确表达'}),/30 条/);
 await assert.rejects(()=>store.propose(a,{title:'非法标签',content:'测试',tags:['bad tag'],reason:'明确表达'}),/参数无效/);
 const v=await store.get(a);assert.equal(v.proposals.length,30);assert.equal(v.documents.length,2);
}));


test('corrupt vaults report an error without erasing recoverable data; index pagination is explicit',()=>temporary(async(store,root)=>{
 const v=await store.get(a),index=await store.read(a,'INDEX.md',0,10);assert.equal(index.truncated,true);assert.equal(index.content.length,10);
 const file=path.join(root,'.atmos/memory',a,'vault.json');await writeFile(file,JSON.stringify({...v,documents:null}));
 await assert.rejects(()=>store.get(a),/读取失败/);assert.equal(JSON.parse(await readFile(file,'utf8')).documents,null);
}));
