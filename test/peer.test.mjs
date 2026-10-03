import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { codexPeerSpec, renderPeerPrompt, verifyCodexPeer } from '../skills/astra-advisor/scripts/peer.mjs';

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-peer-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('peer prompt contains contract and bounded packet without adding evidence', () => {
  const prompt = renderPeerPrompt({ question: 'Ship?', conversation: { messages: [{ text: 'No.' }] } }, 'You are a peer reviewer.');
  assert.match(prompt, /You are a peer reviewer/);
  assert.match(prompt, /<review_packet>/);
  assert.match(prompt, /"question":"Ship\?"/);
  assert.match(prompt, /Do not run tools/);
});

test('Codex peer spec is one explicit Astra low-effort fresh-context spawn', () => {
  const spec = codexPeerSpec('peer prompt');
  assert.match(spec.taskName, /^astra_advisor_[a-f0-9]{12}$/);
  assert.equal(spec.model, 'gpt-6-astra');
  assert.equal(spec.reasoningEffort, 'low');
  assert.equal(spec.forkTurns, 'none');
  assert.equal(spec.prompt, 'peer prompt');
});

test('native Codex peer verifier binds spawn to child model, effort, lineage and zero tools', t => {
  const home = temporary(t);
  const sessions = path.join(home, 'sessions', '2026', '10', '03');
  fs.mkdirSync(sessions, { recursive: true });
  const parentId = 'parent-session-12345', childId = 'child-session-12345', taskName = 'astra_advisor_deadbeefcafe';
  fs.writeFileSync(path.join(sessions, `rollout-${parentId}.jsonl`), [
    JSON.stringify({ type: 'session_meta', payload: { id: parentId } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'spawn_agent', call_id: 'call-1', arguments: JSON.stringify({ task_name: taskName, model: 'gpt-6-astra', reasoning_effort: 'low', fork_turns: 'none' }) } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'SubAgentActivity', id: 'call-1', kind: 'started', agent_thread_id: childId } } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'SubAgentActivity', id: 'done', kind: 'completed', agent_thread_id: childId } } }),
  ].join('\n'));
  fs.writeFileSync(path.join(sessions, `rollout-${childId}.jsonl`), [
    JSON.stringify({ type: 'session_meta', payload: { id: childId, parent_thread_id: parentId, thread_source: 'subagent' } }),
    JSON.stringify({ type: 'turn_context', payload: {
      model: 'gpt-6-astra',
      effort: 'low',
      approval_policy: 'never',
      sandbox_policy: { type: 'read-only' },
      permission_profile: { network: 'restricted' },
    } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'VERDICT: revise' }] } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', last_agent_message: 'VERDICT: revise' } }),
  ].join('\n'));
  const result = verifyCodexPeer(parentId, taskName, { codexHome: home });
  assert.equal(result.report, 'VERDICT: revise');
  assert.equal(result.runtime.configuredModel, 'gpt-6-astra');
  assert.equal(result.runtime.observedToolCalls, 0);
  assert.equal(result.runtime.approvalPolicy, 'never');
  assert.equal(result.runtime.permissionProfile.network, 'restricted');
  assert.match(result.runtime.capabilityBoundary, /read-only.*network is restricted/);
});

test('native Codex peer verifier rejects wrong spawn contract and child tool calls', t => {
  const home = temporary(t);
  const sessions = path.join(home, 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  const parentId = 'parent-session-54321', childId = 'child-session-54321', taskName = 'astra_advisor_abcabcabcabc';
  const parent = (effort = 'low') => [
    JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'spawn_agent', call_id: 'call-2', arguments: JSON.stringify({ task_name: taskName, model: 'gpt-6-astra', reasoning_effort: effort, fork_turns: 'none' }) } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'SubAgentActivity', id: 'call-2', kind: 'started', agent_thread_id: childId } } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'SubAgentActivity', kind: 'completed', agent_thread_id: childId } } }),
  ].join('\n');
  fs.writeFileSync(path.join(sessions, `rollout-${parentId}.jsonl`), parent('medium'));
  assert.throws(() => verifyCodexPeer(parentId, taskName, { codexHome: home }), /must request/);
  fs.writeFileSync(path.join(sessions, `rollout-${parentId}.jsonl`), parent());
  fs.writeFileSync(path.join(sessions, `rollout-${childId}.jsonl`), [
    JSON.stringify({ type: 'session_meta', payload: { id: childId, parent_thread_id: parentId, thread_source: 'subagent' } }),
    JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-6-astra', effort: 'low' } }),
    JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 'bad', arguments: '{}' } }),
    JSON.stringify({ type: 'event_msg', payload: { type: 'task_complete', last_agent_message: 'bad' } }),
  ].join('\n'));
  assert.throws(() => verifyCodexPeer(parentId, taskName, { codexHome: home }), /attempted tool\/action/);
});
