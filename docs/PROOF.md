# What Astra Advisor can prove today

This is the public claim boundary for v0.1.0.

## Proven on the release environment

| Claim | Evidence |
|---|---|
| The standalone skill is installable from GitHub | Fresh `npx skills add PatrickSys/astra-advisor --skill astra-advisor --agent codex claude-code -y --copy` install succeeded for both hosts. |
| The runtime can see exact GPT-6 Astra | `doctor` on Codex 0.160.0 returned `gpt-6-astra` with advertised reasoning efforts. No inference is started by `doctor`. |
| The runtime refuses model substitution | Protocol tests reject provider/model fallback and mid-turn model rerouting. |
| Conversation intake preserves later structured decisions | Deterministic tests cover Claude structured answers and Codex `request_user_input` linkage. |
| It does not treat subagent prompts as human intent | Deterministic tests plus a real desktop history smoke fail closed on subagent-originated history. |
| The one-shot Astra path actually runs | The retained live v0.1.0 canary completed three real Astra calls. |

## The retained live canary

The full sanitized receipt is
[live-eval-pass-2026-10-03.json](evidence/live-eval-pass-2026-10-03.json).
The deterministic suite output is
[npm-test-2026-10-03.txt](evidence/npm-test-2026-10-03.txt).

| Case | Expected | Astra returned |
|---|---|---|
| Sound local plan that respects a no-publication boundary | supported | supported |
| Later structured answer says "No, keep this local", proposed artifact says publish now | revise | revise |
| Asked to conclude an auth fix is correct without code/tests | insufficient evidence | insufficient evidence |

The runtime receipt for those turns reports:

- requested/configured model: `gpt-6-astra`
- requested/configured effort: `low`
- ephemeral thread
- returned read-only sandbox with network disabled
- zero dynamic tools supplied
- zero observed tool/action items

The canary is synthetic by design. It proves the wiring can express the three
behaviors. It does **not** establish a general improvement in software quality.

## Why the intake mechanism is the interesting part

An advisor is only as useful as the question it receives. A normal executor can
brief a reviewer with its own summary of the task; that summary can omit a later
correction or turn a human boundary into an agent assumption.

Astra Advisor instead builds a bounded packet from recognized original conversation
records and explicitly selected evidence. Unknown formats, missing attachments,
ambiguous session identity and excessive history stay visible as gaps or failures.

That is the differentiator worth field-testing.

## Not proven

Do not publish these claims yet:

- "Astra Advisor makes Codex/Claude Code better."
- "It catches more bugs."
- "It saves tokens/money."
- "The advisor is independent."
- "It works on every Codex/Claude Code version or OS."
- "Native `$astra-advisor` / `/astra-advisor` dispatch is verified end-to-end in every host."

The release validation document is the source of truth:
[../docs/VALIDATION.md](../docs/VALIDATION.md).

## Field proof protocol

The next evidence should come from real decisions, not a bigger synthetic benchmark.

For a consequential plan/review:

1. Capture the main agent's proposed next action **before** consulting Astra.
2. Run Astra Advisor once.
3. Record the verdict and the decisive evidence it cited.
4. If it says `revise` or `insufficient evidence`, independently verify whether
   the objection was real.
5. Classify the outcome:
   - caught a real missed human constraint
   - caught a real missing-evidence problem
   - caught a real technical issue
   - agreed with a sound proposal
   - false objection / noise
   - unresolved

That produces the evidence needed for a future quality claim without grading the
advisor by whether it disagrees.
