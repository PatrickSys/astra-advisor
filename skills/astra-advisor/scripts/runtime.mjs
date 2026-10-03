import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';

import { resolveCodex } from './command.mjs';

const MODEL = 'gpt-6-astra';
const DEFAULT_EFFORT = 'low';
const MAX_PACKET_BYTES = 256 * 1024;
const RPC_TIMEOUT_MS = 30_000;
const MAX_STDOUT_BYTES = 32 * 1024 * 1024;
const SNAPSHOT_ONLY_ITEMS = new Set(['userMessage', 'agentMessage', 'reasoning', 'plan']);
const isActionOrUnknown = item => !SNAPSHOT_ONLY_ITEMS.has(item?.type);

const ADVISOR_INSTRUCTIONS = fs.readFileSync(new URL('../references/advisor.md', import.meta.url), 'utf8').trim();

function asPacketText(packet) {
  const text = typeof packet === 'string' ? packet : JSON.stringify(packet);
  if (!text?.trim()) throw new Error('A non-empty advisory packet is required.');
  if (Buffer.byteLength(text) > MAX_PACKET_BYTES) throw new Error('Advisory packet exceeds 256 KiB; narrow the evidence explicitly.');
  return text;
}

function effortNames(model) {
  return (model?.supportedReasoningEfforts || []).map(option => option.reasoningEffort ?? option.effort ?? option.value).filter(Boolean);
}

function modelRow(models) {
  return models.find(model => model.model === MODEL || model.id === MODEL);
}

class AppServer {
  constructor(binary, { cwd, spawnImpl = spawn, rpcTimeoutMs = RPC_TIMEOUT_MS } = {}) {
    this.proc = spawnImpl(binary, [
      'app-server',
      '--disable', 'multi_agent_v2',
      '-c', 'web_search="disabled"',
      '-c', 'apps._default.enabled=false',
    ], { cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.pending = new Map();
    this.listeners = new Set();
    this.notifications = [];
    this.nextId = 0;
    this.closed = false;
    this.stdoutBytes = 0;
    this.diagnostic = '';
    this.rpcTimeoutMs = rpcTimeoutMs;
    this.lines = readline.createInterface({ input: this.proc.stdout });

    this.proc.stderr.on('data', chunk => { this.diagnostic = (this.diagnostic + chunk).slice(-4_000); });
    this.proc.stdout.on('data', chunk => {
      this.stdoutBytes += chunk.length;
      if (this.stdoutBytes > MAX_STDOUT_BYTES) this.fail(new Error('Codex app-server exceeded the 32 MiB protocol bound.'));
    });
    this.lines.on('line', line => this.onLine(line));
    this.proc.on('error', error => this.fail(error));
    this.proc.on('exit', code => {
      if (!this.closed) this.fail(new Error(`Codex app-server exited (${code}): ${this.diagnostic}`));
    });
    this.proc.stdin.on('error', error => { if (!this.closed) this.fail(error); });
  }

  send(message) {
    if (this.closed) throw new Error('Codex app-server is closed.');
    this.proc.stdin.write(`${JSON.stringify(message)}\n`);
  }

  onLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (message.id !== undefined && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error(`Codex ${pending.method}: ${message.error.message || JSON.stringify(message.error)}`));
      else pending.resolve(message.result);
      return;
    }
    if (message.id !== undefined) {
      // This runtime supplies no tool/action handlers. Never approve a server request implicitly.
      this.send({ id: message.id, error: { code: -32601, message: 'Astra Advisor does not provide action handlers.' } });
      return;
    }
    this.notifications.push(message);
    if (this.notifications.length > 10_000) this.notifications.shift();
    for (const listener of this.listeners) listener(message);
  }

  rpc(method, params, timeoutMs = this.rpcTimeoutMs) {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex RPC timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      try { this.send({ id, method, params }); } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  waitFor(predicate, timeoutMs) {
    return new Promise((resolve, reject) => {
      let timer;
      const listener = message => {
        let result;
        try { result = predicate(message); } catch (error) { cleanup(); reject(error); return; }
        if (result === undefined) return;
        cleanup(); resolve(result);
      };
      const cleanup = () => { clearTimeout(timer); this.listeners.delete(listener); };
      try {
        for (const message of this.notifications) {
          const result = predicate(message);
          if (result !== undefined) { resolve(result); return; }
        }
      } catch (error) { reject(error); return; }
      timer = setTimeout(() => { cleanup(); reject(new Error('Astra review timed out.')); }, timeoutMs);
      this.listeners.add(listener);
    });
  }

  fail(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const listener of this.listeners) {
      try { listener({ method: '__client_error__', params: { error } }); } catch { /* listener owns its failure */ }
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.lines.close();
    this.listeners.clear();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Codex app-server closed.'));
    }
    this.pending.clear();
    this.proc.stdin.end();
    this.proc.kill();
  }
}

async function connect({ binary, spawnImpl, rpcTimeoutMs }) {
  // Keep the long-lived app-server out of the disposable per-review directory.
  // Windows will not remove a directory while a child process uses it as cwd.
  const client = new AppServer(binary, { cwd: os.tmpdir(), spawnImpl, rpcTimeoutMs });
  try {
    const runtime = await client.rpc('initialize', {
      clientInfo: { name: 'astra_advisor', version: '0.1.0' },
      capabilities: { experimentalApi: true },
    });
    client.send({ method: 'initialized' });
    return { client, runtime };
  } catch (error) {
    client.close();
    throw error;
  }
}

async function listModels(client) {
  const models = [];
  const cursors = new Set();
  let cursor;
  for (let page = 0; page < 20; page += 1) {
    const result = await client.rpc('model/list', { limit: 100, includeHidden: true, ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(result?.data)) throw new Error('Codex returned an unsupported model catalog.');
    models.push(...result.data);
    if (!result.nextCursor) return models;
    if (cursors.has(result.nextCursor)) throw new Error('Codex model catalog repeated a pagination cursor.');
    cursors.add(result.nextCursor);
    cursor = result.nextCursor;
  }
  throw new Error('Codex model catalog exceeded 2,000 entries.');
}

function assertModel(models, effort) {
  const model = modelRow(models);
  if (!model) throw new Error(`${MODEL} is not available in this Codex runtime.`);
  const supported = effortNames(model);
  if (!supported.includes(effort)) throw new Error(`${MODEL} does not advertise reasoning effort ${effort}. Supported: ${supported.join(', ') || 'unreported'}.`);
  return model;
}

function inspectTurn(turn) {
  if (!turn || turn.status !== 'completed') throw new Error(`Astra turn did not complete successfully (${turn?.status || 'unknown'}).`);
  if (turn.error) throw new Error(`Astra turn failed: ${turn.error.message || JSON.stringify(turn.error)}`);
  const items = Array.isArray(turn.items) ? turn.items : [];
  const toolItems = items.filter(isActionOrUnknown);
  if (toolItems.length) throw new Error(`Astra attempted a tool/action (${toolItems.map(item => item.type).join(', ')}); review discarded.`);
  const report = items.filter(item => item.type === 'agentMessage').map(item => item.text).filter(Boolean).join('\n\n').trim();
  if (!report) throw new Error('Astra completed without an advisory report.');
  return { report, toolItems };
}

function runtimeReceipt(runtime, threadStart, model, effort) {
  return {
    transport: 'codex-app-server',
    userAgent: runtime?.userAgent ?? null,
    codexHome: runtime?.codexHome ?? null,
    platformFamily: runtime?.platformFamily ?? null,
    requestedModel: MODEL,
    configuredModel: threadStart.model,
    requestedEffort: effort,
    configuredEffort: threadStart.reasoningEffort,
    provider: threadStart.modelProvider,
    ephemeral: threadStart.thread?.ephemeral === true,
    environments: threadStart.thread?.environments ?? null,
    sandbox: threadStart.sandbox ?? null,
    approvalPolicy: threadStart.approvalPolicy,
    modelCatalogId: model.id,
    modelCatalogName: model.model,
    toolBoundary: {
      environmentAccessDisabled: Array.isArray(threadStart.thread?.environments) && threadStart.thread.environments.length === 0,
      dynamicToolsSupplied: 0,
      effectiveReadOnlyNoNetwork: threadStart.sandbox?.type === 'readOnly' && threadStart.sandbox.networkAccess === false,
      webSearchDisableRequested: true,
      appsDefaultDisableRequested: true,
      multiAgentV2DisableRequested: true,
      observedToolItems: 0,
      claim: 'Successful reviews verify the returned read-only/no-network sandbox and reject recorded tool/action items. Process-level web/app/multi-agent disables are requests, not independent proof that the serving backend exposed zero tools.',
    },
  };
}

export async function doctor({ binary = resolveCodex(), timeoutMs = RPC_TIMEOUT_MS, spawnImpl = spawn } = {}) {
  let client;
  try {
    const connected = await connect({ binary, spawnImpl, rpcTimeoutMs: timeoutMs });
    client = connected.client;
    const models = await listModels(client);
    const model = modelRow(models);
    const supported = effortNames(model);
    return {
      ok: !!model && supported.includes(DEFAULT_EFFORT),
      binary,
      runtime: {
        transport: 'codex-app-server',
        userAgent: connected.runtime?.userAgent ?? null,
        codexHome: connected.runtime?.codexHome ?? null,
        platformFamily: connected.runtime?.platformFamily ?? null,
      },
      model: model ? { id: model.id, model: model.model, supportedReasoningEfforts: supported, defaultReasoningEffort: model.defaultReasoningEffort, advisorDefaultEffort: DEFAULT_EFFORT } : null,
      inferenceCalls: 0,
    };
  } finally {
    client?.close();
  }
}

export async function review(packet, {
  timeoutMs = 180_000,
  effort = DEFAULT_EFFORT,
  binary = resolveCodex(),
  spawnImpl = spawn,
} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 10 * 60_000) throw new Error('timeoutMs must be between 1,000 and 600,000 ms.');
  if (!['low', 'medium', 'high', 'xhigh'].includes(effort)) throw new Error('effort must be low, medium, high, or xhigh.');
  const packetText = asPacketText(packet);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-advisor-review-'));
  let client;
  let threadId;
  let turnId;
  let usage = null;
  let firstRuntimeError = null;
  let output = null;
  try {
    const connected = await connect({ binary, spawnImpl, rpcTimeoutMs: Math.min(timeoutMs, RPC_TIMEOUT_MS) });
    client = connected.client;
    const models = await listModels(client);
    const model = assertModel(models, effort);

    const started = await client.rpc('thread/start', {
      model: MODEL,
      modelProvider: 'openai',
      allowProviderModelFallback: false,
      config: { model_reasoning_effort: effort },
      cwd: work,
      runtimeWorkspaceRoots: [],
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: true,
      environments: [],
      dynamicTools: [],
      selectedCapabilityRoots: [],
      baseInstructions: ADVISOR_INSTRUCTIONS,
    });
    threadId = started?.thread?.id;
    if (!threadId) throw new Error('Codex did not return an Astra thread id.');
    if (started.modelProvider !== 'openai') throw new Error('Codex did not select the requested OpenAI provider.');
    if (started.thread?.ephemeral !== true) throw new Error('Codex did not honor the ephemeral review boundary.');
    if (started.model !== MODEL || started.thread?.model !== MODEL) throw new Error(`Codex substituted model ${started.model || started.thread?.model || 'unknown'}; fallback is forbidden.`);
    if (started.reasoningEffort !== effort || started.thread?.reasoningEffort !== effort) throw new Error(`Codex configured reasoning effort ${started.reasoningEffort || started.thread?.reasoningEffort || 'unknown'} instead of ${effort}.`);
    if (!Array.isArray(started.thread.environments) || started.thread.environments.length !== 0) throw new Error('Codex did not honor disabled environment access.');
    if (started.sandbox?.type !== 'readOnly') throw new Error(`Codex exposed effective sandbox ${started.sandbox?.type || 'unknown'} instead of readOnly; review refused before inference.`);
    if (started.sandbox.networkAccess !== false) throw new Error('Codex did not report read-only sandbox networking disabled; review refused before inference.');
    if (started.approvalPolicy !== 'never') throw new Error(`Codex exposed approval policy ${JSON.stringify(started.approvalPolicy)} instead of never; review refused before inference.`);

    const turnStart = await client.rpc('turn/start', {
      threadId,
      input: [{ type: 'text', text: `Review this immutable evidence snapshot.\n\n${packetText}` }],
      environments: [],
      runtimeWorkspaceRoots: [],
      approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      model: MODEL,
      effort,
    });
    turnId = turnStart?.turn?.id;
    if (!turnId) throw new Error('Codex did not return an Astra turn id.');

    const finished = client.waitFor(message => {
      if (message.method === '__client_error__') throw message.params.error;
      if (message.method === 'model/rerouted' && message.params?.threadId === threadId && message.params?.turnId === turnId) {
        throw new Error(`Astra model was rerouted to ${message.params.toModel || 'an unreported model'}; review discarded without retry.`);
      }
      if (message.method === 'thread/tokenUsage/updated' && message.params?.threadId === threadId && message.params?.turnId === turnId) usage = message.params.tokenUsage?.last ?? message.params.tokenUsage?.total ?? null;
      if (message.method === 'error' && message.params?.threadId === threadId && message.params?.turnId === turnId) {
        firstRuntimeError = message.params.error;
        if (message.params.willRetry) throw new Error(`Astra runtime requested an automatic retry; review aborted: ${message.params.error?.message || 'runtime error'}`);
      }
      if ((message.method === 'item/started' || message.method === 'item/completed') && message.params?.threadId === threadId && message.params?.turnId === turnId && isActionOrUnknown(message.params.item)) {
        throw new Error(`Astra attempted a tool/action (${message.params.item.type}); review aborted.`);
      }
      if (message.method === 'turn/completed' && message.params?.threadId === threadId && message.params.turn?.id === turnId) return message.params.turn;
      return undefined;
    }, timeoutMs);

    let completed;
    try {
      completed = await finished;
    } catch (error) {
      if (threadId && turnId) {
        try { await client.rpc('turn/interrupt', { threadId, turnId }, 5_000); } catch { /* original failure wins */ }
      }
      throw error;
    }
    if (firstRuntimeError) throw new Error(`Astra runtime failed: ${firstRuntimeError.message || JSON.stringify(firstRuntimeError)}`);

    // Ephemeral Codex threads intentionally do not support thread/read(includeTurns).
    // The turn/completed notification is the authoritative completed-turn payload for
    // this one-shot session, so validate that exact object rather than inventing a
    // persistence guarantee the runtime does not provide.
    const inspected = inspectTurn(completed);
    output = {
      report: inspected.report,
      runtime: {
        ...runtimeReceipt(connected.runtime, started, model, effort),
        turnEvidence: 'turn/completed-notification',
      },
      usage,
    };
    return output;
  } finally {
    client?.close();
    try {
      await fs.promises.rm(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
    } catch (error) {
      // On Windows, Codex descendants can briefly retain a handle to the ephemeral
      // cwd after app-server shutdown. The directory contains no packet or user
      // evidence, so a cleanup race must not discard an otherwise valid review.
      if (output?.runtime) output.runtime.cleanupWarning = `Temporary review directory cleanup failed: ${error.code || error.message}`;
    }
  }
}
