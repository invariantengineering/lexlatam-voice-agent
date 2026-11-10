import { command, startRuntime, state, stopRuntime } from './runtime.mjs';

const source = { title: 'Simulated legal source', citation: 'SIM-1', excerpt: 'Deterministic result.' };
const conversation = `demo_${Date.now()}`;
const other = `${conversation}_other`;
let runtime = await startRuntime('.scratch/demo-state');
try {
  for (const [label, actor, body] of [
    ['turn 1', conversation, { type: 'start_turn', commandId: 'turn_1' }],
    ['search pending', conversation, { type: 'start_search', commandId: 'search_1', callId: 'call_1', generation: 1, query: 'Panama law' }],
    ['independent actor', other, { type: 'start_turn', commandId: 'turn_1' }],
    ['overlapping turn 2', conversation, { type: 'start_turn', commandId: 'turn_2' }],
    ['interrupt', conversation, { type: 'interrupt', commandId: 'interrupt_2' }],
    ['late result', conversation, { type: 'complete_search', commandId: 'result_1', callId: 'call_1', results: [source] }],
    ['duplicate command', conversation, { type: 'complete_search', commandId: 'result_1', callId: 'call_1', results: [source] }],
  ]) console.log(label, await command(runtime.base, actor, body));
  const before = await state(runtime.base, conversation);
  console.log('state before restart', before);
  await stopRuntime(runtime);
  runtime = await startRuntime('.scratch/demo-state');
  console.log('state after restart', await state(runtime.base, conversation));
} finally {
  await stopRuntime(runtime);
}
