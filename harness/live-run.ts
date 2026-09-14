import { mkdir,writeFile,rename,readFile } from 'node:fs/promises';
import path from 'node:path';
import { applyWorkspaceEvent,type LiveWorkspaceState,type WorkspaceEvent,type WorkspacePayload } from '../lib/live-workspace';
import type { Workspace } from './workspace';
export class LiveRun {
  state:LiveWorkspaceState|null=null;
  private seq=0;
  private writes:Promise<void>=Promise.resolve();
  constructor(readonly runId:string,readonly directory:string,readonly publish:(event:WorkspaceEvent)=>void){}
  event(payload:WorkspacePayload){const event={...payload,runId:this.runId,seq:++this.seq,at:Date.now()} as WorkspaceEvent;this.state=applyWorkspaceEvent(this.state,event);this.publish(event);}
  persist(){const snapshot=JSON.stringify(this.state);this.writes=this.writes.catch(()=>{}).then(async()=>{await mkdir(this.directory,{recursive:true});const temp=path.join(this.directory,'snapshot.tmp');await writeFile(temp,snapshot,{mode:0o600});await rename(temp,path.join(this.directory,'snapshot.json'));});return this.writes;}
  async attach(workspace:Workspace){
    this.event({kind:'init',files:await workspace.export()});await this.check(workspace,0);await this.persist();
    workspace.observe(async change=>{
      const revision=(this.state?.files[change.path]?.revision||0)+1;
      this.event({kind:'file',...change,revision});
      if(change.path==='index.html')await this.check(workspace,revision);
      await this.persist();
    });
  }
  private async check(workspace:Workspace,revision:number){
    const checked=await workspace.validate();
    this.event({kind:'preview',revision,issues:checked.issues,...(checked.ok?{code:checked.code}:{})});
  }
  async finish(status:'completed'|'stopped',message?:string){this.event({kind:'status',status,message});await this.persist();}
}
export async function readRunSnapshot(root:string,owner:string,runId:string){
  // Defense in depth: this function is also used without the HTTP schema in tests.
  if(!/^[a-f0-9]{64}$/.test(owner)||!/^[a-f0-9-]{36}$/.test(runId))throw new Error('无效的运行标识。');
  const state=JSON.parse(await readFile(path.join(root,'.atmos/runs',owner,runId,'snapshot.json'),'utf8')) as LiveWorkspaceState;
  // A disk-only running snapshot means the process no longer owns that run.
  return state.status==='running'?{...state,status:'stopped' as const,active:undefined,message:'运行连接已结束；仅恢复工作区快照，不会重放工具。',drafts:Object.fromEntries(Object.entries(state.drafts).map(([id,d])=>[id,{...d,status:'discarded' as const}]))}:state;
}
