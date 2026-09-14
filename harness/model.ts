import { providers, type ModelConfig } from '../lib/types';
export type ToolCall={id:string;type:'function';function:{name:string;arguments:string}};
export type Message={role:'system'|'user'|'assistant'|'tool';content:string|null;tool_calls?:ToolCall[];tool_call_id?:string};
export type ModelTool={type:'function';function:{name:string;description:string;parameters:Record<string,unknown>}};
export type ModelReply={content:string;calls:ToolCall[];finish:string};
export class ModelOutputError extends Error {
  constructor(readonly reason:'length'|'incomplete'|'invalid',message:string){super(message);}
}
export type ModelProgress=(characters:number,publicText?:string,phase?:'reasoning'|'output')=>void;
export async function modelTurn(config:ModelConfig,messages:Message[],tools:ModelTool[],signal:AbortSignal,onProgress?:ModelProgress):Promise<ModelReply>{
  if(!Object.hasOwn(providers,config.provider))throw new Error('不支持的模型服务。');
  const provider=providers[config.provider as keyof typeof providers];
  const response=await fetch(provider.url,{method:'POST',redirect:'manual',signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.apiKey}`},body:JSON.stringify({model:config.model,messages,tools,tool_choice:'auto',stream:true,max_tokens:14000,...(config.provider==='deepseek'?{thinking:{type:'disabled'}}:config.provider==='qwen'?{enable_thinking:false}:{})})});
  if(!response.ok){await response.body?.cancel();throw new Error(response.status===401||response.status===403?'模型认证失败，请检查 API Key 和权限。':response.status===429?'模型限流或额度不足，请稍后重试。':`模型请求失败（HTTP ${response.status}），请确认该模型支持工具调用。`);}
  if(!response.body)throw new ModelOutputError('incomplete','模型没有返回数据流。');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',content='',finish='',size=0,lastAt=0;
  let phase:'reasoning'|'output'='output';
  const calls=new Map<number,ToolCall>();
  function notify(force=false){if(force||Date.now()-lastAt>=120){lastAt=Date.now();onProgress?.(size,content,phase);}}
  function line(raw:string){
    if(!raw.startsWith('data:'))return;const text=raw.slice(5).trim();if(!text||text==='[DONE]')return;
    let data;try{data=JSON.parse(text);}catch{throw new ModelOutputError('invalid','模型返回的 SSE 数据格式损坏，本轮工具未执行。');}
    if(data.error)throw new Error('模型在流式响应中返回错误。');
    const choice=data.choices?.[0];if(!choice)return;if(choice.finish_reason)finish=choice.finish_reason;
    // Detect activity only. Never expose or retain private reasoning fields.
    if(choice.delta?.reasoning_content||choice.delta?.reasoning)phase='reasoning';
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
  return{content,calls:result,finish};
}
