import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { projectRoot } from './sites-env.mjs';
import { startHarness } from './harness-process.mjs';
const serverRoot = path.join(projectRoot, 'dist/server');
let config;
try { config = JSON.parse(await readFile(path.join(serverRoot, 'wrangler.json'), 'utf8')); }
catch { console.error('请先运行 npm run build。'); process.exit(1); }
const harness = await startHarness();
config.main = path.resolve(serverRoot, config.main);
if (config.assets) config.assets.directory = path.resolve(serverRoot, config.assets.directory);
config.vars = { ...config.vars, ATMOS_HARNESS_URL: process.env.ATMOS_HARNESS_URL, ATMOS_HARNESS_TOKEN: process.env.ATMOS_HARNESS_TOKEN };
const localConfig = path.join(projectRoot, '.atmos', `worker-${process.pid}.json`);
await mkdir(path.dirname(localConfig), { recursive: true });
await writeFile(localConfig, JSON.stringify(config), { mode: 0o600 });
const worker = spawn(process.execPath, [path.join(projectRoot,'node_modules/wrangler/bin/wrangler.js'),'dev','--config',localConfig,'--local','--persist-to',path.join(projectRoot,'.wrangler/state'),'--ip','127.0.0.1','--inspector-port','0','--log-level','warn',...process.argv.slice(2)], { stdio:'inherit', env:process.env });
const stop=()=>{worker.kill();harness.kill();};
process.on('SIGINT',stop);process.on('SIGTERM',stop);
worker.once('exit',async code=>{harness.kill();await unlink(localConfig).catch(()=>{});process.exit(code??0);});
worker.once('error',async error=>{console.error(error.message);harness.kill();await unlink(localConfig).catch(()=>{});process.exit(1);});
