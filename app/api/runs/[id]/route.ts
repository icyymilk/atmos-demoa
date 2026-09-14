import { owner,fail,ApiError } from '@/lib/storage';
import { harnessRequest } from '@/lib/harness-client';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}){
  try{const user=await owner(request),{id}=await params;if(!/^[a-f0-9-]{36}$/.test(id))throw new ApiError('无效的运行标识。');
    const response=await harnessRequest('/snapshot',{owner:user,runId:id},request.signal);
    return new Response(response.body,{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  }catch(error){return fail(error);}
}
