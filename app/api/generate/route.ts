import { ApiError, body, checkOrigin, db, fail, getProject, owner } from '@/lib/storage';
import { templateApp } from '@/lib/templates';
import { providers, type ModelConfig } from '@/lib/types';
import { harnessRequest } from '@/lib/harness-client';
import type { AgentEvent } from '@/lib/agent-types';

type Artifact={title:string;summary:string;code:string;files:Record<string,string>;trace:AgentEvent[]};
export async function POST(request:Request){
  try{
    checkOrigin(request);const user=await owner(request),input=await body(request,12000);
    if(typeof input.prompt!=='string'||!input.prompt.trim()||input.prompt.length>4000)throw new ApiError('请填写 1–4000 个字符的应用需求。');
    const prompt=input.prompt.trim(),mode=input.mode==='template'?'template':'ai';
    if(mode==='template'&&input.projectId)throw new ApiError('模板用于创建示例，请连接模型后修改现有应用。');
    const config:ModelConfig={provider:input.provider,model:input.model,apiKey:input.apiKey};
    if(mode==='ai'&&(!Object.hasOwn(providers,config.provider)||typeof config.apiKey!=='string'||!config.apiKey.trim()||config.apiKey.length>1000||typeof config.model!=='string'||!config.model.trim()||config.model.length>150))throw new ApiError('请先配置模型服务、模型名称和 API Key。');
    const project=input.projectId?await getProject(input.projectId,user):null;
    if(project&&Number(project.current_version)>=40)throw new ApiError('此项目已达到 40 个版本的体验上限，请导出源码或新建项目。');
    if(project&&input.baseVersion!==project.current_version)throw new ApiError('项目已更新，请刷新后再生成。',409);
    const count=await db().prepare('SELECT COUNT(*) AS n FROM projects WHERE owner = ?').bind(user).first<{n:number}>();
    if(!project&&(count?.n||0)>=50)throw new ApiError('最多保存 50 个项目，请先删除不需要的项目。');
    const previous=project?await db().prepare('SELECT code, files FROM versions WHERE project_id = ? AND number = ?').bind(project.id,project.current_version).first<{code:string;files:string}>():null;
    const history=project?(await db().prepare('SELECT prompt, summary FROM versions WHERE project_id = ? ORDER BY number DESC LIMIT 5').bind(project.id).all()).results.reverse():[];
    const disconnect=new AbortController(),signal=AbortSignal.any([request.signal,disconnect.signal]);
    const encoder=new TextEncoder();
    const stream=new ReadableStream({
      cancel(){disconnect.abort();},
      async start(controller){
        let closed=false;
        const emit=(data:object)=>{if(!closed)try{controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));}catch{closed=true;disconnect.abort();}};
        try{
          let artifact:Artifact;
          if(mode==='template'){
            const app=templateApp(prompt,['board','expense','focus'].includes(input.templateId)?input.templateId:undefined);
            emit({type:'agent',event:{type:'notice',at:Date.now(),text:'正在创建预置交互模板（不调用模型）。'}});
            artifact={...app,summary:`已创建「${app.title}」模板，可以直接操作并自动保存。这是预置模板；连接模型后 Agent 会通过工具循环完成修改。`,files:{'index.html':app.code},trace:[]};
          }else{
            emit({type:'agent',event:{type:'notice',at:Date.now(),text:'正在启动 Agent，发现 MCP 工具和 Skill…'}});
            const files=previous?{...JSON.parse(previous.files||'{}'),'index.html':previous.code}:{};
            const upstream=await harnessRequest('/run',{owner:user,runId:crypto.randomUUID(),prompt,config,files,history},signal);
            if(!upstream.ok){const error=await upstream.json() as {error?:string};throw new ApiError(error.error||'Agent 运行层拒绝了请求。',upstream.status);}
            if(!upstream.body)throw new ApiError('Agent 未返回事件流。',502);
            const reader=upstream.body.getReader(),decoder=new TextDecoder();let buffer='',result:Artifact|undefined;
            function receive(line:string){if(!line.startsWith('data:'))return;const event=JSON.parse(line.slice(5));if(event.type==='agent'||event.type==='workspace')emit(event);else if(event.type==='error')throw new ApiError(event.message,502);else if(event.type==='result')result=event;}
            try{while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop()||'';lines.forEach(receive);}buffer+=decoder.decode();if(buffer.trim())receive(buffer);}finally{await reader.cancel().catch(()=>{});}
            if(!result)throw new ApiError('Agent 连接中断，尚未完成交付。',502);
            artifact=result;
          }
          signal.throwIfAborted();
          emit({type:'agent',event:{type:'notice',at:Date.now(),text:'交付已通过检查，正在保存代码、工作区和执行记录。'}});
          const id=project?.id||crypto.randomUUID(),revision=crypto.randomUUID(),now=Date.now(),current=Number(project?.current_version||0);
          const statements=[];
          if(!project)statements.push(db().prepare('INSERT INTO projects (id,owner,title,current_version,state,created_at,updated_at) VALUES (?,?,?,0,?,?,?)').bind(id,user,artifact.title,'{}',now,now));
          statements.push(db().prepare('INSERT INTO versions (id,project_id,number,prompt,summary,code,mode,created_at,files,trace) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND current_version = ?)').bind(revision,id,current+1,prompt,artifact.summary,artifact.code,mode,now,JSON.stringify(artifact.files),JSON.stringify(artifact.trace),id,current));
          statements.push(db().prepare('UPDATE projects SET current_version = ?, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM versions WHERE id = ?)').bind(current+1,now,id,revision));
          const saved=await db().batch(statements);if(!saved[saved.length-2].meta.changes)throw new ApiError('项目已被其他窗口更新，请刷新后重试。',409);
          emit({type:'done',projectId:id,title:artifact.title,summary:artifact.summary});
        }catch(error){emit({type:'error',message:signal.aborted?'已停止任务，输入已保留，已有版本未受影响。':error instanceof ApiError?error.message:'任务执行失败，已有版本未受影响，请重试。'});}
        finally{if(!closed){closed=true;controller.close();}}
      }
    });
    return new Response(stream,{headers:{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'}});
  }catch(error){return fail(error);}
}
