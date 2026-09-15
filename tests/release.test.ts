import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedOrigin,requestOrigin} from '../lib/request-origin';
test('TLS proxy uses configured origin and ignores spoofed forwarded headers',()=>{
  const request=new Request('http://internal:8787/api/auth/register',{headers:{Origin:'https://demo.example','X-Forwarded-Proto':'http','X-Forwarded-Host':'evil.example'}});
  assert.equal(requestOrigin(request,'https://demo.example'),'https://demo.example');
  assert.ok(allowedOrigin(request,'https://demo.example'));
  assert.ok(!allowedOrigin(new Request(request,{headers:{Origin:'https://evil.example'}}),'https://demo.example'));
  assert.ok(!allowedOrigin(new Request(request,{headers:{'Sec-Fetch-Site':'cross-site'}}),'https://demo.example'));
  assert.ok(!allowedOrigin(request));
  assert.throws(()=>requestOrigin(request,'https://demo.example/path'));
  assert.throws(()=>requestOrigin(request,'https://user:password@demo.example'));
});
