import fs from 'node:fs';
import path from 'node:path';

/** Resolve the native executable without evaluating a shell or an npm shim. */
export function resolveCodex(env = process.env, platform = process.platform) {
  if (env.CODEX_CLI_PATH) {
    if (!path.isAbsolute(env.CODEX_CLI_PATH) || !fs.statSync(env.CODEX_CLI_PATH).isFile()) {
      throw new Error('CODEX_CLI_PATH must name an existing absolute executable path.');
    }
    return env.CODEX_CLI_PATH;
  }
  for (const dir of (env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const candidates = platform === 'win32' ? [
      path.join(dir, 'codex.exe'),
      path.join(dir, 'node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'),
      path.join(dir, 'node_modules/@openai/codex/node_modules/@openai/codex-win32-arm64/vendor/aarch64-pc-windows-msvc/bin/codex.exe'),
    ] : [path.join(dir, 'codex')];
    for (const candidate of candidates) {
      try { if (fs.statSync(candidate).isFile()) return candidate; } catch { /* Next candidate. */ }
    }
  }
  throw new Error('Codex executable not found. Install Codex, or set CODEX_CLI_PATH to its native executable.');
}
