import type { AgentEvent } from './agent-types';
export function clipped(text:string,limit:number){return text.length>limit?text.slice(0,limit)+`\n[展示已截断：共 ${text.length} 字符]`:text;}
// Cumulative stream updates replace the same logical item; neither UI nor saved
// traces accumulate a new entry for every token and evict earlier tool events.
export function mergeAgentEvent(events:AgentEvent[],event:AgentEvent):AgentEvent[]{
  const approvalIndex=event.type==='approval'?events.findIndex(e=>e.type==='approval'&&e.approval?.id===event.approval?.id):-1;
  if(approvalIndex>=0)return events.map((e,i)=>i===approvalIndex?event:e);
  const index=['assistant','iteration','budget','context'].includes(event.type)?events.findIndex(e=>e.type===event.type&&e.iteration===event.iteration):-1;
  if(index<0)return [...events,event].slice(-500);
  return events.map((e,i)=>i===index?event:e);
}
