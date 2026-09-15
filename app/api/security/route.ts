import {body,checkOrigin,fail,owner} from '@/lib/storage';
import {harnessRequest} from '@/lib/harness-client';
const relay=(r:Response)=>new Response(r.body,{status:r.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export async function GET(request:Request){try{return relay(await harnessRequest('/security',{owner:await owner(request),action:'get'},request.signal));}catch(e){return fail(e);}}
export async function POST(request:Request){try{checkOrigin(request);const user=await owner(request),input=await body(request,1000);return relay(await harnessRequest('/security',{...input,owner:user,action:'set'},request.signal));}catch(e){return fail(e);}}
