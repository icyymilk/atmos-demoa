import {body,checkOrigin,fail,owner} from '@/lib/storage';
import {harnessRequest} from '@/lib/harness-client';
const relay=(r:Response)=>new Response(r.body,{status:r.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export async function GET(request:Request){try{return relay(await harnessRequest('/memory',{owner:await owner(request),action:'get'},request.signal));}catch(error){return fail(error);}}
export async function POST(request:Request){try{checkOrigin(request);const user=await owner(request),input=await body(request,30000);return relay(await harnessRequest('/memory',{...input,owner:user},request.signal));}catch(error){return fail(error);}}
