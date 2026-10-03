# Research that changed the implementation

Reviewed 2026-10-03. This is a source/decision ledger, not evidence of model quality.

## OpenAI coverage

- **Using GPT-6** — current GPT-6 substantive section read end to end, including
  behavior and migration guidance; previous-model appendix excluded.
  https://developers.openai.com/api/docs/guides/latest-model
- **Rethinking skills and prompts for GPT-6 Astra** — complete article read.
  https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra
- **Build skills** — complete substantive page read, including explicit invocation.
  https://learn.chatgpt.com/docs/build-skills
- **Subagents** — relevant model/effort, custom-agent and permission sections read.
  https://learn.chatgpt.com/docs/agent-configuration/subagents
- **App Server** — relevant lifecycle, history and model sections read; installed
  Codex 0.160.0 TypeScript schemas additionally generated and inspected. This is
  not a claim to have audited every endpoint or the entire Codex implementation.
  https://learn.chatgpt.com/docs/app-server
- **Prompt engineering** — task/instruction/data separation and evaluation sections
  consulted. The complete general-purpose guide was not independently certified
  end to end in this build; its many unrelated examples are not release requirements.
  https://developers.openai.com/api/docs/guides/prompt-engineering

Consequences: small caller skill, separate reviewer contract, clear completion
boundary, no routine manager loop. Codex explicit-only policy is enforced through
the skill manifest rather than prose alone. The Subagents guide recommends starting
Astra at low effort when setting it explicitly; xhigh was an earlier local baseline,
not evidence for a public default. Neither setting is proven optimal by this build.

## Actual advisor patterns, not lookalikes

**Claude Code Advisor:** full substantive page read. Native `/advisor` is a
server-side second opinion using supported Claude models (including Fable/Opus),
not a generic subagent. It receives the full executor conversation; the main
model chooses consultations and retains execution. The API core semantics and
best-practice sections were also read: the advisor has no tools/context management.
This project's Claude integration instead calls Astra through Codex. It does not
claim to be Anthropic's native advisor or silently substitute a Claude model.

https://code.claude.com/docs/en/advisor
https://platform.claude.com/docs/en/agents-and-tools/tool-use/advisor-tool

**Amp Oracle:** Tools, Dial and current Modes pages read; relevant models/subagents
sections read. Copy the selective second-opinion role, not mutable provider routing.
The reviewed public mode tables were not fully synchronized. No model ranking is
inferred from them.

https://ampcode.com/docs/tools
https://ampcode.com/docs/the-dial
https://ampcode.com/modes

**Aider Architect:** architect section and complete architect_coder.py read.
Proposal-to-editor handoff is useful role separation, but is not independent
verification: the editor implements the architect's output.

https://aider.chat/docs/usage/modes.html
https://github.com/Aider-AI/aider/blob/main/aider/coders/architect_coder.py

**Superpowers review:** requesting-code-review skill read completely; reviewer
template inspected for evidence requirements. Exact requirements/base/head scope
is useful. Its review schedule is not adopted as a mandatory paid Astra loop.

https://github.com/obra/superpowers/blob/main/skills/requesting-code-review/SKILL.md

## Packaging and host mechanics

Claude skill invocation/substitution sections and Vercel's installer interface
were consulted. Actual installer version 1.7.0 is used for the local copy smoke.

https://code.claude.com/docs/en/skills
https://github.com/vercel-labs/skills

## Claim boundary

No research citation establishes that this advisor is better or cheaper than
Claude Advisor, Amp Oracle, a single strong executor, or the prior local skill.
The testable claim is narrower: recover recognized original intent, provide a
bounded identified snapshot, make one explicitly requested Astra consultation,
and expose material limitations instead of disguising them as assurance.
