import { ApiError, body, checkOrigin, fail, owner } from '@/lib/storage';
import { completion } from '@/lib/generator';
import { providers, type ModelConfig } from '@/lib/types';

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    await owner(request);
    const config = await body(request, 2500) as ModelConfig;
    if (!providers[config.provider as keyof typeof providers] || typeof config.model !== 'string' || !config.model.trim() || config.model.length > 150 || typeof config.apiKey !== 'string' || !config.apiKey.trim() || config.apiKey.length > 1000) throw new ApiError('请填写有效的模型服务、模型名称和 API Key。');
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(20000)]);
    try {
      await completion(config, 'Reply with only OK.', 'Test connection.', signal, undefined, 16);
    } catch (error) {
      if (signal.aborted) throw new ApiError('连接测试超时或已取消，请检查网络或稍后重试。', 504);
      if (error instanceof ApiError) throw error;
      throw new ApiError('无法连接模型服务，请检查本机网络后重试。', 502);
    }
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return fail(error); }
}
