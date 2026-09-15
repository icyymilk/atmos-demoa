import { env } from 'cloudflare:workers';
export function db() {
  if (!env.DB) throw new Error('数据库暂不可用，请稍后重试。');
  return env.DB;
}
import { ApiError } from './errors';
export { ApiError } from './errors';
export function checkOrigin(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new ApiError('不允许跨站请求。', 403);
}
export function cookieToken(request: Request, name = 'atmos_session') {
  return request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(name + '='))?.slice(name.length + 1).match(/^[a-f0-9]{64}$/)?.[0];
}
export async function session(request: Request, cookie = 'atmos_session'): Promise<import('./auth-types').Session> {
  const token = cookieToken(request, cookie);
  if (!token) throw new ApiError('请刷新页面或重新登录。', 401);
  const id = await hashToken(token);
  const row = await db().prepare(`SELECT s.id,s.owner_id,s.user_id,s.name AS guest_name,s.expires_at,u.name,u.email FROM sessions s LEFT JOIN users u ON u.owner_id=s.owner_id WHERE s.id=? AND s.expires_at>? AND ((s.user_id IS NULL AND u.id IS NULL) OR s.user_id=u.id)`).bind(id,Date.now()).first<{id:string;owner_id:string;user_id:string|null;guest_name:string;expires_at:number;name:string|null;email:string|null}>();
  if (!row) throw new ApiError('会话已失效，请刷新页面或重新登录。', 401);
  return { sessionId:row.id,ownerId:row.owner_id,kind:row.user_id?'account':'guest',name:row.name||row.guest_name,expiresAt:row.expires_at,...(row.user_id?{userId:row.user_id,email:row.email!}: {}) };
}
export async function owner(request: Request) {
  const current = await session(request);
  const expected = request.headers.get('X-Atmos-Owner');
  if (expected && expected !== current.ownerId) throw new ApiError('身份已切换，请重新打开项目。', 409);
  return current.ownerId;
}
export async function hashToken(token: string) {
  const data = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(data), b => b.toString(16).padStart(2, '0')).join('');
}
export async function body(request: Request, limit = 100000) {
  const raw = await request.text();
  if (raw.length > limit) throw new ApiError('请求内容过大。', 413);
  try { const parsed = JSON.parse(raw); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(); return parsed; } catch { throw new ApiError('请求格式有误。'); }
}
export function fail(error: unknown) {
  if (error instanceof ApiError) return Response.json({ error: error.message }, { status: error.status });
  console.error('Atmos request failed:', error instanceof Error ? error.name : 'UnknownError');
  return Response.json({ error: '服务暂不可用，你的输入已保留，请稍后重试。' }, { status: 503 });
}
export async function getProject(id: string, user: string) {
  const row = await db().prepare('SELECT * FROM projects WHERE id = ? AND owner = ?').bind(id, user).first();
  if (!row) throw new ApiError('项目不存在或无权访问。', 404);
  return row;
}
