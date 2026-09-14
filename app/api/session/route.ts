import { body, checkOrigin, db, fail, hashToken, owner } from '@/lib/storage';
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    try {
      const id = await owner(request);
      return Response.json(await db().prepare('SELECT name FROM sessions WHERE id = ?').bind(id).first());
    } catch (e) { if (!(e instanceof Error && 'status' in e && e.status === 401)) throw e; }
    const input = await body(request);
    const name = typeof input.name === 'string' ? input.name.trim().slice(0, 30) || '创作者' : '创作者';
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
    await db().prepare('INSERT INTO sessions (id, name, created_at) VALUES (?, ?, ?)').bind(await hashToken(token), name, Date.now()).run();
    return Response.json({ name }, { headers: { 'Set-Cookie': `atmos_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}` } });
  } catch (e) { return fail(e); }
}
