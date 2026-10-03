# Astra Advisor

A small, explicit GPT-6 Astra peer-review skill for **Codex and Claude Code**.

The problem it targets is narrow: a coding agent can brief a reviewer with its own
summary of the task and omit a later correction, approval boundary, or missing piece
of evidence. Astra Advisor builds the review packet from the selected conversation
and explicitly selected artifacts instead.

## Install

```sh
npx skills add PatrickSys/astra-advisor
```

Then invoke it in the conversation you want reviewed:

```text
Codex:       $astra-advisor Is this ready, given what I actually requested?
Claude Code: /astra-advisor Check this approach against my requirements.
```

Requires Node.js 22+ and a signed-in Codex installation with access to
`gpt-6-astra`. Claude Code uses the same Codex/Astra access for the peer review.

## What happens

```text
current conversation + selected files/diff
                 |
                 v
      deterministic bounded packet
                 |
        +--------+--------+
        |                 |
      Codex           Claude Code
        |                 |
 native Astra child   Codex app-server
        |                 |
        +--------+--------+
                 |
          verified peer result
```

**Codex** prepares the packet locally, spawns one native subagent with
`model=gpt-6-astra`, `reasoning_effort=low`, and `fork_turns=none`, then
re-reads the persisted parent and child rollouts. The verifier rejects the result if
the spawn contract, lineage, model/effort, completion, or zero-tool-call condition
does not match.

**Claude Code** uses the bundled helper to create one fresh ephemeral Astra turn
through Codex app-server. The helper verifies the selected model and effort,
read-only/no-network sandbox, absence of dynamic tools, no reroute, and zero observed
action/tool items.

Both paths use the same transcript normalizer and peer-review contract.

## Conversation intake

The helper binds to an exact current or explicitly selected session. It does not pick
the newest or largest transcript.

It preserves:

- original user messages and later corrections;
- Claude `AskUserQuestion` and Codex `request_user_input` answers linked to their
  questions/options;
- preceding visible assistant context for short replies such as `B` or `yes`;
- repeated genuine user text as separate records.

It excludes hidden reasoning, arbitrary tool output, generated instruction envelopes,
and subagent history from human intent. Compaction/rewind records, images,
attachments, malformed records, unknown schemas, and unanswered structured questions
remain explicit coverage limitations.

Selected text files are hashed and bounded to 128 KiB each. The complete review
packet is capped at 256 KiB. Oversized evidence fails instead of silently dropping
human corrections.

## Peer semantics

Astra is a peer reviewer for the selected question. The current agent still owns
execution and integration.

- `supported`: no material objection from the peer; normal acceptance gates still apply.
- `revise`: revise the work or rebut the finding with primary evidence.
- `insufficient evidence`: gather the missing evidence or preserve the unresolved gap.
- unresolved material disagreement: surface both evidence-backed positions to the human.

Neither agent can override a human boundary.

## Verified on v0.1.1

Windows desktop; Codex 0.160.0; Claude Code 2.1.288; skills installer 1.7.0.

| Check | Result |
|---|---|
| Deterministic suite | 58/58 pass |
| Live Astra wiring canary | 3/3 expected verdicts |
| Native Codex `$astra-advisor` | passed |
| Claude Code `/astra-advisor` | passed |
| Copied skill outside checkout | passed |
| Exact Codex + Claude session binding | passed |

See [validation](docs/VALIDATION.md) and the sanitized
[Codex](docs/evidence/codex-host-v0.1.1.json) /
[Claude Code](docs/evidence/claude-host-v0.1.1.json) receipts.

## Limits

This release does **not** establish that Astra Advisor improves coding quality,
catches more bugs, saves money, or is independent in a statistical sense.

The material technical limits are:

- Codex native subagents inherit the parent turn's live sandbox choice. The verified
  release path ran the parent read-only, so the Astra child was effectively
  read-only too. A writable parent would weaken that capability boundary and must be
  reported as such.
- `fork_turns=none` excludes parent-turn history, but Codex still injects normal
  host/project context into the child.
- The current unpersisted prompt is supplied by the host with distinct provenance;
  the helper cannot independently attest that copy.
- Artifact selection is explicit and executor-assisted. Astra does not browse the
  whole live repository.
- Text intake does not recover image/attachment content.
- The tested version matrix is currently one Windows environment.

These are constraints to measure, not claims to hide.

## Development

```sh
npm test          # no inference
npm run doctor    # model catalog check; no inference
npm run eval:live # three paid synthetic Astra canaries
```

The runtime has no npm dependencies or build step. See
[design](docs/DESIGN.md), [research](docs/RESEARCH.md),
[proof boundary](docs/PROOF.md), and
[CONTRIBUTING.md](CONTRIBUTING.md).
