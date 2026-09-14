import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, symlink, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Workspace } from '../harness/workspace';
import { runAgent,buildContext } from '../harness/loop';
import { modelTurn,type Message,type ModelReply } from '../harness/model';
import { loadExtensions,connectPlugin,type Extensions } from '../harness/extensions';
import { isPrivateAddress,publicUrl } from '../harness/network';
import type { AgentEvent } from '../lib/agent-types';
const config={provider:'deepseek',model:'deepseek-flash',apiKey:'test-only-not-real'};
const html='<!DOCTYPE html><html><body><button onclick="this.textContent=\'已点击\'">点击</button><script>const value = 1;</script></body></html>';
function reply(name:string,args:unknown,id='tool-1'):ModelReply{return{content:'',finish:'tool_calls',calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]};}
const extensions:Extensions={plugins:[],skills:[{id:'test/design',name:'design',plugin:'test',description:'Test skill',content:'Read existing code and verify changes.'}],errors:[],limits:{maxIterations:12,maxToolCalls:30,maxCallsPerTurn:4,maxResearchCalls:6,maxOutputRetries:2,timeoutSeconds:30}};
async function temporary(fn:(workspace:Workspace)=>Promise<void>){const root=await mkdtemp(path.join(tmpdir(),'atmos-harness-test-'));try{const w=new Workspace(root);await w.init({});await fn(w);}finally{await rm(root,{recursive:true,force:true});}}

test('agent loops through failed completion, real MCP edits and validation until a valid deliverable',async()=>temporary(async workspace=>{
  const events:AgentEvent[]=[];let round=0;
  const result=await runAgent({prompt:'Build a button',config},{workspace,extensions,signal:new AbortController().signal,emit:e=>events.push(e),turn:async(_config,messages,tools)=>{
    assert.ok(tools.some(t=>t.function.name==='core__load_skill'));
    const n=++round;
    if(n===1)return reply('core__load_skill',{id:'test/design'},'skill');
    if(n===2)return reply('core__complete_task',{title:'未完成',summary:'premature'},'premature');
    if(n===3){assert.ok(messages.some(m=>m.role==='tool'&&m.content?.includes('交付检查失败')));return reply('core__write_file',{path:'index.html',content:html.replace('value = 1','value = ;')},'bad-file');}
    if(n===4)return reply('core__validate_app',{},'check');
    if(n===5){assert.ok(messages.some(m=>m.role==='tool'&&m.content?.includes('JavaScript')));return reply('core__edit_file',{path:'index.html',old_text:'value = ;;',new_text:'value = 1;'},'fix');}
    if(n===6)return reply('core__write_memory',{text:'User wants a simple button.'},'memory');
    return reply('core__complete_task',{title:'按钮应用',summary:'已实现按钮，语法检查通过。'},'complete');
  }});
  assert.equal(round,7);assert.equal(result.code,html);assert.equal(result.files['.agent/MEMORY.md'],'User wants a simple button.');
  assert.ok(events.some(e=>e.type==='tool_end'&&e.callId==='premature'&&e.ok===false));
  assert.equal(events.at(-1)?.type,'complete');assert.equal(await readFile(path.join(workspace.root,'index.html'),'utf8'),html);
}));

test('empty final replies do not bypass completion; budget stops remain incomplete',async()=>temporary(async workspace=>{
  const events:AgentEvent[]=[];
  await assert.rejects(()=>runAgent({prompt:'Build',config},{workspace,extensions:{...extensions,limits:{...extensions.limits,maxIterations:2}},signal:new AbortController().signal,emit:e=>events.push(e),turn:async()=>({content:'Done without files',calls:[],finish:'stop'})}),/模型循环上限/);
  assert.equal(events.at(-1)?.reason,'iteration_limit');assert.ok(!events.some(e=>e.type==='complete'));
}));

test('unknown tools and malformed arguments return errors to the model instead of terminating the loop',async()=>temporary(async workspace=>{
  let n=0;await workspace.write('index.html',html);
  await runAgent({prompt:'Check',config},{workspace,extensions,signal:new AbortController().signal,emit:()=>{},turn:async(_c,messages)=>{
    if(++n===1)return reply('unknown_tool',{},'bad');
    assert.ok(messages.some(m=>m.role==='tool'&&m.content?.includes('未知工具')));
    if(n===2){const malformed=reply('core__read_file',{},'malformed');malformed.calls[0].function.arguments='{';return malformed;}
    assert.ok(messages.some(m=>m.role==='tool'&&m.tool_call_id==='malformed'&&m.content?.includes('error')));
    return reply('core__complete_task',{title:'已检查',summary:'完整文档已验证。'},'done');
  }});assert.equal(n,3);
}));

test('user cancellation ends the active loop without claiming completion',async()=>temporary(async workspace=>{
  const abort=new AbortController();const events:AgentEvent[]=[];
  await assert.rejects(()=>runAgent({prompt:'Build',config},{workspace,extensions,signal:abort.signal,emit:e=>{events.push(e);if(e.type==='iteration')abort.abort();},turn:async(_a,_b,_c,signal)=>{signal.throwIfAborted();throw new Error('unexpected');}}),/用户已停止/);
  assert.equal(events.at(-1)?.reason,'cancelled');
}));

test('workspace rejects traversal and symlinks and checks real JavaScript syntax',async()=>temporary(async workspace=>{
  await assert.rejects(()=>workspace.write('../escape','x'),/相对路径/);
  await symlink(tmpdir(),path.join(workspace.root,'escape'));
  await assert.rejects(()=>workspace.write('escape/file','x'),/符号链接/);
  await workspace.write('index.html',html.replace('value = 1','value = ;'));
  assert.equal((await workspace.validate()).ok,false);
}));

test('context compaction preserves complete assistant-tool message groups',()=>{
  const base:Message[]=[{role:'system',content:'system'},{role:'user',content:'task'}];
  const turns:Message[][]=Array.from({length:12},(_,i)=>[{role:'assistant',content:null,tool_calls:[{id:String(i),type:'function',function:{name:'read',arguments:'{}'}}]},{role:'tool',tool_call_id:String(i),content:'result'}]);
  const context=buildContext(base,turns);assert.ok(context.length<26);
  for(const message of context.filter(m=>m.role==='tool'))assert.ok(context.some(m=>m.tool_calls?.some(c=>c.id===message.tool_call_id)));
});

test('streaming tool calls reconstruct split argument deltas and reject incomplete streams',async()=>{
  const old=globalThis.fetch;
  const chunks=[{choices:[{delta:{tool_calls:[{index:0,id:'call-1',function:{name:'core__read_file',arguments:'{"pa'}}]}}]},{choices:[{delta:{tool_calls:[{index:0,function:{arguments:'th":"index.html"}'}}]},finish_reason:'tool_calls'}]}];
  try{
    globalThis.fetch=async()=>new Response(chunks.map(c=>'data: '+JSON.stringify(c)+'\n\n').join(''));
    const result=await modelTurn(config,[],[],new AbortController().signal);assert.equal(result.calls[0].function.arguments,'{"path":"index.html"}');
    globalThis.fetch=async()=>new Response('data: '+JSON.stringify(chunks[0])+'\n\n');
    await assert.rejects(()=>modelTurn(config,[],[],new AbortController().signal),/提前结束/);
  }finally{globalThis.fetch=old;}
});

test('plugin loader discovers skills and stdio MCP tools execute via official transport',async()=>{
  const config=await loadExtensions(process.cwd());assert.equal(config.errors.length,0);assert.ok(config.skills.some(s=>s.id==='developer/app-builder'));
  const plugin=config.plugins.find(p=>p.id==='utilities')!;const connection=await connectPlugin(plugin,AbortSignal.timeout(10000));
  assert.ok(connection);try{assert.ok(connection.tools.some(t=>t.name==='calculate'));const result=await connection.client.callTool({name:'calculate',arguments:{a:12,b:4,operation:'divide'}});assert.match(JSON.stringify(result),/result.*3/);}finally{await connection.close();}
});

test('web browsing rejects private targets and non-HTTP protocols',async()=>{
  for(const address of ['127.0.0.1','10.0.0.1','192.168.1.2','169.254.169.254','::1','::ffff:7f00:1'])assert.equal(isPrivateAddress(address),true);
  await assert.rejects(()=>publicUrl('http://127.0.0.1/'),/本机或内网/);
  await assert.rejects(()=>publicUrl('file:///etc/passwd'),/HTTP/);
});

test('tool budget and repeated no-progress calls stop with distinct reasons',async()=>temporary(async workspace=>{
  for(const [limits,reason] of [[{maxIterations:12,maxToolCalls:1,timeoutSeconds:30},'tool_limit'],[{maxIterations:12,maxToolCalls:30,timeoutSeconds:30},'no_progress']] as const){
    const events:AgentEvent[]=[];
    await assert.rejects(()=>runAgent({prompt:'Build',config},{workspace,extensions:{...extensions,limits:{...extensions.limits,...limits}},signal:new AbortController().signal,emit:e=>events.push(e),turn:async()=>reply('core__list_files',{})}));
    assert.equal(events.at(-1)?.reason,reason);
  }
}));

test('unfinished task lists must be resolved before completing the task',async()=>temporary(async workspace=>{
  await workspace.write('index.html',html);await workspace.write('.agent/tasks.json',JSON.stringify([{id:'1',title:'验证按钮',status:'in_progress'}]));
  let round=0;
  await runAgent({prompt:'Verify',config},{workspace,extensions,signal:new AbortController().signal,emit:()=>{},turn:async(_c,messages)=>{
    if(++round===1)return reply('core__complete_task',{title:'按钮',summary:'过早完成'},'early');
    if(round===2){assert.ok(messages.some(m=>m.role==='tool'&&m.content?.includes('未完成项')));return reply('core__update_tasks',{tasks:[{id:'1',title:'验证按钮',status:'completed'}]},'tasks');}
    return reply('core__complete_task',{title:'按钮',summary:'已完成检查。'},'done');
  }});assert.equal(round,3);
}));


test('wall-clock timeout aborts a pending model call without reporting completion',async()=>temporary(async workspace=>{
  const events:AgentEvent[]=[];
  await assert.rejects(()=>runAgent({prompt:'Build',config},{workspace,extensions:{...extensions,limits:{...extensions.limits,timeoutSeconds:0.05}},signal:new AbortController().signal,emit:e=>events.push(e),turn:async(_a,_b,_c,signal)=>new Promise((_resolve,reject)=>{
    const hold=setTimeout(()=>reject(new Error('timeout did not abort')),1000);
    const abort=()=>{clearTimeout(hold);reject(signal.reason);};
    if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
  })}),/运行超时/);
  assert.equal(events.at(-1)?.reason,'timeout');assert.ok(!events.some(e=>e.type==='complete'));
}));

test('public progress streams before completion while private reasoning is never emitted',async()=>{
  const old=globalThis.fetch;
  const encoder=new TextEncoder();let stream!:ReadableStreamDefaultController<Uint8Array>;
  const updates:string[]=[];let early!:()=>void;const received=new Promise<void>(resolve=>{early=resolve;});
  try{
    globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){stream=controller;}}));
    const pending=modelTurn(config,[],[],new AbortController().signal,(_n,text)=>{updates.push(text||'');if(text)early();});
    stream.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{reasoning_content:'PRIVATE_INTERNAL_TRACE',content:'正在检查文件。'}}]})+'\n\n'));
    await received;assert.equal(updates.at(-1),'正在检查文件。');
    stream.enqueue(encoder.encode('data: '+JSON.stringify({choices:[{delta:{content:'随后修复。'},finish_reason:'stop'}]})+'\n\n'));stream.close();
    assert.equal((await pending).content,'正在检查文件。随后修复。');assert.ok(!JSON.stringify(updates).includes('PRIVATE_INTERNAL_TRACE'));
  }finally{globalThis.fetch=old;}
});

test('truncated batches cause no partial writes; recovery continues from existing files',async()=>temporary(async workspace=>{
  const old=globalThis.fetch;let requests=0;const events:AgentEvent[]=[];
  const split=html.indexOf('<script>');await workspace.write('index.html',html.slice(0,split));
  try{
    globalThis.fetch=async(_url,options)=>{
      const body=JSON.parse(options?.body as string);requests++;
      const response=(calls:ReturnType<typeof reply>['calls'],finish='tool_calls')=>new Response('data: '+JSON.stringify({choices:[{delta:{tool_calls:calls.map((c,index)=>({...c,index}))},finish_reason:finish}]})+'\n\n');
      if(requests===1){const calls=[...reply('core__write_file',{path:'must-not-exist.txt',content:'discarded'},'partial-1').calls,...reply('core__write_file',{},'partial-2').calls];calls[1].function.arguments='{"path":"index.html","content":"unfinished';return response(calls,'length');}
      assert.ok(body.messages.some((m:Message)=>m.content?.includes('整轮工具均未执行')));
      assert.ok(!JSON.stringify(body.messages).includes('must-not-exist'));
      if(requests===2)return response(reply('core__append_file',{path:'index.html',content:html.slice(split),expectedLength:split},'append').calls);
      return response(reply('core__complete_task',{title:'按钮',summary:'已修复并验证。'},'finish').calls);
    };
    const completed=await runAgent({prompt:'Build',config},{workspace,extensions,signal:new AbortController().signal,emit:e=>events.push(e)});
    assert.equal(completed.code,html);assert.equal(requests,3);assert.ok(!('must-not-exist.txt' in completed.files));
    assert.equal(events.filter(e=>e.reason==='output_recovery').length,1);assert.equal(events.filter(e=>e.type==='tool_start').length,2);
  }finally{globalThis.fetch=old;}
}));

test('repeated incomplete output exhausts bounded recovery without tool side effects',async()=>temporary(async workspace=>{
  const {ModelOutputError}=await import('../harness/model');let rounds=0;const events:AgentEvent[]=[];
  await assert.rejects(()=>runAgent({prompt:'Build',config},{workspace,extensions,signal:new AbortController().signal,emit:e=>events.push(e),turn:async()=>{rounds++;throw new ModelOutputError('incomplete','断流');}}),/自动恢复上限/);
  assert.equal(rounds,3);assert.equal(events.at(-1)?.reason,'output_limit');assert.deepEqual(await workspace.list(),[]);
}));

test('per-turn tool cap denies overflow calls and feeds the denial back to the model',async()=>temporary(async workspace=>{
  await workspace.write('index.html',html);let rounds=0;const events:AgentEvent[]=[];
  await runAgent({prompt:'Check',config},{workspace,extensions:{...extensions,limits:{...extensions.limits,maxCallsPerTurn:2}},signal:new AbortController().signal,emit:e=>events.push(e),turn:async(_c,messages)=>{
    if(++rounds===1)return {content:'写入两个说明文件。',finish:'tool_calls',calls:[1,2,3].flatMap(n=>reply('core__write_file',{path:`note-${n}.txt`,content:String(n)},String(n)).calls)};
    assert.ok(messages.some(m=>m.role==='tool'&&m.tool_call_id==='3'&&m.content?.includes('此调用未执行')));
    return reply('core__complete_task',{title:'按钮',summary:'已检查。'});
  }});
  assert.deepEqual(await workspace.list(),['index.html','note-1.txt','note-2.txt']);
  assert.equal(events.find(e=>e.type==='tool_end'&&e.callId==='3')?.ok,false);
}));

test('research budget removes tools and rejects further model-selected web calls',async()=>temporary(async workspace=>{
  await workspace.write('index.html',html);let rounds=0;const events:AgentEvent[]=[];
  await runAgent({prompt:'Check',config},{workspace,extensions:{...extensions,limits:{...extensions.limits,maxResearchCalls:1}},signal:new AbortController().signal,emit:e=>events.push(e),turn:async(_c,messages,tools)=>{
    if(++rounds===1){assert.ok(tools.some(t=>t.function.name==='core__read_webpage'));return reply('core__read_webpage',{url:'http://127.0.0.1/'},'first');}
    assert.ok(!tools.some(t=>t.function.name==='core__read_webpage'));
    if(rounds===2)return reply('core__read_webpage',{url:'http://localhost/'},'blocked');
    assert.ok(messages.some(m=>m.tool_call_id==='blocked'&&m.content?.includes('联网调用预算')));
    return reply('core__complete_task',{title:'按钮',summary:'已检查。'});
  }});
  assert.equal(events.findLast(e=>e.type==='budget')?.researchUsed,1);
}));

test('total tool cap stops a multi-call batch before excess file mutations',async()=>temporary(async workspace=>{
  const events:AgentEvent[]=[];let rounds=0;
  await assert.rejects(()=>runAgent({prompt:'Build',config},{workspace,extensions:{...extensions,limits:{...extensions.limits,maxToolCalls:2}},signal:new AbortController().signal,emit:e=>events.push(e),turn:async()=>{rounds++;return{content:'',finish:'tool_calls',calls:[1,2,3].flatMap(n=>reply('core__write_file',{path:`file-${n}.txt`,content:String(n)},String(n)).calls)};}}),/工具调用上限/);
  assert.equal(rounds,1);assert.equal((await workspace.list()).length,2);assert.equal(events.findLast(e=>e.type==='budget')?.used,2);
}));

test('append uses expected length to reject replay and preserves existing content',async()=>temporary(async workspace=>{
  const {connectCore}=await import('../harness/core-tools');await workspace.write('notes.txt','start');
  const connection=await connectCore({workspace,skills:[],signal:new AbortController().signal});
  try{
    const args={name:'append_file',arguments:{path:'notes.txt',content:' end',expectedLength:5}};
    assert.ok(!(await connection.client.callTool(args)).isError);
    assert.equal((await connection.client.callTool(args)).isError,true);
    assert.equal(await workspace.read('notes.txt'),'start end');
  }finally{await connection.close();}
}));

test('stream event updates keep one public message and context drops oversized complete groups',async()=>{
  const {mergeAgentEvent,clipped}=await import('../lib/agent-events');
  let events:AgentEvent[]=[{type:'tool_start',at:0,callId:'original'}];
  for(let i=0;i<800;i++)events=mergeAgentEvent(events,{type:'assistant',at:i,iteration:1,text:String(i),streaming:true});
  assert.equal(events.length,2);assert.equal(events[0].callId,'original');assert.equal(events[1].text,'799');
  assert.match(clipped('a'.repeat(20),10),/展示已截断/);
  const context=buildContext([{role:'system',content:'rules'}],[[{role:'assistant',content:null,tool_calls:[{id:'big',type:'function',function:{name:'write_file',arguments:'x'.repeat(160000)}}]},{role:'tool',tool_call_id:'big',content:'Saved 160000 characters'}]]);
  assert.ok(JSON.stringify(context).length<10000);assert.ok(!context.some(m=>m.role==='tool'));assert.match(JSON.stringify(context),/Saved 160000/);
});
