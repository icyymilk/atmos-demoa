'use client';
import {useEffect,useId,useRef,type ReactNode} from 'react';
import {X} from 'lucide-react';
export function Modal({title,close,children}:{title:string;close:()=>void;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null),titleId=useId();
  useEffect(()=>{
    const previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const dialog=ref.current;dialog?.showModal();
    return()=>{dialog?.close();if(previous?.isConnected)previous.focus();};
  },[]);
  return <dialog ref={ref} className="modal" aria-labelledby={titleId} onCancel={e=>{e.preventDefault();close();}} onClick={e=>{
    if(e.target!==ref.current)return;
    const bounds=e.currentTarget.getBoundingClientRect();
    if(e.clientX<bounds.left||e.clientX>bounds.right||e.clientY<bounds.top||e.clientY>bounds.bottom)close();
  }}><div className="modal-top"><h2 id={titleId}>{title}</h2><button className="icon-button" aria-label="关闭弹窗" title="关闭（Esc）" onClick={close}><X size={20}/></button></div>{children}</dialog>;
}
