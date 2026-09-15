import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, link } from 'node:fs/promises';
import path from 'node:path';
import { providers, type Provider, type ConnectionStatus } from '../lib/connection-types';
type Credential = ConnectionStatus & { token: string };
export class ConnectionStore {
  constructor(private root: string) {}
  private file(owner: string, provider: Provider) {
    if (!/^[a-f0-9]{64}$/.test(owner) || !providers.includes(provider)) throw new Error('连接参数无效。');
    return path.join(this.root, '.atmos/connections', owner, `${provider}.json`);
  }
  private async key() {
    const directory = path.join(this.root, '.atmos');
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, 'connections.key');
    try { return await readFile(file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, randomBytes(32), { flag: 'wx', mode: 0o600 });
      try { await link(temp, file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    } finally { await rm(temp, { force: true }); }
    return readFile(file);
  }
  async get(owner: string, provider: Provider): Promise<Credential | undefined> {
    const file = this.file(owner, provider);
    let raw: string;
    try { raw = await readFile(file, 'utf8'); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw new Error('无法读取连接凭据。'); }
    try {
      const { iv, tag, data } = JSON.parse(raw);
      const cipher = createDecipheriv('aes-256-gcm', await this.key(), Buffer.from(iv, 'base64'));
      cipher.setAAD(Buffer.from(`${owner}:${provider}`)); cipher.setAuthTag(Buffer.from(tag, 'base64'));
      return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data, 'base64')), cipher.final()]).toString());
    } catch { throw new Error('连接凭据无法解密，请断开后重新连接。'); }
  }
  async save(owner: string, credential: Credential) {
    const file = this.file(owner, credential.provider), iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', await this.key(), iv);
    cipher.setAAD(Buffer.from(`${owner}:${credential.provider}`));
    const data = Buffer.concat([cipher.update(JSON.stringify(credential)), cipher.final()]);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    try { await writeFile(temp, JSON.stringify({ iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') }), { mode: 0o600 }); await rename(temp, file); }
    finally { await rm(temp, { force: true }); }
  }
  async list(owner: string): Promise<ConnectionStatus[]> {
    const records = await Promise.all(providers.map(p => this.get(owner, p)));
    return records.filter((r): r is Credential => !!r).map(({ provider, account, verifiedAt }) => ({ provider, account, verifiedAt }));
  }
  async remove(owner: string, provider: Provider) { await rm(this.file(owner, provider), { force: true }); }
}
