import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { command, startRuntime, state, stopRuntime } from '../scripts/runtime.mjs';

const source = { title: 'Simulated legal source', citation: 'SIM-1', excerpt: 'Deterministic result.' };

test('concurrent requests to one actor preserve both turns and one search per call ID', async () => {
  const conversation = `concurrent_${randomUUID().replaceAll('-', '')}`;
  const runtime = await startRuntime('.scratch/test-state');
  try {
    const turns = await Promise.all([
      command(runtime.base, conversation, { type: 'start_turn', commandId: 'concurrent_turn_1' }),
      command(runtime.base, conversation, { type: 'start_turn', commandId: 'concurrent_turn_2' }),
    ]);
    assert.deepEqual(turns.map((turn) => turn.generation).sort(), [1, 2]);
    assert.equal((await state(runtime.base, conversation)).generation, 2);

    const searches = await Promise.all([
      command(runtime.base, conversation, {
        type: 'start_search', commandId: 'concurrent_search_1', callId: 'shared_call',
        generation: 2, query: 'Panama law',
      }),
      command(runtime.base, conversation, {
        type: 'start_search', commandId: 'concurrent_search_2', callId: 'shared_call',
        generation: 2, query: 'Panama law',
      }),
    ]);
    assert.deepEqual(searches.map((search) => search.outcome).sort(), ['duplicate_call', 'search_pending']);
    assert.deepEqual((await state(runtime.base, conversation)).searches.map((search) => search.callId), ['shared_call']);
  } finally {
    await stopRuntime(runtime);
  }
});

test('SQLite backed actors coordinate overlapping turns, duplicates, late results, isolation, and restart', async () => {
  const persistTo = '.scratch/test-state';
  const first = `first_${randomUUID().replaceAll('-', '')}`;
  const second = `second_${randomUUID().replaceAll('-', '')}`;
  let runtime = await startRuntime(persistTo);
  try {
    const turn1 = await command(runtime.base, first, { type: 'start_turn', commandId: 'turn_1' });
    assert.equal(turn1.generation, 1);
    const pending = await command(runtime.base, first, {
      type: 'start_search', commandId: 'search_1', callId: 'call_1', generation: 1, query: 'Panama law',
    });
    assert.equal(pending.outcome, 'search_pending');
    assert.equal((await state(runtime.base, first)).searches[0].status, 'pending');

    const otherTurn = await command(runtime.base, second, { type: 'start_turn', commandId: 'turn_1' });
    assert.equal(otherTurn.generation, 1);
    assert.deepEqual((await state(runtime.base, second)).searches, []);

    const turn2 = await command(runtime.base, first, { type: 'start_turn', commandId: 'turn_2' });
    assert.equal(turn2.generation, 2);
    assert.equal((await state(runtime.base, first)).searches[0].status, 'pending');
    const interrupted = await command(runtime.base, first, { type: 'interrupt', commandId: 'interrupt_2' });
    assert.equal(interrupted.generation, 3);

    const late = await command(runtime.base, first, {
      type: 'complete_search', commandId: 'result_1', callId: 'call_1', results: [source],
    });
    assert.equal(late.outcome, 'stale_result');
    assert.equal((await state(runtime.base, first)).searches[0].results, null);
    assert.deepEqual(await command(runtime.base, first, {
      type: 'complete_search', commandId: 'result_1', callId: 'call_1', results: [source],
    }), { ...late, duplicateCommand: true });

    const turn3 = await command(runtime.base, first, { type: 'start_turn', commandId: 'turn_3' });
    assert.equal(turn3.generation, 4);
    const active = await command(runtime.base, first, {
      type: 'start_search', commandId: 'search_2', callId: 'call_2', generation: 4, query: 'Current law',
    });
    assert.equal(active.outcome, 'search_pending');
    assert.equal((await command(runtime.base, first, {
      type: 'start_search', commandId: 'search_2', callId: 'call_2', generation: 4, query: 'Current law',
    })).duplicateCommand, true);
    assert.equal((await command(runtime.base, first, {
      type: 'start_search', commandId: 'search_2b', callId: 'call_2', generation: 4, query: 'Current law',
    })).outcome, 'duplicate_call');
    assert.equal((await command(runtime.base, first, {
      type: 'complete_search', commandId: 'result_2', callId: 'call_2', results: [source],
    })).outcome, 'result_accepted');

    await command(runtime.base, first, {
      type: 'start_search', commandId: 'search_3', callId: 'call_3', generation: 4, query: 'Pending at restart',
    });

    const beforeRestart = await state(runtime.base, first);
    await stopRuntime(runtime);
    runtime = await startRuntime(persistTo);
    assert.deepEqual(await state(runtime.base, first), beforeRestart);
    assert.equal(beforeRestart.searches[2].status, 'pending');
    assert.equal((await command(runtime.base, first, {
      type: 'complete_search', commandId: 'result_3', callId: 'call_3', results: [source],
    })).outcome, 'result_accepted');
    assert.equal((await state(runtime.base, second)).generation, 1);
    assert.equal((await command(runtime.base, first, { type: 'start_turn', commandId: 'turn_3' })).duplicateCommand, true);
  } finally {
    await stopRuntime(runtime);
  }
});
