import { EventEmitter } from 'node:events';
import OpenAI from 'openai';
import { afterEach, expect, it, vi } from 'vitest';

const connection = vi.hoisted(() => ({ url: '', headers: {} as Record<string, string>, restore: () => {} }));
vi.mock('openai/realtime/ws', async () => {
  // Load the real SDK through CommonJS so its external ws dependency can be replaced.
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const ws = require('ws');
  const original = ws.WebSocket;
  connection.restore = () => { ws.WebSocket = original; };
  ws.WebSocket = class extends EventEmitter {
    constructor(url: URL, options: { headers: Record<string, string> }) {
      super();
      connection.url = String(url);
      connection.headers = options.headers;
      queueMicrotask(() => this.emit('open'));
    }
    addEventListener(name: string, listener: (...args: unknown[]) => void) { this.on(name, listener); }
    close() { this.emit('close'); }
    send() {}
  };
  return require('openai/realtime/ws');
});
vi.mock('./mcp', () => ({
  connectResearch: vi.fn(async () => ({ search: vi.fn(), close: vi.fn(async () => {}) })),
  parseQuery: vi.fn(),
}));
import { createCall } from './call';

afterEach(() => { connection.restore(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('attaches the real SDK sideband using the bearer header and existing call ID', async () => {
  vi.stubGlobal('WebSocket', class {
    constructor() { throw new Error('Native subprotocol authentication must not be used'); }
  });
  const client = new OpenAI({ apiKey: 'fixture-openai-key' });
  vi.spyOn(client.realtime.calls, 'create').mockResolvedValue(new Response('v=0\r\n', {
    headers: { location: '/v1/realtime/calls/rtc_fixture' },
  }));
  const hangup = vi.spyOn(client.realtime.calls, 'hangup').mockResolvedValue(undefined);
  const call = await createCall(client, 'fixture-research-token', 'v=0', new AbortController().signal);
  try {
    expect(connection.url).toBe('wss://api.openai.com/v1/realtime?call_id=rtc_fixture');
    expect(connection.headers.Authorization).toBe('Bearer fixture-openai-key');
    expect(call.status()).toMatchObject({ closed: false, failure: false });
  } finally {
    await call.close();
  }
  expect(hangup).toHaveBeenCalledWith('rtc_fixture');
});
