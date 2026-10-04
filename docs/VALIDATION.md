# Validation — v0.1.1

Validated 2026-10-03 on:

- Windows 10.0.26200
- Node.js 24.14.1
- Codex CLI/app-server 0.160.0
- Claude Code 2.1.288
- skills installer 1.7.0

Node 22+ is the intended minimum. macOS/Linux and other host versions are not yet a
tested matrix.

## Deterministic

The current suite passes **58/58** with no model inference. Coverage includes:

- later vetoes and repeated user text;
- Claude `AskUserQuestion` and Codex `request_user_input` linkage;
- short-answer context;
- generated envelopes, sidechains and Codex subagent provenance;
- malformed/unknown records, identity mismatch, size bounds and changed sources;
- copied-skill dependency closure;
- exact Codex/Claude session lookup without recency guessing;
- native Codex peer spawn/child verification fixtures;
- model fallback/reroute, sandbox/network widening, tool/action attempts, retry and
  timeout failure paths for the app-server bridge.

## Live Astra canary

`npm run eval:live` retains three synthetic one-shot consultations:

| Case | Expected | Observed |
|---|---|---|
| sound local plan | `supported` | `supported` |
| later human veto conflicts with artifact | `revise` | `revise` |
| correctness requested without implementation/tests | `insufficient evidence` | `insufficient evidence` |

This is a wiring canary, not a quality benchmark.

## Codex host flow

An installed project-scoped copy was exercised from a real Codex 0.160.0
**read-only** session. The smoke prompt explicitly asked Codex to use Astra Advisor,
and the full downstream skill flow completed, but the Windows test harness passed
through PowerShell and expanded the literal `$astra-advisor` token before Codex saw
the prompt. Therefore this receipt proves the installed-skill host flow, not literal
`$astra-advisor` token dispatch.

Observed chain:

1. Codex loaded the installed `SKILL.md`.
2. The bundled helper resolved the exact current rollout and prepared the packet.
3. Codex spawned one child with the generated task name, explicit
   `gpt-6-astra`, low effort and `fork_turns=none`.
4. The child returned `revise`.
5. `verify-codex` bound the parent spawn to the exact child rollout and confirmed
   configured Astra/low, correct lineage, completion and zero child function calls.

The child inherited the parent's read-only sandbox. The persisted child
`turn_context` reported read-only and the verifier observed zero tool/action calls.
This matches Codex's documented behavior that the parent's live sandbox choice is
reapplied to children.

Sanitized receipt: [codex-host-v0.1.1.json](evidence/codex-host-v0.1.1.json).

One clean shell-escaped literal `$astra-advisor` invocation receipt remains an open
compatibility check. Do not represent it as already proven.

## Claude Code host

An installed project-scoped copy was invoked with `/astra-advisor` from Claude Code
2.1.288. The updated host path ran the bundled `review` bridge and returned
`revise`.

The Astra runtime receipt reported:

- requested/configured `gpt-6-astra`;
- low effort;
- ephemeral thread;
- effective read-only sandbox;
- network disabled;
- zero dynamic tools;
- zero observed action/tool items.

The host process requires local shell/file permission to prepare the question and
invoke the helper. A separate `dontAsk` test correctly stopped when those host
permissions were denied.

Sanitized receipt: [claude-host-v0.1.1.json](evidence/claude-host-v0.1.1.json).

## Integration failures that changed the design

Real host tests found three issues that synthetic tests did not:

1. Windows held the disposable app-server working directory briefly after shutdown;
   cleanup was made non-fatal after a valid review.
2. Ephemeral Codex threads reject `thread/read(includeTurns)`; completed-turn
   notifications are now the one-shot runtime evidence.
3. Node→Codex and nested `codex exec` execution can be denied inside a normal Codex
   sandbox. Codex therefore uses native subagent delegation while Claude Code keeps
   the external app-server bridge.

## Still unproven

- general coding-quality improvement;
- bug-catch-rate improvement;
- cost/token savings;
- cross-platform/version compatibility;
- complete multimodal human-intent recovery;
- independent serving-model attestation beyond Codex runtime/model records;
- enforced read-only capability for a Codex child when the parent turn itself is
  writable; use a read-only parent for the verified capability boundary.
