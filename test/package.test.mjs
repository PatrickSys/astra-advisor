import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const skill = path.join(root, 'skills', 'astra-advisor');

test('both hosts opt out of implicit invocation and skill stays small', () => {
  const text = fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8');
  assert.match(text, /disable-model-invocation: true/);
  assert.match(fs.readFileSync(path.join(skill, 'agents', 'openai.yaml'), 'utf8'), /allow_implicit_invocation: false/);
  assert.ok(text.split('\n').length < 100);
});

test('copy of only the skill executes outside checkout with no repository imports', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'astra-copy-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const installed = path.join(temp, 'installed skill'); fs.cpSync(skill, installed, { recursive: true });
  const question = path.join(temp, 'question.txt'), transcript = path.join(temp, 'transcript.jsonl');
  fs.writeFileSync(question, 'Is publication authorized?');
  fs.writeFileSync(transcript, JSON.stringify({ type: 'user', message: { content: 'No publication.' } }));
  const child = spawnSync(process.execPath, [path.join(installed, 'scripts', 'advisor.mjs'), 'extract', '--host', 'claude', '--transcript', transcript, '--question-file', question], {
    cwd: temp, encoding: 'utf8', windowsHide: true, timeout: 15_000,
    env: { ...process.env, CODEX_HOME: path.join(temp, 'empty-codex'), CODEX_THREAD_ID: '', NODE_PATH: '' },
  });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout).conversation.messages[0].text, 'No publication.');
  const scripts = fs.readdirSync(path.join(installed, 'scripts')).filter(f => f.endsWith('.mjs'));
  for (const file of scripts) {
    const text = fs.readFileSync(path.join(installed, 'scripts', file), 'utf8');
    assert.doesNotMatch(text, /(?:from\s+|import\s*\()['"]\.\.\/\.\.\/\.\./, file);
    assert.doesNotMatch(text, /[A-Z]:[\\/]+Users[\\/]+|\/repos\/ideaspine/, file);
  }
});
