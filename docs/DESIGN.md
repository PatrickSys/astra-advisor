# Architecture

## Contract

Explicit `$astra-advisor` in Codex or `/astra-advisor` in Claude Code creates one
peer-review question.

The human objective and constraints are authoritative. The executor owns mutations
and integration. Astra owns its peer finding. A material disagreement is resolved
with evidence or surfaced to the human; the executor does not silently grade away the
review.

## Shared intake

`scripts/intake.mjs` is the common boundary.

The current request is supplied distinctly from persisted history. Historical intent
comes from one exact session or explicitly supplied transcript. The normalizer
recognizes user text, assistant context needed for short answers, and linked
structured decisions. Unsupported or uncertain history remains a coverage gap.

Sources are snapshotted with hashes. A source that changes during read fails. Limits:

- transcript source: 32 MiB;
- selected artifact: 128 KiB;
- final peer packet: 256 KiB.

Artifact paths must remain inside the selected repository after symlink resolution.
Likely credential filenames are refused. This is a guard, not a secret scanner.

## Codex transport

The Codex host path deliberately uses Codex's native collaboration runtime.

1. Resolve the current rollout by exact `CODEX_THREAD_ID` filename. No recency
   heuristic or model call is used for intake.
2. Build a peer prompt containing the reviewer contract and bounded packet.
3. Spawn exactly one native child:
   - `model = gpt-6-astra`
   - `reasoning_effort = low`
   - `fork_turns = none`
4. Wait for completion.
5. Re-open the exact parent rollout, bind the unique task name to its
   `SubAgentActivity` child thread, then open that exact child rollout.
6. Accept the result only when lineage, requested/configured model, effort,
   completion, and zero function/tool calls match.

Why native delegation: a real Codex host test showed that Node→Codex and nested
`codex exec` process paths can be denied by the parent Codex sandbox. Native
subagents are the supported in-harness execution mechanism.

### Codex permission boundary

Codex reapplies the parent turn's live permission/sandbox choice to subagents.
Therefore a custom child default cannot honestly guarantee read-only when the parent
turn is workspace-write. The verifier records the effective child sandbox.

The v0.1.1 release acceptance ran the parent read-only. The persisted child
`turn_context` also reported read-only, and the verifier observed zero tool/action
items. A writable parent would weaken this boundary and is reported rather than
accepted as equivalent.

`fork_turns=none` prevents parent-turn conversation inheritance. Normal Codex
system/developer/project context is still injected into the child and is recorded as
a context-boundary limitation.

## Claude Code transport

Claude Code cannot natively spawn an OpenAI model, so its path uses the bundled
Codex app-server bridge.

1. Resolve the exact Claude session ID/transcript.
2. Build the same bounded packet.
3. Start a fresh ephemeral Codex app-server thread with exact Astra/low.
4. Require the returned effective sandbox to be read-only and network-disabled
   before inference.
5. Supply no dynamic tools.
6. Reject provider/model fallback, unsupported effort, reroutes, runtime retry
   requests, non-ephemeral execution, and any observed action/tool item.
7. Return the completed peer report plus packet/runtime receipt.

The Claude host itself needs permission to create a temporary question file and run
the local Node helper. That is host orchestration permission; the Astra peer remains
inside the separately verified read-only app-server sandbox.

## Why two host transports

The host runtimes have different extension models. Forcing one subprocess topology
onto both made Codex less reliable. The shared product boundary is the evidence
packet and peer contract; the transport is host-specific.

There is no daemon, database, memory service, automatic polling, recursive reviewer,
or mandatory workflow framework.

## Peer result

The three verdicts are:

- `supported`
- `revise`
- `insufficient evidence`

A verdict is bound to the captured conversation/artifact state. Later corrections or
artifact changes can invalidate it.
