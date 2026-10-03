# Design and acceptance contract

Status: experimental implementation; live compatibility remains a separate gate.
This file records the intended contract, not test results.

## Outcome

Explicit `$astra-advisor` in Codex or `/astra-advisor` in Claude Code creates a
peer-review relationship for one source-grounded question. Astra owns the independent
review; the existing agent owns execution and integration. Neither role outranks the
human objective or human constraints, and the executor is not the arbiter of whether
the peer finding "counts".

One copied skill contains its entire runtime. It requires no native-agent installation,
workflow framework, daemon, database, npm service, or automatic consultation policy.
The repository is a peer utility, not part of a workflow framework. A workflow
can consume it without taking ownership of its model-specific implementation.

## Boundaries

The explicit invocation supplies the decision to review. The host may identify
relevant artifacts and add a narrower labelled question, but it must preserve the
verbatim human request rather than replace it with executor framing. The helper
recovers one exact conversation and reads explicit local evidence. Astra receives a
bounded text snapshot: this is original-intent intake, not an independently browsing
agent. The snapshot and source hashes make selection and limitations inspectable.

Codex history uses a read-only app-server client: only initialize, thread/read,
thread/items/list. No resume/start/turn commands. An exact rollout path returned
by the runtime is preferred because some API views omit structured decisions.
Claude resolves an exact session filename among project directories; no content
search or recency heuristics. An explicit transcript works without discovery.

Recognized structured answers retain linked questions/options. Visible assistant
context accompanies short replies. Reasoning, arbitrary tool output and known
generated envelopes are not promoted to human requests. Repeated user text is
not deduplicated; Codex transport representations may repeat and are labelled.
This is not authenticated authorship, branch reconstruction, complete attachment
recovery, or proof that every human decision is represented.

No silent truncation: source reads are limited to 32 MiB, each artifact to 128 KiB,
and the final packet to 256 KiB. Changed sources, ambiguous identities, credential
filenames, binary artifacts and evidence escaping the selected root fail clearly.
The credential filename check is a guard, not a comprehensive secret scanner.

Peer semantics:

- `supported`: the reviewed question has no material objection from Astra; other
  acceptance gates still apply.
- `revise`: the executor must revise or rebut the finding with primary evidence.
- `insufficient evidence`: gather the missing evidence or surface the unresolved
  gap; do not convert absence of evidence into approval.
- unresolved material disagreement: surface both evidence-backed positions to the
  human. No silent executor override and no automatic majority vote.

## Build plan

1. Fix the source-boundary problem first: structured veto, source identity, honest coverage.
2. Package one helper and concise caller/reviewer contracts with explicit host policies.
3. Test copied installation and deterministic failure cases before model calls.
4. Independently review the code, correct concrete defects, rerun focused regressions.
5. Run bounded synthetic live cases when execution is permitted; retain failures.

## Release gates

- The actual skills installer discovers one skill and copies it for both hosts.
- Copied execution works outside the checkout; no private paths or missing imports.
- Deterministic tests cover later veto, structured answer, short-reply context,
  generated envelopes, malformed records, limits, ambiguity and model failures.
- Runtime/model selection, safety controls and observed tool behavior are recorded,
  not inferred from the advisor's own prose.
- Real supported/revise/insufficient cases have retained results. A small canary
  suite is evidence of wiring and specific behaviors, not general superiority.
- Each claimed host has an actual invocation receipt, or is labelled unverified.

See RESEARCH.md for the source review and VALIDATION.md for actual results.
