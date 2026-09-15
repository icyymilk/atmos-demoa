import { body, checkOrigin, fail, owner } from '@/lib/storage';
import { harnessRequest } from '@/lib/harness-client';
function relay(response: Response) {
  return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
export async function GET(request: Request) {
  try { return relay(await harnessRequest('/connections', { owner: await owner(request), action: 'list' }, request.signal)); }
  catch (error) { return fail(error); }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const session = await owner(request), input = await body(request, 4000);
    return relay(await harnessRequest('/connections', { action: input.action, provider: input.provider, token: input.token, owner: session }, request.signal));
  } catch (error) { return fail(error); }
}
