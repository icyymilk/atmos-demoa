import { body,checkOrigin,fail,owner } from '@/lib/storage';
import { harnessRequest } from '@/lib/harness-client';
export async function GET(request:Request){try{await owner(request);const response=await harnessRequest('/catalog',{},request.signal);return new Response(response.body,{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});}catch(error){return fail(error);}}
export async function POST(request:Request){try{checkOrigin(request);await owner(request);const response=await harnessRequest('/plugins',await body(request,2000),request.signal);return new Response(response.body,{status:response.status,headers:{'Content-Type':'application/json'}});}catch(error){return fail(error);}}
