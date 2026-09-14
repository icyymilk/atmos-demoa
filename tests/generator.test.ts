import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { completion, validateCode } from '../lib/generator';
import { templateApp } from '../lib/templates';
import { previewDocument } from '../lib/preview';
const config = {provider:'deepseek',model:'deepseek-flash',apiKey:'unit-test-only'};
function event(value: object) {return 'data: '+JSON.stringify(value)+'\n\n';}

test('streaming API correctly reconstructs split UTF-8 and SSE events', async () => {
  const old = globalThis.fetch;
  const wire=event({choices:[{delta:{content:'你好，'}}]})+event({choices:[{delta:{content:'世界。'},finish_reason:'stop'}]})+'data: [DONE]\n\n';
  const bytes=new TextEncoder().encode(wire);
  globalThis.fetch=async (_url,options)=>{
    assert.equal(new Headers(options?.headers).get('Authorization'),'Bearer unit-test-only');
    assert.equal(options?.redirect, 'manual');
    assert.equal(JSON.parse(String(options?.body)).thinking.type,'disabled');
    return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close();}}));
  };
  try {assert.equal(await completion(config,'system','prompt',new AbortController().signal),'你好，世界。');}
  finally {globalThis.fetch=old;}
});

test('truncated model output and authentication failures are actionable', async () => {
  const old=globalThis.fetch;
  try {
    globalThis.fetch=async()=>new Response(event({choices:[{delta:{content:'partial'},finish_reason:'length'}]}));
    await assert.rejects(()=>completion(config,'','',new AbortController().signal),/长度限制/);
    globalThis.fetch=async()=>new Response('private provider detail',{status:401});
    await assert.rejects(()=>completion(config,'','',new AbortController().signal),/认证失败/);
    globalThis.fetch=async()=>new Response('',{status:307,headers:{location:'https://untrusted.example'}});
    await assert.rejects(()=>completion(config,'','',new AbortController().signal),/重定向/);
  }finally{globalThis.fetch=old;}
});

test('connection check uses an explicitly bounded completion and expects a real reply', async () => {
  const old = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => {
      assert.equal(JSON.parse(String(options?.body)).max_tokens, 16);
      return new Response(event({ choices: [{ delta: { content: 'OK' }, finish_reason: 'stop' }] }));
    };
    assert.equal(await completion(config, 'Reply OK', 'Test', new AbortController().signal, undefined, 16), 'OK');
    globalThis.fetch = async () => new Response('data: [DONE]\n\n');
    await assert.rejects(() => completion(config, '', '', new AbortController().signal, undefined, 16), /没有返回有效内容/);
  } finally { globalThis.fetch = old; }
});

test('all built-in templates have valid inline JavaScript and supported resources',()=>{
  for(const id of ['board','expense','focus']){
    const {code}=templateApp('',id);assert.deepEqual(validateCode(code),[]);
    for(const m of code.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
  }
  assert.ok(validateCode('<html><body><script src="https://evil.example/a.js"></script></body></html>').length);
});

test('preview bridge escapes injected script endings and exports standalone persistence',()=>{
  const value={text:'</script><script>alert(1)</script>'};
  const html=previewDocument(templateApp('','board').code,value,'test');
  assert.ok(!html.includes('let state={"text":"</script>'));
  assert.ok(html.indexOf('Content-Security-Policy')<html.indexOf('window.atmos'));
  for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
  const standalone=previewDocument(templateApp('','board').code,{},'test',true);
  assert.match(standalone,/localStorage.setItem/);assert.doesNotMatch(standalone,/parent.postMessage/);
});
