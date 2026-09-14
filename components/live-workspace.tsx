'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {FileCode2,FolderTree,Loader2,Monitor,Code2,Columns2,LocateFixed,Pause,Play,RotateCcw,Check,AlertCircle} from 'lucide-react';
import {lineChanges,type LiveWorkspaceState} from '@/lib/live-workspace';
import {previewDocument} from '@/lib/preview';

type Preview={code:string;revision:number;data:Record<string,unknown>};
export function LiveWorkspace({state,initialData,onClose}:{state:LiveWorkspaceState;initialData:Record<string,unknown>;onClose:()=>void}){
  const [selected,setSelected]=useState('index.html'),[follow,setFollow]=useState(true),[mode,setMode]=useState<'split'|'code'|'preview'>('split');
  const [showDraft,setShowDraft]=useState(true);
  const [diff,setDiff]=useState(false),[auto,setAuto]=useState(true),[rendered,setRendered]=useState<Preview>(),[nonce,setNonce]=useState(0),[error,setError]=useState('');
  const data=useRef<Record<string,unknown>>(structuredClone(initialData));
  const frame=useRef<HTMLIFrameElement>(null),changeAnchor=useRef<HTMLSpanElement>(null);
  const latestDraft=Object.values(state.drafts).findLast(d=>d.status==='generating');
  const activePath=latestDraft?.path||state.active?.path;
  const names=Array.from(new Set([...Object.keys(state.files),...Object.values(state.drafts).map(d=>d.path)])).sort();
  const filename=(follow&&activePath?activePath:selected)||names[0]||'index.html';
  const file=state.files[filename],availableDraft=Object.values(state.drafts).findLast(d=>d.path===filename),draft=showDraft?availableDraft:undefined;
  const code=draft?(draft.operation==='append'?(file?.content||'')+draft.text:draft.text):(file?.content||'');
  const baseline=draft?(file?.content||''):(file?.previous||'');
  const changes=useMemo(()=>lineChanges(baseline,code),[baseline,code]);
  const channel=`live:${state.runId}:${rendered?.revision??-1}:${nonce}`;
  const document=useMemo(()=>rendered?previewDocument(rendered.code,rendered.data,channel):'', [rendered,channel]);
  useEffect(()=>{
    if(!auto||!state.preview)return;
    const next=state.preview;
    const timer=setTimeout(()=>{setRendered({...next,data:structuredClone(data.current)});setError('');},650);
    return()=>clearTimeout(timer);
  },[auto,state.preview]);
  useEffect(()=>{if(follow)changeAnchor.current?.scrollIntoView({block:'center',behavior:'auto'});},[follow,filename,code.length,changes.start]);
  useEffect(()=>{
    const listener=(event:MessageEvent)=>{
      if(event.source!==frame.current?.contentWindow||event.data?.channel!==channel)return;
      if(event.data.type==='atmos:error')setError(String(event.data.message).slice(0,500));
      const next=event.data.state;
      if(event.data.type==='atmos:state'&&next&&typeof next==='object'&&!Array.isArray(next)&&JSON.stringify(next).length<=64000)data.current=structuredClone(next);
    };
    window.addEventListener('message',listener);return()=>window.removeEventListener('message',listener);
  },[channel]);
  function refresh(){if(state.preview){setRendered({...state.preview,data:structuredClone(data.current)});setNonce(n=>n+1);setError('');}}
  const running=state.status==='running';
  const fileStatus=draft?draft.status==='discarded'?'草稿未执行':'生成中 · 尚未写入':file?.deleted?'已删除':file?'已写入':'等待文件';
  return <div className="live-workspace">
    <header className="live-header"><span className={`live-dot ${running?'running':''}`}/><strong>{running?'实时工作区':state.status==='completed'?'已完成的工作区':'已停止 · 保留现场'}</strong><small>{state.active?.action||state.message||'文件与预览独立于已保存版本'}</small>{!running&&<button onClick={onClose}>查看已保存版本</button>}</header>
    <div className="live-controls"><div><button className={mode==='split'?'active':''} onClick={()=>setMode('split')}><Columns2 size={14}/>并排</button><button className={mode==='code'?'active':''} onClick={()=>setMode('code')}><Code2 size={14}/>代码</button><button className={mode==='preview'?'active':''} onClick={()=>setMode('preview')}><Monitor size={14}/>预览</button></div><button className={follow?'active':''} onClick={()=>setFollow(!follow)}><LocateFixed size={14}/>{follow?'跟随 Agent':'恢复跟随'}</button></div>
    <div className={`live-body mode-${mode}`}>
      <nav className="live-files" aria-label="运行中文件树"><div><FolderTree size={14}/>文件 <span>{names.length}</span></div>{names.map(name=>{
        const writing=Object.values(state.drafts).some(d=>d.path===name&&d.status==='generating');
        const active=state.active?.path===name&&state.active.busy&&running;
        return <button key={name} title={name} className={`${filename===name?'selected':''} ${state.files[name]?.deleted?'deleted':''}`} onClick={()=>{setSelected(name);setShowDraft(true);setFollow(false);setMode(m=>m==='preview'?'code':m);}}><FileCode2 size={13}/><span>{name}</span>{writing||active?<Loader2 size={12} className="spin"/>:state.files[name]?.deleted?<small>删除</small>:<small>r{state.files[name]?.revision||0}</small>}</button>;
      })}{!names.length&&<p>等待 Agent 创建文件</p>}</nav>
      <section className="live-code"><div className="live-pane-title"><strong title={filename}>{filename}</strong><span>{fileStatus}</span><button onClick={()=>setDiff(!diff)} className={diff?'active':''}>{diff?'显示源码':'查看变化'}</button></div>{availableDraft&&<div className="live-code-note">{showDraft?'当前显示模型草稿':'当前显示已写入文件'}<button onClick={()=>setShowDraft(!showDraft)}>{showDraft?'查看实际文件':'查看生成草稿'}</button></div>}{draft?.operation==='edit'&&<div className="live-code-note">正在生成替换片段，尚未应用到文件。</div>}{draft?.status==='discarded'&&<div className="live-code-note warning">此草稿未成功执行，预览仍使用此前通过检查的文件。</div>}
        <div className="live-editor" tabIndex={0} aria-label="实时文件代码" onWheel={()=>setFollow(false)} onTouchStart={()=>setFollow(false)} onKeyDown={e=>{if(['PageUp','PageDown','ArrowUp','ArrowDown','Home','End'].includes(e.key))setFollow(false);}}>
          {diff?<><div className="live-diff-summary">最近一次变化 · +{changes.added.length} / −{changes.removed.length}</div>{changes.removed.map((line,i)=><div className="code-line removed" key={`r${i}`}><span>−</span><code>{line||' '}</code></div>)}{changes.added.map((line,i)=><div className="code-line added" key={`a${i}`}><span>+</span><code>{line||' '}</code></div>)}</>:code?code.split('\n').map((line,i)=><div key={i} className={`code-line ${i>=changes.start&&i<changes.start+changes.added.length?'added':''}`}><span ref={i===changes.start?changeAnchor:undefined}>{i+1}</span><code>{line||' '}</code></div>):<p className="live-empty">{file?.deleted?'此文件已被删除。':'Agent 写入的代码将在这里实时出现。'}</p>}
        </div><footer>{draft?'草稿仅供查看':'实际工作区文件'} · {code.length.toLocaleString()} 字符 · r{file?.revision||0}</footer>
      </section>
      <section className="live-preview"><div className="live-pane-title"><strong>实时预览</strong><span>{rendered?`r${rendered.revision}`:'等待入口'}</span><button aria-label={auto?'暂停自动预览':'开启自动预览'} onClick={()=>setAuto(!auto)}>{auto?<Pause size={13}/>:<Play size={13}/>}</button><button aria-label="刷新实时预览" disabled={!state.preview} onClick={refresh}><RotateCcw size={13}/></button></div>
        {!!state.issues.length&&<div className="live-validation"><AlertCircle size={13}/><span>r{state.checkedRevision} 等待修复：{state.issues.join('；')} {rendered?'保留上次有效画面。':''}</span></div>}
        {error&&<div className="live-validation warning">预览运行错误：{error}</div>}
        {rendered?<iframe ref={frame} key={channel} title="实时应用预览" sandbox="allow-scripts allow-forms" srcDoc={document}/>:<div className="live-empty-preview"><Monitor size={30}/><strong>等待首个可运行画面</strong><p>完整文件写入并通过检查后，这里会自动更新。</p></div>}
        <footer><Check size={12}/>{auto?'自动刷新':'已暂停刷新'} · 实验数据仅保存在本次预览{state.preview&&rendered?.revision!==state.preview.revision?' · 有新画面待加载':''}</footer>
      </section>
    </div>
  </div>;
}
