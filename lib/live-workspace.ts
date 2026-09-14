export type Draft = {id:string;path:string;operation:'write'|'append'|'edit';text:string;status:'generating'|'discarded'};
export type LiveFile = {content?:string;previous?:string;revision:number;deleted?:boolean};
export type WorkspacePayload =
  | {kind:'init';files:Record<string,string>}
  | {kind:'file';path:string;content?:string;revision:number}
  | {kind:'draft';draft:Draft}
  | {kind:'draft_clear';id?:string;discarded?:boolean}
  | {kind:'activity';path?:string;action:string;busy?:boolean}
  | {kind:'preview';revision:number;code?:string;issues:string[]}
  | {kind:'status';status:'running'|'completed'|'stopped';message?:string};
export type WorkspaceEvent = WorkspacePayload & {runId:string;seq:number;at:number};
export type LiveWorkspaceState = {
  runId:string;seq:number;status:'running'|'completed'|'stopped';files:Record<string,LiveFile>;
  drafts:Record<string,Draft>;active?:{path?:string;action:string;busy?:boolean};
  preview?:{revision:number;code:string};checkedRevision?:number;issues:string[];message?:string;gap?:boolean;
};
export function applyWorkspaceEvent(state:LiveWorkspaceState|null,event:WorkspaceEvent):LiveWorkspaceState|null{
  if(event.kind==='init'){
    if(state?.runId===event.runId&&event.seq<=state.seq)return state;
    return {runId:event.runId,seq:event.seq,status:'running',files:Object.fromEntries(Object.entries(event.files).map(([path,content])=>[path,{content,revision:0}])),drafts:{},issues:[]};
  }
  if(!state||state.runId!==event.runId||event.seq<=state.seq)return state;
  const next={...state,seq:event.seq,gap:state.gap||event.seq!==state.seq+1};
  switch(event.kind){
    case 'file': {
      const old=state.files[event.path];
      if(old&&event.revision<=old.revision)return next;
      next.files={...state.files,[event.path]:{content:event.content,previous:old?.content,revision:event.revision,deleted:event.content===undefined}};
      next.active={path:event.path,action:event.content===undefined?'文件已删除':'文件已写入',busy:false};
      next.drafts=Object.fromEntries(Object.entries(state.drafts).filter(([,draft])=>draft.path!==event.path));break;
    }
    case 'draft':next.drafts={...state.drafts,[event.draft.id]:event.draft};next.active={path:event.draft.path,action:'正在生成代码草稿',busy:true};break;
    case 'draft_clear':next.drafts=Object.fromEntries(Object.entries(state.drafts).flatMap(([id,draft])=>event.id&&id!==event.id?[[id,draft]]:event.discarded?[[id,{...draft,status:'discarded' as const}]]:[]));break;
    case 'activity':next.active={path:event.path??state.active?.path,action:event.action,busy:event.busy??false};break;
    case 'preview':next.checkedRevision=event.revision;next.issues=event.issues;if(event.code!==undefined)next.preview={revision:event.revision,code:event.code};break;
    case 'status':next.status=event.status;next.message=event.message;next.active=undefined;next.drafts=Object.fromEntries(Object.entries(state.drafts).map(([id,draft])=>[id,{...draft,status:'discarded' as const}]));break;
  }
  return next;
}
// A bounded contiguous diff: exact common prefix/suffix, no quadratic LCS on
// large generated files. Multiple edits may appear together in one changed block.
export function lineChanges(before:string,after:string){
  const a=before.split('\n'),b=after.split('\n');let start=0,end=0;
  while(start<a.length&&start<b.length&&a[start]===b[start])start++;
  while(end<a.length-start&&end<b.length-start&&a[a.length-1-end]===b[b.length-1-end])end++;
  return {start,removed:a.slice(start,a.length-end),added:b.slice(start,b.length-end)};
}
