import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const sha256 = value => createHash('sha256').update(value).digest('hex');
const SOURCE_LIMIT = 32 * 1024 * 1024;
export const PACKET_LIMIT = 256 * 1024;
const textTypes = new Set(['text', 'input_text', 'output_text']);
const generated = /^(?:\s*<(?:system-reminder|user_instructions|environment_context|available_skills|instructions|task-notification|subagent_notification)\b|\s*# AGENTS\.md instructions)/i;
const questionTools = new Set(['AskUserQuestion', 'request_user_input']);

export function readSnapshot(filename, limit = SOURCE_LIMIT) {
  const fullPath = fs.realpathSync.native(filename);
  const fd = fs.openSync(fullPath, 'r');
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size > limit) throw new Error(`Input must be a regular file no larger than ${limit} bytes: ${filename}`);
    const bytes = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < bytes.length) {
      const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!n) throw new Error('Source became shorter during read.');
      offset += n;
    }
    const after = fs.fstatSync(fd), current = fs.statSync(fullPath);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== current.ino || before.size !== current.size || before.mtimeMs !== current.mtimeMs) {
      throw new Error('Source changed during read; retry only after obtaining a stable snapshot.');
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) throw new Error('Binary input is not supported. Supply a text artifact or identify the missing attachment.');
    return { path: fullPath, text, sha256: sha256(bytes), bytes: bytes.length };
  } finally { fs.closeSync(fd); }
}

function visible(content, gaps, source) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) { if (content != null) gaps.add(`unsupported-content:${source}`); return ''; }
  return content.map(block => {
    if (textTypes.has(block.type) && typeof block.text === 'string') return block.text;
    if (!['thinking', 'redacted_thinking', 'reasoning', 'tool_use', 'tool_result'].includes(block.type)) gaps.add(`unread-${block.type || 'block'}:${source}`);
    return '';
  }).filter(Boolean).join('\n');
}

function asJson(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return null; }
}

/** Preserve recognized intent and provenance; never claim a lossless/authenticated transcript. */
export function normalizeRecords(records, { host, sourceId = 'transcript', expectedSession } = {}) {
  if (!['codex', 'claude'].includes(host)) throw new Error('host must be codex or claude.');
  const messages = [], gaps = new Set(), calls = new Map(), sessions = new Set();
  let assistantContext = null;
  const add = (text, ref, kind = 'user', extra = {}) => {
    if (!text.trim()) return;
    if (generated.test(text)) { gaps.add(`generated-envelope-excluded:${ref}`); return; }
    const context = text.trim().length < 160 && assistantContext ? assistantContext : undefined;
    messages.push({ kind, source: ref, text, ...(context ? { precedingAssistant: context } : {}), ...extra });
  };
  const decision = (callId, answer, ref) => {
    const call = calls.get(callId);
    if (!call) { gaps.add(`unlinked-tool-result:${ref}`); return; }
    if (answer == null || answer === '') { gaps.add(`missing-human-answer:${ref}`); return; }
    messages.push({ kind: 'structured-decision', source: ref, questionSource: call.source, questions: call.questions, answer });
    calls.delete(callId);
  };
  for (let i = 0; i < records.length; i++) {
    const r = records[i], ref = `${sourceId}:${r.line ?? i + 1}`;
    const row = r.record ?? r;
    if (!row || typeof row !== 'object') { gaps.add(`malformed-record:${ref}`); continue; }
    if (host === 'claude') {
      if (row.sessionId) sessions.add(row.sessionId);
      if (row.isSidechain || row.type === 'agent_meta') { gaps.add(`subagent-lineage-excluded:${ref}`); continue; }
      if (row.isCompactSummary || /compact|rewind|queue-operation/.test(row.type || '')) { gaps.add(`history-${row.type || 'compaction'}:${ref}`); continue; }
      if (!['user', 'assistant'].includes(row.type)) continue;
      if (row.isMeta || (row.userType && row.userType !== 'external')) { gaps.add(`nonhuman-envelope:${ref}`); continue; }
      const content = row.message?.content;
      for (const block of Array.isArray(content) ? content : []) {
        if (row.type === 'assistant' && block.type === 'tool_use' && questionTools.has(block.name)) {
          calls.set(block.id, { source: ref, questions: block.input?.questions ?? block.input });
        }
        if (row.type === 'user' && block.type === 'tool_result') {
          // Only a recognized, linked question tool can promote a tool result to a decision.
          if (calls.has(block.tool_use_id)) decision(block.tool_use_id, row.toolUseResult?.answers ?? asJson(block.content)?.answers ?? visible(block.content, gaps, ref), ref);
        }
      }
      const text = visible(content, gaps, ref);
      if (row.type === 'user') add(text, ref);
      else if (text) assistantContext = { source: ref, text: text.length <= 12_000 ? text : text.slice(0, 12_000), ...(text.length > 12_000 ? { truncated: true } : {}) };
    } else {
      const p = row.payload || {};
      if (row.type === 'session_meta') {
        if (p.id) sessions.add(p.id);
        if (p.parent_thread_id || p.source === 'subagent' || p.source?.subagent) throw new Error('A subagent transcript is not original human intent. Select the originating human conversation explicitly.');
        if (p.forked_from_id || typeof p.source === 'object') gaps.add(`unverified-branch-lineage:${ref}`);
      }
      if (/compact|rollback|rewind/.test(`${row.type} ${p.type || ''}`)) { gaps.add(`history-transition:${ref}`); continue; }
      if (row.type === 'response_item' && p.type === 'function_call' && questionTools.has(p.name?.split('.').at(-1))) {
        const arguments_ = asJson(p.arguments);
        calls.set(p.call_id || p.id, { source: ref, questions: arguments_?.questions ?? arguments_ });
      }
      if (row.type === 'response_item' && p.type === 'function_call_output' && calls.has(p.call_id)) {
        const parsed = asJson(p.output);
        decision(p.call_id, parsed?.answers ?? p.output, ref);
      }
      if (row.type === 'event_msg' && p.type === 'user_message') {
        add(typeof p.message === 'string' ? p.message : visible(p.message?.content, gaps, ref), ref, 'user', { representation: 'event' });
        if (p.images?.length || p.local_images?.length) gaps.add(`unread-images:${ref}`);
      } else if (row.type === 'response_item' && p.type === 'message') {
        const text = visible(p.content, gaps, ref);
        if (p.role === 'user') add(text, ref, 'user', { representation: 'response-item' });
        else if (p.role === 'assistant' && text) assistantContext = { source: ref, text: text.slice(0, 12_000), ...(text.length > 12_000 ? { truncated: true } : {}) };
      } else if (row.type === 'event_msg' && p.type === 'agent_message') {
        const text = typeof p.message === 'string' ? p.message : visible(p.message?.content, gaps, ref);
        if (text) assistantContext = { source: ref, text: text.slice(0, 12_000), ...(text.length > 12_000 ? { truncated: true } : {}) };
      } else if (row.type === 'event_msg' && (p.role || /user|answer|question/.test(p.type || '')) && !['user_message'].includes(p.type)) {
        gaps.add(`unsupported-intent-event:${ref}`);
      }
    }
  }
  if (sessions.size > 1 || (expectedSession && [...sessions].some(id => id !== expectedSession))) throw new Error('Transcript identity is mixed or does not match the selected session.');
  if (expectedSession && !sessions.size) gaps.add('session-identity-not-recorded');
  for (const call of calls.values()) gaps.add(`question-answer-not-recovered:${call.source}`);
  if (messages.some(m => m.precedingAssistant?.truncated)) gaps.add('short-answer-context-truncated');
  return {
    host, sessionId: [...sessions][0] ?? expectedSession ?? null, messages,
    coverage: { sourceReadComplete: true, intent: 'recognized-records-only', limitations: [...gaps],
      note: 'Not authenticated authorship or lossless history. Codex event/response representations may repeat; equal text is never deduplicated. Current unpersisted input must be supplied separately.' },
  };
}

export function fromTranscript(filename, { host, expectedSession } = {}) {
  const snapshot = readSnapshot(filename), records = [], malformed = [];
  const lines = snapshot.text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    try { records.push({ line: i + 1, record: JSON.parse(lines[i]) }); } catch { malformed.push(i + 1); }
  }
  const normalized = normalizeRecords(records, { host, sourceId: 'transcript', expectedSession });
  normalized.source = { path: snapshot.path, sha256: snapshot.sha256, bytes: snapshot.bytes };
  if (malformed.length) {
    normalized.coverage.sourceReadComplete = false;
    normalized.coverage.limitations.push(`malformed-json-lines:${malformed.join(',')}`);
  }
  return normalized;
}

export function fromCodexItems({ thread, entries }) {
  const records = [{ type: 'session_meta', payload: { id: thread.id, parent_thread_id: thread.parentThreadId, forked_from_id: thread.forkedFromId } }];
  const unsupported = [];
  for (const entry of entries) {
    const item = entry.item ?? entry;
    if (item.type === 'userMessage') records.push({ line: `${entry.turnId || 'turn'}/${item.id}`, record: { type: 'response_item', payload: { type: 'message', role: 'user', content: item.content } } });
    else if (item.type === 'agentMessage') records.push({ line: `${entry.turnId || 'turn'}/${item.id}`, record: { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'text', text: item.text }] } } });
    else if (item.type === 'contextCompaction' || item.type === 'functionCallOutput') unsupported.push(`${item.type}:${item.id}`);
  }
  const result = normalizeRecords(records, { host: 'codex', sourceId: `thread:${thread.id}`, expectedSession: thread.id });
  result.source = { threadId: thread.id, historyMode: thread.historyMode, snapshotSha256: sha256(JSON.stringify(entries)), updatedAt: thread.updatedAt };
  result.coverage.limitations.push('api-view-does-not-prove-structured-answer-coverage', ...unsupported);
  return result;
}

export function collectEvidence(filenames, cwd) {
  const root = fs.realpathSync.native(cwd);
  return filenames.map(filename => {
    const resolved = fs.realpathSync.native(path.resolve(root, filename));
    const relative = path.relative(root, resolved);
    if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new Error('Evidence must stay inside the selected repository, including symlink targets.');
    if (/(?:^|[\\/])(?:\.env(?:\..*)?|auth\.json|credentials(?:\.json)?|id_rsa|id_ed25519)$|\.(?:pem|key)$/i.test(relative)) throw new Error(`Refusing a likely credential file: ${relative}`);
    const snapshot = readSnapshot(resolved, 128 * 1024);
    return { path: relative.split(path.sep).join('/'), sha256: snapshot.sha256, bytes: snapshot.bytes, text: snapshot.text, inspectedBy: 'local-helper' };
  });
}

export function collectDiff(cwd) {
  const result = spawnSync('git', ['-C', cwd, '-c', 'core.fsmonitor=false', '--no-pager', 'diff', '--no-ext-diff', '--no-textconv', 'HEAD', '--', '.'], { encoding: 'utf8', windowsHide: true, maxBuffer: 128 * 1024, timeout: 10_000 });
  if (result.error || result.status !== 0) throw new Error('Cannot capture a bounded tracked diff against HEAD. Pass explicit text files for a new/unborn repository.');
  return { source: 'git diff HEAD (tracked only; untracked files not included)', sha256: sha256(result.stdout), text: result.stdout, inspectedBy: 'local-helper' };
}

export function buildPacket({
  question,
  questionProvenance = 'current-host-input; not claimed persisted',
  conversation,
  files = [],
  diff = null,
}) {
  if (typeof question !== 'string' || !question.trim()) throw new Error('A concrete current advisory question is required.');
  const packet = { version: 1, question, questionProvenance, conversation, files, ...(diff ? { diff } : {}) };
  if (Buffer.byteLength(JSON.stringify(packet)) > PACKET_LIMIT) throw new Error('Review evidence exceeds 256 KiB. Select a smaller, explicit scope; do not silently omit human corrections.');
  return packet;
}
