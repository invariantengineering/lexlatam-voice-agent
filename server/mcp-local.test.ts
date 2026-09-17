import { afterEach, expect, it, vi } from 'vitest';
import { connectResearch } from './mcp';

afterEach(() => {
  vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.useRealTimers();
});

function fixture(search: (id: number, init: RequestInit) => Response) {
  const requests: { url: string; init: RequestInit; method: string }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: URL, init: RequestInit) => {
    const message = JSON.parse(init.body as string);
    requests.push({ url: String(url), init, method: message.method });
    if (!('id' in message)) return new Response(null, { status: 202 });
    if (message.method === 'tools/call') return search(message.id, init);
    return Response.json({ jsonrpc: '2.0', id: message.id, result: message.method === 'initialize'
      ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'local-fixture', version: '1' } }
      : { tools: [{ name: 'search_panama_law', inputSchema: {
        type: 'object', properties: { query: { type: 'string' } }, required: ['query'],
      }, outputSchema: { type: 'object', properties: { results: { type: 'array' } }, required: ['results'] } }] },
    });
  }));
  return requests;
}

it.each(['', 'http://127.0.0.1:8000/mcp/', 'http://[::1]/mcp/', 'http://host.docker.internal/mcp/'])('accepts local HTTP %s and preserves bearer authentication', async (url) => {
  vi.stubEnv('LEXLATAM_MCP_URL', url);
  const requests = fixture(() => { throw new Error('Search not expected'); });
  const client = await connectResearch('fixture-token');
  await client.close();
  expect(requests[0].url).toBe(url || 'http://localhost/mcp/');
  for (const { init } of requests) {
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer fixture-token');
    expect(init.signal?.aborted).toBe(true);
  }
});

it.each(['http://research.example/mcp/', 'http://localhost.evil.example/mcp/', 'https://user:secret@example.com/mcp/'])('rejects unsafe endpoint %s before any request', async (url) => {
  vi.stubEnv('LEXLATAM_MCP_URL', url);
  const requests = fixture(() => { throw new Error('Search not expected'); });
  await expect(connectResearch('fixture-token')).rejects.toThrow('Invalid MCP URL');
  expect(requests).toHaveLength(0);
});

it.each([200, 401])('rejects HTTP %s research failures without anonymous retry', async (status) => {
  vi.stubEnv('LEXLATAM_MCP_URL', 'http://localhost/mcp/');
  const requests = fixture((id) => status === 401 ? new Response('Unauthorized', { status }) : Response.json({
    jsonrpc: '2.0', id, result: { isError: true, content: [{ type: 'text', text: 'Research unavailable' }] },
  }));
  const client = await connectResearch('fixture-token');
  try {
    await expect(client.search({ query: 'Norma de prueba' }, new AbortController().signal)).rejects.toThrow();
    expect(requests.filter(({ method }) => method === 'tools/call')).toHaveLength(1);
    for (const { init } of requests) expect(new Headers(init.headers).get('Authorization')).toBe('Bearer fixture-token');
  } finally { await client.close(); }
});

it('bounds tool execution and a stalled HTTP 200 body at 120 seconds', async () => {
  vi.useFakeTimers();
  vi.stubEnv('LEXLATAM_MCP_URL', 'http://localhost/mcp/');
  vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), milliseconds);
    return controller.signal;
  });
  let bodySignal: AbortSignal | undefined;
  fixture((_id, init) => {
    bodySignal = init.signal!;
    return new Response(new ReadableStream({ start(controller) {
      bodySignal!.addEventListener('abort', () => controller.error(bodySignal!.reason), { once: true });
    } }), { headers: { 'Content-Type': 'application/json' } });
  });
  const client = await connectResearch('fixture-token');
  let settled = false;
  const result = client.search({ query: 'Norma de prueba' }, new AbortController().signal)
    .then(() => ({ failed: false }), () => ({ failed: true })).finally(() => { settled = true; });
  try {
    await vi.advanceTimersByTimeAsync(119_999);
    expect(settled).toBe(false);
    expect(bodySignal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ failed: true });
    expect(bodySignal?.aborted).toBe(true);
    expect(AbortSignal.timeout).toHaveBeenCalledWith(120_000);
  } finally { await client.close(); }
});
