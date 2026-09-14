import { ApiError, body, checkOrigin, db, fail, getProject, owner } from '@/lib/storage';
import { appContract, cleanCode, completion, validateCode } from '@/lib/generator';
import { templateApp } from '@/lib/templates';
import { providers, type ModelConfig } from '@/lib/types';

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const user = await owner(request);
    const input = await body(request, 12000);
    if (typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 4000) throw new ApiError('请填写 1–4000 个字符的应用需求。');
    const prompt = input.prompt.trim(), mode = input.mode === 'template' ? 'template' : 'ai';
    if (mode === 'template' && input.projectId) throw new ApiError('模板模式用于创建示例。请连接模型后，用对话修改现有应用。');
    const config: ModelConfig = { provider: input.provider, model: input.model, apiKey: input.apiKey };
    if (mode === 'ai' && (!providers[config.provider as keyof typeof providers] || typeof config.apiKey !== 'string' || !config.apiKey.trim() || config.apiKey.length > 1000 || typeof config.model !== 'string' || !config.model.trim() || config.model.length > 150)) throw new ApiError('请先配置模型服务、模型名称和 API Key。');
    const project = input.projectId ? await getProject(input.projectId, user) : null;
    const previous = project ? await db().prepare('SELECT code FROM versions WHERE project_id = ? AND number = ?').bind(project.id, project.current_version).first<{ code: string }>() : null;
    if (project && Number(project.current_version) >= 40) throw new ApiError('此项目已达到 40 个版本的体验上限，请导出源码或新建项目。');
    if (project && input.baseVersion !== project.current_version) throw new ApiError('项目已更新，请刷新后再生成。', 409);
    const count = await db().prepare('SELECT COUNT(*) AS n FROM projects WHERE owner = ?').bind(user).first<{ n: number }>();
    if (!project && (count?.n || 0) >= 50) throw new ApiError('最多保存 50 个项目，请先删除不需要的项目。');
    const timeout = AbortSignal.timeout(180000);
    const disconnect = new AbortController();
    const signal = AbortSignal.any([request.signal, timeout, disconnect.signal]);
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      cancel() { disconnect.abort(); },
      async start(controller) {
        let closed = false;
        const emit = (data: object) => { if (!closed) try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`)); } catch { closed = true; } };
        try {
          emit({ type: 'step', step: 0, text: mode === 'ai' ? '产品智能体正在拆解需求' : '正在匹配交互模板' });
          let title: string, summary: string, code: string;
          if (mode === 'template') {
            const app = templateApp(prompt, ['board', 'expense', 'focus'].includes(input.templateId) ? input.templateId : undefined);
            title = app.title; code = app.code;
            summary = `已创建「${title}」模板。可以直接操作预览，数据会自动保存。这是预置模板体验；连接模型后可以自由生成与修改应用。`;
            emit({ type: 'plan', text: `使用 ${title} 预置模板，包含真实交互、响应式布局和数据保存。` });
            emit({ type: 'step', step: 1, text: '正在组装模板代码' });
          } else {
            const plan = await completion(config, 'You are a product planner for a single-file HTML app builder. Output ONLY JSON: {"title":"short Chinese name under 24 chars","summary":"brief Chinese description of the implementation, under 200 chars","plan":"3 concrete implementation steps in Chinese, under 400 chars"}. Respect the existing application if editing. No network, backend, external libraries, authentication or payments inside generated apps. Use window.atmos for persistent JSON state.', `${previous ? '这是对现有应用的修改。项目名：' + project!.title + '\n' : ''}需求：${prompt}`, signal);
            let spec; try { spec = JSON.parse(plan.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { throw new ApiError('需求规划结果格式不正确，请重新生成。', 502); }
            if (typeof spec.title !== 'string' || typeof spec.plan !== 'string' || typeof spec.summary !== 'string') throw new ApiError('模型未返回完整的需求规划，请重试。', 502);
            title = spec.title.trim().slice(0, 60) || '新应用'; summary = spec.summary.slice(0, 1000);
            emit({ type: 'plan', text: spec.plan.slice(0, 1800) });
            emit({ type: 'step', step: 1, text: '工程智能体正在编写应用' });
            let last = 0;
            code = cleanCode(await completion(config, appContract, `需求：${prompt}\n实现计划：${spec.plan.slice(0, 1800)}${previous ? '\n在以下现有应用上修改，保留未要求改变的功能和数据字段：\n' + previous.code : ''}`, signal, size => { if (size - last > 500) { last = size; emit({ type: 'progress', size }); } }));
          }
          emit({ type: 'step', step: 2, text: '正在检查文档结构与资源依赖' });
          let issues = validateCode(code);
          if (issues.length && mode === 'ai') {
            emit({ type: 'plan', text: `检查发现：${issues.join('、')}。正在进行一次自动修复。` });
            code = cleanCode(await completion(config, appContract, `修复以下问题并返回完整文档：${issues.join(';')}\n${code}`, signal, size => emit({ type: 'progress', size }))); 
            issues = validateCode(code);
          }
          if (issues.length) throw new ApiError(`生成代码未通过检查：${issues.join('、')}。请重试。`);
          signal.throwIfAborted();
          emit({ type: 'step', step: 3, text: '正在保存项目与版本' });
          const id = project?.id || crypto.randomUUID(), revision = crypto.randomUUID(), now = Date.now();
          const current = Number(project?.current_version || 0);
          const statements = [];
          if (!project) statements.push(db().prepare('INSERT INTO projects (id, owner, title, current_version, state, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?)').bind(id, user, title, '{}', now, now));
          statements.push(db().prepare('INSERT INTO versions (id, project_id, number, prompt, summary, code, mode, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND current_version = ?)').bind(revision, id, current + 1, prompt, summary, code, mode, now, id, current));
          statements.push(db().prepare('UPDATE projects SET current_version = ?, updated_at = ? WHERE id = ? AND EXISTS (SELECT 1 FROM versions WHERE id = ?)').bind(current + 1, now, id, revision));
          const saved = await db().batch(statements);
          if (!saved[saved.length - 2].meta.changes) throw new ApiError('项目已被其他窗口更新，请刷新后重试。', 409);
          emit({ type: 'done', projectId: id, title, summary });
        } catch (error) {
          emit({ type: 'error', message: signal.aborted ? '生成已停止或超时。你的输入已保留，可以重新尝试。' : error instanceof ApiError ? error.message : '生成暂时失败，已有版本未受影响，请重试。' });
        } finally { if (!closed) { closed = true; controller.close(); } }
      },
    });
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' } });
  } catch (e) { return fail(e); }
}
