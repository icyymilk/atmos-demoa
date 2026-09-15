import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ConnectionStore } from '../harness/connection-store';
import { connectExternal, manageConnection, serviceRequest } from '../harness/connections';
import { connectionInfo, providers } from '../lib/connection-types';
import { runAgent } from '../harness/loop';
import { Workspace } from '../harness/workspace';
import type { ModelReply } from '../harness/model';
const owner = 'a'.repeat(64), other = 'b'.repeat(64), token = 'test-only-external-secret';
const signal = new AbortController().signal;
const mock = (fn: (url: URL, init: RequestInit) => Response | Promise<Response>) => ((url: string | URL | Request, init?: RequestInit) => Promise.resolve(fn(new URL(String(url)), init || {}))) as typeof fetch;
async function temporary(fn: (store: ConnectionStore, root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'atmos-connections-'));
  try { await fn(new ConnectionStore(root), root); } finally { await rm(root, { recursive: true, force: true }); }
}
const valid = mock(() => Response.json({ login: 'test-user', username: 'test-user', name: 'Test bot' }));
test('connection credentials persist encrypted with private permissions and owner-bound authentication', () => temporary(async (store, root) => {
  const result = await manageConnection(store, owner, { action: 'connect', provider: 'github', token }, signal, valid);
  assert.equal(result.connections[0].account, 'test-user');
  assert.ok(!JSON.stringify(result).includes(token));
  const file = path.join(root, '.atmos/connections', owner, 'github.json');
  assert.ok(!(await readFile(file, 'utf8')).includes(token));
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal((await stat(path.join(root, '.atmos/connections.key'))).mode & 0o777, 0o600);
  assert.equal((await new ConnectionStore(root).get(owner, 'github'))?.token, token);
  assert.deepEqual(await store.list(other), []);
  await manageConnection(store, other, { action: 'connect', provider: 'github', token: 'other-test-secret' }, signal, valid);
  await copyFile(file, path.join(root, '.atmos/connections', other, 'github.json'));
  await assert.rejects(store.get(other, 'github'), /无法解密/);
  await assert.rejects(store.get('../escape', 'github'), /参数无效/);
}));
test('failed verification retains the old token; disconnect blocks the next live MCP call', () => temporary(async store => {
  await manageConnection(store, owner, { action: 'connect', provider: 'github', token }, signal, valid);
  await assert.rejects(manageConnection(store, owner, { action: 'connect', provider: 'github', token: 'bad-replacement' }, signal, mock(() => Response.json({ token: 'bad-replacement' }, { status: 401 }))), /令牌无效/);
  assert.equal((await store.get(owner, 'github'))?.token, token);
  let requests = 0;
  const connection = await connectExternal(store, owner, 'github', signal, mock(() => { requests++; return Response.json([{ full_name: 'test/repo' }]); }));
  try {
    const result = await connection.client.callTool({ name: 'list_repositories', arguments: {} });
    assert.ok(!result.isError); assert.equal(requests, 1);
    await manageConnection(store, owner, { action: 'disconnect', provider: 'github' }, signal);
    assert.deepEqual(await store.list(owner), []);
    const stopped = await connection.client.callTool({ name: 'list_repositories', arguments: {} });
    assert.equal(stopped.isError, true); assert.match(JSON.stringify(stopped), /已断开/); assert.equal(requests, 1);
  } finally { await connection.close(); }
}));
test('concurrent first saves share one complete encryption key', () => temporary(async (store, root) => {
  await Promise.all(providers.map(provider => manageConnection(new ConnectionStore(root), owner, { action: 'connect', provider, token }, signal, valid)));
  assert.equal((await store.list(owner)).length, 3);
}));
test('service requests use official hosts, reject redirects and never reveal raw secrets', async () => {
  await serviceRequest('github', token, '/user', signal, undefined, mock((url, init) => {
    assert.equal(url.origin, 'https://api.github.com'); assert.equal(init.redirect, 'manual');
    assert.equal(new Headers(init.headers).get('Authorization'), `Bearer ${token}`);
    return Response.json({ login: 'person' });
  }));
  let called = false;
  await assert.rejects(serviceRequest('github', token, '//evil.example/user', signal, undefined, mock(() => { called = true; return Response.json({}); })), /地址无效/);
  assert.equal(called, false);
  await assert.rejects(serviceRequest('github', token, '/user', signal, undefined, mock(() => new Response(null, { status: 302, headers: { Location: 'https://evil.example' } }))), /302/);
  await assert.rejects(serviceRequest('github', token, '/user', signal, undefined, mock(() => { throw new Error(`fetch failed ${token}`); })), error => error instanceof Error && !error.message.includes(token));
  const reflected = await serviceRequest('github', token, '/user', signal, undefined, mock(() => Response.json({ login: token })));
  assert.ok(!JSON.stringify(reflected).includes(token));
  await assert.rejects(serviceRequest('github', token, '/user', signal, { mutation: true }), /仅支持读取/);
  await assert.rejects(serviceRequest('github', token, '/user', signal, undefined, mock(() => new Response('x'.repeat(1000001)))), /结果过大/);
});
test('all advertised MCP tools match the actual catalog and are read-only with no credential arguments', () => temporary(async store => {
  for (const provider of providers) {
    await manageConnection(store, owner, { action: 'connect', provider, token }, signal, valid);
    const connection = await connectExternal(store, owner, provider, signal, valid);
    try {
      assert.deepEqual(connection.tools.map(t => t.name), connectionInfo[provider].tools);
      assert.ok(connection.tools.every(t => t.annotations?.readOnlyHint));
      assert.ok(!JSON.stringify(connection.tools).includes(token));
      assert.ok(connection.tools.every(t => !JSON.stringify(t.inputSchema).includes('token')));
    } finally { await connection.close(); }
  }
}));
test('GitHub file reads decode base64 and paginate; GitLab paths stay encoded; Notion searches only shared pages', () => temporary(async store => {
  for (const provider of providers) await manageConnection(store, owner, { action: 'connect', provider, token }, signal, valid);
  const github = await connectExternal(store, owner, 'github', signal, mock((url) => { assert.equal(url.pathname, '/repos/org/repo/contents/src/a.ts'); return Response.json({ encoding: 'base64', path: 'src/a.ts', content: Buffer.from('abcdefghij').toString('base64') }); }));
  const gitlab = await connectExternal(store, owner, 'gitlab', signal, mock((url, init) => { assert.equal(url.pathname, '/api/v4/projects/group%2Frepo/repository/files/src%2Fa.ts'); assert.equal(new Headers(init.headers).get('PRIVATE-TOKEN'), token); return Response.json({ encoding: 'base64', content: Buffer.from('hello').toString('base64') }); }));
  const notion = await connectExternal(store, owner, 'notion', signal, mock((url, init) => { assert.equal(url.href, 'https://api.notion.com/v1/search'); assert.equal(init.method, 'POST'); assert.equal(JSON.parse(String(init.body)).filter.value, 'page'); return Response.json({ results: [], has_more: false }); }));
  try {
    const result = await github.client.callTool({ name: 'read_file', arguments: { owner: 'org', repo: 'repo', path: 'src/a.ts', offset: 2, length: 4 } });
    assert.match(JSON.stringify(result), /cdef/); assert.match(JSON.stringify(result), /truncated/);
    assert.ok(!(await gitlab.client.callTool({ name: 'read_file', arguments: { project: 'group/repo', path: 'src/a.ts' } })).isError);
    assert.ok(!(await notion.client.callTool({ name: 'search_pages', arguments: { query: 'spec' } })).isError);
  } finally { await Promise.all([github.close(), gitlab.close(), notion.close()]); }
}));
test('external tools participate in the real agent feedback loop without putting credentials into model context', () => temporary(async (store, root) => {
  await manageConnection(store, owner, { action: 'connect', provider: 'github', token }, signal, valid);
  const workspace = new Workspace(path.join(root, 'workspace')); await workspace.init({ 'index.html': '<!DOCTYPE html><html><body>Demo</body></html>' });
  let turn = 0;
  const reply = (name: string, args: unknown): ModelReply => ({ content: '正在读取仓库。', finish: 'tool_calls', calls: [{ id: String(turn), type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  const result = await runAgent({ prompt: '根据仓库交付应用', config: { provider: 'deepseek', model: 'test', apiKey: 'model-test-key' } }, {
    workspace, signal, emit: () => {}, extensions: { plugins: [], skills: [], errors: [], limits: { maxIterations: 4, maxToolCalls: 6, maxCallsPerTurn: 4, maxResearchCalls: 6, maxOutputRetries: 2, timeoutSeconds: 30 } },
    connectExternal: async s => [await connectExternal(store, owner, 'github', s, mock(() => Response.json([{ full_name: 'org/demo' }])))],
    turn: async (_config, messages, tools) => {
      assert.ok(!JSON.stringify(messages).includes(token)); assert.ok(!JSON.stringify(tools).includes(token));
      assert.ok(tools.some(t => t.function.name === 'connected_github__list_repositories'));
      if (++turn === 1) return reply('connected_github__list_repositories', {});
      assert.ok(messages.some(m => m.role === 'tool' && m.content?.includes('org/demo')));
      return reply('core__complete_task', { title: 'Demo', summary: '已读取仓库并交付。' });
    },
  });
  assert.equal(result.title, 'Demo'); assert.equal(turn, 2);
}));
