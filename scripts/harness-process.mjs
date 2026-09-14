import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
export async function startHarness() {
  process.env.ATMOS_HARNESS_TOKEN = randomBytes(32).toString('hex');
  const child = fork(fileURLToPath(new URL('../harness/server.ts', import.meta.url)), [], {
    execArgv: ['--import', 'tsx'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: process.env,
  });
  const port = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Agent runtime startup timed out')); }, 15000);
    child.once('message', message => { clearTimeout(timeout); resolve(message.port); });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`Agent runtime exited: ${code}`)); });
  });
  process.env.ATMOS_HARNESS_URL = `http://127.0.0.1:${port}`;
  process.on('exit', () => child.kill());
  return child;
}
