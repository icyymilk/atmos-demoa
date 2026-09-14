import { ApiError, body, checkOrigin, db, fail, getProject, owner } from '@/lib/storage';
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Context) {
  try {
    const { id } = await ctx.params;
    const project = await getProject(id, await owner(request));
    const versions = await db().prepare('SELECT * FROM versions WHERE project_id = ? ORDER BY number ASC').bind(id).all();
    return Response.json({ ...project, owner: undefined, state: JSON.parse(project.state as string), versions: versions.results.map(v => ({ ...v, files: JSON.parse(String(v.files || '{}')), trace: JSON.parse(String(v.trace || '[]')) })) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) { return fail(e); }
}
export async function PATCH(request: Request, ctx: Context) {
  try {
    checkOrigin(request);
    const { id } = await ctx.params;
    const user = await owner(request);
    await getProject(id, user);
    const input = await body(request, 70000);
    if (input.action === 'rename') {
      if (typeof input.title !== 'string' || !input.title.trim() || input.title.length > 80) throw new ApiError('项目名称需为 1–80 个字符。');
      await db().prepare('UPDATE projects SET title = ?, updated_at = ? WHERE id = ? AND owner = ?').bind(input.title.trim(), Date.now(), id, user).run();
    } else if (input.action === 'state') {
      if (!input.state || typeof input.state !== 'object' || Array.isArray(input.state)) throw new ApiError('应用数据格式有误。');
      await db().prepare('UPDATE projects SET state = ? WHERE id = ? AND owner = ?').bind(JSON.stringify(input.state), id, user).run();
    } else throw new ApiError('不支持的操作。');
    return Response.json({ ok: true });
  } catch (e) { return fail(e); }
}
export async function DELETE(request: Request, ctx: Context) {
  try {
    checkOrigin(request);
    const { id } = await ctx.params;
    const user = await owner(request);
    await getProject(id, user);
    await db().prepare('DELETE FROM projects WHERE id = ? AND owner = ?').bind(id, user).run();
    return Response.json({ ok: true });
  } catch (e) { return fail(e); }
}
