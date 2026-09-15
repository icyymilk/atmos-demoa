export type Project = { id: string; title: string; current_version: number; created_at: number; updated_at: number };
export type Version = { id: string; project_id: string; number: number; prompt: string; summary: string; code: string; mode: string; created_at: number; files?: Record<string,string>; artifactLoaded?: boolean; codeCharacters?: number; hasTrace?: boolean; trace?: import('./agent-types').AgentEvent[] };
export type ProjectDetail = Project & { versions: Version[]; state: Record<string, unknown>; historyBefore?: number|null; historyTotal?: number };
export type ModelConfig = { provider: string; model: string; apiKey: string; reasoningEffort?: import('./model-config').ReasoningEffort; maxOutputTokens?: number; thinkingBudget?: number };
export const providers = {
  deepseek: { name: 'DeepSeek', url: 'https://api.deepseek.com/chat/completions', model: 'deepseek-flash' },
  openai: { name: 'OpenAI', url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4.1-mini' },
  openrouter: { name: 'OpenRouter', url: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-4.1-mini' },
  qwen: { name: '通义千问', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen-plus' },
} as const;
