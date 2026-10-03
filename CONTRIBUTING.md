# Contributing

Keep this project small.

## Local checks

```sh
npm test
npm run doctor
```

`npm test` and `doctor` do not run model inference.

`npm run eval:live` makes up to three real Astra calls and is intentionally
separate.

## Change rules

- Preserve exact-session binding. Do not add "latest transcript" fallback logic.
- Preserve explicit coverage gaps. Do not convert unknown records into empty/success.
- Keep transcript parsing deterministic; models interpret the resulting packet.
- Keep Codex and Claude transports separate when their runtimes require it.
- Do not silently widen sandbox/network permissions or substitute another model.
- Do not add automatic paid retries or recurring reviews.
- A new quality/cost claim needs measured field evidence, including false objections.

Host compatibility changes should include the exact host version and a sanitized
receipt under `docs/evidence/`.

