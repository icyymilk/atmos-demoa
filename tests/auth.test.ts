import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFile, mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { passwordOperation, PasswordBusy } from '../harness/passwords';
import { loadExtensions, setPluginEnabled } from '../harness/extensions';
import { createAppStateSync } from '../lib/app-state-sync';

test('account migration preserves projects, versions, guest IDs, and foreign key integrity',async()=>{
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
  try {
    db.exec(await readFile('drizzle/0000_chilly_thunderball.sql','utf8'));db.exec(await readFile('drizzle/0001_demonic_shockwave.sql','utf8'));
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run('a'.repeat(64),'访客',Date.now());
    db.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?,?)').run('project','a'.repeat(64),'保留项目',2,'{"saved":true}',1,2);
    for(let n=1;n<=2;n++)db.prepare('INSERT INTO versions (id,project_id,number,prompt,summary,code,mode,created_at,files,trace) VALUES (?,?,?,?,?,?,?,?,?,?)').run('v'+n,'project',n,'需求','说明','<html>内容</html>','ai',n,'{"index.html":"retained"}','[{"type":"notice"}]');
    const projects=db.prepare('SELECT * FROM projects').all(),versions=db.prepare('SELECT * FROM versions').all();
    db.exec(await readFile('drizzle/0002_accounts.sql','utf8'));
    assert.deepEqual(db.prepare('SELECT * FROM projects').all(),projects);
    assert.deepEqual(db.prepare('SELECT * FROM versions').all(),versions);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
    assert.equal(db.prepare('SELECT owner_id FROM sessions').get()?.owner_id,'a'.repeat(64));
    // Session revocation cannot remove a project now that ownership is stable.
    db.exec('DELETE FROM sessions');assert.equal(db.prepare('SELECT count(*) n FROM projects').get()?.n,1);
    db.exec('DELETE FROM projects');assert.equal(db.prepare('SELECT count(*) n FROM versions').get()?.n,0);
  }finally{db.close();}
});
test('scrypt uses unique salts, verifies exact Unicode and spaces, and rejects unknown hashes',async()=>{
  const password=' 密码 with spaces 123456 ';
  const a=await passwordOperation({action:'hash',password}),b=await passwordOperation({action:'hash',password});
  assert.notEqual(a.hash,b.hash);assert.match(a.hash!,/^scrypt\$131072\$8\$1\$/);
  assert.equal((await passwordOperation({action:'verify',password,hash:a.hash})).valid,true);
  assert.equal((await passwordOperation({action:'verify',password:password.trim(),hash:a.hash})).valid,false);
  assert.equal((await passwordOperation({action:'verify',password,hash:'unknown'})).valid,false);
  assert.ok(!a.hash!.includes(password));
});
test('password computation has a strict concurrency bound',async()=>{
  const a=passwordOperation({action:'hash',password:'a'.repeat(15)}),b=passwordOperation({action:'hash',password:'b'.repeat(15)});
  await assert.rejects(passwordOperation({action:'hash',password:'c'.repeat(15)}),PasswordBusy);
  await Promise.all([a,b]);
});
test('plugin preferences are owner isolated and inherit operator defaults',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'atmos-owner-plugins-'));
  try {
    await mkdir(path.join(root,'plugin'));await mkdir(path.join(root,'.atmos'));
    await writeFile(path.join(root,'atmos.config.json'),JSON.stringify({plugins:['plugin']}));
    await writeFile(path.join(root,'plugin/plugin.json'),JSON.stringify({id:'demo',name:'Demo',description:'test'}));
    await writeFile(path.join(root,'.atmos/plugin-state.json'),JSON.stringify({demo:false}));
    await setPluginEnabled(root,'demo',true,'a'.repeat(64));
    assert.equal((await loadExtensions(root,'a'.repeat(64))).plugins[0].enabled,true);
    assert.equal((await loadExtensions(root,'b'.repeat(64))).plugins[0].enabled,false);
    await assert.rejects(loadExtensions(root,'../escape'));
  }finally{await rm(root,{recursive:true,force:true});}
});
test('retiring an identity drops queued writes and owner-scopes pending backups',async()=>{
  const map=new Map<string,string>(),storage={getItem:(k:string)=>map.get(k)||null,setItem:(k:string,v:string)=>{map.set(k,v);},removeItem:(k:string)=>{map.delete(k);}};
  const sends:string[]=[],notices:string[]=[];
  const sync=createAppStateSync(async(id)=>{sends.push(id);},(id)=>{notices.push(id);},()=>storage,'owner-a');
  const pending=sync.save('same-project',{value:1});sync.dispose();sync.activate();await pending;
  assert.deepEqual(sends,[]);assert.equal(map.has('atmos:pending:owner-a:same-project'),true);
  const other=createAppStateSync(async()=>{},()=>{},()=>storage,'owner-b');
  assert.equal(other.pending('same-project'),undefined);
  assert.equal(notices.length,1);
  await sync.save('new-project',{value:2});assert.deepEqual(sends,['new-project']);
});
