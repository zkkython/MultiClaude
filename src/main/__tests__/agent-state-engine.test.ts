import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentStateEngine } from '../agent-state-engine.js';

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

test('single waiting prompt resolves to running after submit settle window', async () => {
  const engine = new AgentStateEngine();
  const terminalId = 't-single';

  engine.registerTerminal(terminalId);
  engine.applyExplicitState(terminalId, 'waiting', 'question-1', 'high');
  engine.onInput(terminalId, '\r');

  // Enter should not immediately clear waiting.
  assert.equal(engine.getSnapshot()[terminalId]?.state, 'waiting');

  await sleep(900);
  assert.equal(engine.getSnapshot()[terminalId]?.state, 'running');
});

test('multi-question flow stays waiting when next prompt arrives quickly after submit', async () => {
  const engine = new AgentStateEngine();
  const terminalId = 't-multi';

  engine.registerTerminal(terminalId);
  engine.applyExplicitState(terminalId, 'waiting', 'question-1', 'high');
  engine.onInput(terminalId, '\r');

  // Simulate second question arriving before submit settle timer fires.
  await sleep(200);
  engine.applyExplicitState(terminalId, 'waiting', 'question-2', 'high');

  await sleep(900);
  assert.equal(engine.getSnapshot()[terminalId]?.state, 'waiting');
});
