'use client';
import {useCallback,useEffect,useRef,useState} from 'react';
import {applyWorkspaceEvent,type LiveWorkspaceState,type WorkspaceEvent} from '@/lib/live-workspace';
export function useLiveWorkspace(projectId:string|undefined,busy:boolean,ownerId?:string){
  const [live,setLive]=useState<LiveWorkspaceState|null>(null);
  const storageKey=`atmos:run:${ownerId?ownerId+':':''}${projectId||'new'}`;
  const keyRef=useRef(storageKey);
  const originKey=useRef(storageKey);
  const ticket=useRef(0);
  const fetchSnapshot=useCallback(async(id:string,current:number)=>{
    const response=await fetch(`/api/runs/${encodeURIComponent(id)}`,{headers:ownerId?{'X-Atmos-Owner':ownerId}:{}});if(!response.ok)return;
    const snapshot=await response.json() as LiveWorkspaceState;
    if(current===ticket.current)setLive(previous=>previous?.runId===id&&previous.seq>snapshot.seq?previous:{...snapshot,gap:false});
  },[ownerId]);
  useEffect(()=>{
    keyRef.current=storageKey;
    const current=++ticket.current;
    // Hydrate browser-only run metadata. Files come from the authenticated API.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLive(null);
    try{const id=sessionStorage.getItem(storageKey);if(id)void fetchSnapshot(id,current).catch(()=>{});}catch{}
    return()=>{ticket.current=current+1;};
  },[storageKey,fetchSnapshot]);
  useEffect(()=>{
    if(!live||busy&&!live.gap||!live.gap&&live.status!=='running')return;
    const id=live.runId,current=ticket.current;
    const timer=setInterval(()=>void fetchSnapshot(id,current).catch(()=>{}),1500);
    return()=>clearInterval(timer);
  },[busy,live?.runId,live?.gap,live?.status,fetchSnapshot]); // eslint-disable-line react-hooks/exhaustive-deps
  const receive=useCallback((event:WorkspaceEvent)=>{
    if(event.kind==='init'){originKey.current=keyRef.current;try{sessionStorage.setItem(keyRef.current,event.runId);}catch{}}
    setLive(previous=>applyWorkspaceEvent(previous,event));
  },[]);
  const start=useCallback(()=>{ticket.current++;setLive(null);try{sessionStorage.removeItem(keyRef.current);}catch{}},[]);
  const clear=useCallback(()=>{ticket.current++;setLive(null);try{sessionStorage.removeItem(keyRef.current);sessionStorage.removeItem(originKey.current);}catch{}},[]);
  const settle=useCallback(()=>{setLive(previous=>previous?.status==='running'?{...previous,status:'stopped',active:undefined,message:'连接已结束，正在核对最后快照。'}:previous);},[]);
  const recover=useCallback((id:string)=>fetchSnapshot(id,ticket.current).catch(()=>{}),[fetchSnapshot]);
  return{live,receive,start,clear,settle,recover};
}
