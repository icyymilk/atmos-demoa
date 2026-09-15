'use client';
import type { Identity } from '@/lib/auth-types';
import { useEffect, useState } from 'react';
import { Check, ExternalLink, GitBranch, Link2, Loader2, ShieldCheck } from 'lucide-react';
import { connectionInfo, providers, type Provider, type ConnectionStatus } from '@/lib/connection-types';
export function ConnectionsPanel({identity}:{identity:Identity}) {
  const [connections, setConnections] = useState<ConnectionStatus[]>([]);
  const [selected, setSelected] = useState<Provider | null>(null), [token, setToken] = useState('');
  const [busy, setBusy] = useState('loading'), [error, setError] = useState(''), [notice, setNotice] = useState('');
  async function load() {
    try {
      const response = await fetch('/api/connections', { cache: 'no-store', headers: {'X-Atmos-Owner':identity.ownerId} });
      const data = await response.json() as { connections: ConnectionStatus[]; error?: string };
      if (!response.ok) throw new Error(data.error || '无法加载连接。');
      setConnections(data.connections);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(''); }
  }
  // Initial session-scoped connection catalog.
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  async function action(provider: Provider, action: 'connect' | 'test' | 'disconnect') {
    setBusy(provider); setError(''); setNotice('');
    try {
      const response = await fetch('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atmos-Owner':identity.ownerId }, body: JSON.stringify({ provider, action, ...(action === 'connect' ? { token } : {}) }) });
      const data = await response.json() as { connections: ConnectionStatus[]; error?: string };
      if (!response.ok) throw new Error(data.error || '连接更新失败。');
      setConnections(data.connections); setToken(''); setSelected(null);
      setNotice(action === 'disconnect' ? `${connectionInfo[provider].name} 已断开，后续读取将停止。` : `${connectionInfo[provider].name} 身份验证成功。具体资源仍需授予访问权限。`);
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(''); }
  }
  return <section className="connections-section" aria-label="外部服务连接">
    <div className="connections-heading"><Link2 size={17}/><h3>连接你的工作资料</h3><span>{connections.length} / 3</span></div>
    <p className="connections-description">将仓库与文档带入 Agent。连接成功后，从下一次任务开始自动提供读取工具。</p>
    <div className="connections-account"><ShieldCheck size={16}/><p><strong>{identity.kind==='account'?`已关联账户：${identity.name}`:'当前是访客会话'}</strong> · {identity.kind==='account'?'连接保存在此账户的工作区。':'注册可保留当前项目和连接。'}第三方连接与 Atmos 登录独立管理。</p></div>
    {error && <p role="alert" className="connection-result failure">{error}<button onClick={() => { setBusy('loading'); setError(''); void load(); }} disabled={!!busy}>重新加载</button></p>}
    {notice && <p role="status" className="connection-result success">{notice}</p>}
    {busy === 'loading' && <p className="connections-description"><Loader2 size={14} className="spin"/> 正在读取连接…</p>}
    {providers.map(provider => {
      const info = connectionInfo[provider], connected = connections.find(c => c.provider === provider);
      return <article className={`service-card ${connected ? 'connected' : ''}`} key={provider}>
        <div className="service-heading"><div className={`service-icon ${provider}`}>{provider === 'github' ? <GitBranch size={21}/> : provider === 'gitlab' ? 'G' : 'N'}</div><div><strong>{info.name}</strong><small>{connected ? connected.account : '尚未连接'}</small></div>{connected && <span className="service-status"><Check size={12}/>已连接</span>}</div>
        <p>{info.description}</p>
        {connected && <small className="service-verified">上次验证：{new Date(connected.verifiedAt).toLocaleString('zh-CN')} · {info.tools.length} 个只读工具</small>}
        <div className="service-actions">{connected && <button className="secondary-button" disabled={!!busy} onClick={() => void action(provider, 'test')}>验证连接</button>}<button className="secondary-button" disabled={!!busy} onClick={() => { setSelected(provider); setToken(''); setNotice(''); }}>{connected ? '更换令牌' : '连接服务'}</button>{connected && <button className="service-disconnect" disabled={!!busy} onClick={() => void action(provider, 'disconnect')}>断开</button>}{busy === provider && <Loader2 size={14} className="spin"/>}</div>
        {selected === provider && <form className="service-form" onSubmit={event => { event.preventDefault(); void action(provider, 'connect'); }}><p>{info.help}</p><a href={info.url} target="_blank" rel="noreferrer">前往 {info.name} 创建令牌 <ExternalLink size={12}/></a><label htmlFor={`token-${provider}`}>访问令牌</label><input id={`token-${provider}`} type="password" autoComplete="off" spellCheck={false} value={token} maxLength={2000} onChange={event => setToken(event.target.value)} placeholder="粘贴服务访问令牌" disabled={!!busy}/><small>仅保存到本机加密凭据库，按当前工作区归属隔离。你授权 Agent 读取的内容会发送给当前选择的模型服务。</small><div className="service-actions"><button type="submit" className="primary-button" disabled={!!busy || token.trim().length < 8}>{busy === provider ? '正在验证…' : '验证并连接'}</button><button type="button" className="secondary-button" disabled={!!busy} onClick={() => { setSelected(null); setToken(''); }}>取消</button></div></form>}
        <details><summary>可用能力与权限说明</summary><div className="tool-chips">{info.tools.map(tool => <code key={tool}>{tool}</code>)}</div><p>{info.help}</p></details>
      </article>;
    })}
    <p className="connections-description">断开会删除本机保存的令牌，不会删除已生成的项目内容。如需撤销令牌本身，请前往对应服务的设置。</p>
  </section>;
}
