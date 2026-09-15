'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowUp, ArrowUpRight, ArrowLeft, Plus, Sparkles, PanelLeft, LayoutGrid, Clock3, Settings2, Check, ChevronDown, ChevronRight, Code2, Monitor, Smartphone, Download, RotateCcw, X, Loader2, Search, Trash2, FileCode2, CircleHelp, KeyRound, Square, CheckCheck, MessageSquare, FlaskConical, ExternalLink, Pencil, AlertCircle, Layers3, Wrench, Terminal, Brain, ShieldCheck } from 'lucide-react';
import { efforts,effortLabels } from '@/lib/model-config';
import { providers, type ModelConfig, type Project, type ProjectDetail, type Version } from '@/lib/types';
import { templates } from '@/lib/templates';
import { previewDocument } from '@/lib/preview';
import { ParticleBackdrop } from '@/components/particle-backdrop';
import {TrustSettingsPanel} from '@/components/trust-settings';
import { ExportProject } from '@/components/export-project';
import { ModelSettings } from '@/components/model-settings';
import { createAppStateSync } from '@/lib/app-state-sync';
import { AgentTrace } from '@/components/agent-trace';
import { MemoryCenter } from '@/components/memory-center';
import { ExtensionsPanel } from '@/components/extensions-panel';
import { LiveWorkspace } from '@/components/live-workspace';
import { IdentityBoundary } from '@/components/identity-boundary';
import { AccountPanel } from '@/components/account-panel';
import type { Identity } from '@/lib/auth-types';
import { useLiveWorkspace } from '@/hooks/use-live-workspace';
import type { WorkspaceEvent } from '@/lib/live-workspace';
import { mergeAgentEvent } from '@/lib/agent-events';
import type { AgentEvent } from '@/lib/agent-types';

async function requestApi<T = { ok: boolean }>(path: string, options?: RequestInit) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error((data as {error?: string}).error || '请求失败，请重试。');
  return data as T;
}
const post = (data: unknown) => ({ method: 'POST', body: JSON.stringify(data) });
function Brand({ small = false }: { small?: boolean }) { return <div className="brand"><span className="brand-mark">a<span>·</span></span>{!small && <span>atmos<span className="brand-dot">.</span></span>}</div>; }
function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="modal" onCancel={close} onClick={e => { if (e.target === ref.current) close(); }}><div className="modal-top"><h2>{title}</h2><button className="icon-button" aria-label="关闭弹窗" onClick={close}><X size={20}/></button></div>{children}</dialog>;
}
function MiniApp({ kind }: { kind: string }) {
  return <div className={`mini-app mini-${kind}`} aria-hidden="true"><div className="mini-top"><i/><i/><i/><span>{kind === 'board' ? 'WEEKLY WORKSPACE' : kind === 'expense' ? 'THE DAILY LEDGER' : 'TIME TO FOCUS'}</span></div>{kind === 'board' ? <><div className="mini-heading">Make things happen<span>让想法，一步步落地。</span></div><div className="mini-columns">{['待开始', '进行中', '已完成'].map((s,i) => <div key={s}><small>{s}<b>{i === 0 ? '2' : '1'}</b></small><p><i/>{['整理新的灵感','设计第一个页面','写下本周目标'][i]}<em/></p>{i === 0 && <p><i/>留一点时间给阅读<em/></p>}</div>)}</div></> : kind === 'expense' ? <><div className="mini-ledger"><span>这个月，花得明明白白</span><strong>¥ 2,460<small>.00</small></strong><div className="mini-bars">{[30,54,42,73,47,89,66,43,60,37,74,50].map((h,i)=><i key={i} style={{height: h+'%'}}/>)}</div><span>生活有度 · 消费有数</span></div></> : <div className="mini-focus"><span>留一点时间，给自己。</span><div className="mini-clock">25:00<small>专注当下</small></div><b>开始专注</b></div>}</div>;
}
export default function Home(){return <IdentityBoundary>{(identity,onChanged)=><WorkspaceHome identity={identity} onIdentityChanged={onChanged}/>}</IdentityBoundary>;}
function WorkspaceHome({identity,onIdentityChanged}:{identity:Identity;onIdentityChanged:(next:Identity)=>void}) {
  const retired=useRef(false);
  async function api<T={ok:boolean}>(path:string,options?:RequestInit){
    if(retired.current)throw new Error('身份已切换。');
    const result=await requestApi<T>(path,{...options,headers:{...options?.headers,'X-Atmos-Owner':identity.ownerId}});
    if(retired.current)throw new Error('身份已切换。');
    return result;
  }
  const [account,setAccount]=useState(false);
  const [memoryOpen,setMemoryOpen]=useState(false);
  const [exportOpen,setExportOpen]=useState(false);
  const [trustOpen,setTrustOpen]=useState(false);
  const [loadingHistory,setLoadingHistory]=useState(false),[loadingVersion,setLoadingVersion]=useState<number|null>(null);
  const chatScroll=useRef<HTMLDivElement>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [prompt, setPrompt] = useState('');
  const [config, setConfig] = useState<ModelConfig>({ provider: 'deepseek', model: 'deepseek-flash', apiKey: '' });
  const [extensions, setExtensions] = useState(false);
  const [agentEvents, setAgentEvents] = useState<AgentEvent[]>([]);
  const [sourceFile, setSourceFile] = useState('index.html');
  const [settings, setSettings] = useState(false), [help, setHelp] = useState(false);
  const [ready, setReady] = useState(false), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [toast, setToast] = useState('');
  const [activePrompt, setActivePrompt] = useState('');
  const [inspectRun, setInspectRun] = useState(false);
  const [tab, setTab] = useState<'preview'|'code'|'history'>('preview');
  const [mobile, setMobile] = useState(false), [mobilePanel, setMobilePanel] = useState<'chat'|'app'>('app');
  const [selected, setSelected] = useState<number | null>(null), [nonce, setNonce] = useState(0);
  const [menu, setMenu] = useState(false), [search, setSearch] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [runtimeError, setRuntimeError] = useState(''), [saving, setSaving] = useState('已同步');
  const [rename, setRename] = useState(false), [titleDraft, setTitleDraft] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const frame = useRef<HTMLIFrameElement>(null), chatEnd = useRef<HTMLDivElement>(null);
  const appState = useRef<Record<string, unknown>>({});
  const activeProjectId = useRef<string | null>(null);
  const [stateSync] = useState(() => createAppStateSync(
    (id, state) => api('/api/projects/' + id, { method: 'PATCH', body: JSON.stringify({ action: 'state', state }) }),
    (id, status) => { if (activeProjectId.current === id) setSaving(status); },
    () => window.sessionStorage,
    identity.ownerId,
  ));
  const loadingTicket = useRef(0);
  const liveRun=useLiveWorkspace(project?.id,busy,identity.ownerId);
  const workspace = !!project || busy || !!liveRun.live;
  const version = project?.versions.find(v => v.number === (selected ?? project.current_version));
  const sourceFiles: Record<string, string> = version ? { ...version.files, 'index.html': version.code } : {};
  const sourceCode = sourceFiles[sourceFile] || version?.code || '';
  const channel = `${project?.id || ''}:${version?.id || ''}:${nonce}`;
  // Freeze initial data for this iframe instance. App mutations must not remount the preview.
  const document = useMemo(() => version ? previewDocument(version.code, appState.current, channel) : '', [version?.id, channel, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  async function refreshProjects() { setProjects(await api<Project[]>('/api/projects')); }
  async function initialize() {
    try {
      setError(''); await refreshProjects(); setReady(true);
      const id = new URLSearchParams(window.location.search).get('project');
      if (id) await loadProject(id);
    } catch (e) { setError(e instanceof Error ? e.message : '连接失败。'); }
  }
  useEffect(()=>{
    retired.current=false;stateSync.activate();
    const retire=()=>{retired.current=true;abortRef.current?.abort();stateSync.dispose();++loadingTicket.current;activeProjectId.current=null;};
    window.addEventListener('atmos:retire',retire);
    return()=>{retire();window.removeEventListener('atmos:retire',retire);};
  },[stateSync]);
  // One-time network/session hydration; setters run after awaited requests.
  useEffect(() => { void initialize(); }, []); // eslint-disable-line react-hooks/exhaustive-deps, react-hooks/set-state-in-effect
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 3600); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: busy ? 'auto' : 'smooth' }); }, [project?.current_version, busy, agentEvents]);
  useEffect(() => {
    const handler = () => {
      if (busy) return;
      const id = new URLSearchParams(window.location.search).get('project');
      if (id) void loadProject(id, false); else { ++loadingTicket.current; activeProjectId.current = null; setLoading(false); setProject(null); setSelected(null); }
    };
    window.addEventListener('popstate', handler); return () => window.removeEventListener('popstate', handler);
  }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('atmos:model-preference') || 'null');
      if (stored && Object.hasOwn(providers, stored.provider) && typeof stored.model === 'string' && stored.model.trim() && stored.model.length <= 150) {
        // Hydrate browser-only preferences after SSR; the key is never persisted.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setConfig({ provider: stored.provider, model: stored.model, apiKey: '',reasoningEffort:efforts.includes(stored.reasoningEffort)?stored.reasoningEffort:'default',maxOutputTokens:Number.isInteger(stored.maxOutputTokens)&&stored.maxOutputTokens>=1024&&stored.maxOutputTokens<=32768?stored.maxOutputTokens:16384,thinkingBudget:Number.isInteger(stored.thinkingBudget)&&stored.thinkingBudget>=1024&&stored.thinkingBudget<=24576?stored.thinkingBudget:4096 });
      }
    } catch { /* Model selection remains usable without browser storage. */ }
  }, []);
  function saveConfig(next: ModelConfig) {
    setConfig(next); setSettings(false);
    try { localStorage.setItem('atmos:model-preference', JSON.stringify({ provider: next.provider, model: next.model,reasoningEffort:next.reasoningEffort,maxOutputTokens:next.maxOutputTokens,thinkingBudget:next.thinkingBudget })); } catch { /* Never persist the key. */ }
    setToast(next.apiKey ? '模型配置已应用。发送需求即可开始生成。' : '已清除密钥并断开模型。');
  }
  function retrySave() {
    if (!project) return;
    const pending = stateSync.pending(project.id);
    if (pending) void stateSync.save(project.id, pending);
  }
  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !project || event.data?.channel !== channel) return;
      if (event.data.type === 'atmos:error') { setRuntimeError(String(event.data.message).slice(0, 500)); return; }
      const state = event.data.state;
      if (event.data.type !== 'atmos:state' || !state || typeof state !== 'object' || Array.isArray(state) || version?.number !== project.current_version) return;
      if (JSON.stringify(state).length > 64000) { setSaving('数据超过 64 KB，未保存'); return; }
      appState.current = state;
      void stateSync.save(project.id, state);
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, [project?.id, channel]); // eslint-disable-line react-hooks/exhaustive-deps
  async function loadProject(id: string, navigate = true) {
    const ticket = ++loadingTicket.current;
    setLoading(true); setError(''); setMenu(false);
    try {
      await stateSync.flush();
      const detail: ProjectDetail = await api<ProjectDetail>('/api/projects/' + id+'?view=progressive');
      if (ticket !== loadingTicket.current) return;
      const pending = stateSync.pending(id);
      appState.current = pending || detail.state;
      activeProjectId.current = id;
      setSaving(pending ? '同步中…' : '已同步');
      setRename(false); setSourceFile('index.html');
      if (pending) void stateSync.save(id, pending);
      setProject(detail); setSelected(null); setRuntimeError(''); setTab('preview'); setMobilePanel('app');
      if (navigate && new URLSearchParams(window.location.search).get('project') !== id) window.history.pushState({}, '', '/?project=' + id);
    } catch (e) { setError(e instanceof Error ? e.message : '无法加载项目。'); }
    finally { if (ticket === loadingTicket.current) setLoading(false); }
  }
  async function loadVersion(number:number){
    if(!project)return;const id=project.id,known=project.versions.find(v=>v.number===number);if(known?.artifactLoaded)return known;
    setLoadingVersion(number);try{const artifact=await api<Version>(`/api/projects/${id}/versions/${number}`);if(activeProjectId.current!==id)return;setProject(p=>p?.id===id?{...p,versions:p.versions.map(v=>v.number===number?artifact:v)}:p);return artifact;}catch(e){setError((e as Error).message);}finally{setLoadingVersion(null);}
  }
  async function selectVersion(number:number){if(busy||loadingVersion!==null)return;const artifact=await loadVersion(number);if(artifact){setSelected(number);setTab('preview');setMobilePanel('app');setRuntimeError('');}}
  async function loadHistory(){if(!project?.historyBefore||loadingHistory)return;const id=project.id,scroll=chatScroll.current,priorHeight=scroll?.scrollHeight||0,priorTop=scroll?.scrollTop||0;setLoadingHistory(true);try{const page=await api<{versions:Version[];before:number|null}>(`/api/projects/${id}/history?before=${project.historyBefore}`);if(activeProjectId.current!==id)return;setProject(p=>p?.id===id?{...p,versions:[...page.versions.filter(v=>!p.versions.some(old=>old.id===v.id)),...p.versions],historyBefore:page.before}:p);requestAnimationFrame(()=>{if(scroll)scroll.scrollTop=priorTop+scroll.scrollHeight-priorHeight;});}catch(e){setError((e as Error).message);}finally{setLoadingHistory(false);}}
  function goHome() {
    if (busy) return;
    liveRun.clear();
    ++loadingTicket.current; activeProjectId.current = null; setRename(false); setLoading(false); setProject(null); setSelected(null); setError(''); setPrompt(''); setMenu(false); window.history.pushState({}, '', '/');
  }
  async function generate(text = prompt, templateId?: string) {
    if (retired.current || busy || loading || !ready || !text.trim()) return;
    if (!templateId && !config.apiKey.trim()) { setSettings(true); return; }
    setError(''); setRuntimeError(''); setActivePrompt(text); setAgentEvents([]); liveRun.start(); setBusy(true); setSelected(null); setMobilePanel('chat');
    const abort = new AbortController(); abortRef.current = abort; let liveRunId='';
    try {
      const response = await fetch('/api/generate', { ...post({ prompt: text, mode: templateId ? 'template' : 'ai', templateId, projectId: templateId ? undefined : project?.id, baseVersion: project?.current_version, ...config }), headers: { 'Content-Type': 'application/json', 'X-Atmos-Owner': identity.ownerId }, signal: abort.signal });
      if (!response.ok) { const data = await response.json() as {error?:string}; throw new Error(data.error || '无法开始生成。'); }
      if (!response.body) throw new Error('未收到生成结果。');
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '', completedId = '';
      function receive(line: string) {
        if (retired.current || !line.startsWith('data: ')) return;
        const data = JSON.parse(line.slice(6));
        if (data.type === 'workspace') { const event=data.event as WorkspaceEvent; liveRunId=event.runId; liveRun.receive(event); }
        if (data.type === 'agent') setAgentEvents(events => mergeAgentEvent(events,data.event as AgentEvent));
        if (data.type === 'error') throw new Error(data.message);
        if (data.type === 'done') completedId = data.projectId;
      }
      try {
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n'); buffer = lines.pop() || '';
          lines.forEach(receive);
        }
        buffer += decoder.decode(); if (buffer.trim()) receive(buffer);
      } finally { await reader.cancel().catch(() => {}); }
      if (!completedId) throw new Error('生成连接意外中断，请重试。');
      setPrompt(''); await loadProject(completedId); await refreshProjects(); liveRunId=''; liveRun.clear(); setToast('应用已就绪，试着与它互动吧。');
    } catch (e) {
      setPrompt(text); setError(abort.signal.aborted ? '已停止生成。输入已保留，已有版本未受影响。' : e instanceof Error ? e.message : '生成失败，请重试。');
    } finally { setBusy(false); abortRef.current = null; liveRun.settle(); if(liveRunId&&!retired.current)void liveRun.recover(liveRunId); }
  }
  async function restore(v: Version) {
    if (!project || busy || loading) return;
    setLoading(true);
    try { await stateSync.flush(); await api('/api/projects/' + project.id + '/restore', post({ number: v.number })); await loadProject(project.id); await refreshProjects(); setToast('已恢复为新版本，历史版本仍然保留。'); }
    catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }
  async function removeProject() {
    if (!deleteTarget || loading) return;
    setLoading(true);
    try { await stateSync.flush(); await api('/api/projects/' + deleteTarget.id, { method: 'DELETE' }); stateSync.forget(deleteTarget.id); if (project?.id === deleteTarget.id) goHome(); setDeleteTarget(null); await refreshProjects(); setToast('项目已删除。'); }
    catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  }
  async function saveTitle(e: FormEvent) {
    e.preventDefault(); if (!project) return;
    try { await api('/api/projects/' + project.id, { method: 'PATCH', body: JSON.stringify({ action: 'rename', title: titleDraft }) }); setProject({ ...project, title: titleDraft.trim() }); setRename(false); await refreshProjects(); }
    catch (e) { setError((e as Error).message); }
  }
  function download() {
    if (!version || !project) return;
    const blob = new Blob([previewDocument(version.code, appState.current, project.id, true)], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob), a = window.document.createElement('a'); a.href = url; a.download = project.title.replace(/[\\/:*?"<>|]/g, '-') + '.html'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setToast('已导出独立 HTML，下载后可直接用浏览器打开。');
  }
  const filtered = projects.filter(p => p.title.toLowerCase().includes(search.toLowerCase()));
  const composer = (home: boolean) => <form className={`composer ${home ? 'home-composer' : ''}`} onSubmit={e => { e.preventDefault(); void generate(); }}><textarea aria-label={home ? '描述你想创建的应用' : '描述修改需求'} placeholder={home ? '描述你的想法，让 Atmos 帮你实现…' : '继续描述，让应用更接近你的想法…'} value={prompt} maxLength={4000} onChange={e => setPrompt(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void generate(); } }} disabled={busy} rows={home ? 3 : 3}/><div className="composer-bottom"><button type="button" className="model-select" onClick={() => setSettings(true)} disabled={busy}><span className={config.apiKey ? 'connected-dot' : 'unconnected-dot'}/><span className="composer-model-name" title={config.model}>{config.apiKey ? config.model : '连接模型'}</span>{config.apiKey&&<small>{effortLabels[config.reasoningEffort||'default']}</small>}<ChevronDown size={13}/></button><div className="composer-actions">{home && <span className="enter-hint">Enter 发送</span>}{busy ? <button type="button" className="send-button stop" title="停止生成" aria-label="停止生成" onClick={() => abortRef.current?.abort()}><Square size={15}/></button> : <button className="send-button" title="生成应用" aria-label="生成应用" disabled={!prompt.trim() || !ready || loading}><ArrowUp size={20}/></button>}</div></div></form>;

  return <div className={`shell ${workspace ? 'is-workspace' : ''}`}>
    <aside className={`sidebar ${menu ? 'sidebar-open' : ''}`}><button className="brand-button" onClick={goHome} aria-label="返回创作首页" disabled={busy}><Brand/></button><button className="new-project" aria-label="新建应用" onClick={goHome} disabled={busy}><Plus size={17}/><span>新建应用</span><span className="plus-key">＋</span></button><nav><button aria-label="创作空间" className={!workspace ? 'nav-item active' : 'nav-item'} onClick={goHome} disabled={busy}><LayoutGrid size={17}/><span>创作空间</span></button><button className="nav-item" aria-label="我的项目" onClick={() => { goHome(); setTimeout(() => window.document.getElementById('my-projects')?.scrollIntoView({ behavior: 'smooth' }), 50); }} disabled={busy}><Layers3 size={17}/><span>我的项目</span><span className="nav-count">{projects.length}</span></button></nav><div className="sidebar-label">最近项目</div><div className="sidebar-projects">{projects.slice(0, 8).map(p => <button className={`project-link ${project?.id === p.id ? 'selected' : ''}`} key={p.id} onClick={() => void loadProject(p.id)} disabled={busy || loading}><FileCode2 size={15}/><span>{p.title}</span></button>)}{!projects.length && <p className="sidebar-empty">你的下一个想法<br/>会从这里开始。</p>}</div><div className="sidebar-bottom"><div className="model-note"><span className="little-star">✳</span><strong>你的想法，值得被实现。</strong><p>连接你喜欢的模型，<br/>开始创造属于自己的应用。</p><button onClick={() => setSettings(true)}><KeyRound size={14}/>配置模型<ArrowUpRight size={14}/></button></div><button className="nav-item" aria-label="记忆中心" onClick={() => {setMemoryOpen(true);setMenu(false);}}><Brain size={17}/><span>记忆中心</span></button><button className="nav-item" aria-label="工具与扩展" onClick={() => setExtensions(true)}><Wrench size={17}/><span>工具与外部连接</span></button><button className="nav-item" aria-label="信任与审批" onClick={()=>setTrustOpen(true)}><ShieldCheck size={17}/><span>信任与审批</span></button><button className="nav-item" aria-label="使用指南" onClick={() => setHelp(true)}><CircleHelp size={17}/><span>使用指南</span></button><button className="profile" aria-label={identity.kind==='account'?'账户设置':'注册或登录'} onClick={() => setAccount(true)}><span className="avatar">{identity.name.slice(0,1)}</span><span>{identity.kind==='account'?identity.name:'访客创作空间'}<small>{identity.kind==='account'?'已登录 · 数据已关联账户':'注册 / 登录 · 保留你的作品'}</small></span><Settings2 size={15}/></button></div></aside>
    {menu && <button className="sidebar-backdrop" onClick={() => setMenu(false)} aria-label="关闭导航"/>}
    <div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" aria-label="打开导航" onClick={() => setMenu(!menu)}><PanelLeft size={18}/></button>{workspace ? <><button className="back-home" aria-label="返回首页" onClick={goHome} disabled={busy}><ArrowLeft size={15}/></button><span className="breadcrumb-parent">创作空间</span><ChevronRight size={14}/>{rename ? <form onSubmit={saveTitle} className="rename-form"><input autoFocus aria-label="项目名称" maxLength={80} value={titleDraft} onChange={e => setTitleDraft(e.target.value)}/><button aria-label="保存名称"><Check size={16}/></button><button type="button" aria-label="取消重命名" onClick={() => setRename(false)}><X size={16}/></button></form> : <button className="project-title" onClick={() => { if (project && !busy) { setTitleDraft(project.title); setRename(true); } }}>{project?.title || '正在构建新应用'}{project && <Pencil size={12}/>}</button>}</> : <><span className="topbar-title">创作空间</span><span className="beta">BETA</span></>}</div><div className="topbar-right"><button className="top-account" onClick={()=>setAccount(true)}>{identity.kind==='account'?'账户':'注册 / 登录'}</button><button className="icon-button" aria-label="管理 Agent 工具与 Skill" title="工具与扩展" onClick={() => setExtensions(true)}><Wrench size={16}/></button>{workspace ? <>{project && <button className={`save-status ${saving.includes('失败') ? 'failed' : ''}`} onClick={retrySave}><CheckCheck size={14}/><span>{saving}</span></button>}<button className="export-button" onClick={()=>setExportOpen(true)} disabled={!version || busy}><Download size={15}/><span>导出项目</span></button></> : <><span className="desktop-hint">从一个想法，到真正可用。</span><button className="top-help" onClick={() => setHelp(true)}>快速入门<ArrowUpRight size={14}/></button></>}</div></header>
    {error && <div className="error-banner" role="alert"><AlertCircle size={17}/><span>{error}</span>{!!agentEvents.length && <button onClick={() => setInspectRun(true)}>查看执行记录</button>}{!ready && <button onClick={() => void initialize()}>重新连接</button>}<button aria-label="关闭错误提示" onClick={() => setError('')}><X size={16}/></button></div>}
    {!workspace ? <main className="home"><ParticleBackdrop/><section className="launch"><div className="section-kicker"><span className="spark-box"><Sparkles size={14}/></span>A LITTLE SPARK. INFINITE POSSIBILITIES.</div><h1>让每个想法，<br/><span>拥有自己的天空。</span></h1><p className="launch-subtitle">描述你的灵感，和 AI 一起创造可用的应用。</p>{composer(true)}<div className="prompt-suggestions"><span>试着说</span>{['一个记录读书进度的应用', '帮我做一个旅行规划工具', '一个极简习惯打卡器'].map(s => <button key={s} onClick={() => setPrompt(s)}>{s}<ArrowUpRight size={12}/></button>)}</div></section><section className="templates-section"><div className="section-header"><div><h2>从这里，找到灵感<span className="quiet-tag">无需 API Key</span></h2><p>选一个可交互模板，先体验创造的乐趣。</p></div><span className="section-index">01 — EXPLORE</span></div><div className="template-grid">{templates.map(t => <button key={t.id} className="template-card" onClick={() => void generate(t.prompt, t.id)} disabled={!ready || loading}><MiniApp kind={t.id}/><div className="template-info"><div><span className="template-category">{t.tag}</span><h3>{t.name}</h3><p>{t.caption}</p></div><span className="template-arrow"><ArrowUpRight size={19}/></span></div></button>)}</div></section><section className="projects-section" id="my-projects"><div className="section-header"><div><h2>我的项目<span className="project-total">{projects.length}</span></h2><p>每一次进展，都好好保存。</p></div><label className="project-search"><Search size={15}/><input placeholder="搜索项目" aria-label="搜索项目" value={search} onChange={e => setSearch(e.target.value)}/></label></div>{!ready && !error ? <div className="empty-projects"><Loader2 className="spin" size={20}/>正在连接创作空间…</div> : filtered.length ? <div className="project-grid">{filtered.map(p => <div className="saved-project" key={p.id}><button onClick={() => void loadProject(p.id)} disabled={loading}><span className="project-icon"><FileCode2 size={23}/></span><span><strong>{p.title}</strong><small>v{p.current_version} · {new Date(p.updated_at).toLocaleDateString('zh-CN')} 更新</small></span><ArrowUpRight size={16}/></button><button className="delete-project" aria-label={'删除' + p.title} onClick={() => setDeleteTarget(p)}><Trash2 size={15}/></button></div>)}</div> : <div className="empty-projects"><span className="empty-project-icon"><Layers3 size={23}/></span><div><strong>{search ? '没有匹配的项目' : '给你的第一个想法，留个位置。'}</strong><p>{search ? '试试其他关键词。' : '从上方描述需求，或者选择一个模板开始。'}</p></div></div>}</section><footer className="home-footer"><Brand small/><span>Made for your next idea.</span><span className="footer-right">ATMOS / BUILD WITH INTENTION</span></footer></main> : <main className="workspace"><div className="mobile-workspace-switch"><button className={mobilePanel === 'chat' ? 'active' : ''} onClick={() => setMobilePanel('chat')}><MessageSquare size={15}/>对话</button><button className={mobilePanel === 'app' ? 'active' : ''} onClick={() => setMobilePanel('app')}><Monitor size={15}/>应用</button></div><section className={`chat-panel ${mobilePanel === 'chat' ? 'mobile-visible' : ''}`}><div className="chat-heading"><span><Sparkles size={16}/>与 Atmos 共创</span><span className="agent-label">BUILD AGENT</span></div><div className="chat-scroll" ref={chatScroll}><div className="chat-intro"><span className="agent-avatar"><Sparkles size={17}/></span><div><strong>从想法，到第一次运行。</strong><p>说出需求，剩下的我们一起完成。</p></div></div>{!!project?.historyBefore&&<button className="load-history" disabled={loadingHistory} onClick={()=>void loadHistory()}>{loadingHistory?<Loader2 size={14} className="spin"/>:<Clock3 size={14}/>}加载更早对话 · 已显示 {project.versions.length}/{project.historyTotal}</button>}{project?.versions.map(v => <div className="conversation" key={v.id}><div className="user-message">{v.prompt}</div><div className="agent-message"><div className="agent-name"><span className="agent-avatar small"><Sparkles size={12}/></span>Atmos<span>{v.mode === 'template' ? '模板模式' : v.mode === 'restore' ? '版本恢复' : 'AI 生成'}</span></div><p>{v.summary}</p>{(v.hasTrace||!!v.trace?.length) && <details className="saved-trace" onToggle={e=>{if(e.currentTarget.open&&!v.artifactLoaded)void loadVersion(v.number);}}><summary><Terminal size={13}/>执行记录 · {v.trace?`${v.trace.filter(e => e.type === 'tool_start').length} 次工具调用`:'按需加载'}</summary>{v.trace?<AgentTrace events={v.trace}/>:<p>正在加载执行记录…</p>}</details>}<button className={`version-card ${version?.id === v.id ? 'active' : ''}`} onClick={() => void selectVersion(v.number)} disabled={busy||loadingVersion!==null}><span className="version-icon"><FileCode2 size={19}/></span><span><strong>{project.title}</strong><small>版本 {v.number} · {(v.codeCharacters??v.code.length).toLocaleString()} 字符</small></span><Check size={16}/></button></div></div>)}{busy && <div className="conversation"><div className="user-message">{activePrompt}</div><div className="agent-message"><div className="agent-name"><span className="agent-avatar small"><Sparkles size={12}/></span>Atmos <span>正在构建</span></div><AgentTrace events={agentEvents} live ownerId={identity.ownerId}/></div></div>}<div ref={chatEnd}/></div><div className="chat-composer-wrap">{!config.apiKey && !busy && <button className="connect-tip" onClick={() => setSettings(true)}><KeyRound size={13}/>连接模型，继续迭代你的应用<ArrowUpRight size={13}/></button>}{composer(false)}<div className="composer-footnote">{busy ? '生成期间可随时停止' : 'Agent 自主调用工具 · 完成交付后保存版本'}</div></div></section><section className={`preview-panel ${mobilePanel === 'app' ? 'mobile-visible' : ''}`}>{liveRun.live ? <LiveWorkspace key={liveRun.live.runId} state={liveRun.live} initialData={appState.current} onClose={liveRun.clear}/> : <><div className="preview-toolbar"><div className="view-tabs"><button className={tab === 'preview' ? 'active' : ''} onClick={() => setTab('preview')}><Monitor size={15}/><span>预览</span></button><button className={tab === 'code' ? 'active' : ''} onClick={() => setTab('code')}><Code2 size={15}/><span>代码</span></button><button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}><Clock3 size={15}/><span>版本</span></button></div><div className="preview-controls">{tab === 'preview' && <><button className={`icon-button ${!mobile ? 'selected' : ''}`} onClick={() => setMobile(false)} aria-label="桌面预览"><Monitor size={15}/></button><button className={`icon-button ${mobile ? 'selected' : ''}`} onClick={() => setMobile(true)} aria-label="手机预览"><Smartphone size={15}/></button><span className="toolbar-divider"/><button className="icon-button" onClick={() => { setNonce(n => n+1); setRuntimeError(''); }} aria-label="重新加载预览"><RotateCcw size={14}/></button></>}{version && <span className="version-pill">v{version.number}</span>}</div></div>{selected !== null && selected !== project?.current_version && <div className="historical-banner">正在查看历史版本 v{selected} · 此处操作不保存数据<button onClick={() => { setSelected(null); setRuntimeError(''); }}>回到最新版</button>{version && <button onClick={() => void restore(version)} disabled={busy || loading}>恢复此版本</button>}</div>}{runtimeError && <div className="runtime-error"><AlertCircle size={16}/><span>预览运行错误：{runtimeError}</span><button onClick={() => { setPrompt('请修复以下运行错误，保留现有功能：' + runtimeError); setMobilePanel('chat'); }}>让 AI 修复</button></div>}<div className={`preview-canvas ${tab === 'code' ? 'code-canvas' : ''}`}>{tab === 'preview' ? version ? <div className={`browser-frame ${mobile ? 'phone-frame' : ''}`}><div className="browser-address"><span className="browser-dots"><i/><i/><i/></span><span><span className="address-lock">◇</span> {project?.title.toLowerCase().replace(/\s/g,'-')} <span className="address-path">/ preview</span></span><span className="live-tag">运行中</span></div><iframe key={channel} ref={frame} title="生成应用预览" sandbox="allow-scripts allow-forms" srcDoc={document}/></div> : <div className="building-placeholder"><div className="building-orbit"><Sparkles size={28}/></div><h2>Agent 正在推进你的任务。</h2><p>工具结果会回到模型上下文，完成交付后在这里运行。</p><div className="agent-loop-indicator"><Loader2 size={14} className="spin"/><span>{agentEvents.filter(e => e.type === 'tool_start').length} 次工具调用 · 自主执行中</span></div></div> : tab === 'code' ? version ? <div className="source-view"><div className="source-heading"><FileCode2 size={15}/><select aria-label="工作区文件" value={sourceFile} onChange={e => setSourceFile(e.target.value)}>{Object.keys(sourceFiles).map(name => <option key={name} value={name}>{name}</option>)}</select><span>{sourceCode.split('\n').length} 行 · {(sourceCode.length/1000).toFixed(1)} KB</span><button onClick={async () => { try { await navigator.clipboard.writeText(sourceCode); setToast('源码已复制。'); } catch { setError('无法访问剪贴板，请使用导出项目。'); } }}>复制代码</button></div><pre tabIndex={0} aria-label="生成的 HTML 源码"><code>{sourceCode}</code></pre></div> : <div className="panel-empty"><Code2 size={30}/><p>生成完成后可查看源代码。</p></div> : <div className="history-view"><div className="history-title"><Clock3 size={22}/><h2>每一步，都有迹可循。</h2><p>查看或恢复任意版本。恢复会新增版本，保留完整历史。</p></div>{!!project?.historyBefore&&<button className="load-history" disabled={loadingHistory} onClick={()=>void loadHistory()}>加载更早版本</button>}{project?.versions.slice().reverse().map(v => <div className="history-card" key={v.id}><span className="history-number">v{v.number}</span><div><strong>{v.prompt}</strong><small>{new Date(v.created_at).toLocaleString('zh-CN')} · {v.mode === 'template' ? '模板' : v.mode === 'restore' ? '恢复' : 'AI 生成'}</small><p>{v.summary}</p></div><div className="history-actions">{v.number === project.current_version ? <span className="latest-tag">当前版本</span> : <button disabled={busy || loading} onClick={() => void restore(v)}><RotateCcw size={13}/>恢复</button>}<button disabled={busy} onClick={() => void selectVersion(v.number)}><ExternalLink size={13}/>查看</button></div></div>)}</div>}</div><div className="preview-footer"><span><FlaskConical size={13}/>隔离预览环境</span><button onClick={retrySave}>{saving === '已同步' ? '应用数据自动保存' : saving}<CheckCheck size={13}/></button></div></>}</section></main>}
    </div>{loading && <div className="loading-overlay" role="status"><Loader2 className="spin" size={22}/><span>正在加载…</span></div>}{toast && <div className="toast" role="status"><Check size={17}/>{toast}</div>}
    {inspectRun && <Modal title="本次任务执行记录" close={() => setInspectRun(false)}><AgentTrace events={agentEvents}/></Modal>}
    {account && <Modal title={identity.kind==='account'?'我的账户':'欢迎来到 Atmos'} close={()=>setAccount(false)}><AccountPanel identity={identity} busy={busy} beforeChange={()=>stateSync.flush().then(()=>{})} onChanged={onIdentityChanged}/></Modal>}
    {memoryOpen && <MemoryCenter identity={identity} onClose={() => setMemoryOpen(false)}/>}
    {extensions && <Modal title="Agent 工具与扩展" close={() => setExtensions(false)}><ExtensionsPanel identity={identity}/></Modal>}
    {trustOpen && <Modal title="信任与审批" close={()=>setTrustOpen(false)}><TrustSettingsPanel ownerId={identity.ownerId}/></Modal>}
    {exportOpen && project && version && <Modal title="导出完整项目" close={()=>setExportOpen(false)}><ExportProject title={project.title} projectId={project.id} version={version} state={()=>appState.current} standalone={download}/></Modal>}
    {settings && <Modal title="连接你的 AI 模型" close={() => setSettings(false)}><ModelSettings config={config} save={saveConfig}/></Modal>}
    {help && <Modal title="从一个想法开始" close={() => setHelp(false)}><div className="help-steps"><div><span>01</span><section><h3>先体验，再创造</h3><p>点击首页模板，直接体验任务看板、记账本或番茄钟。模板是预置应用，不调用 AI。</p></section></div><div><span>02</span><section><h3>连接模型，说出需求</h3><p>填写 API Key 后，可以创建任意范围合适的前端小应用，或通过对话修改已有项目。</p></section></div><div><span>03</span><section><h3>预览、迭代、带走</h3><p>直接操作预览；在「版本」中回看与恢复；点击「导出项目」下载包含所有工作区文件的 ZIP，也可单独导出可运行的 HTML。</p></section></div></div><div className="help-note"><strong>关于账户、保存与能力边界</strong><p>项目和应用数据保存在当前服务的数据库中（本地运行时保存在本机）。未注册的访客依赖 30 天会话，清除 Cookie 或会话过期会失去入口，请及时注册或导出。注册可继承当前访客资料。已有账户可在同一服务的其他浏览器登录，继续访问项目。</p><p>可在「工具与外部连接」中连接 GitHub、GitLab 和 Notion，授权 Agent 读取仓库与文档。第三方连接不是 Atmos 账户登录。生成应用适用于单页工具，预览不允许访问网络或外部资源；不支持真实支付和自建后端。Agent 可自主检索资料、操作文件和调用 MCP，按需加载 Skill，并循环修复问题。交付检查覆盖结构与语法；功能仍需在预览中确认。</p></div><button className="primary-button full-width" onClick={() => setHelp(false)}>开始创造<ArrowUpRight size={15}/></button></Modal>}
    {deleteTarget && <Modal title="删除这个项目？" close={() => setDeleteTarget(null)}><p className="delete-copy">「{deleteTarget.title}」的所有版本和应用数据将被删除。这个操作无法撤销，建议先导出需要保留的应用。</p><div className="modal-actions"><button className="secondary-button" onClick={() => setDeleteTarget(null)}>保留项目</button><button className="danger-button" onClick={() => void removeProject()} disabled={loading}>确认删除</button></div></Modal>}
  </div>;
}
