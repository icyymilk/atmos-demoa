import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,rename,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import type {TrustMode,TrustSettings,ApprovalRequest} from '../lib/trust-types';
export class GuardError extends Error{constructor(message:string,readonly status=400){super(message);}}
export type GuardOperation={subject:'tool'|'reply';name:string;callId?:string;input:string;reasons:string[]};
export function shellRisks(input:string){
 const text=input.replace(/\\\r?\n/g,'').replace(/["']/g,'');const reasons:string[]=[];
 const rules:[RegExp,string][]=[
  [/\b(?:rm|rmdir|unlink|shred)\s+(?:-[^\s]+\s+)*\S|\bfind\b[^\n]*-(?:delete|exec)\b/i,'可能删除或批量修改文件'],
  [/\bgit\s+(?:reset\b[^\n]*--hard|clean\b|restore\b|checkout\s+(?:--|\.)|push\b)/i,'可能丢弃代码变更或写入远程仓库'],
  [/\b(?:sudo|su|chmod|chown|chflags|mount|umount|diskutil|mkfs(?:\.[\w]+)?|dd|reboot|shutdown|kill|killall|pkill|launchctl)\s+\S/i,'可能修改系统、权限、磁盘或进程'],
  [/\b(?:curl|wget)\b[^\n]*\|[^\n]*\b(?:sh|bash|zsh|python|node)\b/i,'下载内容被直接交给解释器执行'],
  [/\b(?:bash|sh|zsh|node|python\d*|perl|ruby)\s+(?:-[^\s]+\s+)*-(?:[a-z]*[ce])\b|\beval\s+|\bbase64\b[^\n]*\|/i,'动态解释或编码命令难以静态检查'],
  [/\b(?:curl|wget|scp|sftp|ssh|rsync|nc|ncat|socat)\s+\S/i,'命令可能访问外部服务或传输本机数据'],
  [/\b(?:npm|pnpm|yarn|pip\d*|brew|apt|apt-get)\s+(?:install|add|remove|uninstall|upgrade)\b/i,'安装或移除依赖可能执行第三方脚本'],
  [/\$\(|\/dev\/(?:sd[a-z]|nvme|disk)\b|:\(\)\s*\{/,'存在命令替换、设备访问或进程放大语法'],
 ];
 for(const [pattern,reason] of rules)if(pattern.test(text))reasons.push(reason);return [...new Set(reasons)];
}
const safeCore=new Set(['list_files','read_file','write_file','append_file','edit_file','search_files','read_webpage','update_tasks','read_memory','write_memory','load_skill','validate_app','complete_task']);
export function toolOperation(name:string,args:Record<string,unknown>,callId?:string):GuardOperation{
 const input=JSON.stringify(args,null,2),[source,...parts]=name.split('__'),tool=parts.join('__');
 const reasons=shellRisks(Object.values(args).filter(v=>typeof v==='string').join('\n'));
 if(source==='core'&&tool==='delete_file')reasons.push('删除工作区文件');
 const known=source==='core'&&safeCore.has(tool)||source==='memory'&&['search','read','propose'].includes(tool)||source==='context'&&['search_history','read_history'].includes(tool)||['github','gitlab','notion'].includes(source);
 if(!known&&!(source==='core'&&tool==='delete_file'))reasons.push('插件工具的副作用未经内置规则验证');
 if(/(?:bash|shell|exec|command|terminal|run_script)/i.test(name)||Object.keys(args).some(k=>/^(command|cmd|commands|script|shell)$/i.test(k)))reasons.push('将执行命令或脚本，需确认原始参数');
 return {subject:'tool',name,callId,input,reasons:[...new Set(reasons)]};
}
export function needsApproval(mode:TrustMode,operation:GuardOperation){return mode!=='allow'&&(operation.reasons.length>0||mode==='always'&&operation.subject==='tool');}
const writes=new Map<string,Promise<unknown>>();
export class TrustStore{
 constructor(private root:string){}
 private file(owner:string){if(!/^[a-f0-9]{64}$/.test(owner))throw new GuardError('无效归属');return path.join(this.root,'.atmos/owners',owner,'trust.json');}
 async get(owner:string):Promise<TrustSettings>{try{const v=JSON.parse(await readFile(this.file(owner),'utf8'));if(!['always','important','allow'].includes(v.mode)||!Number.isInteger(v.revision)||v.revision<0)throw new Error();return {mode:v.mode,revision:v.revision};}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return {mode:'important',revision:0};throw new GuardError('无法读取信任设置，已停止自动放行。',503);}}
 async set(owner:string,mode:TrustMode,revision:number){const file=this.file(owner),previous=writes.get(file)||Promise.resolve();const job=previous.catch(()=>{}).then(async()=>{const current=await this.get(owner);if(current.revision!==revision)throw new GuardError('信任设置已更新，请刷新后重试。',409);const next={mode,revision:revision+1};await mkdir(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+randomUUID()+'.tmp';try{await writeFile(temp,JSON.stringify(next),{mode:0o600});await rename(temp,file);}finally{await rm(temp,{force:true});}return next;});writes.set(file,job);try{return await job;}finally{if(writes.get(file)===job)writes.delete(file);}}
}
type Pending={owner:string;request:ApprovalRequest;settle:(approved:boolean)=>void};
export class Approvals{
 private pending=new Map<string,Pending>();
 async wait(owner:string,runId:string,mode:TrustMode,operation:GuardOperation,signal:AbortSignal,publish:(request:ApprovalRequest)=>void,timeoutMs=300000){
  signal.throwIfAborted();const request:ApprovalRequest={...operation,id:randomUUID(),runId,mode,status:'pending',expiresAt:Date.now()+timeoutMs,fingerprint:createHash('sha256').update(JSON.stringify({owner,runId,...operation})).digest('hex')};
  return new Promise<boolean>((resolve,reject)=>{
   const finish=(approved:boolean,error?:Error)=>{if(!this.pending.delete(request.id))return;clearTimeout(timer);signal.removeEventListener('abort',abort);publish({...request,status:error?'expired':approved?'approved':'denied'});if(error)reject(error);else resolve(approved);};
   const abort=()=>finish(false,new GuardError('运行已取消，审批失效。',409));
   this.pending.set(request.id,{owner,request,settle:allow=>finish(allow)});signal.addEventListener('abort',abort,{once:true});
   const timer=setTimeout(()=>finish(false,new GuardError('审批等待超时，此操作未执行。',408)),timeoutMs);
   try{publish(request);}catch(e){finish(false,e as Error);}
   if(signal.aborted)abort();
  });
 }
 decide(owner:string,runId:string,id:string,allow:boolean){const item=this.pending.get(id);if(!item||item.owner!==owner||item.request.runId!==runId)throw new GuardError('审批不存在、已处理或无权操作。',404);if(item.request.expiresAt<=Date.now())throw new GuardError('审批已过期。',409);item.settle(allow);return {ok:true};}
}
export type RunGuard={mode:TrustMode;request:(operation:GuardOperation,signal:AbortSignal,publish:(request:ApprovalRequest)=>void)=>Promise<boolean>};
