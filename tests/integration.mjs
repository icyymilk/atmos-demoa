import assert from 'node:assert/strict';
const origin = process.env.ATMOS_TEST_URL || 'http://localhost:5173';
async function call(path, {cookie, data, method = data !== undefined ? 'POST' : 'GET', extra = {}} = {}) {
  return fetch(origin + path, { method, headers: { 'Content-Type':'application/json', ...(cookie ? {cookie} : {}), ...extra }, ...(data !== undefined ? {body:JSON.stringify(data)} : {}) });
}
const a = await call('/api/session', {data:{name:'接口测试'}}); assert.equal(a.status, 200);
const cookie = a.headers.get('set-cookie').split(';')[0];
const b = await call('/api/session', {data:{name:'隔离会话'}}); const other = b.headers.get('set-cookie').split(';')[0];
assert.match(a.headers.get('set-cookie'), /HttpOnly/);
assert.equal((await call('/api/projects')).status, 401);
assert.equal((await call('/api/harness')).status, 401);
const ids = [];
try {
  for (const templateId of ['board','expense','focus']) {
    const r = await call('/api/generate', {cookie, data:{prompt:'测试模板交互',mode:'template',templateId}});
    assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /event-stream/);
    const events = (await r.text()).split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6)));
    assert.ok(events.some(e=>e.type==='agent'&&e.event.type==='notice'));
    const done=events.find(e=>e.type==='done'); assert.ok(done, JSON.stringify(events)); ids.push(done.projectId);
    const p=await (await call('/api/projects/'+done.projectId,{cookie})).json(); assert.equal(p.versions.length,1); assert.ok(p.versions[0].code.includes('window.atmos')); assert.equal(p.versions[0].files['index.html'],p.versions[0].code); assert.deepEqual(p.versions[0].trace,[]);
    assert.equal((await call('/api/projects/'+done.projectId,{cookie:other})).status,404);
  }
  const id=ids[0], state={tasks:[{id:'test',title:'Persist me',status:1}]};
  assert.equal((await call('/api/projects/'+id,{cookie,method:'PATCH',data:{action:'state',state}})).status,200);
  let p=await (await call('/api/projects/'+id,{cookie})).json(); assert.deepEqual(p.state,state);
  assert.equal((await call('/api/projects/'+id+'/restore',{cookie,data:{number:1}})).status,200);
  p=await (await call('/api/projects/'+id,{cookie})).json(); assert.equal(p.current_version,2); assert.equal(p.versions[0].code,p.versions[1].code); assert.deepEqual(p.versions[0].files,p.versions[1].files); assert.deepEqual(p.state,state);
  assert.equal((await call('/api/projects/'+id,{cookie,method:'PATCH',data:{action:'rename',title:'已重命名'}})).status,200);
  p=await (await call('/api/projects/'+id,{cookie})).json(); assert.equal(p.title,'已重命名');
  assert.equal((await call('/api/projects/'+id+'/restore',{cookie:other,data:{number:1}})).status,404);
  assert.equal((await call('/api/projects/'+id,{cookie:other,method:'DELETE'})).status,404);
  assert.equal((await call('/api/generate',{cookie,data:{prompt:'AI application',mode:'ai'}})).status,400);
  assert.equal((await call('/api/generate',{cookie,data:{prompt:'',mode:'template'}})).status,400);
  assert.equal((await call('/api/generate',{cookie,data:null})).status,400);
  assert.equal((await call('/api/generate',{cookie,data:{prompt:'x'.repeat(4001),mode:'template'}})).status,400);
  assert.equal((await call('/api/projects/'+id,{cookie,method:'PATCH',data:{action:'state',state:[]}})).status,400);
  assert.equal((await call('/api/session',{cookie,data:{},extra:{Origin:'https://untrusted.example'}})).status,403);
  assert.equal((await call('/api/models/test',{data:{}})).status,401);
  assert.equal((await call('/api/models/test',{cookie,data:{}})).status,400);
  assert.equal((await call('/api/models/test',{cookie,data:{},extra:{Origin:'https://untrusted.example'}})).status,403);
  // Restoring code must obey the same version limit as AI generation.
  for (let number = 3; number <= 40; number++) assert.equal((await call('/api/projects/'+id+'/restore',{cookie,data:{number:1}})).status,200);
  assert.equal((await call('/api/projects/'+id+'/restore',{cookie,data:{number:1}})).status,400);
  p=await (await call('/api/projects/'+id,{cookie})).json(); assert.equal(p.current_version,40); assert.deepEqual(p.state,state);
  const bad=await call('/api/generate',{cookie,data:{prompt:'制作一个计数器',mode:'ai',provider:'deepseek',model:'deepseek-flash',apiKey:'invalid-key-for-validation-only'}});
  const badEvents=(await bad.text()).split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));
  assert.ok(badEvents.some(e=>e.type==='error'&&/模型认证失败/.test(e.message)));
  const runId=badEvents.find(e=>e.type==='workspace'&&e.event.kind==='init')?.event.runId;assert.ok(runId);
  const snapshot=await (await call('/api/runs/'+runId,{cookie})).json();assert.equal(snapshot.status,'stopped');assert.deepEqual(snapshot.files,{});
  assert.equal((await call('/api/runs/'+runId,{cookie:other})).status,404);
  assert.equal((await call('/api/runs/'+runId)).status,401);
  assert.equal((await call('/api/runs/not-a-run',{cookie})).status,400);
  const connection=await call('/api/models/test',{cookie,data:{provider:'deepseek',model:'deepseek-flash',apiKey:'invalid-key-for-validation-only'}});
  assert.equal(connection.status,502); assert.match(await connection.text(), /模型认证失败/);
  console.log('PASS: 三个模板、SSE事件、会话隔离、数据持久化、回滚、重命名、输入验证、CSRF和模型认证错误');
} finally {
  for (const id of ids) assert.equal((await call('/api/projects/'+id,{cookie,method:'DELETE'})).status,200);
}
console.log('PASS: 测试项目已清理，删除接口通过');
