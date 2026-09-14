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
const ids = [];
try {
  for (const templateId of ['board','expense','focus']) {
    const r = await call('/api/generate', {cookie, data:{prompt:'测试模板交互',mode:'template',templateId}});
    assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /event-stream/);
    const events = (await r.text()).split('\n').filter(l=>l.startsWith('data: ')).map(l=>JSON.parse(l.slice(6)));
    assert.deepEqual(events.filter(e=>e.type==='step').map(e=>e.step), [0,1,2,3]);
    const done=events.find(e=>e.type==='done'); assert.ok(done, JSON.stringify(events)); ids.push(done.projectId);
    const p=await (await call('/api/projects/'+done.projectId,{cookie})).json(); assert.equal(p.versions.length,1); assert.ok(p.versions[0].code.includes('window.atmos'));
    assert.equal((await call('/api/projects/'+done.projectId,{cookie:other})).status,404);
  }
  const id=ids[0], state={tasks:[{id:'test',title:'Persist me',status:1}]};
  assert.equal((await call('/api/projects/'+id,{cookie,method:'PATCH',data:{action:'state',state}})).status,200);
  let p=await (await call('/api/projects/'+id,{cookie})).json(); assert.deepEqual(p.state,state);
  assert.equal((await call('/api/projects/'+id+'/restore',{cookie,data:{number:1}})).status,200);
  p=await (await call('/api/projects/'+id,{cookie})).json(); assert.equal(p.current_version,2); assert.equal(p.versions[0].code,p.versions[1].code); assert.deepEqual(p.state,state);
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
  const bad=await call('/api/generate',{cookie,data:{prompt:'制作一个计数器',mode:'ai',provider:'deepseek',model:'deepseek-flash',apiKey:'invalid-key-for-validation-only'}});
  assert.match(await bad.text(), /"type":"error"/);
  console.log('PASS: 三个模板、SSE阶段、会话隔离、数据持久化、回滚、重命名、输入验证、CSRF和模型认证错误');
} finally {
  for (const id of ids) assert.equal((await call('/api/projects/'+id,{cookie,method:'DELETE'})).status,200);
}
console.log('PASS: 测试项目已清理，删除接口通过');
