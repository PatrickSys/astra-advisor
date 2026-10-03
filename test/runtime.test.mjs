import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { doctor, review } from '../skills/astra-advisor/scripts/runtime.mjs';

const MODEL = {
  id: 'gpt-6-astra', model: 'gpt-6-astra', defaultReasoningEffort: 'low',
  supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'xhigh' }],
};

function fakeSpawn(handler) {
  const calls = [];
  const spawnImpl = (binary, args, options) => {
    const proc = new EventEmitter();
    proc.stdout = new PassThrough();
    proc.stderr = new PassThrough();
    proc.stdin = new PassThrough();
    proc.kill = () => { proc.killed = true; };
    calls.push({ binary, args, options, proc });
    let buffered = '';
    const emit = message => proc.stdout.write(`${JSON.stringify(message)}\n`);
    proc.stdin.on('data', chunk => {
      buffered += chunk.toString();
      for (;;) {
        const split = buffered.indexOf('\n');
        if (split < 0) break;
        const line = buffered.slice(0, split); buffered = buffered.slice(split + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.id === undefined) continue;
        Promise.resolve(handler(message, { emit, calls })).then(result => {
          if (result !== undefined) emit({ id: message.id, result });
        }, error => emit({ id: message.id, error: { code: -32000, message: error.message } }));
      }
    });
    return proc;
  };
  return { spawnImpl, calls };
}

function initialize() {
  return { userAgent: 'codex-test/0.160.0', codexHome: 'C:/fake/.codex', platformFamily: 'windows' };
}

test('doctor checks the model catalog without starting inference', async () => {
  const methods = [];
  const fake = fakeSpawn(message => {
    methods.push(message.method);
    if (message.method === 'initialize') return initialize();
    if (message.method === 'model/list') return { data: [MODEL], nextCursor: null };
    throw new Error(`unexpected ${message.method}`);
  });
  const result = await doctor({ binary: 'codex-test', spawnImpl: fake.spawnImpl });
  assert.equal(result.ok, true);
  assert.equal(result.inferenceCalls, 0);
  assert.deepEqual(methods, ['initialize', 'model/list']);
  assert.equal(fake.calls[0].args.includes('multi_agent_v2'), true);
  assert.equal(fake.calls[0].args.includes('apps._default.enabled=false'), true);
});

test('review pins Astra, low effort and disabled environment access, then validates the completed turn and usage', async () => {
  let recordedTurn;
  const seen = [];
  const fake = fakeSpawn((message, { emit }) => {
    seen.push(message);
    if (message.method === 'initialize') return initialize();
    if (message.method === 'model/list') return { data: [MODEL], nextCursor: null };
    if (message.method === 'thread/start') {
      assert.equal(message.params.model, 'gpt-6-astra');
      assert.equal(message.params.modelProvider, 'openai');
      assert.equal(message.params.config.model_reasoning_effort, 'low');
      assert.equal(message.params.allowProviderModelFallback, false);
      assert.equal(message.params.ephemeral, true);
      assert.deepEqual(message.params.environments, []);
      assert.deepEqual(message.params.dynamicTools, []);
      assert.deepEqual(message.params.config, { model_reasoning_effort: 'low' });
      return {
        thread: { id: 'thread-1', model: 'gpt-6-astra', reasoningEffort: 'low', ephemeral: true, environments: [] },
        model: 'gpt-6-astra', modelProvider: 'openai', reasoningEffort: 'low',
        sandbox: { type: 'readOnly', networkAccess: false }, approvalPolicy: 'never',
      };
    }
    if (message.method === 'turn/start') {
      assert.equal(message.params.effort, 'low');
      assert.deepEqual(message.params.environments, []);
      assert.deepEqual(message.params.sandboxPolicy, { type: 'readOnly', networkAccess: false });
      recordedTurn = { id: 'turn-1', status: 'completed', error: null, itemsView: 'full', items: [
        { type: 'userMessage', id: 'u1', content: message.params.input },
        { type: 'reasoning', id: 'r1', summary: [], content: [] },
        { type: 'agentMessage', id: 'a1', text: 'VERDICT: revise', phase: null },
      ] };
      queueMicrotask(() => {
        emit({ method: 'thread/tokenUsage/updated', params: { threadId: 'thread-1', turnId: 'turn-1', tokenUsage: { last: { inputTokens: 12, cachedInputTokens: 3, cacheWriteInputTokens: 0, outputTokens: 4, reasoningOutputTokens: 2, totalTokens: 16 }, total: {} } } });
        emit({ method: 'turn/completed', params: { threadId: 'thread-1', turn: recordedTurn } });
      });
      return { turn: { id: 'turn-1', status: 'inProgress', items: [], itemsView: 'summary', error: null } };
    }
    throw new Error(`unexpected ${message.method}`);
  });
  const result = await review({ question: 'ship?' }, { binary: 'codex-test', spawnImpl: fake.spawnImpl, timeoutMs: 5_000 });
  assert.equal(result.report, 'VERDICT: revise');
  assert.equal(result.runtime.configuredModel, 'gpt-6-astra');
  assert.equal(result.runtime.configuredEffort, 'low');
  assert.equal(result.runtime.toolBoundary.observedToolItems, 0);
  assert.equal(result.runtime.toolBoundary.effectiveReadOnlyNoNetwork, true);
  assert.equal(result.runtime.toolBoundary.webSearchDisableRequested, true);
  assert.equal(result.runtime.turnEvidence, 'turn/completed-notification');
  assert.equal(result.usage.inputTokens, 12);
  assert.equal(seen.filter(message => message.method === 'turn/start').length, 1);
  assert.equal(seen.some(message => message.method === 'thread/read'), false);
});

test('review rejects provider model fallback before starting a turn', async () => {
  const methods = [];
  const fake = fakeSpawn(message => {
    methods.push(message.method);
    if (message.method === 'initialize') return initialize();
    if (message.method === 'model/list') return { data: [MODEL], nextCursor: null };
    if (message.method === 'thread/start') return {
      thread: { id: 'thread-2', model: 'gpt-6-luna', reasoningEffort: 'low', ephemeral: true, environments: [] },
      model: 'gpt-6-luna', modelProvider: 'openai', reasoningEffort: 'low', sandbox: { type: 'readOnly', networkAccess: false }, approvalPolicy: 'never',
    };
    throw new Error(`unexpected ${message.method}`);
  });
  await assert.rejects(() => review({ question: 'ship?' }, { binary: 'codex-test', spawnImpl: fake.spawnImpl, timeoutMs: 5_000 }), /substituted model/);
  assert.equal(methods.includes('turn/start'), false);
});

test('review fails before thread creation when Astra is missing', async () => {
  const methods = [];
  const fake = fakeSpawn(message => {
    methods.push(message.method);
    if (message.method === 'initialize') return initialize();
    if (message.method === 'model/list') return { data: [], nextCursor: null };
    throw new Error(`unexpected ${message.method}`);
  });
  await assert.rejects(() => review({ question: 'ship?' }, { binary: 'codex-test', spawnImpl: fake.spawnImpl, timeoutMs: 5_000 }), /gpt-6-astra is not available/);
  assert.equal(methods.includes('thread/start'), false);
});

test('review fails before thread creation when the requested effort is unsupported', async () => {
  const methods = [];
  const fake = fakeSpawn(message => {
    methods.push(message.method);
    if (message.method === 'initialize') return initialize();
    if (message.method === 'model/list') return { data: [MODEL], nextCursor: null };
    throw new Error(`unexpected ${message.method}`);
  });
  await assert.rejects(() => review({ question: 'ship?' }, { effort: 'medium', binary: 'codex-test', spawnImpl: fake.spawnImpl, timeoutMs: 5_000 }), /does not advertise reasoning effort medium/);
  assert.equal(methods.includes('thread/start'), false);
});

test('review refuses an effective sandbox escalation before starting a turn', async () => {
  const methods = [];
  const fake = fakeSpawn(message => {
    methods.push(message.method);
    if (message.method === 'initialize') return initialize();
    if (message.method === 'model/list') return { data: [MODEL], nextCursor: null };
    if (message.method === 'thread/start') return {
      thread: { id: 'thread-escalated', model: 'gpt-6-astra', reasoningEffort: 'low', ephemeral: true, environments: [] },
      model: 'gpt-6-astra', modelProvider: 'openai', reasoningEffort: 'low', sandbox: { type: 'dangerFullAccess' }, approvalPolicy: 'never',
    };
    throw new Error(`unexpected ${message.method}`);
  });
  await assert.rejects(() => review({ question: 'ship?' }, { binary: 'codex-test', spawnImpl: fake.spawnImpl, timeoutMs: 5_000 }), /effective sandbox dangerFullAccess/);
  assert.equal(methods.includes('turn/start'), false);
});

test('review refuses effective network access before starting a turn', async () => {
  const methods = [];
  const fake = fakeSpawn(message => {
    methods.push(message.method);
    if (message.method === 'initialize') return initialize();
    if (message.method === 'model/list') return { data: [MODEL], nextCursor: null };
    if (message.method === 'thread/start') return {
      thread: { id: 'thread-network', model: 'gpt-6-astra', reasoningEffort: 'low', ephemeral: true, environments: [] },
      model: 'gpt-6-astra', modelProvider: 'openai', reasoningEffort: 'low', sandbox: { type: 'readOnly', networkAccess: true }, approvalPolicy: 'never',
    };
    throw new Error(`unexpected ${message.method}`);
  });
  await assert.rejects(() => review({ question: 'ship?' }, { binary: 'codex-test', spawnImpl: fake.spawnImpl, timeoutMs: 5_000 }), /sandbox networking disabled/);
  assert.equal(methods.includes('turn/start'), false);
});

test('review refuses a non-ephemeral thread before starting a turn', async () => {
  const methods = [];
  const fake = fakeSpawn(message => {
    methods.push(message.method);
    if (message.method === 'initialize') return initialize();
    if (message.method === 'model/list') return { data: [MODEL], nextCursor: null };
    if (message.method === 'thread/start') return {
      thread: { id: 'thread-persistent', model: 'gpt-6-astra', reasoningEffort: 'low', ephemeral: false, environments: [] },
      model: 'gpt-6-astra', modelProvider: 'openai', reasoningEffort: 'low', sandbox: { type: 'readOnly', networkAccess: false }, approvalPolicy: 'never',
    };
    throw new Error(`unexpected ${message.method}`);
  });
  await assert.rejects(() => review({ question: 'ship?' }, { binary: 'codex-test', spawnImpl: fake.spawnImpl, timeoutMs: 5_000 }), /ephemeral review boundary/);
  assert.equal(methods.includes('turn/start'), false);
});

test('review aborts and discards a turn that starts any recorded tool/action', async () => {
  const methods = [];
  const fake = fakeSpawn((message, { emit }) => {
    methods.push(message.method);
    if (message.method === 'initialize') return initialize();
    if (message.method === 'model/list') return { data: [MODEL], nextCursor: null };
    if (message.method === 'thread/start') return {
      thread: { id: 'thread-3', model: 'gpt-6-astra', reasoningEffort: 'low', ephemeral: true, environments: [] },
      model: 'gpt-6-astra', modelProvider: 'openai', reasoningEffort: 'low', sandbox: { type: 'readOnly', networkAccess: false }, approvalPolicy: 'never',
    };
    if (message.method === 'turn/start') {
      queueMicrotask(() => emit({ method: 'item/started', params: { threadId: 'thread-3', turnId: 'turn-3', item: { type: 'commandExecution', id: 'tool-1' } } }));
      return { turn: { id: 'turn-3', status: 'inProgress', items: [], itemsView: 'summary', error: null } };
    }
    if (message.method === 'turn/interrupt') return {};
    throw new Error(`unexpected ${message.method}`);
  });
  await assert.rejects(() => review({ question: 'ship?' }, { binary: 'codex-test', spawnImpl: fake.spawnImpl, timeoutMs: 5_000 }), /attempted a tool\/action/);
  assert.equal(methods.filter(method => method === 'turn/start').length, 1);
  assert.equal(methods.filter(method => method === 'turn/interrupt').length, 1);
});

function turnFixture({ model = MODEL, event, startOverride = {}, noCompletion = false, authFailure = false } = {}) {
  const methods = [];
  const fake = fakeSpawn((message, { emit }) => {
    methods.push(message.method);
    if (message.method === 'initialize') return initialize();
    if (message.method === 'model/list') return { data: model ? [model] : [], nextCursor: null };
    if (message.method === 'thread/start') return {
      thread: { id: 'thread-extra', model: 'gpt-6-astra', reasoningEffort: 'low', ephemeral: true, environments: [] },
      model: 'gpt-6-astra', modelProvider: 'openai', reasoningEffort: 'low',
      sandbox: { type: 'readOnly', networkAccess: false }, approvalPolicy: 'never', ...startOverride,
    };
    if (message.method === 'turn/start') {
      if (authFailure) throw new Error('Authentication required: run codex login.');
      if (event) queueMicrotask(() => emit(event));
      return { turn: { id: 'turn-extra', status: 'inProgress', items: [], error: null } };
    }
    if (message.method === 'turn/interrupt') return {};
    throw new Error(`Unexpected ${message.method}`);
  });
  return { ...fake, methods };
}

for (const type of ['collabToolCall', 'collabAgentToolCall', 'futureAction', 'hookPrompt']) {
  test(`rejects ${type}, including aliases and unknown future items`, async () => {
    const fake = turnFixture({ event: { method: 'item/started', params: { threadId: 'thread-extra', turnId: 'turn-extra', item: { type, id: 'action-1' } } } });
    await assert.rejects(review({ question: 'Should we publish?' }, { binary: 'fake', spawnImpl: fake.spawnImpl, timeoutMs: 1000 }), /tool\/action/);
    assert.equal(fake.methods.filter(m => m === 'turn/start').length, 1);
    assert.equal(fake.methods.filter(m => m === 'turn/interrupt').length, 1);
  });
}

test('model reroute cannot produce a successful exact-Astra receipt', async () => {
  const fake = turnFixture({ event: { method: 'model/rerouted', params: { threadId: 'thread-extra', turnId: 'turn-extra', fromModel: 'gpt-6-astra', toModel: 'another-model', reason: 'server-routing' } } });
  await assert.rejects(review({ question: 'Review' }, { binary: 'fake', spawnImpl: fake.spawnImpl, timeoutMs: 1000 }), /rerouted/);
  assert.equal(fake.methods.filter(m => m === 'turn/start').length, 1);
});

test('missing model and unsupported effort fail before creating a model turn', async () => {
  for (const model of [null, { ...MODEL, supportedReasoningEfforts: [{ reasoningEffort: 'high' }] }]) {
    const fake = turnFixture({ model });
    await assert.rejects(review({ question: 'Review' }, { binary: 'fake', spawnImpl: fake.spawnImpl, timeoutMs: 1000 }), /not available|does not advertise/);
    assert.equal(fake.methods.includes('turn/start'), false);
  }
});

test('widened networking and non-ephemeral thread are refused before inference', async () => {
  for (const startOverride of [
    { sandbox: { type: 'readOnly', networkAccess: true } },
    { thread: { id: 'thread-extra', model: 'gpt-6-astra', reasoningEffort: 'low', ephemeral: false, environments: [] } },
  ]) {
    const fake = turnFixture({ startOverride });
    await assert.rejects(review({ question: 'Review' }, { binary: 'fake', spawnImpl: fake.spawnImpl, timeoutMs: 1000 }), /networking|ephemeral/);
    assert.equal(fake.methods.includes('turn/start'), false);
  }
});

test('runtime retry request is rejected without starting a second model turn', async () => {
  const fake = turnFixture({ event: { method: 'error', params: { threadId: 'thread-extra', turnId: 'turn-extra', willRetry: true, error: { message: 'Temporary outage.' } } } });
  await assert.rejects(review({ question: 'Review' }, { binary: 'fake', spawnImpl: fake.spawnImpl, timeoutMs: 1000 }), /automatic retry/);
  assert.equal(fake.methods.filter(m => m === 'turn/start').length, 1);
});

test('deadline interrupts a stuck review once, without retry', async () => {
  const fake = turnFixture();
  await assert.rejects(review({ question: 'Review' }, { binary: 'fake', spawnImpl: fake.spawnImpl, timeoutMs: 1000 }), /timed out/);
  assert.equal(fake.methods.filter(m => m === 'turn/start').length, 1);
  assert.equal(fake.methods.filter(m => m === 'turn/interrupt').length, 1);
  assert.equal(fake.calls[0].proc.killed, true);
});

test('authentication failure is surfaced, not silently retried or substituted', async () => {
  const fake = turnFixture({ authFailure: true });
  await assert.rejects(review({ question: 'Review' }, { binary: 'fake', spawnImpl: fake.spawnImpl, timeoutMs: 1000 }), /Authentication required/);
  assert.equal(fake.methods.filter(m => m === 'turn/start').length, 1);
});

test('review times out once, interrupts once, and never retries inference', async () => {
  const methods = [];
  const fake = fakeSpawn(message => {
    methods.push(message.method);
    if (message.method === 'initialize') return initialize();
    if (message.method === 'model/list') return { data: [MODEL], nextCursor: null };
    if (message.method === 'thread/start') return {
      thread: { id: 'thread-timeout', model: 'gpt-6-astra', reasoningEffort: 'low', ephemeral: true, environments: [] },
      model: 'gpt-6-astra', modelProvider: 'openai', reasoningEffort: 'low', sandbox: { type: 'readOnly', networkAccess: false }, approvalPolicy: 'never',
    };
    if (message.method === 'turn/start') return { turn: { id: 'turn-timeout', status: 'inProgress', items: [], itemsView: 'summary', error: null } };
    if (message.method === 'turn/interrupt') return {};
    throw new Error(`unexpected ${message.method}`);
  });
  await assert.rejects(() => review({ question: 'ship?' }, { binary: 'codex-test', spawnImpl: fake.spawnImpl, timeoutMs: 1_000 }), /Astra review timed out/);
  assert.equal(methods.filter(method => method === 'thread/start').length, 1);
  assert.equal(methods.filter(method => method === 'turn/start').length, 1);
  assert.equal(methods.filter(method => method === 'turn/interrupt').length, 1);
});
