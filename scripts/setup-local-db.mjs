import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { projectRoot } from './sites-env.mjs';
import { localBindings } from './local-bindings.mjs';

const hosting = JSON.parse(readFileSync(path.join(projectRoot, '.openai/hosting.json'), 'utf8'));
if (!hosting.d1) process.exit(0);
const migrationDir = path.join(projectRoot, '.wrangler/local-migrations');
mkdirSync(migrationDir, { recursive: true });
for (const file of readdirSync(path.join(projectRoot, 'drizzle')).filter(name => name.endsWith('.sql')).sort()) {
  let sql = readFileSync(path.join(projectRoot, 'drizzle', file), 'utf8');
  // The earliest local release applied this schema without a migration ledger.
  // Make only that initial migration adoptable without replacing existing tables or data.
  if (file === '0000_chilly_thunderball.sql') sql = sql.replace(/CREATE TABLE /g, 'CREATE TABLE IF NOT EXISTS ').replace(/CREATE (UNIQUE )?INDEX /g, 'CREATE $1INDEX IF NOT EXISTS ');
  writeFileSync(path.join(migrationDir, file), sql);
}
const bindings = localBindings(hosting);
bindings.d1_databases[0].migrations_dir = migrationDir;
const config = path.join(projectRoot, '.wrangler/local-db.json');
writeFileSync(config, JSON.stringify({ name: 'atmos-local', compatibility_date: '2026-05-15', ...bindings }));
const result = spawnSync(process.execPath, [
  path.join(projectRoot, 'node_modules/wrangler/bin/wrangler.js'),
  'd1', 'migrations', 'apply', hosting.d1, '--local', '--config', config,
  '--persist-to', path.resolve(process.env.ATMOS_LOCAL_STATE_DIR || path.join(projectRoot, '.wrangler/state')),
], { cwd: projectRoot, stdio: ['ignore', 'inherit', 'inherit'] });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
