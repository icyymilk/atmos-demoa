'use client';
import { Check, ChevronRight, CircleAlert, Loader2, Wrench, Bot, Terminal, Clock3 } from 'lucide-react';
import type { AgentEvent } from '@/lib/agent-types';
const labels:Record<string,string>={list_files:'列出文件',read_file:'读取文件',write_file:'写入文件',append_file:'分块追加文件',edit_file:'精确编辑',search_files:'检索项目',delete_file:'删除文件',read_webpage:'读取网页',update_tasks:'更新任务清单',read_memory:'读取项目记忆',write_memory:'保存项目记忆',load_skill:'加载 Skill',validate_app:'验证应用',complete_task:'交付应用',web_search_exa:'搜索互联网',web_fetch_exa:'读取网络资料',get_code_context_exa:'检索技术资料',current_time:'查询时间',calculate:'计算'};
export function AgentTrace({events,live=false}:{events:AgentEvent[];live?:boolean}){
  const starts=events.filter(e=>e.type==='tool_start'),last=events.at(-1),budget=events.findLast(e=>e.type==='budget'),iteration=events.findLast(e=>e.type==='iteration');
  return <div className="agent-trace">
    <div className="trace-heading"><Terminal size={14}/><strong>{live?'Agent 正在执行':'Agent 执行记录'}</strong><span>{budget?`${budget.used}/${budget.limit}`:starts.length} 次调用</span></div>
    {budget&&<div className="trace-budget"><span>联网 {budget.researchUsed}/{budget.researchLimit} 次</span><span>剩余 {(budget.limit||0)-(budget.used||0)} 次工具调用</span></div>}
    {events.filter(e=>e.type!=='tool_end'&&e.type!=='iteration'&&e.type!=='budget').map((event,i)=>{
      if(event.type==='tool_start'){
        const result=events.find(e=>e.type==='tool_end'&&e.callId===event.callId&&e.iteration===event.iteration),name=event.name?.split('__').slice(1).join('__')||'';
        return <details className={`trace-tool ${result?.ok===false?'tool-failed':''}`} key={`${event.iteration}-${event.callId||i}`}><summary>{result?(result.ok?<Check size={14}/>:<CircleAlert size={14}/>):live?<Loader2 size={14} className="spin"/>:<Wrench size={14}/>}<span>{labels[name]||event.name}</span><small>{event.name?.split('__')[0]}{result?.durationMs!==undefined?` · ${(result.durationMs/1000).toFixed(1)}s`:''}</small><ChevronRight size={13}/></summary><div className="trace-detail"><p>{event.name}</p><strong>参数</strong><pre>{event.input||'{}'}</pre><strong>执行结果</strong><pre>{result?.output||(live?'等待工具返回…':'执行未完成')}</pre></div></details>;
      }
      return <div className={`trace-note trace-${event.type}`} key={i}>{event.type==='assistant'?<Bot size={13}/>:event.type==='complete'?<Check size={13}/>:<Clock3 size={13}/>}<p>{event.type==='assistant'&&<strong className="trace-public-label">Agent 进度说明{event.streaming&&live?' · 正在输出':''}</strong>}{event.type==='activity'&&<strong className="trace-public-label">执行摘要</strong>}{event.text}</p></div>;
    })}
    {live&&last?.type!=='tool_start'&&iteration&&<div className="trace-thinking"><Loader2 size={13} className="spin"/>{iteration.text}</div>}
  </div>;
}
