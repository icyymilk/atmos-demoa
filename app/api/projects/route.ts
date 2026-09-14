import { db, fail, owner } from '@/lib/storage';
export async function GET(request: Request) {
  try {
    const user = await owner(request);
    const result = await db().prepare('SELECT id, title, current_version, created_at, updated_at FROM projects WHERE owner = ? ORDER BY updated_at DESC LIMIT 100').bind(user).all();
    return Response.json(result.results, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return fail(e); }
}
