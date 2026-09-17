import OpenAI from 'openai';
import { OpenAIRealtimeWS } from 'openai/realtime/ws';
import { connectResearch, parseQuery } from './mcp';
import type { ToolStatus } from './mcp';
import { sessionConfig } from './session';

export async function createCall(openai: OpenAI, token: string, sdp: string, signal: AbortSignal) {
  const research = await connectResearch(token);
  let socket: OpenAIRealtimeWS | undefined;
  let callId: string | undefined;
  let closed = false;
  let turn = 0;
  let responseActive = false;
  let tool: ToolStatus | null = null;
  let failure = false;
  const pending = new AbortController();
  const handled = new Set<string>();
  let lifetime: ReturnType<typeof setTimeout> | undefined;
  const close = async () => {
    if (closed) return;
    closed = true;
    pending.abort();
    clearTimeout(lifetime);
    socket?.close();
    await Promise.allSettled([
      research.close(),
      ...(callId ? [openai.realtime.calls.hangup(callId)] : []),
    ]);
  };
  const abort = () => { void close(); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    if (signal.aborted) throw new Error('Cancelled');
    const response = await openai.realtime.calls.create({ sdp, session: sessionConfig }, { signal });
    callId = response.headers.get('location')?.split('/').pop();
    const answer = await response.text();
    if (!callId || !answer.startsWith('v=0')) throw new Error('Invalid call response');
    socket = new OpenAIRealtimeWS({ callID: callId }, openai);
    const sideband = socket;
    sideband.on('error', () => { failure = true; void close(); });
    sideband.socket.addEventListener('close', () => { if (!closed) { failure = true; void close(); } });
    sideband.on('input_audio_buffer.speech_started', () => {
      turn += 1;
      if (tool?.state === 'running') tool = null;
    });
    sideband.on('response.created', () => { responseActive = true; });
    sideband.on('response.done', async (event) => {
      responseActive = false;
      if (closed || event.response.status !== 'completed') return;
      const calls = event.response.output?.filter((item) => item.type === 'function_call') ?? [];
      const startedTurn = turn;
      let returned = false;
      for (const item of calls) {
        if (closed || !item.call_id || handled.has(item.call_id)) continue;
        handled.add(item.call_id);
        const started = performance.now();
        let output: object;
        let runningTool: ToolStatus | undefined;
        try {
          if (startedTurn !== turn) throw new Error('Superseded');
          if (item.name !== 'search_panama_law') throw new Error('Tool not allowed');
          const args = parseQuery(item.arguments ?? '');
          runningTool = tool = { name: 'search_panama_law', state: 'running', sources: [] };
          const sources = await research.search(args, pending.signal);
          if (closed) return;
          output = { results: sources };
          if (startedTurn === turn) tool = { name: 'search_panama_law', state: 'success', sources, latencyMs: Math.round(performance.now() - started) };
        } catch {
          if (closed) return;
          output = { error: 'No se pudo verificar la consulta. No hay evidencia para responder.' };
          if (startedTurn === turn) tool = { name: 'search_panama_law', state: 'failure', sources: [], latencyMs: Math.round(performance.now() - started) };
        }
        if (startedTurn !== turn) {
          output = { error: 'Consulta anterior descartada. No aporta evidencia a esta respuesta.' };
          if (runningTool && tool === runningTool) tool = { name: 'search_panama_law', state: 'failure', sources: [], latencyMs: Math.round(performance.now() - started) };
        }
        sideband.send({ type: 'conversation.item.create', item: {
          type: 'function_call_output', call_id: item.call_id, output: JSON.stringify(output),
        } });
        returned = true;
      }
      if (returned && !closed && startedTurn === turn && !responseActive) sideband.send({ type: 'response.create' });
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Sideband timeout')), 10_000);
      sideband.socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      sideband.socket.addEventListener('close', () => { clearTimeout(timer); reject(new Error('Sideband closed')); }, { once: true });
      sideband.on('error', () => { clearTimeout(timer); reject(new Error('Sideband failed')); });
    });
    if (closed || signal.aborted) throw new Error('Cancelled');
    lifetime = setTimeout(() => { failure = true; void close(); }, 10 * 60_000);
    return { sdp: answer, status: () => ({ closed, failure, tool }), close };
  } catch (error) {
    await close();
    throw error;
  } finally {
    signal.removeEventListener('abort', abort);
  }
}
