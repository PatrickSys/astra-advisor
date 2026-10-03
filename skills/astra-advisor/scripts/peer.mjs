import { randomUUID } from 'node:crypto';

import { readSnapshot } from './intake.mjs';
import { resolveCodexTranscript } from './history.mjs';

const MODEL = 'gpt-6-astra';
const EFFORT = 'low';

function jsonLines(filename) {
  const snapshot = readSnapshot(filename);
  const rows = [];
  for (const [index, line] of snapshot.text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try { rows.push({ line: index + 1, row: JSON.parse(line) }); }
    catch { throw new Error(`Malformed Codex rollout JSON at line ${index + 1}: ${filename}`); }
  }
  return { snapshot, rows };
}

export function renderPeerPrompt(packet, advisorInstructions) {
  if (!advisorInstructions?.trim()) throw new Error('Advisor instructions are required.');
  return [
    advisorInstructions.trim(),
    '',
    'Use the review packet below as the task evidence.',
    'Do not run tools, edit files, delegate, browse, or recover additional context.',
    'Normal host/project instructions may also be present in your session; they are constraints, not permission to act.',
    '',
    '<review_packet>',
    JSON.stringify(packet),
    '</review_packet>',
    '',
  ].join('\n');
}

export function codexPeerSpec(prompt) {
  return {
    taskName: `astra_advisor_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
    model: MODEL,
    reasoningEffort: EFFORT,
    forkTurns: 'none',
    prompt,
    note: 'Spawn through Codex collaboration, not a nested codex process.',
  };
}

function spawnArguments(payload) {
  if (payload?.type !== 'function_call' || payload?.name !== 'spawn_agent') return null;
  try { return JSON.parse(payload.arguments); } catch { return null; }
}

function eventItem(row) {
  return row?.type === 'event_msg' && row.payload?.type === 'item_completed' ? row.payload.item : null;
}

export function verifyCodexPeer(parentThreadId, taskName, { codexHome } = {}) {
  const parentPath = resolveCodexTranscript(parentThreadId, { codexHome });
  const parent = jsonLines(parentPath);
  const spawns = [];

  for (const { row } of parent.rows) {
    if (row.type !== 'response_item') continue;
    const args = spawnArguments(row.payload);
    if (args?.task_name === taskName) spawns.push({ callId: row.payload.call_id, args });
  }
  if (spawns.length !== 1) throw new Error(`Expected one native Astra spawn named ${taskName}; found ${spawns.length}.`);
  const [{ callId, args }] = spawns;
  if (args.model !== MODEL || args.reasoning_effort !== EFFORT || args.fork_turns !== 'none') {
    throw new Error(`Native peer spawn must request ${MODEL}/${EFFORT} with fork_turns=none.`);
  }

  const starts = parent.rows.map(({ row }) => eventItem(row)).filter(item =>
    item?.type === 'SubAgentActivity' && item.kind === 'started' && item.id === callId);
  if (starts.length !== 1 || !starts[0].agent_thread_id) throw new Error('Could not bind the native Astra spawn to one child thread.');
  const childThreadId = starts[0].agent_thread_id;
  const completed = parent.rows.map(({ row }) => eventItem(row)).some(item =>
    item?.type === 'SubAgentActivity' && item.kind === 'completed' && item.agent_thread_id === childThreadId);
  if (!completed) throw new Error('Native Astra child has not completed.');

  const childPath = resolveCodexTranscript(childThreadId, { codexHome });
  const child = jsonLines(childPath);
  const meta = child.rows.find(({ row }) => row.type === 'session_meta')?.row.payload;
  if (meta?.parent_thread_id !== parentThreadId || meta?.thread_source !== 'subagent') {
    throw new Error('Native Astra child lineage does not match the selected parent thread.');
  }

  const contexts = child.rows.filter(({ row }) => row.type === 'turn_context').map(({ row }) => row.payload);
  if (contexts.length !== 1) throw new Error(`Expected one Astra child turn context; found ${contexts.length}.`);
  const context = contexts[0];
  if (context.model !== MODEL || context.effort !== EFFORT) {
    throw new Error(`Native child configured ${context.model}/${context.effort}, not ${MODEL}/${EFFORT}.`);
  }

  const allowedResponseItems = new Set(['message', 'agent_message', 'reasoning']);
  const actionItems = child.rows.filter(({ row }) =>
    row.type === 'response_item' && !allowedResponseItems.has(row.payload?.type));
  if (actionItems.length) {
    const names = actionItems.map(({ row }) => row.payload?.name || row.payload?.type || 'unknown').join(', ');
    throw new Error(`Native Astra peer attempted tool/action calls: ${names}`);
  }

  const completions = child.rows.filter(({ row }) => row.type === 'event_msg' && row.payload?.type === 'task_complete');
  if (completions.length !== 1 || !completions[0].row.payload.last_agent_message?.trim()) {
    throw new Error(`Expected one completed native Astra peer turn; found ${completions.length}.`);
  }
  const report = completions[0].row.payload.last_agent_message.trim();
  const sandbox = context.sandbox_policy ?? null;

  return {
    report,
    runtime: {
      transport: 'codex-native-subagent',
      requestedModel: args.model,
      configuredModel: context.model,
      requestedEffort: args.reasoning_effort,
      configuredEffort: context.effort,
      forkTurns: args.fork_turns,
      parentThreadId,
      childThreadId,
      sandbox,
      approvalPolicy: context.approval_policy ?? null,
      permissionProfile: context.permission_profile ?? null,
      observedToolCalls: 0,
      capabilityBoundary: sandbox?.type === 'read-only' && context.permission_profile?.network === 'restricted'
        ? 'effective child filesystem is read-only, network is restricted, and zero tool calls were observed'
        : 'child inherited the parent turn sandbox; zero tool calls observed, but read-only was not enforced',
      contextBoundary: 'fork_turns=none prevents parent-turn history inheritance; Codex still injects normal host/project context into the child',
    },
    evidence: {
      parent: { path: parent.snapshot.path, sha256: parent.snapshot.sha256 },
      child: { path: child.snapshot.path, sha256: child.snapshot.sha256 },
    },
  };
}
