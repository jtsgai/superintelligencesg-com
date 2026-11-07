// Homepage directory-count states. Intercepts the directory API locally; does not change production.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = '/opt/cursor/artifacts';
await mkdir(artifacts, { recursive: true });
const failures = [];
const check = (cond, message) => { if (!cond) failures.push(message); };
const held = [];
let plan = {};
const liveEntries = { entries: [
  { id: 'public-one', name: 'One', source: 'public', updated: '2026-10-28' },
  { id: 'community-two', name: 'Two', source: 'community', updated: '2026-10-01' },
]};
const liveStats = { version: 1, total: 2, by_type: { organization: 2 } };
const otherEntries = { entries: [
  { id: 'public-a', name: 'A', source: 'public', updated: '2026-09-01' },
  { id: 'public-b', name: 'B', source: 'public', updated: '2026-09-02' },
  { id: 'public-c', name: 'C', source: 'public', updated: '2026-09-03' },
]};
const otherStats = { version: 1, total: 3, by_type: { organization: 3 } };

const profile = await mkdtemp(join(tmpdir(), 'si-counts-'));
const server = spawn('python3', ['-m', 'http.server', '8771', '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
const chrome = spawn('google-chrome', [
  '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=9341', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });

try {
  await waitForHttp('http://127.0.0.1:8771/index.html');
  const version = await waitForJson('http://127.0.0.1:9341/json/version');
  const browser = await connect(version.webSocketDebuggerUrl);
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const attached = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const page = browser.session(attached.sessionId);
  page.on((method, params) => {
    if (method !== 'Fetch.requestPaused') return;
    const url = params.request.url;
    const kind = url.includes('/v1/stats') ? 'stats' : url.includes('/v1/entries') ? 'entries' : url.includes('organizations.json') ? 'snapshot' : '';
    if (!kind) { page.send('Fetch.continueRequest', { requestId: params.requestId }).catch(() => {}); return; }
    const action = plan[kind] || 'continue';
    if (action === 'hang' || action === 'hold') { held.push({ kind, params, action }); return; }
    fulfill(page, params, action).catch(error => failures.push(error.message));
  });
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Fetch.enable', { patterns: [
    { urlPattern: '*api.superintelligencesg.org/*' },
    { urlPattern: '*organizations.json*' },
  ]});

  await scenarioReal(page);
  await scenarioSuccess(page);
  await scenarioEmpty(page);
  await scenarioHttpSnapshot(page);
  await scenarioFormat(page);
  await scenarioNetwork(page);
  await scenarioRetry(page);
  await scenarioRace(page);
  await scenarioHang(page);
  await scenarioNarrow(page);
  await scenarioNoScript(page);
} catch (error) {
  failures.push(error.stack || error.message);
} finally {
  chrome.kill('SIGKILL');
  server.kill('SIGKILL');
  await delay(100);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
if (failures.length) {
  console.error(failures.map(line => `FAIL ${line}`).join('\n\n'));
  process.exit(1);
}
console.log('home count checks ok');

async function scenarioReal(page) {
  plan = { entries: 'continue', stats: 'continue', snapshot: 'continue' };
  await size(page, 1280, 800, false);
  const started = Date.now();
  await go(page, 'http://127.0.0.1:8771/index.html');
  await waitFor(page, `document.getElementById('home-count-source').textContent.includes('Offline snapshot')`, 12000);
  const state = await read(page);
  const elapsed = Date.now() - started;
  check(/^\d+ organizations$/.test(state.org) && state.source.startsWith('Offline snapshot') && state.source.includes('Updated') && !state.source.includes('Live data') && state.retry === true, `cross-origin fallback unexpected: ${JSON.stringify(state)} after ${elapsed}ms`);
  check(state.navigator.includes('directory.html') && state.search, 'fallback lost navigation');
  console.log('cross-origin API fell back to snapshot', state.org, state.source, elapsed + 'ms');
}

async function scenarioSuccess(page) {
  plan = { entries: 'live', stats: 'live-stats', snapshot: 'http' };
  await go(page, 'http://127.0.0.1:8771/index.html');
  await waitFor(page, `document.getElementById('home-count-source').textContent.includes('Live data')`);
  const state = await read(page);
  check(state.org === '2 organizations' && state.pub === '1 public reference' && state.community === '1 self-published community profile' && state.source.includes('Updated') && state.source.includes('28 Oct 2026') && !state.source.includes('Offline'), `fixture success unexpected: ${JSON.stringify(state)}`);
  await shot(page, 'home_counts_success_desktop.png');
  await size(page, 390, 700, true);
  await delay(80);
  await shot(page, 'home_counts_success_390.png');
}

async function scenarioEmpty(page) {
  plan = { entries: 'empty-entries', stats: 'empty-stats', snapshot: 'http' };
  await go(page, 'http://127.0.0.1:8771/index.html');
  await waitFor(page, `document.getElementById('home-count-source').textContent.includes('No organizations')`);
  const state = await read(page);
  check(state.org === '0 organizations' && state.source.startsWith('Live data') && state.source.includes('No organizations in this response') && !state.source.includes('Offline') && state.retry === true, `empty live unexpected: ${JSON.stringify(state)}`);
}

async function scenarioHttpSnapshot(page) {
  plan = { entries: 'http', stats: 'http', snapshot: 'continue' };
  await go(page, 'http://127.0.0.1:8771/index.html');
  await waitFor(page, `document.getElementById('home-count-source').textContent.includes('Offline snapshot')`);
  const state = await read(page);
  check(/^\d+ organizations$/.test(state.org) && state.org !== '0 organizations' && state.source.includes('Offline snapshot') && state.source.includes('Updated') && !state.source.includes('Live data'), `http fallback unexpected: ${JSON.stringify(state)}`);
}

async function scenarioFormat(page) {
  plan = { entries: 'format', stats: 'format', snapshot: 'format' };
  await size(page, 1280, 800, false);
  await go(page, 'http://127.0.0.1:8771/index.html');
  await waitFor(page, `document.getElementById('home-count-source').textContent.includes('could not be read')`);
  const state = await read(page);
  check(state.org === 'Organizations' && state.pub === 'Public references' && !/\d/.test(state.org) && state.retry === false && state.button === 'Retry', `format failure unexpected: ${JSON.stringify(state)}`);
  await shot(page, 'home_counts_failure_desktop.png');
}

async function scenarioNetwork(page) {
  plan = { entries: 'network', stats: 'network', snapshot: 'network' };
  await size(page, 390, 700, true);
  await go(page, 'http://127.0.0.1:8771/index.html');
  await waitFor(page, `document.getElementById('home-count-source').textContent.includes('unavailable')`);
  const state = await read(page);
  check(state.org === 'Organizations' && state.retry === false && state.overflow <= 1 && state.link, `network failure unexpected: ${JSON.stringify(state)}`);
  await shot(page, 'home_counts_failure_390.png');
}

async function scenarioRetry(page) {
  plan = { entries: 'network', stats: 'network', snapshot: 'network' };
  await size(page, 1280, 800, false);
  await go(page, 'http://127.0.0.1:8771/index.html');
  await waitFor(page, `!document.getElementById('home-counts-retry').hidden`);
  plan = { entries: 'other', stats: 'other-stats', snapshot: 'http' };
  await evalPage(page, `document.getElementById('home-counts-retry').click()`);
  await waitFor(page, `document.getElementById('count-organizations').textContent === '3 organizations'`);
  const state = await read(page);
  check(state.source.startsWith('Live data') && state.retry === true && state.pub === '3 public references', `retry recovery unexpected: ${JSON.stringify(state)}`);
  await shot(page, 'home_counts_retry_desktop.png');
}

async function scenarioRace(page) {
  held.length = 0;
  plan = { entries: 'hold', stats: 'hold', snapshot: 'http' };
  await go(page, 'http://127.0.0.1:8771/index.html');
  await waitFor(page, `document.getElementById('home-count-source').textContent.includes('Loading')`);
  await waitHeld(2);
  const first = held.splice(0, held.length);
  plan = { entries: 'other', stats: 'other-stats', snapshot: 'http' };
  await evalPage(page, `const button=document.getElementById('home-counts-retry');button.hidden=false;button.disabled=false;button.click()`);
  await waitFor(page, `document.getElementById('count-organizations').textContent === '3 organizations'`);
  for (const item of first) await fulfill(page, item.params, item.kind === 'stats' ? 'stale-stats' : 'stale-entries').catch(() => {});
  await delay(400);
  const state = await read(page);
  check(state.org === '3 organizations' && !state.source.includes('99') && state.org !== '99 organizations', `stale response overwrote retry: ${JSON.stringify(state)}`);
}

async function scenarioHang(page) {
  plan = { entries: 'hang', stats: 'hang', snapshot: 'hang' };
  const started = Date.now();
  await go(page, 'http://127.0.0.1:8771/index.html');
  await waitFor(page, `document.getElementById('home-count-source').textContent.includes('did not respond in time')`, 12000);
  const elapsed = Date.now() - started;
  const state = await read(page);
  check(elapsed < 11000 && elapsed > 3000 && state.org === 'Organizations' && state.retry === false, `hang unexpected after ${elapsed}ms: ${JSON.stringify(state)}`);
  console.log('hang settled', elapsed + 'ms', state.source);
}

async function scenarioNarrow(page) {
  plan = { entries: 'network', stats: 'network', snapshot: 'network' };
  for (const width of [390, 320]) {
    await size(page, width, 700, true);
    await go(page, 'http://127.0.0.1:8771/index.html');
    await waitFor(page, `!document.getElementById('home-counts-retry').hidden`);
    const state = await read(page);
    check(state.overflow <= 1, `${width}px failure overflow ${state.overflow}`);
  }
  await shot(page, 'home_counts_failure_320.png');
}

async function scenarioNoScript(page) {
  await page.send('Emulation.setScriptExecutionDisabled', { value: true });
  await size(page, 390, 700, true);
  await go(page, 'http://127.0.0.1:8771/index.html');
  const state = await evalPage(page, `(() => { const text=document.body.innerText.toLowerCase(); return {hasNote:text.includes('directory counts need javascript'), loading:text.includes('loading directory counts'), search:!!document.querySelector('#home-search'), link:document.querySelector('a[href="directory.html"]')?.getAttribute('href')||'', overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth}; })()`);
  check(state.hasNote === true && state.loading === false && state.search && state.link === 'directory.html' && state.overflow <= 1, `no-JS unexpected: ${JSON.stringify(state)}`);
  await shot(page, 'home_counts_nojs_390.png');
  await page.send('Emulation.setScriptExecutionDisabled', { value: false });
}

function bodyFor(action) {
  if (action === 'live') return liveEntries;
  if (action === 'live-stats') return liveStats;
  if (action === 'other') return otherEntries;
  if (action === 'other-stats') return otherStats;
  if (action === 'empty-entries') return { entries: [] };
  if (action === 'empty-stats') return { version: 1, total: 0, by_type: { organization: 0 } };
  if (action === 'stale-entries') return { entries: Array.from({ length: 99 }, (_, i) => ({ id: 's' + i, name: 'S' + i, source: 'public', updated: '2020-01-01' })) };
  if (action === 'stale-stats') return { version: 1, total: 99, by_type: { organization: 99 } };
  if (action === 'format') return { entries: 'nope' };
  return { error: true };
}
async function fulfill(page, params, action) {
  if (action === 'continue') return page.send('Fetch.continueRequest', { requestId: params.requestId });
  if (action === 'network') return page.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'Failed' });
  const code = action === 'http' ? 500 : 200;
  const payload = action === 'http' ? { error: 'nope' } : action === 'format' && params.request.url.includes('organizations.json') ? { not: 'an array' } : bodyFor(action);
  return page.send('Fetch.fulfillRequest', {
    requestId: params.requestId,
    responseCode: code,
    responseHeaders: [
      { name: 'Content-Type', value: 'application/json' },
      { name: 'Access-Control-Allow-Origin', value: '*' },
    ],
    body: Buffer.from(JSON.stringify(payload)).toString('base64'),
  });
}
async function read(page) {
  return evalPage(page, `(() => {
    const button = document.getElementById('home-counts-retry');
    const link = document.querySelector('a[href="directory.html"]');
    return {
      org: document.getElementById('count-organizations').textContent,
      pub: document.getElementById('count-public').textContent,
      community: document.getElementById('count-community').textContent,
      source: document.getElementById('home-count-source').textContent,
      retry: button.hidden,
      button: button.textContent,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      link: !!link,
      search: !!document.querySelector('#home-search'),
      navigator: link ? link.getAttribute('href') : '',
    };
  })()`);
}
async function waitHeld(count) {
  const start = Date.now();
  while (held.length < count) {
    if (Date.now() - start > 4000) throw new Error('timed out holding requests, have ' + held.length);
    await delay(30);
  }
}
async function size(page, width, height, mobile) {
  await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile });
}
async function go(page, url) {
  held.length = 0;
  await page.send('Page.navigate', { url });
  await waitFor(page, `document.readyState === 'complete'`, 12000);
  await delay(30);
}
async function waitFor(page, expression, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { if (await evalPage(page, expression)) return; } catch { /* navigating */ }
    await delay(40);
  }
  let last = '';
  try { last = await evalPage(page, `(() => ({source:document.getElementById('home-count-source')?.textContent, error:window.__countError||''}))()`); }
  catch (error) { last = error.message; }
  throw new Error('timed out waiting for ' + expression + ' last=' + JSON.stringify(last));
}
async function evalPage(page, expression) {
  const { result, exceptionDetails } = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (exceptionDetails) throw new Error(exceptionDetails.text || exceptionDetails.exception?.description || expression);
  return result?.value;
}
async function shot(page, name) {
  await waitFor(page, `(() => { const node=document.querySelector('.home-count-status'); return !node || getComputedStyle(node).opacity === '1'; })()`, 4000);
  await evalPage(page, `document.getElementById('count-organizations').scrollIntoView()`);
  await delay(100);
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(artifacts, name), Buffer.from(data, 'base64'));
  console.log('screenshot', name);
}
async function waitForHttp(url) {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    try { if ((await fetch(url)).ok) return; } catch { /* starting */ }
    await delay(40);
  }
  throw new Error('server did not start');
}
async function waitForJson(url) {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    try { const response = await fetch(url); if (response.ok) return response.json(); } catch { /* starting */ }
    await delay(40);
  }
  throw new Error('chrome did not start');
}
function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  const listeners = new Map();
  const loaders = new Map();
  let seq = 0;
  const api = {
    send(method, params = {}, sessionId) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        const payload = { id, method, params };
        if (sessionId) payload.sessionId = sessionId;
        ws.send(JSON.stringify(payload));
      });
    },
  };
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
      else resolve(message.result || {});
      return;
    }
    if (message.sessionId && message.method) {
      (listeners.get(message.sessionId) || []).forEach(fn => fn(message.method, message.params || {}));
      if (message.method === 'Page.loadEventFired') loaders.get(message.sessionId)?.();
    }
  });
  api.session = (sessionId) => {
    const handlers = [];
    listeners.set(sessionId, handlers);
    const realSend = (method, params) => api.send(method, params, sessionId);
    return {
      on(fn) { handlers.push(fn); },
      send(method, params) {
        if (method !== 'Page.navigate') return realSend(method, params);
        const pendingLoad = new Promise(resolve => {
          const timer = setTimeout(resolve, 12000);
          loaders.set(sessionId, () => { clearTimeout(timer); loaders.delete(sessionId); resolve(); });
        });
        return realSend(method, params).then(async result => { await pendingLoad; return result; });
      },
    };
  };
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(api));
    ws.addEventListener('error', () => reject(new Error('websocket failed')));
  });
}
