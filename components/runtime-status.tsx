'use client';
import {useEffect,useState} from 'react';
import {Check,RefreshCw,AlertCircle,Loader2} from 'lucide-react';
export function RuntimeStatus(){
  const [status,setStatus]=useState<'checking'|'ready'|'unavailable'>('checking'),[message,setMessage]=useState('正在检查服务');
  useEffect(()=>{
    const controller=new AbortController();
    const check=async()=>{try{const r=await fetch('/api/health',{signal:controller.signal,cache:'no-store'}),data=await r.json() as {ok:boolean;database:boolean;agent:boolean};if(!controller.signal.aborted){setStatus(data.ok?'ready':'unavailable');setMessage(data.ok?'数据保存与 Agent 运行层已就绪':!data.database?'数据服务不可用，请重新启动服务':'Agent 运行层不可用，AI 生成与账户操作暂不可用');}}catch{if(!controller.signal.aborted){setStatus('unavailable');setMessage('无法连接服务，请刷新或检查服务进程');}}};
    void check();const timer=setInterval(check,60000);return()=>{controller.abort();clearInterval(timer);};
  },[]);
  return <span className={`runtime-status ${status}`} role="status" title={message}>{status==='ready'?<Check size={13}/>:status==='checking'?<Loader2 size={13} className="spin"/>:<AlertCircle size={13}/>}<span>{status==='ready'?'服务已就绪':status==='checking'?'连接中':'服务未就绪'}</span>{status==='unavailable'&&<button aria-label="重新检查服务" title={message} onClick={()=>window.location.reload()}><RefreshCw size={13}/></button>}</span>;
}
