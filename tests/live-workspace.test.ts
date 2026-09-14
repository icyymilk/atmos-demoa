import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {Workspace} from '../harness/workspace';
import {LiveRun,readRunSnapshot} from '../harness/live-run';
import {draftFromCall,partialStrings} from '../harness/draft';
import {applyWorkspaceEvent,lineChanges,type WorkspaceEvent} from '../lib/live-workspace';
import {runAgent} from '../harness/loop';
import {modelTurn,type ModelReply} from '../harness/model';
const html='<!DOCTYPE html><html><body><button id="counter">0</button><script>let n=0;counter.onclick=()=>counter.textContent=++n;</script></body></html>';
const config={provider:'deepseek',model:'deepseek-flash',apiKey:'test-not-a-key'};
const extensions={plugins:[],skills:[],errors:[],limits:{maxIterations:6,maxToolCalls:10,maxCallsPerTurn:4,maxResearchCalls:0,maxOutputRetries:2,timeoutSeconds:30}};
async function temp(fn:(root:string)=>Promise<void>){const root=await mkdtemp(path.join(tmpdir(),'atmos-live-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}}

test('file snapshots precede completion, failed partial HTML keeps the last checked preview',()=>temp(async root=>{
  const events:WorkspaceEvent[]=[];const w=new Workspace(path.join(root,'workspace'));await w.init({'index.html':html});
  const live=new LiveRun(randomUUID(),root,e=>events.push(e));await live.attach(w);
  assert.equal(live.state?.preview?.code,html);
  const changed=html.replace('>0</button>','>5</button>');
  await w.write('index.html',changed.slice(0,-7));
  assert.equal(live.state?.files['index.html'].revision,1);assert.ok(live.state?.issues.length);assert.equal(live.state?.preview?.revision,0);
  await w.write('index.html',changed);
  assert.equal(live.state?.preview?.revision,2);assert.equal(live.state?.preview?.code,changed);
  assert.equal(live.state?.status,'running');assert.ok(events.some(e=>e.kind==='file'&&e.content===changed));
  await w.remove('index.html');assert.equal(live.state?.files['index.html'].deleted,true);assert.equal(live.state?.preview?.code,changed);
  await live.finish('stopped');assert.equal(JSON.parse(await readFile(path.join(root,'snapshot.json'),'utf8')).status,'stopped');
}));

test('partial JSON draft extraction handles escaped strings and never writes or executes',()=>{
  const args=JSON.stringify({path:'index.html',content:'<p title="旅行">你好\n世界\\路径</p>'});
  for(let i=0;i<args.length;i++){const fields=partialStrings(args.slice(0,i));if(fields.content)assert.ok('<p title="旅行">你好\n世界\\路径</p>'.startsWith(fields.content));}
  assert.equal(partialStrings(args).content,'<p title="旅行">你好\n世界\\路径</p>');
  assert.equal(partialStrings('{"path":"a","content":"\\u4f60\\u59').content,'你');
  const call={id:'x',type:'function' as const,function:{name:'core__write_file',arguments:args.slice(0,-3)}};
  assert.equal(draftFromCall(call,2)?.status,'generating');
  assert.equal(draftFromCall({...call,function:{...call.function,arguments:'{"path":"../outside","content":"x"}'}},1),undefined);
  assert.equal(draftFromCall({...call,function:{name:'external_tool',arguments:args}},1),undefined);
});

test('deduplicated events preserve large files and detect gaps without applying another run',()=>{
  const init={kind:'init' as const,files:{},runId:'run-a',seq:1,at:0};let state=applyWorkspaceEvent(null,init);
  const content='a'.repeat(160000);const file={kind:'file' as const,path:'big.txt',content,revision:1,runId:'run-a',seq:2,at:1};state=applyWorkspaceEvent(state,file);
  assert.equal(state?.files['big.txt'].content?.length,160000);assert.equal(applyWorkspaceEvent(state,file),state);
  assert.equal(applyWorkspaceEvent(state,{...file,runId:'run-b',seq:3}),state);
  state=applyWorkspaceEvent(state,{kind:'activity',action:'read',runId:'run-a',seq:4,at:2});assert.equal(state?.gap,true);
  assert.deepEqual(lineChanges('a\nb\nc','a\nB\nc'),{start:1,removed:['b'],added:['B']});
});

test('stopped snapshots are owner scoped and disk-only running snapshots never resume tools',()=>temp(async root=>{
  const owner='a'.repeat(64),id=randomUUID(),directory=path.join(root,'.atmos/runs',owner,id);const w=new Workspace(path.join(directory,'workspace'));await w.init({'index.html':html});const live=new LiveRun(id,directory,()=>{});await live.attach(w);
  const snapshot=await readRunSnapshot(root,owner,id);assert.equal(snapshot.status,'stopped');assert.equal(snapshot.files['index.html'].content,html);
  await assert.rejects(()=>readRunSnapshot(root,'b'.repeat(64),id));
  await assert.rejects(()=>readRunSnapshot(root,'../',id),/无效/);
}));

test('agent writes emit live files before complete_task and stop discards only draft',()=>temp(async root=>{
  const events:WorkspaceEvent[]=[];const w=new Workspace(path.join(root,'workspace'));await w.init({});const live=new LiveRun(randomUUID(),root,e=>events.push(e));await live.attach(w);let round=0;
  const result=await runAgent({prompt:'Build',config},{workspace:w,extensions,runId:live.runId,signal:new AbortController().signal,emit:()=>{},workspaceEvent:e=>live.event(e),turn:async(_c,_m,_t,_s,progress)=>{
    if(++round===1){const call={id:'w',type:'function' as const,function:{name:'core__write_file',arguments:JSON.stringify({path:'index.html',content:html})}};progress?.(100,'正在写入按钮。','output',[call]);assert.ok(events.some(e=>e.kind==='draft'));assert.equal(live.state?.files['index.html'],undefined);return{content:'',finish:'tool_calls',calls:[call]};}
    assert.equal(live.state?.preview?.code,html);return{content:'',finish:'tool_calls',calls:[{id:'done',type:'function',function:{name:'core__complete_task',arguments:JSON.stringify({title:'按钮',summary:'已完成'})}}]} as ModelReply;
  }});
  assert.equal(result.code,html);assert.equal(live.state?.status,'running');await live.finish('completed');assert.deepEqual(live.state?.drafts,{});
}));

test('stream parser sends file draft deltas before the complete model reply',async()=>{
  const old=globalThis.fetch;let stream!:ReadableStreamDefaultController<Uint8Array>;let ready!:()=>void;const seen=new Promise<void>(r=>{ready=r;});const encoder=new TextEncoder();
  try{
    globalThis.fetch=async()=>new Response(new ReadableStream({start(c){stream=c;}}));
    const pending=modelTurn(config,[],[],new AbortController().signal,(_n,_text,_phase,calls)=>{if(calls?.[0]?.function.arguments.includes('content'))ready();});
    const send=(delta:object,finish?:string)=>stream.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta,finish_reason:finish}]})+'\n\n'));
    send({tool_calls:[{index:0,id:'w',function:{name:'core__write_file',arguments:'{"path":"index.html","content":"<html>'}}]});await seen;
    send({tool_calls:[{index:0,function:{arguments:'</html>"}'}}]},'tool_calls');stream.close();assert.equal((await pending).calls.length,1);
  }finally{globalThis.fetch=old;}
});
