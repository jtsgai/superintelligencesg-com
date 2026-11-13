// Ripple checks: CSS/JS wiring, opt-in hosts, excluded controls, click + keyboard ripple, cleanup,
// non-blocking navigation/submit, and prefers-reduced-motion. Local files and headless Chrome only.
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (cond, message) => { if (!cond) failures.push(message); };
const profile = await mkdtemp(join(tmpdir(), 'si-ripple-'));
const server = spawn('python3', ['-m', 'http.server', '8775', '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
const chrome = spawn('google-chrome', ['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--remote-debugging-port=9345',`--user-data-dir=${profile}`,'about:blank'], {stdio:'ignore'});
const origin = 'http://127.0.0.1:8775';

// Source wiring, independent of the browser.
for (const name of ['index.html', 'directory.html']) {
  const html = await readFile(join(root, name), 'utf8');
  check(html.includes('assets/product/si-ripple.css') && html.includes('assets/product/si-ripple.js'), `${name} does not load si-ripple.css and si-ripple.js`);
}
for (const name of ['about.html', 'changelog.html', 'map.html', 'source-radar.html']) {
  const html = await readFile(join(root, name), 'utf8');
  check(!html.includes('si-ripple'), `${name} should not load ripple`);
}
const css = await readFile(join(root, 'assets/product/si-ripple.css'), 'utf8');
const js = await readFile(join(root, 'assets/product/si-ripple.js'), 'utf8');
check(/prefers-reduced-motion:\s*reduce\)\s*{[^}]*\.si-ripple\s*{[^}]*display:\s*none/.test(css), 'css must hide the ripple under reduced motion');
check(/pointer-events:\s*none/.test(css) && /overflow:\s*hidden/.test(css), 'css must set pointer-events none on ink and overflow hidden on host');
check(js.includes('prefers-reduced-motion: reduce') && !js.includes('.preventDefault(') && !js.includes('.stopPropagation('), 'js must check reduced motion and never preventDefault/stopPropagation');

// Records every ripple the moment it is added, and whether the click/submit was left alone.
const probe = `(() => {
  window.__ripples = []; window.__defaults = [];
  new MutationObserver(list => list.forEach(m => m.addedNodes.forEach(n => {
    if (!(n instanceof Element) || !n.classList.contains('si-ripple')) return;
    const host = n.parentElement, b = host.getBoundingClientRect();
    window.__ripples.push({ host: host.tagName + '.' + host.className, cx: parseFloat(n.style.left) + parseFloat(n.style.width) / 2, cy: parseFloat(n.style.top) + parseFloat(n.style.height) / 2, w: b.width, h: b.height, ariaHidden: n.getAttribute('aria-hidden') });
  }))).observe(document.body, { childList: true, subtree: true });
  for (const type of ['click', 'submit']) window.addEventListener(type, e => { window.__defaults.push({ type, prevented: e.defaultPrevented }); if (type === 'submit' || e.target.closest?.('a')) e.preventDefault(); });
})()`;
// The window listener runs last in bubbling, so it sees whether anything earlier prevented the default;
// it then prevents anchor navigation and form submit itself only so the test stays on the page.

try {
  await waitForHttp(origin + '/index.html');
  const version = await waitForJson('http://127.0.0.1:9345/json/version');
  const browser = await connect(version.webSocketDebuggerUrl);
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
  const attached = await browser.send('Target.attachToTarget', { targetId, flatten: true });
  const page = browser.session(attached.sessionId);
  await page.send('Page.enable');
  await page.send('Runtime.enable');
  await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

  const mouseClick = async (selector, dx = 12, dy = 10) => {
    await evalPage(page, `(document.documentElement.style.scrollBehavior='auto', document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'}))`);
    await delay(120);
    const r = await evalPage(page, `(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: b.left, y: b.top }; })()`);
    const x = r.x + dx, y = r.y + dy;
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  };
  const key = async (name, code, text) => {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code, text, windowsVirtualKeyCode: name === 'Enter' ? 13 : 32 });
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: name === 'Enter' ? 13 : 32 });
  };
  const state = () => evalPage(page, `({ ripples: window.__ripples, defaults: window.__defaults, live: document.querySelectorAll('.si-ripple').length })`);
  const reduce = async value => page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value }] });
  const arm = async url => { await go(page, url); await waitFor(page, `document.querySelector('[data-si-ripple]')`); await evalPage(page, probe); };

  // ---- Homepage ----
  await reduce('no-preference');
  await arm(origin + '/index.html?motion=done');
  const homeHosts = await evalPage(page, `[...document.querySelectorAll('[data-si-ripple]')].map(n => n.tagName + '|' + (n.className || n.type || ''))`);
  check(JSON.stringify(homeHosts) === JSON.stringify(['BUTTON|submit', 'A|button']), `home ripple hosts unexpected: ${JSON.stringify(homeHosts)}`);
  const homeExcluded = ['.door', '.index-row', '.nav-tool', '.si-marquee__toggle', '#home-counts-retry', '.header a', '.eco-nav a', '.skip-link, a[href="#main"]', '.hero-links a', '.signal-actions a', '.cta-band a', '.cross a', 'footer a'];
  for (const selector of homeExcluded) {
    const bad = await evalPage(page, `[...document.querySelectorAll(${JSON.stringify(selector)})].filter(n => n.hasAttribute('data-si-ripple') || n.querySelector('[data-si-ripple]')).length`);
    check(bad === 0, `home ${selector} should not carry the ripple hook`);
  }
  const hostStyle = await evalPage(page, `(() => { const s = getComputedStyle(document.querySelector('.find button')); return { overflow: s.overflow, position: s.position, transform: s.transform }; })()`);
  check(hostStyle.overflow === 'hidden' && hostStyle.position === 'relative', `button host style unexpected: ${JSON.stringify(hostStyle)}`);

  // Pointer: ripple starts near the click point, is inert, then cleans itself up.
  await mouseClick('a.button', 30, 12);
  await delay(80);
  let s = await state();
  check(s.ripples.length === 1 && s.live === 1 && Math.abs(s.ripples[0].cx - 30) <= 2 && Math.abs(s.ripples[0].cy - 12) <= 2 && s.ripples[0].host.startsWith('A.button') && s.ripples[0].ariaHidden === 'true', `pointer ripple unexpected: ${JSON.stringify(s)}`);
  const during = await evalPage(page, `(() => { const n = document.querySelector('.si-ripple'); const s = getComputedStyle(n); return { pe: s.pointerEvents, anim: s.animationName, hostTransform: getComputedStyle(n.parentElement).transform }; })()`);
  check(during.pe === 'none' && during.anim === 'si-ripple' && during.hostTransform === 'none', `ripple ink style unexpected: ${JSON.stringify(during)}`);
  check(s.defaults.length === 1 && s.defaults[0].type === 'click' && s.defaults[0].prevented === false, `anchor click was prevented: ${JSON.stringify(s.defaults)}`);
  await delay(900);
  s = await state();
  check(s.live === 0, 'ripple not cleaned up after animation');

  // Keyboard: Space on the focused button and Enter inside the search field ripple from the center.
  await evalPage(page, `window.__ripples.length = 0; window.__defaults.length = 0; document.querySelector('.find button').focus()`);
  await key(' ', 'Space', ' ');
  await delay(80);
  s = await state();
  check(s.ripples.length === 1 && Math.abs(s.ripples[0].cx - s.ripples[0].w / 2) <= 2 && Math.abs(s.ripples[0].cy - s.ripples[0].h / 2) <= 2, `space ripple should start at center: ${JSON.stringify(s.ripples)}`);
  check(s.defaults.some(d => d.type === 'submit' && d.prevented === false), `space did not submit the form unblocked: ${JSON.stringify(s.defaults)}`);
  await delay(900);
  await evalPage(page, `window.__ripples.length = 0; window.__defaults.length = 0; document.getElementById('home-search').focus()`);
  await key('Enter', 'Enter', '\r');
  await delay(80);
  s = await state();
  check(s.ripples.length === 1 && Math.abs(s.ripples[0].cx - s.ripples[0].w / 2) <= 2, `enter-in-field ripple unexpected: ${JSON.stringify(s.ripples)}`);
  check(s.defaults.some(d => d.type === 'submit' && d.prevented === false), `enter did not submit the form unblocked: ${JSON.stringify(s.defaults)}`);
  await delay(900);

  // Excluded controls never ripple when clicked.
  await evalPage(page, `window.__ripples.length = 0`);
  await mouseClick('.index-row a, .index-row', 10, 10);
  await mouseClick('.header a', 4, 4);
  await mouseClick('.si-marquee__toggle:not([hidden]), .hero-links a', 4, 4);
  await delay(80);
  s = await state();
  check(s.ripples.length === 0 && s.live === 0, `excluded home controls rippled: ${JSON.stringify(s.ripples)}`);

  // Reduced motion: no ripple element is ever created.
  await reduce('reduce');
  await arm(origin + '/index.html?motion=done');
  await mouseClick('a.button', 30, 12);
  await key(' ', 'Space', ' ');
  await delay(120);
  s = await state();
  check(s.ripples.length === 0 && s.live === 0, `reduced motion produced a ripple: ${JSON.stringify(s)}`);
  check(s.defaults.some(d => d.type === 'click' && d.prevented === false), 'reduced motion click was blocked');
  await reduce('no-preference');

  // Real submit still navigates to the directory with the query.
  await go(page, origin + '/index.html?motion=done');
  await waitFor(page, `document.querySelector('[data-si-ripple]')`);
  await evalPage(page, `document.getElementById('home-search').value='ai'`);
  await mouseClick('.find button', 20, 10);
  await waitFor(page, `location.pathname.endsWith('/directory.html') && location.search.includes('q=ai')`, 8000);

  // ---- Directory ----
  await arm(origin + '/directory.html');
  const dirHosts = await evalPage(page, `[...document.querySelectorAll('[data-si-ripple]')].map(n => n.tagName + '.' + n.className)`);
  check(JSON.stringify(dirHosts) === JSON.stringify(['A.publish']), `directory ripple hosts unexpected: ${JSON.stringify(dirHosts)}`);
  const dirExcluded = ['#copy-view', '#reset-filters', '#saved-only', '#compare-button', '#share-button', '#download-button', '#retry-community', '.filter', '.journey', 'select', '.header a', '.eco-nav a', 'footer a', '.result a', '.result button'];
  for (const selector of dirExcluded) {
    const bad = await evalPage(page, `[...document.querySelectorAll(${JSON.stringify(selector)})].filter(n => n.hasAttribute('data-si-ripple')).length`);
    check(bad === 0, `directory ${selector} should not carry the ripple hook`);
  }
  await mouseClick('a.publish', 40, 14);
  await delay(80);
  s = await state();
  check(s.ripples.length === 1 && Math.abs(s.ripples[0].cx - 40) <= 2 && Math.abs(s.ripples[0].cy - 14) <= 2, `publish ripple unexpected: ${JSON.stringify(s.ripples)}`);
  check(s.defaults.length === 1 && s.defaults[0].prevented === false, `publish click was prevented: ${JSON.stringify(s.defaults)}`);
  await delay(900);
  s = await state();
  check(s.live === 0, 'directory ripple not cleaned up');
  await evalPage(page, `window.__ripples.length = 0`);
  await evalPage(page, `document.querySelector('[data-source="public"]').click()`);
  await mouseClick('#copy-view', 8, 8);
  await mouseClick('#reset-filters', 8, 8);
  await delay(80);
  s = await state();
  check(s.ripples.length === 0 && s.live === 0, `directory tool/filter controls rippled: ${JSON.stringify(s.ripples)}`);
  await reduce('reduce');
  await arm(origin + '/directory.html');
  await mouseClick('a.publish', 40, 14);
  await delay(120);
  s = await state();
  check(s.ripples.length === 0 && s.live === 0, `directory reduced motion produced a ripple: ${JSON.stringify(s)}`);
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
console.log('ripple checks ok');

async function size(page, width, height, mobile) { await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile }); }
async function go(page, url) { await page.send('Page.navigate', { url }); await waitFor(page, `document.readyState==='complete'`, 12000); await delay(40); }
async function waitFor(page, expression, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { if (await evalPage(page, expression)) return; } catch { /* navigating */ }
    await delay(40);
  }
  throw new Error('timed out waiting for ' + expression);
}
async function evalPage(page, expression) {
  const { result, exceptionDetails } = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (exceptionDetails) throw new Error(exceptionDetails.text || exceptionDetails.exception?.description || expression);
  return result?.value;
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
