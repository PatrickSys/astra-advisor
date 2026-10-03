import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cases } from '../scripts/evaluate.mjs';

test('live evaluation is opt-in; default command only lists three synthetic cases', () => {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/evaluate.mjs', import.meta.url))], {
    encoding: 'utf8', windowsHide: true, timeout: 5000,
    env: { ...process.env, CODEX_CLI_PATH: '/nonexistent/no-inference-executable' },
  });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /No inference started/);
  assert.match(child.stdout, /npm run eval:live/);
});

test('evaluation tests acceptance, real linked veto and missing evidence—not agreement alone', () => {
  assert.deepEqual(cases.map(c => c.expected), ['supported', 'revise', 'insufficient evidence']);
  const veto = cases[1].packet.conversation.messages.find(m => m.kind === 'structured-decision');
  assert.match(veto.answer, /No, keep this local/);
  assert.equal(veto.questions[0].question, 'Publish now?');
  assert.equal(cases[2].packet.files.length, 0);
});
