import {ApiError,body,checkOrigin,fail,owner} from '@/lib/storage';
import {modelListUrls,type AvailableModel} from '@/lib/model-config';
export async function POST(request:Request){try{
 checkOrigin(request);await owner(request);const input=await body(request,2500);
 if(typeof input.provider!=='string'||!Object.hasOwn(modelListUrls,input.provider)||typeof input.apiKey!=='string'||!input.apiKey.trim()||input.apiKey.length>1000)throw new ApiError('请先填写模型服务和 API Key。');
 const response=await fetch(modelListUrls[input.provider],{headers:{Authorization:`Bearer ${input.apiKey.trim()}`},redirect:'manual',signal:AbortSignal.any([request.signal,AbortSignal.timeout(15000)])});
 if(!response.ok){await response.body?.cancel();throw new ApiError(response.status===401||response.status===403?'模型列表认证失败，请检查 API Key。':'此服务暂不能列出模型，请手动填写模型 ID。',502);}
 const text=await response.text();if(text.length>5000000)throw new ApiError('模型列表过大，请手动填写模型 ID。',502);
 const data=JSON.parse(text);const models:AvailableModel[]=(Array.isArray(data.data)?data.data:[]).filter((m:{id?:unknown})=>typeof m.id==='string'&&m.id.length<=150).slice(0,2000).map((m:{id:string;name?:string;reasoning?:{supported_efforts?:string[];mandatory?:boolean}})=>({id:m.id,name:typeof m.name==='string'?m.name.slice(0,150):undefined,...(input.provider==='openrouter'?{efforts:Array.isArray(m.reasoning?.supported_efforts)?m.reasoning.supported_efforts.filter(e=>typeof e==='string'):undefined,reasoningMandatory:m.reasoning?.mandatory===true}:{})})).sort((a:AvailableModel,b:AvailableModel)=>a.id.localeCompare(b.id));
 return Response.json({models},{headers:{'Cache-Control':'no-store'}});
}catch(error){return fail(error);}}
