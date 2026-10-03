#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSnapshot, fromTranscript, fromCodexItems, collectEvidence, collectDiff, buildPacket, sha256 } from './intake.mjs';
import { readCodexThread, resolveClaudeTranscript } from './history.mjs';

export const HELP = `Astra Advisor — one explicit second opinion.

  advisor.mjs doctor                         Check runtime; no model call
  advisor.mjs extract [options]              Print evidence; no model call
  advisor.mjs review [options]               Consult Astra once

Options (normally filled by your host agent):
  --question-file PATH  UTF-8 current request/question (required)
  --host codex|claude    Codex is the default
  --session ID          Exact session; Codex defaults to CODEX_THREAD_ID
  --transcript PATH     Exact JSONL instead of session lookup
  --file PATH           Repository-relative evidence; repeat as needed
  --diff                Include tracked working/staged changes against HEAD
  --cwd PATH            Evidence repository (defaults to current directory)
  --timeout-ms N        Model deadline, 1000–300000 (default 180000)

Uses your existing Codex authentication. Evidence is sent to its model provider.
Never selects the newest conversation, publishes, or retries a paid review.
`;

export function parseArgs(argv) {
  const [command = 'help', ...rest] = argv;
  if (['help', '--help', '-h'].includes(command)) return { command: 'help' };
  if (!['doctor', 'extract', 'review'].includes(command)) throw new Error(`Unknown command: ${command}`);
  const result = { command, files: [], cwd: process.cwd(), host: 'codex', timeoutMs: 180_000 };
  const values = { '--question-file': 'questionFile', '--host': 'host', '--session': 'session', '--transcript': 'transcript', '--file': 'files', '--cwd': 'cwd', '--timeout-ms': 'timeoutMs' };
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i];
    if (key === '--diff') { if (result.diff) throw new Error('Duplicate --diff.'); result.diff = true; continue; }
    if (!values[key] || i + 1 === rest.length || rest[i + 1].startsWith('--')) throw new Error(`Unknown option or missing value: ${key}`);
    const value = rest[++i];
    if (key === '--file') result.files.push(value);
    else {
      result.seen ??= new Set();
      if (result.seen.has(key)) throw new Error(`Duplicate option: ${key}`);
      result.seen.add(key); result[values[key]] = value;
    }
  }
  if (!['codex', 'claude'].includes(result.host)) throw new Error('--host must be codex or claude.');
  result.timeoutMs = Number(result.timeoutMs);
  if (!Number.isSafeInteger(result.timeoutMs) || result.timeoutMs < 1000 || result.timeoutMs > 300_000) throw new Error('--timeout-ms must be an integer between 1000 and 300000.');
  if (result.session && result.transcript) throw new Error('Choose --session or --transcript, not both.');
  if (command === 'doctor' && rest.length) throw new Error('doctor takes no evidence options.');
  if (command !== 'doctor' && !result.questionFile) throw new Error('--question-file is required; the host agent should write the current request to a temporary UTF-8 file.');
  result.cwd = path.resolve(result.cwd);
  delete result.seen;
  return result;
}

export async function prepare(options, { env = process.env, readThread = readCodexThread } = {}) {
  const question = readSnapshot(options.questionFile, 32 * 1024).text;
  let conversation;
  if (options.transcript) conversation = fromTranscript(options.transcript, { host: options.host });
  else if (options.host === 'claude') {
    conversation = fromTranscript(resolveClaudeTranscript(options.session), { host: 'claude', expectedSession: options.session });
  } else {
    const session = options.session || env.CODEX_THREAD_ID;
    if (!session) throw new Error('Current Codex thread ID is unavailable. The host must supply the exact --session or --transcript; never guess from recency.');
    const history = await readThread(session);
    conversation = history.transcript ? fromTranscript(history.transcript, { host: 'codex', expectedSession: session }) : fromCodexItems(history);
  }
  return buildPacket({ question, conversation, files: collectEvidence(options.files || [], options.cwd), diff: options.diff ? collectDiff(options.cwd) : null });
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.command === 'help') { console.log(HELP); return; }
    if (options.command === 'doctor') {
      const { doctor } = await import('./runtime.mjs');
      const result = await doctor();
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
      return;
    }
    const packet = await prepare(options);
    if (options.command === 'extract') { console.log(JSON.stringify(packet, null, 2)); return; }
    const { review } = await import('./runtime.mjs');
    const result = await review(packet, { timeoutMs: options.timeoutMs });
    console.log(JSON.stringify({ ...result, evidence: {
      packetSha256: sha256(JSON.stringify(packet)), conversationSource: packet.conversation.source,
      coverage: packet.conversation.coverage, files: packet.files.map(({ path, sha256 }) => ({ path, sha256 })),
      ...(packet.diff ? { diffSha256: packet.diff.sha256 } : {}),
      validity: 'Applies to this captured snapshot, not subsequent edits or user corrections.',
    } }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({ error: error.message, automaticRetry: false })); process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
