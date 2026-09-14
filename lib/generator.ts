import { ApiError } from './errors';
import { providers, type ModelConfig } from './types';

export const appContract = `You are Atmos, an expert web application engineer. Return a complete runnable SINGLE HTML document, beginning <!DOCTYPE html> and ending </html>. Include all CSS and JavaScript inline. No markdown fences. Use vanilla JavaScript, no dependencies, imports, external scripts, fonts, images or network requests. All visible copy should be Simplified Chinese unless the user requests otherwise. Build polished responsive interactive applications with usable empty/error states, accessible labels and functional controls. Never use placeholder buttons or simulated business actions. Use DOM textContent for user-supplied text. Persistent data MUST use window.atmos.getState() (synchronous, returns a JSON object) and window.atmos.setState(fullObject) (synchronous, saves entire state). These methods are provided by the host before your code runs. Do NOT define or overwrite window.atmos. No localStorage, cookies, indexedDB, parent access, postMessage or navigation. Use defaults if state is empty; preserve prior state keys and data compatibility on edits. Sandbox blocks network access, external assets, top navigation and form submissions; handle forms with preventDefault. No backend integrations or actual payments are available. Do not claim those work. Return a compact implementation under 65000 characters.`;

export async function completion(config: ModelConfig, system: string, prompt: string, signal: AbortSignal, onDelta?: (size: number) => void) {
  const provider = providers[config.provider as keyof typeof providers];
  if (!provider) throw new ApiError('请选择受支持的模型服务。');
  const response = await fetch(provider.url, {
    method: 'POST', signal, redirect: 'error',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ ...(config.provider === 'deepseek' ? { thinking: { type: 'disabled' } } : config.provider === 'qwen' ? { enable_thinking: false } : {}), model: config.model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], stream: true, max_tokens: onDelta ? 14000 : 1200 }),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ApiError(response.status === 401 || response.status === 403 ? '模型认证失败，请检查 API Key 和模型访问权限。' : response.status === 429 ? '模型额度不足或请求过于频繁，请稍后重试。' : `模型服务返回 ${response.status}，请检查模型名称或更换服务。`, 502);
  }
  if (!response.body) throw new ApiError('模型服务没有返回内容。', 502);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', result = '', finish = '';
  function line(raw: string) {
    if (!raw.startsWith('data:')) return;
    const data = raw.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let value; try { value = JSON.parse(data); } catch { return; }
    if (value.error) throw new ApiError('模型服务中断了生成，请重试。', 502);
    const choice = value.choices?.[0];
    if (choice?.finish_reason) finish = choice.finish_reason;
    const delta = choice?.delta?.content;
    if (typeof delta === 'string') { result += delta; onDelta?.(result.length); }
    if (result.length > 100000) throw new ApiError('生成内容过大，请缩小应用范围后重试。');
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop() || '';
      for (const raw of lines) line(raw);
    }
    buffer += decoder.decode(); if (buffer.trim()) line(buffer);
  } finally { await reader.cancel().catch(() => {}); }
  if (finish === 'length') throw new ApiError('模型输出达到长度限制，请简化需求后重试。');
  if (!result.trim()) throw new ApiError('模型没有返回有效内容，请重试。', 502);
  return result.trim();
}
export function cleanCode(code: string) { return code.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/, '').trim(); }
export function validateCode(code: string) {
  const issues: string[] = [];
  if (!/<html[\s>]/i.test(code) || !/<body[\s>]/i.test(code) || !/<\/html>\s*$/i.test(code)) issues.push('缺少完整 HTML 文档结构');
  if ((code.match(/<script[\s>]/gi)?.length || 0) !== (code.match(/<\/script>/gi)?.length || 0)) issues.push('script 标签未闭合');
  if (/<script[^>]+src\s*=/i.test(code) || /<link[^>]+href\s*=/i.test(code)) issues.push('包含不受支持的外部脚本或样式');
  if (/\b(?:localStorage|sessionStorage|indexedDB)\b/.test(code)) issues.push('请使用 window.atmos 数据接口');
  return issues;
}
