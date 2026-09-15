'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUpRight, KeyRound, Loader2, PlugZap } from 'lucide-react';
import { effortOptions,effortLabels,modelConfigSchema,type AvailableModel } from '@/lib/model-config';
import { providers, type ModelConfig } from '@/lib/types';

export function ModelSettings({ config, save }: { config: ModelConfig; save: (config: ModelConfig) => void }) {
  const [draft, setDraft] = useState<ModelConfig>({...config,reasoningEffort:config.reasoningEffort||'default',maxOutputTokens:config.maxOutputTokens||16384,thinkingBudget:config.thinkingBudget||4096});
  const [models,setModels]=useState<AvailableModel[]>([]),[listing,setListing]=useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const clean = () => ({ ...draft, model: draft.model.trim(), apiKey: draft.apiKey.trim() });
  function update(next: ModelConfig) { setDraft(next); setResult(null); }
  function submit(event: FormEvent) {
    event.preventDefault();
    const value = clean();
    const parsed=modelConfigSchema.safeParse(value);if(!parsed.success){setResult({ok:false,text:parsed.error.issues[0].message});return;}
    save(value);
  }
  async function loadModels(){const controller=new AbortController();request.current=controller;setListing(true);setResult(null);try{const response=await fetch('/api/models/list',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(clean()),signal:controller.signal});const data=await response.json() as {error?:string;models:AvailableModel[]};if(!response.ok)throw new Error(data.error||'无法读取模型列表');setModels(data.models);setResult({ok:true,text:`已读取 ${data.models.length} 个模型，可选择或手动填写 ID；工具调用与推理参数支持情况以所选模型为准。`});}catch(error){if(!controller.signal.aborted)setResult({ok:false,text:(error as Error).message});}finally{if(!controller.signal.aborted)setListing(false);}}
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
      <fieldset disabled={testing||listing} className="model-fields">
        <label className="field">模型服务<select value={draft.provider} onChange={event => { const provider = event.target.value as keyof typeof providers; setModels([]);update({ ...draft,provider, model: providers[provider].model, apiKey: '',reasoningEffort:'default' }); }}>{Object.entries(providers).map(([id, provider]) => <option key={id} value={id}>{provider.name}</option>)}</select></label>
        <div className="model-list-actions"><button type="button" className="secondary-button" disabled={testing||listing||!draft.apiKey.trim()} onClick={()=>void loadModels()}>{listing?<Loader2 size={14} className="spin"/>:<PlugZap size={14}/>}读取可用模型</button>{!!models.length&&<select aria-label="选择可用模型" value={models.some(m=>m.id===draft.model)?draft.model:''} onChange={e=>update({...draft,model:e.target.value,reasoningEffort:'default'})}><option value="" disabled>选择模型</option>{models.map(m=><option key={m.id} value={m.id}>{m.id}</option>)}</select>}</div><label className="field">模型名称<input aria-label="模型名称" required value={draft.model} maxLength={150} onChange={event => update({ ...draft, model: event.target.value })}/><small>填写该服务可调用的模型 ID；下次打开会记住服务与模型名称。</small></label>
        <label className="field">API Key<input type="password" required autoComplete="off" spellCheck={false} placeholder="粘贴你的 API Key" value={draft.apiKey} maxLength={1000} onChange={event => update({ ...draft, apiKey: event.target.value })}/></label>
      <label className="field">推理强度<select aria-label="推理强度" value={draft.reasoningEffort} onChange={e=>update({...draft,reasoningEffort:e.target.value as ModelConfig['reasoningEffort']})}>{effortOptions(draft.provider).filter(e=>{const model=models.find(m=>m.id===draft.model);return e==='default'||(!model?.reasoningMandatory||e!=='none')&&(!model?.efforts||model.efforts.includes(e));}).map(e=><option key={e} value={e}>{draft.provider==='qwen'&&e==='high'?'开启思考（按预算）':effortLabels[e]}</option>)}</select><small>默认不覆盖模型设置；显式选择会真实传给服务。不支持的参数会报错，不会静默忽略。</small></label>
        <div className="model-budget-fields"><label className="field">总输出 Token 上限<input aria-label="总输出 Token 上限" type="number" min={1024} max={32768} step={1024} value={draft.maxOutputTokens} onChange={e=>update({...draft,maxOutputTokens:Number(e.target.value)})}/><small>包含推理与回复；高强度建议预留更多输出空间。</small></label>{draft.provider==='qwen'&&draft.reasoningEffort==='high'&&<label className="field">思考 Token 预算<input aria-label="思考 Token 预算" type="number" min={1024} max={24576} step={1024} value={draft.thinkingBudget} onChange={e=>update({...draft,thinkingBudget:Number(e.target.value)})}/></label>}</div>
      </fieldset>
      <div className="connection-test"><button type="button" className="secondary-button" onClick={() => void test()} disabled={testing||listing}>{testing ? <Loader2 size={15} className="spin"/> : <PlugZap size={15}/>} {testing ? '正在测试…' : '测试连接'}</button><small>使用当前推理设置发送短测试，最多 4,096 输出 Token，会产生模型用量。</small></div>
      {result && <p className={`connection-result ${result.ok ? 'success' : 'failure'}`} role={result.ok ? 'status' : 'alert'}>{result.text}</p>}
      <div className="key-notice"><KeyRound size={15}/><span>密钥仅保留在当前页面内存，刷新后清除。请求经服务端转发至所选模型服务，不写入数据库或日志。</span></div>
      <div className="modal-actions"><button type="button" className="secondary-button" disabled={testing||listing} onClick={() => save({ ...config, apiKey: '' })}>清除并断开</button><button className="primary-button" disabled={testing||listing}>保存配置<ArrowUpRight size={15}/></button></div>
    </form>
  </>;
}
