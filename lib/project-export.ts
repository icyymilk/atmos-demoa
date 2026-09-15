import {previewDocument} from './preview';
import type {Version} from './types';
const utf8=new TextEncoder();
const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc32(bytes:Uint8Array){let crc=0xffffffff;for(const b of bytes)crc=crcTable[(crc^b)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
export function safeArchivePath(name:string){if(!name||name.length>240||name.startsWith('/')||name.includes('\\')||/[\x00-\x1f:]/.test(name)||name.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('无法导出不安全的文件路径：'+name);return name;}
function join(parts:Uint8Array[]){const result=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of parts){result.set(p,offset);offset+=p.length;}return result;}
// ZIP store method, UTF-8 names and CRC-32. No server dependency or lossy source rewriting.
export function zipFiles(files:Record<string,string>){
 const local:Uint8Array[]=[],central:Uint8Array[]=[];let offset=0,total=0;const entries=Object.entries(files);if(entries.length>1000)throw new Error('导出文件过多。');
 for(const [name,content] of entries){const filename=utf8.encode(safeArchivePath(name)),data=utf8.encode(content),crc=crc32(data);total+=data.length;if(total>10000000)throw new Error('导出内容超过 10 MB。');
  const header=new Uint8Array(30),h=new DataView(header.buffer);h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x800,true);h.setUint16(12,33,true);h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,filename.length,true);
  local.push(header,filename,data);
  const record=new Uint8Array(46),c=new DataView(record.buffer);c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x800,true);c.setUint16(14,33,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,filename.length,true);c.setUint32(42,offset,true);central.push(record,filename);offset+=header.length+filename.length+data.length;
 }
 const directory=join(central),end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,entries.length,true);e.setUint16(10,entries.length,true);e.setUint32(12,directory.length,true);e.setUint32(16,offset,true);return join([...local,directory,end]);
}
export function projectArchive(title:string,projectId:string,version:Version,state:Record<string,unknown>={}){
 const files:Record<string,string>={...version.files,'index.html':version.code};for(const name of Object.keys(files))safeArchivePath(name);
 let meta='atmos-export';while(Object.keys(files).some(name=>name===meta||name.startsWith(meta+'/')))meta+='-';
 files[meta+'/preview.html']=previewDocument(version.code,state,projectId,true);
 files[meta+'/manifest.json']=JSON.stringify({format:1,title,projectId,version:version.number,files:Object.keys(files).filter(name=>!name.startsWith(meta+'/')),state},null,2);
 files[meta+'/README.md']=`# ${title}\n\n这是 Atmos 项目版本 v${version.number} 的完整工作区快照。所有原始文件和目录结构保留。\n\n## 本地体验\n\n解压后打开本目录的 preview.html，即可体验带 Atmos 数据接口适配的独立应用。原始 index.html 保持原样，依赖 window.atmos。\n\n## 继续开发\n\n可用编辑器打开解压目录，并在项目根目录运行 git init 建立新仓库。此压缩包是源码快照，不包含 Git 提交历史、Atmos 服务本身或用户全局记忆。\n\n生成应用仍受单文件运行契约约束；其他源文件、项目笔记与任务文件随包保留。\n`;
 return {files,bytes:zipFiles(files),name:title.replace(/[\\/:*?"<>|\x00-\x1f]/g,'-')+`-v${version.number}.zip`};
}
