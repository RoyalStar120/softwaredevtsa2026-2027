// End-to-end verification: API smoke test + headless Chrome screenshots.
// Usage: node scripts/verify.mjs [baseUrl] [outDir]
import puppeteer from 'puppeteer-core';
import { mkdirSync, existsSync } from 'node:fs';

const BASE = process.argv[2] ?? 'http://localhost:3100';
const OUT = process.argv[3] ?? 'screenshots';
mkdirSync(OUT, { recursive: true });

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].filter(Boolean);
const executablePath = CHROME_PATHS.find((p) => existsSync(p));

const results = [];
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`);
};

// ---------------- API smoke test ----------------
async function apiTest() {
  let cookie = '';
  const call = async (method, path, body) => {
    const res = await fetch(BASE + '/api' + path, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  };
  const login = await call('POST', '/auth/demo', { role: 'learner' });
  check('demo learner login', login.status === 200, login.data?.user?.displayName);
  const prof = await call('GET', '/profile');
  check('profile', prof.status === 200 && prof.data.skills.length > 0, `${prof.data?.stats?.completed} completed, ${prof.data?.patterns?.length} patterns`);
  const recs = await call('GET', '/recommendations');
  const top = recs.data?.top?.[0];
  check('recommendations', recs.status === 200 && !!top, top ? `${top.title} d${top.difficulty}: ${top.reasons?.[0]?.text}` : '');

  // Electrical attempt: safe expert-ish run
  const start = await call('POST', '/attempts', { templateId: 'elec.porch-light', difficulty: 2 });
  check('start electrical attempt', start.status === 200, start.data?.attemptId);
  const id = start.data.attemptId;
  const view = await call('GET', `/attempts/${id}`);
  check('active attempt view', view.status === 200 && !!view.data.scenario.view.comps, view.data?.scenario?.title);
  const steps = [
    { type: 'measure', payload: { mode: 'V', red: 'N1', black: 'N0' } },
    { type: 'measure', payload: { mode: 'V', red: 'N4', black: 'N0' } },
    { type: 'measure', payload: { mode: 'R', red: 'N1', black: 'N0' } },
  ];
  for (const s of steps) {
    const r = await call('POST', `/attempts/${id}/actions`, { action: s });
    check(`action ${s.type} ${s.payload.mode}`, r.status === 200 && r.data.ok, r.data?.entry?.description ?? r.data?.error);
  }
  const hint = await call('POST', `/attempts/${id}/hint`);
  check('hint level 1', hint.status === 200, hint.data?.hint?.text?.slice(0, 80));
  for (const s of [
    { type: 'set_power', payload: { on: false } },
    { type: 'set_lockout', payload: { applied: true } },
    { type: 'measure', payload: { mode: 'V', red: 'N2', black: 'N0' } },
    { type: 'replace', payload: { comp: 'F1' } },
    { type: 'set_lockout', payload: { applied: false } },
    { type: 'set_power', payload: { on: true } },
    { type: 'diagnose', payload: { faults: [{ comp: 'F1', type: 'open' }] } },
  ]) {
    const r = await call('POST', `/attempts/${id}/actions`, { action: s });
    check(`action ${s.type}`, r.status === 200 && r.data.ok, r.data?.entry?.description ?? r.data?.error);
  }
  const sub = await call('POST', `/attempts/${id}/submit`, { action: { type: 'complete_work_order', payload: {} } });
  check('submit electrical', sub.status === 200 && sub.data.complete, sub.data?.error);
  const deb = await call('GET', `/attempts/${id}/debrief`);
  check('debrief', deb.status === 200 && typeof deb.data.evaluation?.overall === 'number', `${deb.data?.evaluation?.overall} · ${deb.data?.evaluation?.processVerdict?.label} · ${deb.data?.evaluation?.mistakes?.map((m) => m.code).join(',')}`);
  const ask = await call('POST', `/attempts/${id}/coach/ask`, { question: 'Why was step 3 a mistake?' });
  check('coach answer', ask.status === 200 && ask.data.messages?.length >= 2, ask.data?.messages?.at(-1)?.content?.slice(0, 100));
  const narr = await call('POST', `/attempts/${id}/coach/narrative`);
  check('coach narrative endpoint', narr.status === 200, `provider=${narr.data?.provider}`);

  // Programming attempt via adaptive focus
  const p = await call('POST', '/attempts', { focusSkills: ['prog.reproduce'], source: 'skill_focus' });
  check('start programming attempt (skill focus)', p.status === 200, p.data?.attemptId);
  const pv = await call('GET', `/attempts/${p.data.attemptId}`);
  check('programming view', pv.status === 200 && typeof pv.data.scenario.view.code === 'string', pv.data?.scenario?.title);
  await call('POST', `/attempts/${p.data.attemptId}/abandon`);

  // Instructor
  cookie = '';
  const t = await call('POST', '/auth/demo', { role: 'instructor' });
  check('demo instructor login', t.status === 200);
  const classes = await call('GET', '/instructor/classes');
  check('instructor classes', classes.status === 200 && classes.data.length > 0, classes.data?.[0]?.name);
  const cd = await call('GET', `/instructor/classes/${classes.data[0].id}`);
  check(
    'class detail',
    cd.status === 200 && cd.data.roster.length > 0,
    `${cd.data.roster.length} students, ${cd.data.mistakes.length} mistake types, pre/post n=${cd.data.evidence.prePost.length} (${cd.data.evidence.baselineAvg}→${cd.data.evidence.transferAvg})`,
  );
  const st = await call('GET', `/instructor/students/${cd.data.roster[0].user.id}`);
  check('student detail', st.status === 200, st.data?.user?.displayName);
  const csv = await call('GET', `/instructor/classes/${classes.data[0].id}/export.csv`);
  check('csv export', csv.status === 200 && String(csv.data).startsWith('student,'), `${String(csv.data).split('\n').length - 1} rows`);
  const asg = await call('POST', `/instructor/classes/${classes.data[0].id}/assignments`, { title: 'Verify test', kind: 'practice', focusSkills: ['elec.voltage'] });
  check('create assignment', asg.status === 200 && asg.data.ids.length === 1);
  return { classId: classes.data[0].id, studentId: cd.data.roster[0].user.id, attemptId: id };
}

// ---------------- Screenshots ----------------
async function screenshots(ids) {
  if (!executablePath) {
    console.log('Chrome not found; skipping screenshots');
    return;
  }
  const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  const errors = [];
  const shoot = async (page, name, url, { wait = 1200, full = true, action } = {}) => {
    if (url) await page.goto(BASE + url, { waitUntil: 'networkidle0', timeout: 30000 });
    if (action) await action(page);
    await new Promise((r) => setTimeout(r, wait));
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: full });
    console.log(`shot ${name}`);
  };
  const newPage = async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => errors.push(`${page.url()}: ${e.message}`));
    page.on('console', (m) => m.type() === 'error' && errors.push(`${page.url()}: console: ${m.text()}`));
    return page;
  };
  const page = await newPage();
  await shoot(page, '01-landing', '/welcome');
  await page.goto(BASE + '/login', { waitUntil: 'networkidle0' });
  await page.evaluate(() => fetch('/api/auth/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'learner' }) }));
  await shoot(page, '02-learner-home', '/home', { wait: 1800 });
  await shoot(page, '03-practice', '/practice');
  await shoot(page, '04-progress', '/progress', { wait: 1800 });
  await shoot(page, '05-debrief', `/debrief/${ids.attemptId}`, { wait: 1800 });
  // Start fresh scenarios and capture the workspaces
  const elec = await page.evaluate(() =>
    fetch('/api/attempts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ templateId: 'elec.fan-relay', difficulty: 3 }) }).then((r) => r.json()),
  );
  await shoot(page, '06-electrical-workspace', `/play/${elec.attemptId}`, { wait: 2000, full: false });
  await shoot(page, '06b-electrical-workspace-full', null, { wait: 300, full: true });
  const prog = await page.evaluate(() =>
    fetch('/api/attempts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ templateId: 'prog.gradebook', difficulty: 1 }) }).then((r) => r.json()),
  );
  await shoot(page, '07-programming-workspace', `/play/${prog.attemptId}`, { wait: 2500, full: false });
  await shoot(page, '07b-programming-workspace-full', null, { wait: 300, full: true });
  await page.evaluate(() => fetch('/api/auth/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'instructor' }) }));
  await shoot(page, '08-instructor-classes', '/instructor');
  await shoot(page, '09-class-overview', `/instructor/classes/${ids.classId}`, { wait: 1800 });
  const clickTab = (label) => async (p) => {
    await p.evaluate((l) => {
      const b = [...document.querySelectorAll('button.tab')].find((x) => x.textContent?.includes(l));
      b?.click();
    }, label);
  };
  await shoot(page, '10-class-mastery', null, { action: clickTab('Skill mastery') });
  await shoot(page, '11-class-evidence', null, { action: clickTab('Learning evidence') });
  await shoot(page, '12-student-detail', `/instructor/students/${ids.studentId}`, { wait: 1800 });
  await shoot(page, '13-about', '/about');
  // mobile
  const m = await newPage();
  await m.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  await m.goto(BASE + '/login', { waitUntil: 'networkidle0' });
  await m.evaluate(() => fetch('/api/auth/demo', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'learner' }) }));
  await shoot(m, '14-mobile-home', '/home', { wait: 1500 });
  await browser.close();
  if (errors.length) {
    console.log('\nBROWSER ERRORS:');
    for (const e of [...new Set(errors)].slice(0, 40)) console.log(' -', e);
  } else console.log('\nNo browser errors.');
}

const ids = await apiTest();
await screenshots(ids);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} API checks passed`);
process.exit(failed.length ? 1 : 0);
