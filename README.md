# Astra Advisor

An explicit GPT-6 Astra second opinion for **Codex and Claude Code**.
Your current agent stays in charge. Astra checks the decision against original
user requests, later corrections, linked answers and relevant file snapshots.

**Status: experimental local build. Not published.** Validation status is recorded
in [docs/VALIDATION.md](docs/VALIDATION.md), including what has not been tested.

## Install and use

From this checkout:

```sh
npx skills add .
```

Choose Codex or Claude Code and the desired scope in the installer. After this
repository is published, the equivalent public command will be:

```sh
npx skills add PatrickSys/astra-advisor
```

Then ask in your existing conversation:

```text
Codex:       $astra-advisor Is this ready, given what I actually requested?
Claude Code: /astra-advisor Check this approach before we commit to it.
```

The agent handles session identity and evidence selection. No JSON packet to
prepare, global native-agent configuration to edit, or service to start.

**Requires:** Node.js 22+ and a signed-in Codex installation with Astra access,
even when used from Claude Code. This is not Claude's native Fable/Opus advisor.
Evidence is sent through the Codex model provider using your existing account.

## What it does—and does not do

Explicit by default in both host manifests. One bounded consultation, no automatic
paid retries or recursive reviewers. Advice is not approval to ignore a human veto.

The helper reads one identified conversation and explicitly selected text files or
tracked diff. Structured answers retain their questions. Source hashes and line
pointers make the packet inspectable. Unknown formats, attachments and incomplete
history stay visible limitations; oversized inputs are not silently shortened.

Astra reads a **snapshot**, not the live repository. This does not prove complete
human-intent recovery, independent tool inspection, security, or benchmark superiority.
The caller must avoid secrets and unrelated data. Provider/runtime retention applies.

## Develop

```sh
npm test
npm run doctor
```

Tests and `doctor` do not run model inference. The agent-facing helper also has
an `extract` command for inspecting the exact packet without a model call.

The remaining live check is deliberately separate:

```sh
npm run eval:live
```

This starts up to three synthetic Astra consultations using your account. It
keeps every result, including failures, in a new `.local/eval-*.json` receipt.
It is never part of `npm test`. Passing these canaries would not establish broad
accuracy or replace testing an actual skill invocation in each host.

See [design](docs/DESIGN.md), [research coverage](docs/RESEARCH.md) and
[validation](docs/VALIDATION.md). Runtime code lives entirely inside the installed
skill; there are no npm runtime dependencies or build steps.
