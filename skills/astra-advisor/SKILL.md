---
name: astra-advisor
description: Get a source-grounded GPT-6 Astra peer review when the user explicitly asks for Astra advice or invokes this skill. The current agent remains the execution owner, not the sole judge of the review.
disable-model-invocation: true
---

# Astra Advisor

Use only on explicit request. One question, one Astra peer review. The executor owns
execution, not whether a material peer finding counts. Do not enable Claude's native
`/advisor` or change the user's model/configuration.

## Run

1. Preserve the user's request/corrections separately from executor claims. Label any
   narrower review wording; never replace or weaken the human objective.
2. Resolve the helper relative to this installed `SKILL.md`, not the repository.
   Claude supplies `${CLAUDE_SKILL_DIR}` and `${CLAUDE_SESSION_ID}` as host
   substitutions, not assumed shell variables.
3. Choose the host path below.

### Codex

Prepare the bounded peer prompt without inference:

   ```text
   node <skill-directory>/scripts/advisor.mjs prepare --file <relevant-repository-file>
   ```

The helper uses exact `CODEX_THREAD_ID`, recovers the persisted current request,
and returns `codexPeer.prompt`. If current input is not persisted, pass
`--question-file`. Use exact `--transcript` for a selected saved conversation.
Never guess by recency. Add `--diff` or repeat `--file` for evidence.

Spawn **exactly one native Codex subagent** with:

- `task_name = codexPeer.taskName`
- `model = gpt-6-astra`
- `reasoning_effort = low`
- `fork_turns = none`
- `message = codexPeer.prompt` exactly

Wait; do not create nested `codex exec`. Validate the persisted child:

   ```text
   node <skill-directory>/scripts/advisor.mjs verify-codex --task-name <codexPeer.taskName>
   ```

The verifier checks exact child lineage, Astra/low, `fork_turns=none`, completion,
zero child function calls, and the effective sandbox. Codex reapplies the parent's
live sandbox choice; report it honestly.

### Claude Code

Write the current request verbatim plus labelled review wording to a temporary UTF-8
file; Claude persistence can lag current input. Then run:

```text
node <skill-directory>/scripts/advisor.mjs review --host claude --session <resolved-Claude-session-id> --question-file <temporary-file> --file <relevant-repository-file>
```

The bridge verifies Astra/low, ephemeral read-only/no-network execution, no dynamic
tools, no reroute, and zero observed action/tool items.

4. Return the verified verdict, material evidence/limits, and smallest next step.
   Resolve `revise`/`insufficient evidence` by changing work, gathering evidence,
   or an evidence-backed rebuttal. Surface unresolved material disagreement to the
   human. Never silently overrule the peer review. Never waive required tests or a
   human veto.

The helper supplies a bounded snapshot, not live-repository inspection. Keep
attachments, unsupported history and ambiguous identities as explicit limitations.

If the helper fails, report its concrete diagnostic. Do not silently substitute
your own opinion, another model, a broader permission mode, or a paid retry.
`doctor` and `extract` use no inference.

No automatic review loop, recursive advisor, background process, publication,
global installation change, whole-history audit, or unrelated source collection.
Consult again only on a new explicit request after materially changed evidence.
