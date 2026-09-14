import { mkdir, readFile, writeFile, readdir, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { validateCode } from '../lib/generator';

export class Workspace {
  constructor(readonly root: string) {}
  private onChange?: (change:{path:string;content?:string})=>Promise<void>;
  observe(callback:(change:{path:string;content?:string})=>Promise<void>){this.onChange=callback;}
  resolve(name: string) {
    if (!name || name.length > 180 || name.includes('\\') || name.split('/').some(part => !part || part === '..' || part === '.') || path.isAbsolute(name)) throw new Error('文件路径必须是工作区内的相对路径，不能包含 ..。');
    return path.join(this.root, name);
  }
  async guard(name: string) {
    const target = this.resolve(name);
    let current = this.root;
    for (const part of name.split('/')) {
      current = path.join(current, part);
      try { if ((await lstat(current)).isSymbolicLink()) throw new Error('工作区不允许符号链接。'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return target;
  }
  async init(files: Record<string, string>) { await mkdir(this.root, { recursive: true }); for (const [name, content] of Object.entries(files)) await this.write(name, content); }
  async read(name: string) { return readFile(await this.guard(name), 'utf8'); }
  async write(name: string, content: string) {
    if (Buffer.byteLength(content) > 180000) throw new Error('单个文件不能超过 180 KB。');
    const files = await this.list();
    if (!files.includes(name) && files.length >= 40) throw new Error('工作区最多 40 个文件。');
    const target = await this.guard(name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, content, 'utf8');
    await this.onChange?.({path:name,content});
    return { path: name, characters: content.length };
  }
  async remove(name: string) { await unlink(await this.guard(name)); await this.onChange?.({path:name}); return { deleted: name }; }
  async list(dir = ''): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await readdir(path.join(this.root, dir), { withFileTypes: true }).catch(() => [])) {
      if (entry.isSymbolicLink()) continue;
      const name = dir ? `${dir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) out.push(...await this.list(name)); else if (entry.isFile()) out.push(name);
    }
    return out.sort();
  }
  async export() {
    const files: Record<string, string> = Object.create(null); let bytes = 0;
    for (const name of await this.list()) { files[name] = await this.read(name); bytes += Buffer.byteLength(files[name]); }
    if (bytes > 600000) throw new Error('工作区总大小不能超过 600 KB。');
    return files;
  }
  async validate() {
    let code: string; try { code = await this.read('index.html'); } catch { return { ok: false, issues: ['请先写入 index.html。'], code: '' }; }
    const issues = validateCode(code);
    for (const match of code.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/type\s*=\s*["'](?:application\/ld\+json|application\/json)["']/i.test(match[1])) continue;
      try { new vm.Script(match[2]); } catch (error) { issues.push(`JavaScript 语法错误：${(error as Error).message}`); }
    }
    if (code.length > 100000) issues.push('index.html 超过 100000 字符。');
    return { ok: issues.length === 0, issues, code };
  }
}
