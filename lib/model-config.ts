import {z} from 'zod';
import type {ModelConfig} from './types';
export const efforts=['default','none','minimal','low','medium','high','xhigh','max'] as const;
export type ReasoningEffort=typeof efforts[number];
export const effortLabels:Record<ReasoningEffort,string>={default:'模型默认',none:'关闭推理',minimal:'极低',low:'低',medium:'中',high:'高',xhigh:'极高',max:'最高'};
export const modelConfigSchema=z.object({provider:z.enum(['deepseek','openai','openrouter','qwen']),model:z.string().trim().min(1).max(150),apiKey:z.string().trim().min(1).max(1000),reasoningEffort:z.enum(efforts).default('default'),maxOutputTokens:z.number().int().min(1024).max(32768).default(16384),thinkingBudget:z.number().int().min(1024).max(24576).default(4096)}).superRefine((c,ctx)=>{
 if(!effortOptions(c.provider).includes(c.reasoningEffort))ctx.addIssue({code:'custom',message:'此服务不支持所选推理参数。',path:['reasoningEffort']});
 if(c.provider==='qwen'&&c.reasoningEffort==='high'&&c.thinkingBudget>=c.maxOutputTokens)ctx.addIssue({code:'custom',message:'思考预算必须小于总输出上限，为代码和回复留出空间。',path:['thinkingBudget']});
});
export function effortOptions(provider:string):ReasoningEffort[]{
 if(provider==='deepseek')return ['default','none','low','high','max'];
 if(provider==='qwen')return ['default','none','high'];
 if(provider==='openai')return ['default','none','minimal','low','medium','high','xhigh'];
 return [...efforts];
}
export function generationParameters(config:ModelConfig,overrideTokens?:number){
 const effort=config.reasoningEffort||'default',tokens=overrideTokens??config.maxOutputTokens??16384;
 const params:Record<string,unknown>=config.provider==='openai'?{max_completion_tokens:tokens}:{max_tokens:tokens};
 if(effort==='default')return params;
 if(config.provider==='deepseek'){params.thinking={type:effort==='none'?'disabled':'enabled'};if(effort!=='none')params.reasoning_effort=effort;}
 else if(config.provider==='openrouter')params.reasoning={effort};
 else if(config.provider==='qwen'){params.enable_thinking=effort!=='none';if(effort!=='none')params.thinking_budget=Math.min(config.thinkingBudget??4096,Math.max(1,tokens-512));}
 else params.reasoning_effort=effort;
 return params;
}
export type AvailableModel={id:string;name?:string;efforts?:string[];reasoningMandatory?:boolean};
export const modelListUrls:Record<string,string>={deepseek:'https://api.deepseek.com/models',openai:'https://api.openai.com/v1/models',openrouter:'https://openrouter.ai/api/v1/models',qwen:'https://dashscope.aliyuncs.com/compatible-mode/v1/models'};
