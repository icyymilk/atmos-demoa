import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppStateSync } from '../lib/app-state-sync';

function storage() {
  const entries = new Map<string, string>();
  return { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
}

test('older acknowledgements cannot clear newer edits and saves retain their order', async () => {
  const backup = storage(), statuses: string[] = [], sent: number[] = [];
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const sync = createAppStateSync(async (_id, state) => { sent.push(state.value as number); if (state.value === 1) await gate; }, (_id, status) => statuses.push(status), () => backup);
  const first = sync.save('a', { value: 1 });
  const second = sync.save('a', { value: 2 });
  await Promise.resolve();
  assert.deepEqual(sent, [1]);
  assert.deepEqual(sync.pending('a'), { value: 2 });
  assert.equal(backup.getItem('atmos:pending:a'), '{"value":2}');
  finish(); await Promise.all([first, second]);
  assert.deepEqual(sent, [1, 2]);
  assert.equal(statuses.filter(status => status === '已同步').length, 1);
  assert.equal(backup.getItem('atmos:pending:a'), null);
});

test('failed saves survive page reload and retry without losing another project', async () => {
  const backup = storage();
  const sync = createAppStateSync(async () => { throw new Error('offline'); }, () => {}, () => backup);
  await sync.save('a', { tasks: ['keep me'] });
  await sync.save('b', { amount: 120 });
  const restored = createAppStateSync(async () => {}, () => {}, () => backup);
  assert.deepEqual(restored.pending('a'), { tasks: ['keep me'] });
  await restored.save('a', restored.pending('a')!);
  assert.equal(restored.pending('a'), undefined);
  assert.deepEqual(restored.pending('b'), { amount: 120 });
});

test('blocked browser storage does not prevent successful database saves', async () => {
  const statuses: string[] = [];
  const sync = createAppStateSync(async () => {}, (_id, status) => statuses.push(status), () => { throw new Error('storage blocked'); });
  await sync.save('a', { value: 1 });
  assert.equal(statuses.at(-1), '已同步');
});
