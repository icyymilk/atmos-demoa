import {db} from '@/lib/storage';
import {harnessRequest} from '@/lib/harness-client';
export async function GET(){
  const results=await Promise.allSettled([
    db().prepare('SELECT 1 AS ready').first(),
    harnessRequest('/health',{},AbortSignal.timeout(4000)).then(async r=>r.ok&&(await r.json() as {ok?:boolean}).ok===true),
  ]);
  const database=results[0].status==='fulfilled',agent=results[1].status==='fulfilled'&&results[1].value===true;
  return Response.json({ok:database&&agent,database,agent},{status:database&&agent?200:503,headers:{'Cache-Control':'no-store'}});
}
