import { env } from 'cloudflare:workers';
import { ApiError } from './errors';
export async function harnessRequest(path:string,input:unknown,signal?:AbortSignal){
  const config=env as unknown as {ATMOS_HARNESS_URL?:string;ATMOS_HARNESS_TOKEN?:string};
  if(!config.ATMOS_HARNESS_URL||!config.ATMOS_HARNESS_TOKEN)throw new ApiError('Agent 运行层尚未启动。请使用 npm run dev 启动本地工作台。',503);
  try{return await fetch(config.ATMOS_HARNESS_URL+path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${config.ATMOS_HARNESS_TOKEN}`},body:JSON.stringify(input),signal,redirect:'manual'});}
  catch(error){if(signal?.aborted)throw error;throw new ApiError('无法连接本地 Agent 运行层，请重新启动 npm run dev。',503);}
}
