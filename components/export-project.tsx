'use client';
import {useState} from 'react';
import {Download,FileArchive,FileCode2} from 'lucide-react';
import {projectArchive} from '@/lib/project-export';
import type {Version} from '@/lib/types';
export function ExportProject({title,projectId,version,state,standalone}:{title:string;projectId:string;version:Version;state:()=>Record<string,unknown>;standalone:()=>void}){
 const [includeData,setIncludeData]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
 const files={...version.files,'index.html':version.code};
 function download(){try{const bundle=projectArchive(title,projectId,version,includeData?state():{}),url=URL.createObjectURL(new Blob([bundle.bytes.buffer as ArrayBuffer],{type:'application/zip'})),a=document.createElement('a');a.href=url;a.download=bundle.name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setDone(true);setError('');}catch(e){setError((e as Error).message);}}
 return <div className="export-project"><div className="export-intro"><FileArchive size={30}/><div><h3>带走整个项目</h3><p>版本 v{version.number} · {Object.keys(files).length} 个原始文件 · 保留目录结构</p></div></div><div className="export-file-list">{Object.entries(files).map(([name,content])=><div key={name}><FileCode2 size={14}/><code>{name}</code><small>{new TextEncoder().encode(content).length.toLocaleString()} B</small></div>)}</div><p>ZIP 包含全部工作区源码、项目笔记、任务文件，以及可直接打开的独立预览和运行说明。导出的是当前版本快照。</p><label className="export-data"><input type="checkbox" checked={includeData} onChange={e=>setIncludeData(e.target.checked)}/>同时导出当前应用数据</label><small>不包含账户信息、模型 Key、外部连接凭据和用户全局记忆。</small>{error&&<p role="alert" className="connection-result failure">{error}</p>}{done&&<p role="status" className="connection-result success">完整项目 ZIP 已开始下载。</p>}<div className="modal-actions"><button className="secondary-button" onClick={standalone}>仅导出独立 HTML</button><button className="primary-button" onClick={download}><Download size={15}/>下载完整项目 ZIP</button></div></div>;
}
