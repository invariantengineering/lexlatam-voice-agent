import { afterEach, expect, it, vi } from 'vitest';
import { connectResearch } from './mcp';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

it('lists tools without a blocking standalone stream and preserves authenticated POST SSE', async () => {
  vi.useFakeTimers();
  vi.stubEnv('LEXLATAM_MCP_URL', 'https://research.example/mcp/');
  let standaloneOpen = false;
  const requests: RequestInit[] = [];
  const sources = [{ title: 'Norma de prueba', citation: 'Artículo 1', excerpt: 'Texto de prueba' }];
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init: RequestInit) => {
    requests.push(init);
    if (init.method === 'GET') {
      standaloneOpen = true;
      return new Promise<Response>(() => {});
    }
    const message = JSON.parse(init.body as string);
    if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (message.method === 'initialize') return Response.json({
      jsonrpc: '2.0', id: message.id,
      result: { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'research-fixture', version: '1' } },
    });
    if (standaloneOpen) return new Promise<Response>(() => {});
    const result = message.method === 'tools/list' ? {
      tools: [{
        name: 'search_panama_law',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
        outputSchema: { type: 'object', properties: { results: { type: 'array' } }, required: ['results'] },
      }],
    } : { content: [], structuredContent: { results: sources } };
    return new Response(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result })}\n\n`, {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }));

  const connected = connectResearch('fixture-token').then(
    (client) => ({ client, error: undefined }),
    (error: unknown) => ({ client: undefined, error }),
  );
  await vi.advanceTimersByTimeAsync(15_001);
  const outcome = await connected;
  expect(outcome.error).toBeUndefined();
  expect(outcome.client).toBeDefined();
  try {
    const result = await outcome.client!.search({ query: 'Norma de prueba' }, new AbortController().signal);
    expect(result).toEqual(sources);
    expect(requests.map((request) => request.method)).toEqual(['POST', 'POST', 'POST', 'POST']);
    for (const request of requests) {
      expect(new Headers(request.headers).get('Authorization')).toBe('Bearer fixture-token');
      expect(request.signal).toBeInstanceOf(AbortSignal);
    }
  } finally {
    await outcome.client?.close();
  }
});
