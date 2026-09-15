type State = Record<string, unknown>;
type Backup = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type SyncStatus = '同步中…' | '已同步' | '同步失败，点击重试';

// Keep one ordered queue per project. A late response must never acknowledge a newer edit.
export function createAppStateSync(
  send: (id: string, state: State) => Promise<unknown>,
  notify: (id: string, status: SyncStatus) => void,
  backup: () => Backup | undefined,
  ownerId?: string,
) {
  let disposed=false,epoch=0;
  const latest = new Map<string, State>();
  const queues = new Map<string, Promise<void>>();
  const key = (id: string) => `atmos:pending:${ownerId?ownerId+':':''}${id}`;
  function pending(id: string): State | undefined {
    if (latest.has(id)) return latest.get(id);
    try {
      const value = JSON.parse(backup()?.getItem(key(id)) || 'null');
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch { /* In-memory saving still works when browser storage is unavailable. */ }
  }
  function save(id: string, state: State) {
    if(disposed)return Promise.resolve();
    const revision=epoch;
    latest.set(id, state);
    const encoded = JSON.stringify(state);
    try { backup()?.setItem(key(id), encoded); } catch { /* Best-effort refresh recovery. */ }
    notify(id, '同步中…');
    const job = (queues.get(id) || Promise.resolve()).then(async () => {
      if(disposed||revision!==epoch)return;
      try {
        await send(id, state);
        if (disposed || revision!==epoch || latest.get(id) !== state) return;
        latest.delete(id);
        try {
          const storage = backup();
          if (storage?.getItem(key(id)) === encoded) storage.removeItem(key(id));
        } catch { /* Do not misreport an acknowledged server save as failed. */ }
        notify(id, '已同步');
      } catch {
        if (!disposed && revision===epoch && latest.get(id) === state) notify(id, '同步失败，点击重试');
      }
    });
    queues.set(id, job);
    return job;
  }
  return {
    pending, save,
    activate(){disposed=false;},
    dispose(){disposed=true;epoch++;latest.clear();queues.clear();},
    flush: () => Promise.all(queues.values()),
    forget(id: string) {
      latest.delete(id); queues.delete(id);
      try { backup()?.removeItem(key(id)); } catch { /* Optional browser backup. */ }
    },
  };
}
