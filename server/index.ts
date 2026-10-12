/**
 * SkillBridge server entry point.
 *   npm run dev    -> API on :3000 + Vite client on :5173
 *   npm start      -> serves API and the built client (npm run build) on :3000
 */

import express from 'express';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.ts';
import { attachUser } from './auth.ts';
import { api, errorHandler, userCount } from './routes.ts';
import { aiStatus } from './llm.ts';
import { seedDemo } from './seed.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 3000);

openDb();
if (userCount() === 0 && process.env.SKIP_AUTO_SEED !== '1') {
  console.log('First run: generating demo accounts and simulated class data...');
  const t0 = Date.now();
  seedDemo({ quiet: true });
  console.log(`Demo data ready in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(attachUser);
app.use('/api', api);

const dist = join(ROOT, 'dist');
if (existsSync(join(dist, 'index.html'))) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    res.sendFile(join(dist, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res
      .type('text/plain')
      .send('SkillBridge API is running.\n\nDevelopment: open http://localhost:5173 (npm run dev).\nProduction: run `npm run build`, then `npm start`.');
  });
}

app.use(errorHandler);

app.listen(PORT, () => {
  const ai = aiStatus();
  console.log(`SkillBridge running at http://localhost:${PORT}`);
  console.log(`AI coach: ${ai.provider === 'offline' ? 'built-in offline coach (set GEMINI_API_KEY or OPENAI_API_KEY to enable an LLM)' : `${ai.provider} (${ai.model})`}`);
  console.log('Demo logins: student / skillbridge  -  teacher / skillbridge');
});
