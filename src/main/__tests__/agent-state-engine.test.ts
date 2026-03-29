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

test('explicit marker output updates runtime state and strips marker line from returned chunk', async () => {
  const engine = new AgentStateEngine();
  const terminalId = 't-marker';
  engine.registerTerminal(terminalId);

  await sleep(350);
  const output = 'before\n__MC_STATE__:waiting\nafter\n';
  const cleaned = engine.onOutput(terminalId, output);
  const snapshot = engine.getSnapshot()[terminalId];

  assert.equal(snapshot?.state, 'waiting');
  assert.equal(snapshot?.source, 'explicit');
  assert.equal(snapshot?.reason, 'explicit marker: waiting');
  assert.equal(cleaned.includes('__MC_STATE__'), false);
  assert.equal(cleaned, 'before\nafter\n');
});

test('waiting state ignores non-marker output but cancel input returns to running', async () => {
  const engine = new AgentStateEngine();
  const terminalId = 't-wait-cancel';

  engine.registerTerminal(terminalId);
  engine.applyExplicitState(terminalId, 'waiting', 'question', 'high');

  const passthrough = engine.onOutput(terminalId, 'progress text\n');
  assert.equal(passthrough, 'progress text\n');
  assert.equal(engine.getSnapshot()[terminalId]?.state, 'waiting');

  await sleep(350);
  engine.onInput(terminalId, '\x1b');
  assert.equal(engine.getSnapshot()[terminalId]?.state, 'running');
  assert.equal(engine.getSnapshot()[terminalId]?.reason, 'waiting cancelled by user');
});

test('non-meaningful control input does not leave idle but meaningful input does', async () => {
  const engine = new AgentStateEngine();
  const terminalId = 't-input';

  engine.registerTerminal(terminalId);
  engine.applyExplicitState(terminalId, 'idle', 'forced idle', 'high');

  engine.onInput(terminalId, '\x1b[A');
  assert.equal(engine.getSnapshot()[terminalId]?.state, 'idle');

  await sleep(350);
  engine.onInput(terminalId, 'x');
  assert.equal(engine.getSnapshot()[terminalId]?.state, 'running');
  assert.equal(engine.getSnapshot()[terminalId]?.reason, 'user input received');
});

test('onExit emits exited state, unregister removes session, and unknown terminal output is passthrough', () => {
  const engine = new AgentStateEngine();
  const terminalId = 't-exit';
  const events: Array<{ terminalId: string; state: string }> = [];
  engine.setStateListener((payload) => {
    events.push({ terminalId: payload.terminalId, state: payload.state });
  });

  engine.registerTerminal(terminalId);
  engine.onExit(terminalId);
  assert.equal(engine.getSnapshot()[terminalId]?.state, 'exited');
  assert.equal(events.some((event) => event.terminalId === terminalId && event.state === 'exited'), true);

  engine.unregisterTerminal(terminalId);
  assert.equal(engine.getSnapshot()[terminalId], undefined);
  assert.equal(engine.onOutput('missing-terminal', '__MC_STATE__:idle'), '__MC_STATE__:idle');
});
