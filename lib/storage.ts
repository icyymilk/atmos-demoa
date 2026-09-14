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
export async function owner(request: Request) {
  const token = request.headers.get('cookie')?.match(/(?:^|;\s*)atmos_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token) throw new ApiError('请刷新页面以建立体验会话。', 401);
  const id = await hashToken(token);
  if (!await db().prepare('SELECT id FROM sessions WHERE id = ? AND created_at > ?').bind(id, Date.now() - 2592000000).first()) throw new ApiError('会话已失效，请刷新页面。', 401);
  return id;
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
