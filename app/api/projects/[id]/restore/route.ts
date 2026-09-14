import { ApiError, body, checkOrigin, db, fail, getProject, owner } from '@/lib/storage';
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    checkOrigin(request);
    const { id } = await ctx.params;
    const user = await owner(request);
    const project = await getProject(id, user);
    const input = await body(request);
    if (!Number.isInteger(input.number)) throw new ApiError('版本号无效。');
    const version = await db().prepare('SELECT * FROM versions WHERE project_id = ? AND number = ?').bind(id, input.number).first();
    if (!version) throw new ApiError('版本不存在。', 404);
    const revision = crypto.randomUUID();
    const current = Number(project.current_version);
    if (current >= 40) throw new ApiError('此项目已达到 40 个版本的体验上限，请导出源码或新建项目。');
    const now = Date.now();
    const result = await db().batch([
      db().prepare('INSERT INTO versions (id, project_id, number, prompt, summary, code, mode, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND current_version = ?)').bind(revision, id, current + 1, `恢复版本 v${input.number}`, `已将 v${input.number} 的代码恢复为新版本，历史记录与应用数据均保留。`, version.code, 'restore', now, id, current),
      db().prepare('UPDATE projects SET current_version = ?, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM versions WHERE id = ?)').bind(current + 1, now, id, revision),
    ]);
    if (!result[0].meta.changes) throw new ApiError('项目已在其他窗口更新，请刷新后重试。', 409);
    return Response.json({ ok: true });
  } catch (e) { return fail(e); }
}
