import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type OpenAI from 'openai';
import type { Source } from './mcp';

const mocks = vi.hoisted(() => ({ search: vi.fn(), close: vi.fn(), sideband: null as unknown }));
vi.mock('./mcp', async (original) => ({
  ...await original<typeof import('./mcp')>(),
  connectResearch: vi.fn(async () => ({ search: mocks.search, close: mocks.close })),
}));
vi.mock('openai/realtime/ws', () => ({
  OpenAIRealtimeWS: class extends EventEmitter {
    socket = new EventTarget();
    send = vi.fn();
    close = vi.fn();
    constructor() {
      super(); mocks.sideband = this;
      queueMicrotask(() => this.socket.dispatchEvent(new Event('open')));
    }
  },
}));
import { createCall } from './call';

const source: Source = { title: 'Ley de prueba', citation: 'Artículo 1', excerpt: 'Evidencia de prueba' };
let call: Awaited<ReturnType<typeof createCall>> | undefined;
afterEach(async () => { await call?.close(); call = undefined; vi.clearAllMocks(); });

async function setup() {
  const openai = { realtime: { calls: {
    create: vi.fn(async () => new Response('v=0\r\n', { headers: { location: '/v1/realtime/calls/rtc_test' } })),
    hangup: vi.fn(async () => {}),
  } } } as unknown as OpenAI;
  call = await createCall(openai, 'test-token', 'v=0', new AbortController().signal);
  return mocks.sideband as EventEmitter & { send: ReturnType<typeof vi.fn> };
}
function done(status = 'completed', name = 'search_panama_law') {
  return { response: { status, output: [{ type: 'function_call', call_id: 'call_test', name, arguments: '{"query":"Ley de prueba"}' }] } };
}

describe('server tool execution', () => {
  it('returns validated evidence and continues once for a completed call', async () => {
    mocks.search.mockResolvedValue([source]);
    const sideband = await setup();
    sideband.emit('response.done', done());
    await vi.waitFor(() => expect(sideband.send).toHaveBeenCalledTimes(2));
    expect(sideband.send.mock.calls[0][0].item).toMatchObject({ call_id: 'call_test', type: 'function_call_output', output: JSON.stringify({ results: [source] }) });
    expect(sideband.send.mock.calls[1][0]).toEqual({ type: 'response.create' });
    sideband.emit('response.done', done());
    expect(mocks.search).toHaveBeenCalledTimes(1);
  });
  it('never executes cancelled responses or unlisted tools', async () => {
    const sideband = await setup();
    sideband.emit('response.done', done('cancelled'));
    sideband.emit('response.done', done('completed', 'other_tool'));
    expect(mocks.search).not.toHaveBeenCalled();
  });
  it('discards delayed evidence after a newer user turn', async () => {
    let finish!: (value: Source[]) => void;
    mocks.search.mockImplementation(() => new Promise<Source[]>((resolve) => { finish = resolve; }));
    const sideband = await setup();
    sideband.emit('response.done', done());
    sideband.emit('input_audio_buffer.speech_started');
    expect(call?.status().tool?.state).not.toBe('running');
    finish([source]);
    await vi.waitFor(() => expect(sideband.send).toHaveBeenCalledTimes(1));
    const output = JSON.parse(sideband.send.mock.calls[0][0].item.output);
    expect(output.results).toBeUndefined();
    expect(output.error).toContain('descartada');
    expect(sideband.send.mock.calls.some(([event]) => event.type === 'response.create')).toBe(false);
    expect(call?.status().tool?.state).not.toBe('running');
  });
});
