---
name: astra-advisor
description: Get a source-grounded GPT-6 Astra second opinion when the user explicitly asks for Astra advice or invokes this skill. The current agent remains the executor.
disable-model-invocation: true
---

# Astra Advisor

Use only on explicit request. One question, one Astra consultation, then return
control to the executor. Do not enable Claude's native `/advisor` or change the
user's model/configuration. This skill uses the installed Codex runtime from either host.

## Run

1. Identify the concrete decision and relevant primary files or tracked diff.
   Keep original requests/corrections separate from your proposed answer.
   Write the user's current request verbatim plus the specific review question
   into a temporary UTF-8 file outside the repository. Label any wording you add.
2. Resolve the helper relative to this installed `SKILL.md`, not the repository.
   In Claude Code, the skill directory is `${CLAUDE_SKILL_DIR}` and this session
   is `${CLAUDE_SESSION_ID}`. These are host substitutions, not assumed shell variables.
3. Invoke the bundled helper once, with safely quoted path arguments:

   ```text
   node <skill-directory>/scripts/advisor.mjs review --question-file <temporary-file> --file <relevant-repository-file>
   ```

   Codex: the helper uses `CODEX_THREAD_ID`; otherwise supply the actual `--session`.
   Claude: add `--host claude --session <resolved-Claude-session-id>`.
   For a specifically selected saved conversation, use `--transcript <exact-JSONL>`
   with its `--host`. Never choose the newest/largest log or ask the user to
   assemble a JSON packet. Add `--diff` for tracked changes against HEAD, or
   repeat `--file` for relevant artifacts (including untracked files).
4. Return the recommendation, the material evidence/limits, and the smallest
   next step. Treat the result as advice, not approval authority. Check material
   findings before applying them; do not waive required tests or a human veto.

The helper reads original persisted messages and linked structured answers.
Current unpersisted input stays distinctly labelled. It supplies a bounded text
snapshot; Astra does not independently inspect the live repository. Attachments,
unsupported history and ambiguous identities must stay explicit limitations.

If the helper fails, report its concrete diagnostic. Do not silently substitute
your own opinion, another model, a broader permission mode, or a paid retry.
`doctor` diagnoses the runtime without inference; `extract` shows the exact packet
without inference. They do not prove that an advisory model call will succeed.

No automatic review loop, recursive advisor, background process, publication,
global installation change, whole-history audit, or unrelated source collection.
Consult again only on a new explicit request after materially changed evidence.
