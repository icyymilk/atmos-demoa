import { generationParameters } from '../lib/model-config';
import { providers, type ModelConfig } from '../lib/types';
export type ToolCall={id:string;type:'function';function:{name:string;arguments:string}};
export type Message={role:'system'|'user'|'assistant'|'tool';content:string|null;tool_calls?:ToolCall[];tool_call_id?:string;reasoning_content?:string;reasoning?:string;reasoning_details?:Record<string,unknown>[]};
export type ModelTool={type:'function';function:{name:string;description:string;parameters:Record<string,unknown>}};
export type ModelReply={content:string;calls:ToolCall[];finish:string};
// Protocol continuation stays in this process, never in public events or stored versions.
const continuations=new WeakMap<ModelReply,Partial<Message>>();
export function assistantMessage(reply:ModelReply):Message{return {role:'assistant',content:reply.content||null,...(reply.calls.length?{tool_calls:reply.calls}:{}),...continuations.get(reply)};}
export class ModelOutputError extends Error {
  constructor(readonly reason:'length'|'incomplete'|'invalid',message:string){super(message);}
}
export type ModelProgress=(characters:number,publicText?:string,phase?:'reasoning'|'output',calls?:ToolCall[])=>void;
export async function modelTurn(config:ModelConfig,messages:Message[],tools:ModelTool[],signal:AbortSignal,onProgress?:ModelProgress):Promise<ModelReply>{
  if(!Object.hasOwn(providers,config.provider))throw new Error('不支持的模型服务。');
  const provider=providers[config.provider as keyof typeof providers];
  const response=await fetch(provider.url,{method:'POST',redirect:'manual',signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.apiKey}`},body:JSON.stringify({model:config.model,messages,tools,tool_choice:'auto',stream:true,...generationParameters(config)})});
  if(!response.ok){await response.body?.cancel();throw new Error(response.status===401||response.status===403?'模型认证失败，请检查 API Key 和权限。':response.status===429?'模型限流或额度不足，请稍后重试。':`模型请求失败（HTTP ${response.status}），请确认该模型支持工具调用。`);}
  if(!response.body)throw new ModelOutputError('incomplete','模型没有返回数据流。');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',content='',finish='',size=0,lastAt=0;
  let phase:'reasoning'|'output'='output',privateText='',privateSize=0;
  const details=new Map<number,Record<string,unknown>>();
  const calls=new Map<number,ToolCall>();
  function notify(force=false){if(force||Date.now()-lastAt>=120){lastAt=Date.now();onProgress?.(size,content,phase,[...calls.values()]);}}
  function line(raw:string){
    if(!raw.startsWith('data:'))return;const text=raw.slice(5).trim();if(!text||text==='[DONE]')return;
    let data;try{data=JSON.parse(text);}catch{throw new ModelOutputError('invalid','模型返回的 SSE 数据格式损坏，本轮工具未执行。');}
    if(data.error)throw new Error('模型在流式响应中返回错误。');
    const choice=data.choices?.[0];if(!choice)return;if(choice.finish_reason)finish=choice.finish_reason;
    // Retain only provider-required continuation, without exposing reasoning in progress.
    const reasoning=choice.delta?.reasoning_content??choice.delta?.reasoning;
    if(typeof reasoning==='string'){phase='reasoning';privateSize+=reasoning.length;if(config.provider==='deepseek'||config.provider==='openrouter')privateText+=reasoning;}
    if(config.provider==='openrouter')for(const [i,part] of (choice.delta?.reasoning_details||[]).entries()){
      privateSize+=JSON.stringify(part).length;const index=Number.isInteger(part.index)?part.index:i,previous=details.get(index)||{},next={...previous,...part};
      for(const field of ['text','data','signature'])if(typeof previous[field]==='string'&&typeof part[field]==='string')next[field]=String(previous[field])+part[field];
      details.set(index,next);
    }
    if(privateSize>400000)throw new ModelOutputError('length','推理输出超过本轮容量，本轮工具未执行。请调低推理强度或输出上限。');
    if(typeof choice.delta?.content==='string'){content+=choice.delta.content;size+=choice.delta.content.length;phase='output';}
    for(const delta of choice.delta?.tool_calls||[]){
      phase='output';
      if(!Number.isInteger(delta.index)||delta.index<0||delta.index>15)throw new ModelOutputError('length','单轮工具调用数量过多，本轮工具未执行。');
      const call=calls.get(delta.index)||{id:'',type:'function' as const,function:{name:'',arguments:''}};
      if(delta.id)call.id=delta.id;
      if(delta.function?.name)call.function.name+=delta.function.name;
      if(delta.function?.arguments){call.function.arguments+=delta.function.arguments;size+=delta.function.arguments.length;}
      calls.set(delta.index,call);
    }
    if(size>220000)throw new ModelOutputError('length','本轮模型输出超出限制，本轮工具未执行。');
    notify();
  }
  try{
    while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});if(buffer.length>500000)throw new ModelOutputError('length','流式数据行超过限制，本轮工具未执行。');const lines=buffer.split('\n');buffer=lines.pop()||'';for(const value of lines)line(value);}
    buffer+=decoder.decode();if(buffer.trim())line(buffer);
  }catch(error){if(signal.aborted||error instanceof ModelOutputError)throw error;throw new ModelOutputError('incomplete','模型流式连接异常中断，本轮工具未执行。');}
  finally{notify(true);await reader.cancel().catch(()=>{});}
  if(finish==='length')throw new ModelOutputError('length','模型输出被长度限制截断，本轮工具未执行。');
  if(!finish)throw new ModelOutputError('incomplete','模型连接提前结束，未收到完成标记；本轮工具未执行。');
  if(finish==='content_filter')throw new Error('模型服务未允许完成本轮响应。');
  if(!['stop','tool_calls'].includes(finish))throw new ModelOutputError('invalid','模型完成标记不受支持，本轮工具未执行。');
  const result=[...calls.values()];
  if(result.some(c=>!c.id||!c.function.name)||new Set(result.map(c=>c.id)).size!==result.length)throw new ModelOutputError('invalid','模型返回了不完整或重复 ID 的工具调用。');
  // Validate the entire batch before any tool can cause a side effect.
  for(const call of result){try{JSON.parse(call.function.arguments);}catch{throw new ModelOutputError('invalid','工具参数 JSON 不完整，本轮工具未执行。');}}
  if(!content.trim()&&!result.length)throw new ModelOutputError('invalid','模型没有返回回复或工具调用。');
  const reply={content,calls:result,finish};
  if(config.provider==='deepseek')continuations.set(reply,{reasoning_content:privateText});
  if(config.provider==='openrouter'&&(details.size||privateText))continuations.set(reply,details.size?{reasoning_details:[...details.values()]}:{reasoning:privateText});
  return reply;
}
