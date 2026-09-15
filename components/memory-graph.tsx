'use client';
import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { Minus, Plus, Scan } from 'lucide-react';
import { memoryLinks, type MemoryDocument } from '@/lib/memory-types';

type Point={x:number;y:number};
function layout(documents:MemoryDocument[],links:ReturnType<typeof memoryLinks>['links']){
  const points=new Map(documents.map((d,i)=>[d.id,{x:400+Math.cos(i*2.39996)*Math.sqrt(i+1)*27,y:270+Math.sin(i*2.39996)*Math.sqrt(i+1)*27}]));
  for(let step=0;step<110;step++){
    const force=new Map(documents.map(d=>[d.id,{x:0,y:0}]));
    for(let i=0;i<documents.length;i++)for(let j=i+1;j<documents.length;j++){
      const a=points.get(documents[i].id)!,b=points.get(documents[j].id)!,dx=a.x-b.x,dy=a.y-b.y,dist=Math.max(1,Math.hypot(dx,dy)),strength=1100/(dist*dist);
      force.get(documents[i].id)!.x+=dx*strength;force.get(documents[i].id)!.y+=dy*strength;
      force.get(documents[j].id)!.x-=dx*strength;force.get(documents[j].id)!.y-=dy*strength;
    }
    for(const l of links){const a=points.get(l.source)!,b=points.get(l.target)!;const dx=(b.x-a.x)*.015,dy=(b.y-a.y)*.015;force.get(l.source)!.x+=dx;force.get(l.source)!.y+=dy;force.get(l.target)!.x-=dx;force.get(l.target)!.y-=dy;}
    for(const d of documents){const p=points.get(d.id)!,f=force.get(d.id)!;p.x+=Math.max(-12,Math.min(12,f.x+(400-p.x)*.009));p.y+=Math.max(-12,Math.min(12,f.y+(270-p.y)*.009));}
  }
  return points;
}
function fitCamera(points:Point[]){
  if(!points.length)return {x:0,y:0,zoom:1};
  const minX=Math.min(...points.map(p=>p.x))-85,maxX=Math.max(...points.map(p=>p.x))+85,minY=Math.min(...points.map(p=>p.y))-60,maxY=Math.max(...points.map(p=>p.y))+60;
  const zoom=Math.min(1.5,700/(maxX-minX),440/(maxY-minY));
  return {zoom,x:400-(minX+maxX)*zoom/2,y:260-(minY+maxY)*zoom/2};
}
export function MemoryGraph({documents,selected,onSelect}:{documents:MemoryDocument[];selected:string;onSelect:(id:string)=>void}){
  const links=useMemo(()=>memoryLinks(documents).links,[documents]);
  const positions=useMemo(()=>layout(documents,links),[documents,links]);
  const [overrides,setOverrides]=useState<Record<string,Point>>({}),[viewport,setCamera]=useState<(Point&{zoom:number})|null>(null);
  const home=useMemo(()=>fitCamera([...positions.values()]),[positions]);
  const camera=viewport||home;
  const svg=useRef<SVGSVGElement>(null),gesture=useRef<{id?:string;start:Point;origin:Point;moved:boolean}|null>(null),suppressClick=useRef(false);
  const neighbors=new Set(links.flatMap(l=>l.source===selected?[l.target]:l.target===selected?[l.source]:[]));
  function point(e:PointerEvent<SVGElement>){const matrix=svg.current!.getScreenCTM()!.inverse();return new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix);}
  function start(e:PointerEvent<SVGElement>,id?:string){if(e.button!==0)return;e.stopPropagation();const p=point(e);gesture.current={id,start:p,origin:id?(overrides[id]||positions.get(id)!):{x:camera.x,y:camera.y},moved:false};svg.current!.setPointerCapture(e.pointerId);}
  function move(e:PointerEvent<SVGSVGElement>){const g=gesture.current;if(!g)return;const p=point(e),dx=p.x-g.start.x,dy=p.y-g.start.y;if(Math.hypot(dx,dy)>3)g.moved=true;if(g.id)setOverrides(v=>({...v,[g.id!]:{x:g.origin.x+dx/camera.zoom,y:g.origin.y+dy/camera.zoom}}));else setCamera({...camera,x:g.origin.x+dx,y:g.origin.y+dy});}
  function end(){if(gesture.current){suppressClick.current=gesture.current.moved;if(gesture.current.id&&!gesture.current.moved)onSelect(gesture.current.id);}gesture.current=null;}
  function zoom(factor:number){setCamera(previous=>{const v=previous||home;const next=Math.max(.35,Math.min(3,v.zoom*factor));const ratio=next/v.zoom;return {zoom:next,x:400-(400-v.x)*ratio,y:270-(270-v.y)*ratio};});}
  function fit(){setOverrides({});setCamera(null);}
  return <div className="memory-graph"><div className="memory-graph-caption"><strong>思想之间，自有连接</strong><span>{documents.length} 篇文档 · {links.length} 条引用关系</span></div><svg ref={svg} viewBox="0 0 800 540" aria-label="用户记忆关系图谱，支持拖动节点和缩放" onPointerDown={e=>start(e)} onPointerMove={move} onPointerUp={end} onPointerCancel={()=>{gesture.current=null;}} onWheel={e=>{zoom(e.deltaY>0?.92:1.08);}}>
    <defs><pattern id="memory-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="#b8d7e7"/></pattern></defs><rect width="800" height="540" fill="url(#memory-grid)" opacity=".5"/>
    <g transform={`translate(${camera.x} ${camera.y}) scale(${camera.zoom})`}>{links.map(l=>{const a=overrides[l.source]||positions.get(l.source)!,b=overrides[l.target]||positions.get(l.target)!,active=l.source===selected||l.target===selected;return <line key={l.source+l.target} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={active?'#399ed3':'#b9d5e5'} strokeWidth={active?2:1} opacity={selected&&!active?.4:1}/>;})}{documents.map(d=>{const p=overrides[d.id]||positions.get(d.id)!,active=d.id===selected;return <g key={d.id} transform={`translate(${p.x} ${p.y})`} className={`memory-node ${active?'selected':''}`} role="button" tabIndex={0} aria-label={`图谱文档：${d.title}`} onPointerDown={e=>start(e,d.id)} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();onSelect(d.id);}}} onClick={()=>{if(!suppressClick.current)onSelect(d.id);suppressClick.current=false;}} opacity={selected&&!active&&!neighbors.has(d.id)?.45:1}><circle r="24" fill="transparent"/><title>{d.path}{d.enabled?'':' · 已暂停'}</title>{active&&<circle r="24" fill="#73c9f2" opacity=".2"/>}<circle r={d.pinned?12:8} fill={d.enabled?(active?'#087bad':d.pinned?'#35aee7':'#83c8e8'):'#b3c0ca'} stroke="white" strokeWidth="3"/><text y="31" textAnchor="middle" fill="#355f79" fontSize="12">{d.title.length>16?d.title.slice(0,16)+'…':d.title}</text></g>;})}</g>
  </svg><div className="memory-graph-controls"><button aria-label="缩小图谱" onClick={()=>zoom(.8)}><Minus size={16}/></button><span>{Math.round(camera.zoom*100)}%</span><button aria-label="放大图谱" onClick={()=>zoom(1.25)}><Plus size={16}/></button><button aria-label="适应全部节点" onClick={fit}><Scan size={16}/></button></div><p className="memory-graph-legend">拖动节点或空白处 · 滚轮缩放 · 连线来自 [[双向链接]]<br/>大节点为常驻记忆，灰色节点已暂停</p></div>;
}
