export type AgentEvent = {
  type: 'activity' | 'budget' | 'run_start' | 'iteration' | 'assistant' | 'tool_start' | 'tool_end' | 'notice' | 'complete' | 'stopped';
  at: number; iteration?: number; callId?: string; name?: string; text?: string;
  input?: string; output?: string; ok?: boolean; durationMs?: number; reason?: string;
  tools?: number; runId?: string; streaming?: boolean;
  used?: number; limit?: number; researchUsed?: number; researchLimit?: number;
};
export type AgentCatalog = {
  available: boolean;
  limits: { maxIterations: number; maxToolCalls: number; timeoutSeconds: number; maxCallsPerTurn?: number; maxResearchCalls?: number; maxOutputRetries?: number };
  plugins: { id: string; name: string; description: string; enabled: boolean; transport: string; tools: string[]; error?: string }[];
  skills: { id: string; name: string; description: string; plugin: string }[];
};
