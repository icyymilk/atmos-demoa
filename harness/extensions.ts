import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';

const mcpSchema = z.discriminatedUnion('transport',[
  z.object({transport:z.literal('stdio'),command:z.string().min(1),args:z.array(z.string()).default([]),env:z.record(z.string()).optional(),tools:z.array(z.string()).optional()}),
  z.object({transport:z.enum(['http','sse']),url:z.string().url(),headers:z.record(z.string()).optional(),tools:z.array(z.string()).optional()}),
]);
const pluginSchema=z.object({id:z.string().regex(/^[a-z][a-z0-9-]{0,29}$/),name:z.string().max(80),version:z.string().default('1.0.0'),description:z.string().max(500),skills:z.array(z.string()).default([]),mcp:mcpSchema.optional()});
export type Plugin=z.infer<typeof pluginSchema>&{root:string;enabled:boolean};
export type Skill={id:string;name:string;description:string;plugin:string;content:string};
export type Connection={id:string;client:Client;tools:Tool[];close:()=>Promise<void>};
export type Extensions=Awaited<ReturnType<typeof loadExtensions>>;
async function json(file:string,fallback:unknown) {try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return fallback;throw error;}}
export async function loadExtensions(root:string) {
  const config=await json(path.join(root,'atmos.config.json'),{});
  const local=await json(path.join(root,'atmos.local.json'),{});
  const settings=z.object({plugins:z.array(z.string()).max(20).default([]),limits:z.object({maxIterations:z.number().int().min(1).max(60).default(24),maxToolCalls:z.number().int().min(1).max(200).default(80),timeoutSeconds:z.number().int().min(20).max(1800).default(600)}).default({})}).parse({...config,...local,limits:{...config.limits,...local.limits}});
  const disabled=await json(path.join(root,'.atmos/plugin-state.json'),{});
  const plugins:Plugin[]=[],skills:Skill[]=[],errors:{id:string;error:string}[]=[];
  for(const directory of settings.plugins){
    try {
      const pluginRoot=await realpath(path.resolve(root,directory));
      const manifest=pluginSchema.parse(await json(path.join(pluginRoot,'plugin.json'),{}));
      if(plugins.some(p=>p.id===manifest.id))throw new Error('插件 ID 重复');
      const plugin={...manifest,root:pluginRoot,enabled:disabled[manifest.id]!==false};plugins.push(plugin);
      if(!plugin.enabled)continue;
      for(const file of manifest.skills){
        const target=await realpath(path.resolve(pluginRoot,file));
        if(!target.startsWith(pluginRoot+path.sep))throw new Error('Skill 路径超出插件目录');
        const content=await readFile(target,'utf8');if(content.length>24000)throw new Error('Skill 超过 24000 字符');
        const meta=content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        const name=meta?.[1].match(/^name:\s*(.+)$/m)?.[1].trim().replace(/^["']|["']$/g,'') || path.basename(path.dirname(file));
        const description=meta?.[1].match(/^description:\s*(.+)$/m)?.[1].trim().replace(/^["']|["']$/g,'') || manifest.description;
        const id=`${manifest.id}/${name}`;
        if(skills.some(s=>s.id===id))throw new Error('Skill ID 重复');
        skills.push({id,name,description,plugin:manifest.id,content});
      }
    }catch(error){errors.push({id:path.basename(directory),error:(error as Error).message.slice(0,300)});}
  }
  return {plugins,skills,errors,limits:settings.limits};
}
export async function setPluginEnabled(root:string,id:string,enabled:boolean){
  const extensions=await loadExtensions(root);if(!extensions.plugins.some(p=>p.id===id))throw new Error('只能启用或停用已安装插件。');
  const file=path.join(root,'.atmos/plugin-state.json');const state=await json(file,{});await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify({...state,[id]:enabled},null,2));
}
export async function connectPlugin(plugin:Plugin,signal:AbortSignal):Promise<Connection|undefined>{
  if(!plugin.enabled||!plugin.mcp)return;
  const config=plugin.mcp;
  const expand=(s:string)=>s.replaceAll('${NODE}',process.execPath).replaceAll('${PLUGIN_DIR}',plugin.root).replace(/\$\{env:([A-Z0-9_]+)\}/g,(_,name)=>{const value=process.env[name];if(!value)throw new Error(`需要设置环境变量 ${name}`);return value;});
  const client=new Client({name:'atmos-harness',version:'1.0.0'});
  const transport=config.transport==='stdio'?new StdioClientTransport({command:expand(config.command),args:config.args.map(expand),cwd:plugin.root,env:config.env?Object.fromEntries(Object.entries(config.env).map(([k,v])=>[k,expand(v)])):undefined,stderr:'ignore'}):config.transport==='sse'?new SSEClientTransport(new URL(config.url),{requestInit:{headers:config.headers?Object.fromEntries(Object.entries(config.headers).map(([k,v])=>[k,expand(v)])):undefined}}):new StreamableHTTPClientTransport(new URL(config.url),{requestInit:{headers:config.headers?Object.fromEntries(Object.entries(config.headers).map(([k,v])=>[k,expand(v)])):undefined}});
  try{
    await client.connect(transport,{signal,timeout:12000});
    const tools:Tool[]=[];let cursor:string|undefined;let pages=0;
    do{const page=await client.listTools(cursor?{cursor}:undefined,{signal,timeout:12000});tools.push(...page.tools);cursor=page.nextCursor;if(++pages>10)throw new Error('MCP 工具列表分页超限');}while(cursor);
    return {id:plugin.id,client,tools:tools.filter(t=>!config.tools||config.tools.includes(t.name)).slice(0,60),close:()=>client.close()};
  }catch(error){await client.close().catch(()=>{});throw error;}
}
