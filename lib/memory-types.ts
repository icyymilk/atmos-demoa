export type MemoryDocument={id:string;path:string;title:string;content:string;tags:string[];enabled:boolean;pinned:boolean;revision:number;createdAt:number;updatedAt:number;source:'user'|'agent'};
export type MemoryProposal={id:string;title:string;content:string;tags:string[];reason:string;runId?:string;createdAt:number};
export type MemoryRecall={at:number;runId:string;query:string;documents:{id:string;path:string;revision:number}[]};
export type MemoryVault={revision:number;enabled:boolean;documents:MemoryDocument[];proposals:MemoryProposal[];recalls:MemoryRecall[]};
export type MemoryLink={source:string;target:string;label:string};
export function wikiTargets(content:string){return [...content.replace(/```[\s\S]*?```/g,'').matchAll(/\[\[([^\]\n]+)\]\]/g)].map(m=>({raw:m[1],target:m[1].split('|')[0].split('#')[0].trim()})).filter(x=>x.target);}
export function resolveMemoryTarget(documents:MemoryDocument[],target:string){
  const lower=target.split('|')[0].split('#')[0].trim().toLowerCase();
  const paths=documents.filter(d=>d.path.toLowerCase()===lower||d.path.toLowerCase()===lower+'.md');
  const matches=paths.length?paths:documents.filter(d=>d.title.toLowerCase()===lower||d.path.split('/').at(-1)?.replace(/\.md$/i,'').toLowerCase()===lower);
  return matches.length===1?matches[0]:undefined;
}
export function memoryLinks(documents:MemoryDocument[]){
  const links:MemoryLink[]=[],unresolved:{source:string;target:string}[]=[];
  for(const doc of documents)for(const {target} of wikiTargets(doc.content)){
    const match=resolveMemoryTarget(documents,target);
    if(match){if(!links.some(l=>l.source===doc.id&&l.target===match.id))links.push({source:doc.id,target:match.id,label:'双向链接'});}
    else unresolved.push({source:doc.id,target});
  }
  return {links,unresolved};
}
export function markdownIndex(vault:MemoryVault){return '# 全局文档索引\n\n'+vault.documents.map(d=>`- [[${d.path}|${d.title}]]${d.tags.length?' · '+d.tags.map(t=>'#'+t).join(' '):''}${d.enabled?'':' · 已暂停'}`).join('\n')+'\n';}
export function memoryTokens(text:string){
  const lower=text.toLowerCase();const words:string[]=lower.match(/[a-z0-9_-]{2,}/g)||[];
  for(const span of lower.match(/[\u3400-\u9fff]+/g)||[]){if(span.length===1)words.push(span);for(let i=0;i<span.length-1;i++)words.push(span.slice(i,i+2));}
  return [...new Set(words)].slice(0,150);
}
export function rankMemories(documents:MemoryDocument[],query:string){
  const tokens=memoryTokens(query);
  return documents.map(doc=>{const title=(doc.title+' '+doc.path+' '+doc.tags.join(' ')).toLowerCase(),body=doc.content.toLowerCase();const score=tokens.reduce((n,t)=>n+(title.includes(t)?5:0)+(body.includes(t)?1:0),0);return {doc,score};}).filter(item=>!query.trim()||item.score>0).sort((a,b)=>b.score-a.score||b.doc.updatedAt-a.doc.updatedAt);
}
