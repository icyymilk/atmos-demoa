import { ApiError, body, checkOrigin, fail, owner } from '@/lib/storage';
import { completion } from '@/lib/generator';
import { modelConfigSchema } from '@/lib/model-config';

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    await owner(request);
    const parsed=modelConfigSchema.safeParse(await body(request,2500));if(!parsed.success)throw new ApiError(parsed.error.issues[0].message);
    const config=parsed.data;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(60000)]);
    try {
      await completion(config, 'Reply with only OK.', 'Test connection.', signal, undefined, Math.min(config.maxOutputTokens,4096));
    } catch (error) {
      if (signal.aborted) throw new ApiError('连接测试超时或已取消，请检查网络或稍后重试。', 504);
      if (error instanceof ApiError) throw error;
      throw new ApiError('无法连接模型服务，请检查本机网络后重试。', 502);
    }
    return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return fail(error); }
}
