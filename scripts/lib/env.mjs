// Minimal .env loader for tooling scripts (no dependency). Never logs secret values.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function loadEnv() {
  const file = path.join(ROOT, '.env');
  const out = { ...process.env };
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && out[m[1]] === undefined) out[m[1]] = m[2];
  }
  return out;
}

export function requireEnv(env, names) {
  const missing = names.filter((n) => !env[n]);
  if (missing.length) {
    console.error(`Missing required environment variables: ${missing.join(', ')}. See .env.example.`);
    process.exit(1);
  }
}
