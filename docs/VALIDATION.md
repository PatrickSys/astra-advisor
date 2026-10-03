# Validation receipt — 2026-10-03

**Experimental local build. Not published. Actual model behavior and native host
invocation are not yet verified.** This document distinguishes tests from claims.

## Environment observed

Windows desktop; Node.js 24.14.1; Codex CLI/app-server 0.160.0; Claude Code 2.1.288;
skills installer 1.7.0. Node 22+ is the intended minimum, not a tested version matrix.
No macOS/Linux or other Codex/Claude versions were exercised.

## Completed checks

- The final deterministic intake, packaging, evaluation-opt-in and protocol suites
  passed: **50 tests, zero failures or skips**. No suite runs inference.
- The real skills 1.7.0 installer discovered one skill and installed project-scoped
  copies for both Codex and Claude Code in a disposable directory. No personal
  installation or global configuration was changed.
- The final installed skill's files matched their source hashes (zero mismatches).
  Its copied `doctor` ran successfully outside the source checkout with zero inference.
- A copy of only the skill executed `extract` outside the source checkout, with
  synthetic input, paths containing spaces and an isolated Codex home. Runtime
  imports stay within the copied skill. This is not a native host invocation test.
- Real `doctor` initialized Codex 0.160.0 and read its model catalog without a model
  turn. Exact `gpt-6-astra` is advertised with low/medium/high/xhigh/max/ultra. The
  catalog default is medium; this advisor deliberately requests low.
- A targeted existing desktop Codex conversation was read through its runtime-
  returned exact source. The 23,748,117-byte source yielded 50 recognized message
  records and six linked structured decisions. These are not 50 independently
  authenticated human messages: transport representations may repeat. Compaction
  and generated-envelope limits were retained. No raw private conversation was
  exported or committed into this repository.

## Review and correction loop

Two maximum-effort ChatGPT workers researched/reviewed the design; one implemented
the isolated runtime module. Primary and independent review produced concrete fixes:

1. Claude sidechain messages no longer masquerade as human intent or overwrite
   the main conversation's short-answer context. Codex subagent prompts are refused.
2. Windows namespaced paths returned by Codex use native realpath resolution. This
   was caught by the real desktop-history check, not only synthetic tests.
3. Requested effort is explicitly set before checking the configured response.
   Provider/model/effort, ephemeral state and effective sandbox restrictions are
   checked before a model turn; wider settings are not silently accepted.
4. A mid-turn `model/rerouted` event invalidates the result. Allowed item types are
   explicitly enumerated, so legacy/new collaboration names and unknown action
   types cannot evade an incomplete denylist.
5. Reported settings distinguish requested tool restrictions from observed runtime
   metadata. Filesystem read-only is not a claim that all connected tools are safe.

Regressions also cover later vetoes, structured question linkage, repeated text,
missing attachments, malformed records, ambiguous identities, bounds, copied skill
execution, provider fallback, missing model, unsupported effort, authentication
failure, timeout/interrupt, retry refusal and runtime notification ordering.

## Not completed—and why

The tool execution layer blocked the requested Codex implementation worker launch.
Implementation proceeded directly with the two ChatGPT workers; no Codex executor
or Luna subagents ran. Later, it also blocked the command requesting live synthetic
Astra evaluation before execution. That was not retried through another route.

**New live Astra model calls in this build: zero.** Mock protocol tests and a real
model catalog do not prove successful inference, actual permission enforcement,
correct advisory judgments or host-to-helper execution.

Actual `$astra-advisor` expansion/execution inside Codex and `/astra-advisor`
execution inside Claude Code remain unverified. Installed files and a successful
standalone `extract` do not close those gates. The runtime also has no independently
attested backend model identity or proof that zero tools were exposed server-side;
recorded tool attempts invalidate the review but are not prevention of every side effect.

## Smallest remaining acceptance step

Run `npm run eval:live` locally when execution is permitted. It makes at most three
synthetic consultations (support, linked veto, insufficient evidence), stops on a
runtime failure and saves a new receipt without overwriting prior results. Inspect
the evidence cited, not just the expected verdict string. Then invoke the installed
skill once from each host, verifying exact conversation binding and runtime metadata.

Do not publish a stable-compatibility, accuracy-improvement or cost-saving claim
until those real results exist. The synthetic cases are wiring canaries, not a
comparative benchmark. Existing personal Astra skill/native-agent settings are unchanged.
