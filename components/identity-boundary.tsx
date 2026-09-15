'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Identity } from '@/lib/auth-types';
export function IdentityBoundary({children}:{children:(identity:Identity,onChange:(next:Identity)=>void)=>ReactNode}) {
  const [identity,setIdentity]=useState<Identity|null>(null),[revision,setRevision]=useState(0),[error,setError]=useState('');
  const current=useRef<Identity|null>(null),channel=useRef<BroadcastChannel|null>(null),ticket=useRef(0);
  async function hydrate(reset=false) {
    const t=++ticket.current;
    if(reset){window.dispatchEvent(new Event('atmos:retire'));setIdentity(null);current.current=null;window.history.replaceState({},'','/');}
    try {
      let r=await fetch('/api/auth/me',{cache:'no-store'});
      if(r.status===401)r=await fetch('/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      const data=await r.json() as Identity&{error?:string};if(!r.ok)throw new Error(data.error||'无法读取账户信息。');
      if(t!==ticket.current)return;
      if(current.current&&[current.current.kind,current.current.ownerId,current.current.name,current.current.email,current.current.expiresAt].join('|')!==[data.kind,data.ownerId,data.name,data.email,data.expiresAt].join('|')){window.dispatchEvent(new Event('atmos:retire'));window.history.replaceState({},'','/');setRevision(v=>v+1);}
      current.current=data;setIdentity(data);setError('');
    }catch(error){if(t===ticket.current)setError((error as Error).message);}
  }
  useEffect(()=>{
    // Initial hydration only updates state after a network response.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void hydrate();
    try{channel.current=new BroadcastChannel('atmos:identity');channel.current.onmessage=()=>void hydrate(true);}catch{}
    const storage=(e:StorageEvent)=>{if(e.key==='atmos:identity-revision')void hydrate(true);};
    const focus=()=>void hydrate();
    window.addEventListener('storage',storage);window.addEventListener('focus',focus);
    const timer=setInterval(()=>void hydrate(),30000);
    // Invalidate any outstanding request when this boundary unmounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return()=>{ticket.current++;channel.current?.close();window.removeEventListener('storage',storage);window.removeEventListener('focus',focus);clearInterval(timer);};
  },[]);
  function changed(next:Identity){
    ticket.current++;window.dispatchEvent(new Event('atmos:retire'));
    if(current.current?.ownerId!==next.ownerId)window.history.replaceState({},'','/');
    current.current=next;setIdentity(next);setRevision(v=>v+1);
    if(channel.current)channel.current.postMessage({changed:true});
    else try{localStorage.setItem('atmos:identity-revision',crypto.randomUUID());}catch{}
  }
  if(!identity)return <div className="identity-loading"><strong>atmos.</strong><p>{error||'正在连接你的创作空间…'}</p>{error&&<button className="secondary-button" onClick={()=>void hydrate()}>重新连接</button>}</div>;
  // The render prop passes changed as an event handler; it never invokes it during render.
  // eslint-disable-next-line react-hooks/refs
  return <div key={revision}>{children(identity,changed)}</div>;
}
