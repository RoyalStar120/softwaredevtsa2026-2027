// Starts the API server (with auto-restart on changes) and the Vite dev server together.
// Cross-platform: no shell-specific syntax.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;

const procs = [
  spawn(node, ['--watch-path=server', '--watch-path=shared', '--disable-warning=ExperimentalWarning', '--env-file-if-exists=.env', 'server/index.ts'], {
    cwd: root,
    stdio: 'inherit',
  }),
  spawn(node, [join(root, 'node_modules', 'vite', 'bin', 'vite.js')], { cwd: root, stdio: 'inherit' }),
];

const stop = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => code && console.log(`[dev] a process exited with code ${code}`));
