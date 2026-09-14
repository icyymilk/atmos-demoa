import { providers, type ModelConfig } from '../lib/types';
export type ToolCall={id:string;type:'function';function:{name:string;arguments:string}};
export type Message={role:'system'|'user'|'assistant'|'tool';content:string|null;tool_calls?:ToolCall[];tool_call_id?:string};
export type ModelTool={type:'function';function:{name:string;description:string;parameters:Record<string,unknown>}};
export type ModelReply={content:string;calls:ToolCall[];finish:string};
export async function modelTurn(config:ModelConfig,messages:Message[],tools:ModelTool[],signal:AbortSignal,onProgress?:(characters:number)=>void):Promise<ModelReply>{
  if(!Object.hasOwn(providers,config.provider))throw new Error('不支持的模型服务。');
  const provider=providers[config.provider as keyof typeof providers];
  const response=await fetch(provider.url,{method:'POST',redirect:'manual',signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.apiKey}`},body:JSON.stringify({model:config.model,messages,tools,tool_choice:'auto',stream:true,max_tokens:14000,...(config.provider==='deepseek'?{thinking:{type:'disabled'}}:config.provider==='qwen'?{enable_thinking:false}:{})})});
  if(!response.ok){await response.body?.cancel();throw new Error(response.status===401||response.status===403?'模型认证失败，请检查 API Key 和权限。':response.status===429?'模型限流或额度不足，请稍后重试。':`模型请求失败（HTTP ${response.status}），请确认该模型支持工具调用。`);}
  if(!response.body)throw new Error('模型没有返回数据流。');
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',content='',finish='',size=0,last=0;
  const calls=new Map<number,ToolCall>();
  function line(raw:string){
    if(!raw.startsWith('data:'))return;const text=raw.slice(5).trim();if(!text||text==='[DONE]')return;
    let data;try{data=JSON.parse(text);}catch{throw new Error('模型返回的 SSE 数据格式损坏。');}
    if(data.error)throw new Error('模型在流式响应中返回错误。');
    const choice=data.choices?.[0];if(!choice)return;if(choice.finish_reason)finish=choice.finish_reason;
    if(typeof choice.delta?.content==='string'){content+=choice.delta.content;size+=choice.delta.content.length;}
    for(const delta of choice.delta?.tool_calls||[]){
      if(!Number.isInteger(delta.index)||delta.index<0||delta.index>15)throw new Error('单轮工具调用数量过多。');
      const call=calls.get(delta.index)||{id:'',type:'function' as const,function:{name:'',arguments:''}};
      if(delta.id)call.id=delta.id;
      if(delta.function?.name)call.function.name+=delta.function.name;
      if(delta.function?.arguments){call.function.arguments+=delta.function.arguments;size+=delta.function.arguments.length;}
      calls.set(delta.index,call);
    }
    if(size>220000)throw new Error('本轮模型输出超出限制，请缩小任务。');
    if(size-last>=1000){last=size;onProgress?.(size);}
  }
  try{while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop()||'';for(const value of lines)line(value);}buffer+=decoder.decode();if(buffer.trim())line(buffer);}finally{await reader.cancel().catch(()=>{});}
  if(finish==='length')throw new Error('模型输出被长度限制截断，本轮工具未执行。请缩小需求。');
  if(!finish)throw new Error('模型连接提前结束，未收到完成标记；本轮工具未执行。');
  if(finish==='content_filter')throw new Error('模型服务未允许完成本轮响应。');
  const result=[...calls.values()];
  if(result.some(c=>!c.id||!c.function.name))throw new Error('模型返回了不完整的工具调用。');
  if(!content.trim()&&!result.length)throw new Error('模型没有返回回复或工具调用。');
  return{content,calls:result,finish};
}
