import { spawn } from 'node:child_process';
import readline from 'node:readline';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { resolveCodex } from './command.mjs';

export const SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,127}$/;

/**
 * Resolve one exact Codex rollout by thread id without starting Codex.
 * This is filename-only discovery: no recency heuristic and no content search.
 */
export function resolveCodexTranscript(threadId, {
  codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'),
  maxEntries = 50_000,
} = {}) {
  if (!SESSION_ID.test(threadId)) throw new Error('A resolved Codex thread ID is required; unresolved template variables are not IDs.');
  const roots = ['sessions', 'archived_sessions'].map(name => path.join(codexHome, name)).filter(p => fs.existsSync(p));
  const matches = [];
  let visited = 0;
  for (const root of roots) {
    const pending = [root];
    while (pending.length) {
      const current = pending.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        if (++visited > maxEntries) throw new Error(`Codex session index exceeds ${maxEntries} entries; pass the exact --transcript instead.`);
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) pending.push(full);
        else if (entry.isFile() && entry.name.endsWith(`${threadId}.jsonl`)) matches.push(full);
      }
    }
  }
  if (matches.length !== 1) throw new Error(`Expected one Codex transcript for thread ${threadId}; found ${matches.length}. Pass its exact --transcript; never choose newest.`);
  return matches[0];
}

/** Read one named thread. This client never starts/resumes a thread or model turn. */
export async function readCodexThread(threadId, { binary = resolveCodex(), timeoutMs = 30_000 } = {}) {
  if (!SESSION_ID.test(threadId)) throw new Error('A resolved Codex thread ID is required; unresolved template variables are not IDs.');
  const proc = spawn(binary, ['app-server'], { cwd: os.tmpdir(), windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const pending = new Map();
  let next = 0, received = 0, ended = false;
  const lines = readline.createInterface({ input: proc.stdout });
  const send = m => { if (!ended) proc.stdin.write(JSON.stringify(m) + '\n'); };
  const fail = error => { for (const p of pending.values()) p.reject(error); pending.clear(); };
  const timer = setTimeout(() => { fail(new Error('Reading the selected Codex thread timed out; no inference was started.')); proc.kill(); }, timeoutMs);
  proc.on('error', fail);
  proc.on('exit', code => { ended = true; fail(new Error(`Codex history process exited (${code}).`)); });
  proc.stdin.on('error', fail);
  proc.stderr.resume();
  proc.stdout.on('data', data => {
    received += data.length;
    if (received > 32 * 1024 * 1024) { fail(new Error('Selected history exceeds 32 MiB; no silent truncation. Use an explicitly scoped transcript.')); proc.kill(); }
  });
  lines.on('line', line => {
    let message; try { message = JSON.parse(line); } catch { return; }
    if (message.id !== undefined && pending.has(message.id)) {
      const p = pending.get(message.id); pending.delete(message.id);
      message.error ? p.reject(new Error(`Codex history: ${message.error.message}`)) : p.resolve(message.result);
    } else if (message.id !== undefined) {
      send({ id: message.id, error: { code: -32601, message: 'History reader does not execute or authorize actions.' } });
    }
  });
  const rpc = (method, params) => new Promise((resolve, reject) => {
    if (ended) return reject(new Error('Codex history process is closed.'));
    const id = ++next; pending.set(id, { resolve, reject }); send({ id, method, params });
  });
  try {
    await rpc('initialize', { clientInfo: { name: 'astra_advisor_history', version: '0.1.1' }, capabilities: { experimentalApi: true } });
    send({ method: 'initialized' });
    const { thread } = await rpc('thread/read', { threadId, includeTurns: false });
    if (thread.id !== threadId) throw new Error('Codex returned a different thread identity.');
    // Exact stored rollout retains structured question/answer records absent from some API views.
    if (thread.path && fs.existsSync(thread.path) && path.extname(thread.path) === '.jsonl') return { thread, transcript: thread.path };
    const entries = [], cursors = new Set();
    let cursor;
    for (let page = 0; page < 100; page++) {
      const result = await rpc('thread/items/list', { threadId, limit: 100, sortDirection: 'asc', ...(cursor ? { cursor } : {}) });
      if (!Array.isArray(result.data)) throw new Error('Unsupported Codex history schema.');
      entries.push(...result.data);
      if (!result.nextCursor) return { thread, entries };
      if (cursors.has(result.nextCursor)) throw new Error('Codex history pagination repeated a cursor.');
      cursors.add(result.nextCursor); cursor = result.nextCursor;
    }
    throw new Error('Selected history exceeds 10,000 items; no silent truncation.');
  } finally {
    clearTimeout(timer); ended = true; lines.close(); proc.stdin.end(); proc.kill(); fail(new Error('History reader closed.'));
  }
}

/** Only inspect exact filenames in Claude's project directories, never conversation contents. */
export function resolveClaudeTranscript(sessionId, { root = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects') } = {}) {
  if (!SESSION_ID.test(sessionId)) throw new Error('Pass the resolved Claude session ID or its exact transcript path.');
  const directories = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory());
  if (directories.length > 512) throw new Error('Claude project index is too large; pass the exact transcript path.');
  const matches = directories.map(d => path.join(root, d.name, `${sessionId}.jsonl`)).filter(p => fs.existsSync(p));
  if (matches.length !== 1) throw new Error(`Expected one Claude transcript for this session; found ${matches.length}. Pass its exact path; never choose newest.`);
  return matches[0];
}
