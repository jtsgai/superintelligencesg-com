// Directory search, filter, history, and view-link checks. Local snapshot and intercepted responses only.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = process.env.SI_ARTIFACTS_DIR || '/opt/cursor/artifacts';
await mkdir(artifacts, { recursive: true });
const failures = [];
const check = (cond, message) => { if (!cond) failures.push(message); };
let plan = {};
const profile = await mkdtemp(join(tmpdir(), 'si-dir-'));
const server = spawn('python3', ['-m', 'http.server', '8772', '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
const chrome = spawn('google-chrome', ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--remote-debugging-port=9343',`--user-data-dir=${profile}`,'about:blank'], {stdio:'ignore'});
const origin = 'http://127.0.0.1:8772';

try {
  await waitForHttp(origin + '/directory.html');
  const version = await waitForJson('http://127.0.0.1:9343/json/version');
  const browser = await connect(version.webSocketDebuggerUrl);
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const attached = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const page = browser.session(attached.sessionId);
  page.on((method, params) => {
    if (method !== 'Fetch.requestPaused') return;
    const url = params.request.url;
    const kind = url.includes('/api/shortlists') && !url.includes('/api/shortlists/') ? 'shortlists' : url.includes('/v1/stats') ? 'stats' : url.includes('/v1/entries') ? 'entries' : url.includes('organizations.json') ? 'snapshot' : '';
    const action = plan[kind] || 'continue';
    const body = action === 'empty-entries' ? { entries: [] } : action === 'empty-stats' ? { version: 1, total: 0, by_type: { organization: 0 } } : { bad: true };
    const ignore = error => { if (!String(error.message || error).includes('Invalid InterceptionId')) failures.push(error.message || String(error)); };
    if (!kind || action === 'continue') { page.send('Fetch.continueRequest', { requestId: params.requestId }).catch(ignore); return; }
    if (action === 'network') { page.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'Failed' }).catch(ignore); return; }
    page.send('Fetch.fulfillRequest', {
      requestId: params.requestId,
      responseCode: action === 'http' ? 500 : 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
      body: Buffer.from(JSON.stringify(action === 'format' ? { entries: 'nope' } : body)).toString('base64'),
    }).catch(ignore);
  });
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*api.superintelligencesg.org/*' }, { urlPattern: '*organizations.json*' }, { urlPattern: '*/api/shortlists*' }] });

  await size(page, 1280, 900, false);
  plan = { entries: 'continue', stats: 'continue', snapshot: 'continue', shortlists: 'network' };
  await go(page, origin + '/directory.html');
  await waitFor(page, `document.body.innerText.includes('AI Singapore')`, 12000);
  const loaded = await read(page);
  check(loaded.status.includes('result') && !loaded.status.startsWith('0 results') && loaded.empty === '' && loaded.shareDisabled === true, `loaded directory unexpected: ${JSON.stringify(loaded)}`);
  await shot(page, 'directory_results_desktop.png');

  const beforeHistory = await evalPage(page, 'history.length');
  await typeQuery(page, 'AI');
  await typeQuery(page, 'AI Singapore');
  await waitFor(page, `document.body.innerText.includes('AI Singapore') && !document.body.innerText.includes('No matching entries')`);
  const searched = await read(page);
  check(searched.q === 'AI Singapore' && searched.url.includes('q=') && searched.names.includes('AI Singapore'), `search unexpected: ${JSON.stringify(searched)}`);
  const afterTyping = await evalPage(page, 'history.length');
  check(afterTyping === beforeHistory + 1, `typing should add one history entry, ${beforeHistory} -> ${afterTyping}`);

  await evalPage(page, `document.querySelector('[data-source="public"]').click()`);
  await waitFor(page, `location.search.includes('source=public')`);
  const filtered = await read(page);
  check(filtered.pressed === 'true' && filtered.url.includes('source=public') && filtered.url.includes('q='), `source filter unexpected: ${JSON.stringify(filtered)}`);

  await evalPage(page, `navigator.clipboard.writeText=()=>Promise.reject(new Error('denied'));document.getElementById('copy-view').click()`);
  await delay(50);
  const denied = await read(page);
  const expected = new URL(denied.path, origin).href;
  check(denied.fallback === false && denied.viewUrl === expected && denied.viewStatus.toLowerCase().includes('clipboard'), `clipboard fallback unexpected: ${JSON.stringify(denied)}`);

  let copied = '';
  await evalPage(page, `navigator.clipboard.writeText=text=>{window.__copied=text;return Promise.resolve()};document.getElementById('copy-view').click()`);
  await delay(30);
  copied = await evalPage(page, 'window.__copied');
  check(copied === expected, `copied view link ${copied} !== ${expected}`);

  await go(page, copied);
  await waitFor(page, `document.getElementById('search').value==='AI Singapore' && document.querySelector('[data-source="public"]').getAttribute('aria-pressed')==='true'`);
  const restored = await read(page);
  check(restored.q === 'AI Singapore' && restored.pressed === 'true', `restored link unexpected: ${JSON.stringify(restored)}`);

  await typeQuery(page, '100% & +');
  await waitFor(page, `location.search.includes('q=')`);
  const encoded = await evalPage(page, 'location.href');
  check(encoded.includes('%25') && encoded.includes('%26') && encoded.includes('%2B'), `special characters not encoded: ${encoded}`);
  await go(page, encoded);
  await waitFor(page, `document.getElementById('search').value==='100% & +' && document.querySelector('[data-status]').textContent.includes('result')`, 12000);
  const roundTrip = await read(page);
  check(roundTrip.q === '100% & +' && roundTrip.empty.includes('No matching entries'), `round trip unexpected: ${JSON.stringify(roundTrip)}`);

  await evalPage(page, `document.getElementById('reset-filters').click()`);
  await waitFor(page, `document.getElementById('search').value==='' && !location.search.includes('q=')`);
  await evalPage(page, 'history.back()');
  await waitFor(page, `document.getElementById('search').value==='100% & +'`);
  const backed = await read(page);
  check(backed.q === '100% & +', `back did not restore the query: ${JSON.stringify(backed)}`);


  // View link whitelist: only q, source, kind, lens, sort, open, page, entry may be copied.
  const privateList = '00000000-0000-4000-8000-000000000000';
  const allowedKeys = ['entry', 'kind', 'lens', 'open', 'page', 'q', 'sort', 'source'];
  const junkKeys = ['utm_source', 'utm_medium', 'foo', 'tracking', 'fbclid', 'sourc', 'shortlist', 'list', 'work', 'notes'];
  const keysOf = href => [...new URL(href).searchParams.keys()].sort();
  const noJunk = href => !junkKeys.some(key => new URL(href).searchParams.has(key)) && !/utm_|foo=|shortlist=|list=|notes=/.test(href);
  const landed = async (url, value) => { await go(page, url); await waitFor(page, `document.getElementById('search').value===${JSON.stringify(value)} && (document.querySelector('[data-status]')?.textContent||'').includes('result')`, 12000); };
  const copyNow = async () => { await evalPage(page, `navigator.clipboard.writeText=text=>{window.__copied=text;return Promise.resolve()};window.__copied='';document.getElementById('copy-view').click()`); await delay(40); return evalPage(page, 'window.__copied'); };
  const denyNow = async () => { await evalPage(page, `navigator.clipboard.writeText=()=>Promise.reject(new Error('denied'));document.getElementById('copy-view').click()`); await delay(40); return read(page); };

  // Landing with junk plus private shortlist/list params, then Copy before any filter change.
  const junkLanding = origin + `/directory.html?utm_source=x&foo=bar&q=test&lens=research&shortlist=ai-singapore&list=${privateList}&tracking=1&fbclid=z&notes=secret`;
  await landed(junkLanding, 'test');
  const junkCopied = await copyNow();
  check(keysOf(junkCopied).join() === 'lens,q' && new URL(junkCopied).searchParams.get('q') === 'test' && new URL(junkCopied).searchParams.get('lens') === 'research' && noJunk(junkCopied), `junk landing copied unexpected link: ${junkCopied}`);
  const junkDenied = await denyNow();
  check(junkDenied.fallback === false && keysOf(junkDenied.viewUrl).join() === 'lens,q' && noJunk(junkDenied.viewUrl) && junkDenied.viewStatus.toLowerCase().includes('clipboard'), `junk landing fallback unexpected: ${JSON.stringify(junkDenied)}`);

  // An unknown lens value is normalized away rather than copied.
  await landed(origin + '/directory.html?utm_source=x&foo=bar&q=test&lens=ai', 'test');
  const badLens = await copyNow();
  check(keysOf(badLens).join() === 'q' && noJunk(badLens), `unknown lens copied unexpected link: ${badLens}`);

  // Every whitelisted key with a non-default value survives; defaults and junk do not.
  await landed(origin + '/directory.html?q=AI&source=public&kind=Research&open=1&sort=alpha&page=1&entry=ai-singapore&lens=public&utm_medium=m&tracking=1&list=' + privateList, 'AI');
  const full = await copyNow();
  const fullParams = new URL(full).searchParams;
  check(noJunk(full) && keysOf(full).every(key => allowedKeys.includes(key)) && fullParams.get('q') === 'AI' && fullParams.get('source') === 'public' && fullParams.get('kind') === 'Research' && fullParams.get('open') === '1' && fullParams.get('sort') === 'alpha' && fullParams.get('entry') === 'ai-singapore' && fullParams.get('lens') === 'public' && !fullParams.has('page'), `full whitelist copied unexpected link: ${full}`);

  // Default values and junk collapse to the bare directory path.
  await landed(origin + '/directory.html?source=all&sort=featured&page=1&q=&open=0&lens=all&utm_source=x&foo=bar', '');
  const bare = await copyNow();
  check(bare === origin + '/directory.html', `default view link should be bare, got ${bare}`);

  // Special characters still encode and round-trip, with junk dropped.
  await landed(origin + '/directory.html?utm_source=x&foo=bar', '');
  await typeQuery(page, '100% & +');
  await waitFor(page, `location.search.includes('q=')`);
  const specialCopied = await copyNow();
  check(keysOf(specialCopied).join() === 'q' && new URL(specialCopied).searchParams.get('q') === '100% & +' && specialCopied.includes('%25') && specialCopied.includes('%26') && specialCopied.includes('%2B') && noJunk(specialCopied), `special characters copied unexpected link: ${specialCopied}`);
  const addressBar = await evalPage(page, 'location.search');
  check(!/utm_|foo=/.test(addressBar), `address bar kept junk after a filter change: ${addressBar}`);

  // Copy shortlist link keeps its own list/shortlist flow.
  const navigatorSource = await readFile(join(root, 'assets/product/navigator.js'), 'utf8');
  check(navigatorSource.includes("u.searchParams.set('list',savedListID)") && navigatorSource.includes("shortlistURL.searchParams.set('shortlist',saved.join(','))"), 'shortlist share flow no longer uses list/shortlist');

  plan = { entries: 'network', stats: 'network', snapshot: 'network', shortlists: 'network' };
  await go(page, origin + '/directory.html?q=AI%20Singapore&source=public');
  await waitFor(page, `document.body.innerText.includes('Directory data is unavailable')`, 12000);
  const failed = await read(page);
  check(failed.status.startsWith('Directory data unavailable') && !failed.status.startsWith('0') && failed.empty.includes('not an empty search') && failed.q === 'AI Singapore', `load failure looked like no matches: ${JSON.stringify(failed)}`);
  await shot(page, 'directory_unavailable_desktop.png');

  plan = { entries: 'empty-entries', stats: 'empty-stats', snapshot: 'http' };
  await go(page, origin + '/directory.html');
  await waitFor(page, `document.body.innerText.includes('No organizations in this response')`, 8000);
  const emptyLive = await read(page);
  check(emptyLive.status.includes('0 results') && emptyLive.empty.includes('responded without entries') && !emptyLive.empty.includes('unavailable'), `empty live unexpected: ${JSON.stringify(emptyLive)}`);

  plan = { entries: 'continue', stats: 'continue', snapshot: 'continue', shortlists: 'network' };
  await size(page, 390, 700, true);
  await go(page, origin + '/directory.html?q=AI%20Singapore');
  await waitFor(page, `document.body.innerText.includes('AI Singapore')`, 12000);
  const narrow = await read(page);
  check(narrow.overflow <= 1 && narrow.q === 'AI Singapore', `390 directory overflow ${narrow.overflow}`);
  await shot(page, 'directory_search_390.png');
  console.log('example local view link', new URL(narrow.path, origin).href);
} catch (error) {
  failures.push(error.stack || error.message);
} finally {
  chrome.kill('SIGKILL');
  server.kill('SIGKILL');
  await delay(80);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
if (failures.length) {
  console.error(failures.map(line => `FAIL ${line}`).join('\n\n'));
  process.exit(1);
}
console.log('directory view checks ok');

async function typeQuery(page, value) {
  await evalPage(page, `(() => { const input=document.getElementById('search'); input.value=${JSON.stringify(value)}; input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
}
async function read(page) {
  return evalPage(page, `(() => ({
    q: document.getElementById('search').value,
    url: location.search,
    path: location.pathname+location.search,
    pressed: document.querySelector('[data-source="public"]')?.getAttribute('aria-pressed'),
    status: document.querySelector('[data-status]')?.textContent||'',
    empty: document.querySelector('.empty')?.innerText||'',
    names: [...document.querySelectorAll('.result h3')].map(node=>node.textContent).slice(0,5),
    shareDisabled: document.getElementById('share-button')?.disabled,
    viewStatus: document.getElementById('view-status')?.textContent||'',
    fallback: document.getElementById('view-fallback')?.hidden,
    viewUrl: document.getElementById('view-url')?.value||'',
    overflow: document.documentElement.scrollWidth-document.documentElement.clientWidth
  }))()`);
}
async function size(page, width, height, mobile) { await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }); }
async function go(page, url) { await page.send('Page.navigate', { url }); await waitFor(page, `document.readyState==='complete'`, 12000); await delay(40); }
async function waitFor(page, expression, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { if (await evalPage(page, expression)) return; } catch { /* navigating */ }
    await delay(40);
  }
  let last = '';
  try { last = JSON.stringify(await read(page)); } catch (error) { last = error.message; }
  throw new Error('timed out waiting for ' + expression + ' last=' + last);
}
async function evalPage(page, expression) {
  const { result, exceptionDetails } = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (exceptionDetails) throw new Error(exceptionDetails.text || exceptionDetails.exception?.description || expression);
  return result?.value;
}
async function shot(page, name) {
  await evalPage(page, `document.getElementById('search')?.scrollIntoView()`);
  await delay(100);
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(artifacts, name), Buffer.from(data, 'base64'));
  console.log('screenshot', name);
}
async function waitForHttp(url) { const start=Date.now(); while(Date.now()-start<8000){ try { if ((await fetch(url)).ok) return; } catch {} await delay(40);} throw new Error('server'); }
async function waitForJson(url) { const start=Date.now(); while(Date.now()-start<8000){ try { const response=await fetch(url); if (response.ok) return response.json(); } catch {} await delay(40);} throw new Error('chrome'); }
function connect(url) {
  const ws = new WebSocket(url); const pending = new Map(); const listeners = new Map(); const loaders = new Map(); let seq = 0;
  const api = { send(method, params = {}, sessionId) { const id = ++seq; return new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); const payload = { id, method, params }; if (sessionId) payload.sessionId = sessionId; ws.send(JSON.stringify(payload)); }); } };
  ws.addEventListener('message', event => { const message = JSON.parse(event.data); if (message.id && pending.has(message.id)) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error))); else resolve(message.result || {}); return; } if (message.sessionId && message.method) { (listeners.get(message.sessionId) || []).forEach(fn => fn(message.method, message.params || {})); if (message.method === 'Page.loadEventFired') loaders.get(message.sessionId)?.(); } });
  api.session = sessionId => { const handlers = []; listeners.set(sessionId, handlers); const real = (method, params) => api.send(method, params, sessionId); return { on(fn) { handlers.push(fn); }, send(method, params) { if (method !== 'Page.navigate') return real(method, params); const gate = new Promise(resolve => { const timer = setTimeout(resolve, 12000); loaders.set(sessionId, () => { clearTimeout(timer); loaders.delete(sessionId); resolve(); }); }); return real(method, params).then(async result => { await gate; return result; }); } }; };
  return new Promise((resolve, reject) => { ws.addEventListener('open', () => resolve(api)); ws.addEventListener('error', () => reject(new Error('websocket failed'))); });
}
