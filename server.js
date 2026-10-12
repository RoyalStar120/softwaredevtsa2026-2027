#!/usr/bin/env node
/**
 * Convenience entry point so `node server.js` works from the project root.
 * Equivalent to `npm start`, with friendly checks for a first-time setup:
 *   - Node version (built-in TypeScript type stripping needs >= 22.18)
 *   - dependencies installed (`npm install`)
 *   - optional .env file (GEMINI_API_KEY / OPENAI_API_KEY, PORT, ...)
 *   - builds the React client once if dist/ is missing
 */
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const fail = (msg) => {
  console.error(`\n${msg}\n`);
  process.exit(1);
};

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  fail(`SkillBridge needs Node.js 22.18 or newer (you have ${process.versions.node}).\nInstall the current LTS from https://nodejs.org and try again.`);
}

if (!existsSync(join(ROOT, 'node_modules', 'express'))) {
  fail('Dependencies are not installed yet. Run:\n\n  npm install\n\nthen start again with `node server.js` (or `npm start`).');
}

// Same effect as `node --disable-warning=ExperimentalWarning` (type stripping, node:sqlite).
const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type;
  if (type === 'ExperimentalWarning') return;
  return emitWarning.call(process, warning, ...rest);
};

// Same effect as `--env-file-if-exists=.env`.
const envFile = join(ROOT, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Build the client once if needed, so http://localhost:3000 serves the app.
if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
  console.log('No client build found (dist/). Building it once with Vite...');
  const vite = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
  const r = spawnSync(process.execPath, [vite, 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) console.warn('Client build failed; the API will still start. Run `npm run build` to see the error.');
}

await import('./server/index.ts');
