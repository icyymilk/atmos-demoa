import { session, fail } from '@/lib/storage';
import { publicIdentity } from '@/lib/auth';
export async function GET(request:Request) {
  try{return Response.json(publicIdentity(await session(request)),{headers:{'Cache-Control':'no-store'}});}catch(error){return fail(error);}
}
