'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, KeyRound, Loader2, PlugZap } from 'lucide-react';
import { providers, type ModelConfig } from '@/lib/types';

export function ModelSettings({ config, save }: { config: ModelConfig; save: (config: ModelConfig) => void }) {
  const [draft, setDraft] = useState(config);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const clean = () => ({ ...draft, model: draft.model.trim(), apiKey: draft.apiKey.trim() });
  function update(next: ModelConfig) { setDraft(next); setResult(null); }
  function submit(event: FormEvent) {
    event.preventDefault();
    const value = clean();
    if (!value.model || !value.apiKey) { setResult({ ok: false, text: '请填写模型名称和 API Key。' }); return; }
    save(value);
  }
  async function test() {
    const value = clean();
    if (!value.model || !value.apiKey) { setResult({ ok: false, text: '请先填写模型名称和 API Key。' }); return; }
    const controller = new AbortController(); request.current = controller;
    setTesting(true); setResult(null);
    try {
      const response = await fetch('/api/models/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal: controller.signal });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || '连接测试失败，请稍后重试。');
      setResult({ ok: true, text: '连接成功，模型已实际回复。可以保存配置并开始生成。' });
    } catch (error) {
      if (!controller.signal.aborted) setResult({ ok: false, text: error instanceof Error ? error.message : '无法连接模型服务。' });
    } finally { if (!controller.signal.aborted) setTesting(false); }
  }
  return <>
    <div className="settings-intro"><span className="settings-icon"><KeyRound size={24}/></span><p>使用你自己的 API Key，让 Atmos 理解需求、编写代码，并持续改进应用。</p></div>
    <form onSubmit={submit}>
      <fieldset disabled={testing} className="model-fields">
        <label className="field">模型服务<select value={draft.provider} onChange={event => { const provider = event.target.value as keyof typeof providers; update({ provider, model: providers[provider].model, apiKey: '' }); }}>{Object.entries(providers).map(([id, provider]) => <option key={id} value={id}>{provider.name}</option>)}</select></label>
        <label className="field">模型名称<input required value={draft.model} maxLength={150} onChange={event => update({ ...draft, model: event.target.value })}/><small>填写该服务可调用的模型 ID；下次打开会记住服务与模型名称。</small></label>
        <label className="field">API Key<input type="password" required autoComplete="off" spellCheck={false} placeholder="粘贴你的 API Key" value={draft.apiKey} maxLength={1000} onChange={event => update({ ...draft, apiKey: event.target.value })}/></label>
      </fieldset>
      <div className="connection-test"><button type="button" className="secondary-button" onClick={() => void test()} disabled={testing}>{testing ? <Loader2 size={15} className="spin"/> : <PlugZap size={15}/>} {testing ? '正在测试…' : '测试连接'}</button><small>发送一条短请求，会产生少量模型用量。</small></div>
      {result && <p className={`connection-result ${result.ok ? 'success' : 'failure'}`} role={result.ok ? 'status' : 'alert'}>{result.text}</p>}
      <div className="key-notice"><KeyRound size={15}/><span>密钥仅保留在当前页面内存，刷新后清除。请求经服务端转发至所选模型服务，不写入数据库或日志。</span></div>
      <div className="modal-actions"><button type="button" className="secondary-button" disabled={testing} onClick={() => save({ ...config, apiKey: '' })}>清除并断开</button><button className="primary-button" disabled={testing}>保存配置<ArrowUpRight size={15}/></button></div>
    </form>
  </>;
}
