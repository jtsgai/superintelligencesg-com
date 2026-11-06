// Static and headless checks for the .com marquee and directory stagger.
// Usage: node scripts/check-motion-quiet.mjs
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (cond, message) => { if (!cond) failures.push(message); };

const indexHtml = await readFile(join(root, 'index.html'), 'utf8');
const directoryHtml = await readFile(join(root, 'directory.html'), 'utf8');
const css = await readFile(join(root, 'assets/product/motion-quiet.css'), 'utf8');
const js = await readFile(join(root, 'assets/product/motion-quiet.js'), 'utf8');
const homeCss = await readFile(join(root, 'assets/product/motion-home.css'), 'utf8');
const homeJs = await readFile(join(root, 'assets/product/motion-home.js'), 'utf8');

const journey = [...directoryHtml.matchAll(/class="journey"[^>]*>([^<]+)/g)].map((match) =>
  match[1].replaceAll('&amp;', '&').trim()
);
const marqueeItems = [...indexHtml.matchAll(/<ul class="si-marquee__group">([\s\S]*?)<\/ul>/g)];
const itemText = (block) => [...block.matchAll(/<li>([^<]+)<\/li>/g)].map((match) =>
  match[1].replaceAll('&amp;', '&').trim()
);

check(journey.length === 6, `expected 6 directory collections, found ${journey.length}`);
check(marqueeItems.length === 1, `homepage should ship one marquee list, found ${marqueeItems.length}`);
check(JSON.stringify(itemText(marqueeItems[0]?.[1] || '')) === JSON.stringify(journey),
  `marquee copy must match directory collections.\n  directory: ${journey.join(' | ')}\n  marquee: ${itemText(marqueeItems[0]?.[1] || '').join(' | ')}`);
check(indexHtml.includes('data-si-marquee') && !directoryHtml.includes('data-si-marquee'),
  'marquee markup belongs on the homepage only');
check(indexHtml.includes('assets/product/motion-quiet.css') && indexHtml.includes('assets/product/motion-quiet.js'),
  'homepage must load motion-quiet assets');
check(directoryHtml.includes('assets/product/motion-quiet.css') && directoryHtml.includes('assets/product/motion-quiet.js'),
  'directory must load motion-quiet assets');
check(indexHtml.includes('aria-hidden') === false || !indexHtml.includes('data-si-marquee-clone'),
  'the duplicate marquee list must be created by script, not shipped in HTML');
check(/class="si-marquee__toggle" hidden/.test(indexHtml), 'pause button starts hidden');
check(!/(^|[^a-z-])transform\s*:/.test(css), 'motion-quiet.css must not set transform');
check(css.includes('translate: -50% 0') && css.includes('translate: 0 8px'),
  'marquee and stagger motion use the translate property');
check(css.includes('prefers-reduced-motion: reduce') && css.includes('animation: none !important'),
  'reduced motion must cancel animation');
check(js.includes('aria-hidden') && js.includes('inert') && js.includes('visibilitychange')
  && js.includes('IntersectionObserver') && js.includes('touchend') && js.includes('prefers-reduced-motion'),
  'marquee script is missing a required pause or accessibility hook');
check(js.includes("rows.slice(0, 5)") && js.includes('played = true'),
  'directory stagger must be one-shot and limited');
check(homeJs.includes('#navigator .index-row') && homeJs.includes('.section.doors .door'),
  'existing homepage GSAP stagger targets should stay in place');
check(homeCss.includes('translate:0 -6px') && homeCss.includes('translate:0 -4px'),
  'existing Hover Lift translate values should stay in place');
check(!indexHtml.includes('si-motion.js') && indexHtml.includes('motion-home.js'),
  'homepage should keep GSAP motion-home.js and not also load si-motion.js');

if (failures.length) {
  console.error(failures.map((line) => `FAIL ${line}`).join('\n'));
  process.exit(1);
}
console.log('static checks ok');
console.log('collections:', journey.join(' | '));

const artifacts = '/opt/cursor/artifacts';
await mkdir(artifacts, { recursive: true });
const port = 8765;
const server = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], {
  cwd: root,
  stdio: 'ignore',
});
const profile = await mkdtemp(join(tmpdir(), 'si-motion-chrome-'));
const chrome = spawn('google-chrome', [
  '--headless=new',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--disable-background-networking',
  `--remote-debugging-port=9334`,
  `--user-data-dir=${profile}`,
  'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] });
let chromeLog = '';
chrome.stderr.on('data', (chunk) => { chromeLog += chunk.toString(); });
chrome.stdout.on('data', (chunk) => { chromeLog += chunk.toString(); });

const cleanup = async () => {
  chrome.kill('SIGKILL');
  server.kill('SIGKILL');
  await delay(100);
  await rm(profile, { recursive: true, force: true }).catch(async () => {
    await delay(200);
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  });
};

try {
  await waitForHttp(`http://127.0.0.1:${port}/index.html`);
  const version = await waitForJson('http://127.0.0.1:9334/json/version');
  const browser = await connect(version.webSocketDebuggerUrl);
  await browser.send('Target.setDiscoverTargets', { discover: true });

  async function openPage() {
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const attached = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    const page = browser.session(attached.sessionId);
    await page.send('Page.enable');
    await page.send('Runtime.enable');
    await page.send('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
    });
    return page;
  }

  const page = await openPage();
  await page.send('Page.addScriptToEvaluateOnNewDocument', {
    source: 'window.__siAnim=[];addEventListener("animationstart",e=>window.__siAnim.push(e.animationName),true);',
  });

  const origin = `http://127.0.0.1:${port}`;
  await scenarioDesktop(page, origin);
  await scenarioNarrow(page, origin, 320, 'motion_home_320.png');
  await scenarioNarrow(page, origin, 390, 'motion_home_390.png');
  await scenarioReduced(page, origin);
  await scenarioScriptOff(page, origin);
  await scenarioDirectory(page, origin);
  await scenarioDirectoryReduced(page, origin);
  await scenarioDirectoryNarrow(page, origin);

  await browser.send('Target.closeTarget', { targetId: page.targetId }).catch(() => {});
} catch (error) {
  failures.push(error.stack || error.message);
} finally {
  await cleanup();
}

if (failures.length) {
  console.error(failures.map((line) => `FAIL ${line}`).join('\n\n'));
  process.exit(1);
}
console.log('browser checks ok');

async function scenarioDesktop(page, origin) {
  await resetMedia(page);
  await size(page, 1280, 800, false);
  await go(page, `${origin}/index.html`);
  await waitFor(page, `document.querySelector('[data-si-marquee]')?.classList.contains('is-animated')`);
  await waitFor(page, `document.querySelector('[data-si-marquee]')?.classList.contains('is-held')`);
  await waitFor(page, `getComputedStyle(document.querySelector('.hero h1')).visibility === 'visible'`);
  const off = await evalPage(page, `(() => {
    const root = document.querySelector('[data-si-marquee]');
    const track = root.querySelector('.si-marquee__track');
    const style = getComputedStyle(track);
    return {
      held: root.classList.contains('is-held'),
      play: style.animationPlayState,
      name: style.animationName,
      groups: root.querySelectorAll('.si-marquee__group').length,
      hiddenGroups: root.querySelectorAll('.si-marquee__group[aria-hidden="true"]').length,
      inert: root.querySelector('.si-marquee__group[aria-hidden="true"]')?.hasAttribute('inert') || false,
      visibleItems: root.querySelectorAll('.si-marquee__group:not([aria-hidden="true"]) li').length,
      tabs: [...root.querySelectorAll('a,button,input,select,textarea,[tabindex]')].filter(el => !el.hidden && el.tabIndex >= 0).length,
      hero: getComputedStyle(document.querySelector('.hero h1')).visibility,
      motion: document.documentElement.classList.contains('js-motion'),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`);
  check(off.held && off.play === 'paused', `offscreen marquee should be paused, got ${JSON.stringify(off)}`);
  check(off.groups === 2 && off.hiddenGroups === 1 && off.inert, `clone should be hidden and inert, got ${JSON.stringify(off)}`);
  check(off.visibleItems === 6 && off.tabs === 1, `one readable list and one tab stop, got ${JSON.stringify(off)}`);
  check(off.hero === 'visible' && off.motion === true, `homepage GSAP reveal should still show the title, got ${JSON.stringify(off)}`);
  check(off.overflow <= 1, `desktop homepage overflow ${off.overflow}px`);

  await reveal(page, '[data-si-marquee]');
  await waitFor(page, `!document.querySelector('[data-si-marquee]').classList.contains('is-held')`);
  const running = await trackState(page);
  check(running.play === 'running' && running.name.includes('si-marquee-scroll'), `in-view marquee should scroll, got ${JSON.stringify(running)}`);
  await shot(page, 'motion_home_desktop_marquee.png');

  const box = await evalPage(page, `(() => { const r = document.querySelector('.si-marquee__viewport').getBoundingClientRect(); return {x:r.x+20,y:r.y+12}; })()`);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  await delay(50);
  const hovered = await trackState(page);
  check(hovered.play === 'paused', `hover should pause, got ${hovered.play}`);
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 });
  await delay(50);
  const left = await trackState(page);
  check(left.play === 'running', `leaving hover should resume, got ${left.play}`);

  await evalPage(page, `document.querySelector('.si-marquee__toggle').click()`);
  const paused = await evalPage(page, `(() => { const b = document.querySelector('.si-marquee__toggle'); return {pressed:b.getAttribute('aria-pressed'), text:b.textContent, play:getComputedStyle(document.querySelector('.si-marquee__track')).animationPlayState}; })()`);
  check(paused.pressed === 'true' && paused.text === 'Play' && paused.play === 'paused', `pause button failed: ${JSON.stringify(paused)}`);
  await evalPage(page, `document.querySelector('.si-marquee__toggle').click()`);
  const played = await trackState(page);
  check(played.play === 'running' && played.pressed === 'false', `play button failed: ${JSON.stringify(played)}`);

  await evalPage(page, `document.querySelector('.si-marquee__toggle').blur()`);
  await delay(30);
  await evalPage(page, `document.querySelector('.si-marquee__toggle').focus()`);
  await delay(30);
  const focused = await trackState(page);
  check(focused.play === 'paused', `focus should pause, got ${JSON.stringify(focused)}`);
  await evalPage(page, `document.querySelector('.si-marquee__toggle').blur()`);
  await delay(30);
  const blurred = await trackState(page);
  check(blurred.play === 'running', `blur should resume, got ${JSON.stringify(blurred)}`);

  const tapped = await evalPage(page, `(() => {
    try {
      const el = document.querySelector('.si-marquee__viewport');
      const r = el.getBoundingClientRect();
      const point = new Touch({ identifier: 1, target: el, clientX: r.x + 24, clientY: r.y + 12 });
      el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, cancelable: true, touches: [point], changedTouches: [point] }));
      el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, cancelable: true, touches: [], changedTouches: [point] }));
      const button = document.querySelector('.si-marquee__toggle');
      return { pressed: button.getAttribute('aria-pressed'), play: getComputedStyle(document.querySelector('.si-marquee__track')).animationPlayState };
    } catch (error) {
      return { error: String(error) };
    }
  })()`);
  check(tapped.pressed === 'true' && tapped.play === 'paused', `touch should pause, got ${JSON.stringify(tapped)}`);
  await evalPage(page, `(() => { const button = document.querySelector('.si-marquee__toggle'); if (button.getAttribute('aria-pressed') === 'true') button.click(); button.blur(); document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo(0, 0); })()`);
  await waitFor(page, `document.querySelector('[data-si-marquee]').classList.contains('is-held')`);
  const away = await trackState(page);
  check(away.play === 'paused' && away.pressed === 'false', `scrolling the marquee offscreen should pause it without a lock, got ${JSON.stringify(away)}`);
  await reveal(page, '[data-si-marquee]');
  const back = await trackState(page);
  check(back.play === 'running', `returning the marquee onscreen should resume it, got ${JSON.stringify(back)}`);

  await evalPage(page, `window.__vis=[];document.addEventListener('visibilitychange',()=>window.__vis.push(document.visibilityState+':'+document.querySelector('[data-si-marquee]').className))`);
  const frozen = await page.send('Page.setWebLifecycleState', { state: 'frozen' }).then(() => true, (error) => error.message);
  if (frozen === true) {
    await page.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
    const state = await Promise.race([
      evalPage(page, `({vis:window.__vis, held:document.querySelector('[data-si-marquee]').classList.contains('is-held'), hidden:document.hidden})`),
      delay(1500).then(() => ({ timeout: true })),
    ]);
    if (state.timeout) {
      console.log('note: page stayed frozen; lifecycle pause was not observable');
    } else {
      const hiddenEntry = Array.isArray(state.vis) ? state.vis.find((entry) => entry.startsWith('hidden:')) : '';
      check(Boolean(hiddenEntry), `backgrounding should hide the page, got ${JSON.stringify(state)}`);
      check(String(hiddenEntry).includes('is-held'), `backgrounding should pause the marquee, got ${JSON.stringify(state)}`);
    }
  } else {
    console.log('note: Page.setWebLifecycleState unavailable:', frozen);
  }
}

async function scenarioNarrow(page, origin, width, file) {
  await size(page, width, 700, true);
  await go(page, `${origin}/index.html`);
  await waitFor(page, `document.querySelector('[data-si-marquee]')?.classList.contains('is-animated')`);
  await reveal(page, '[data-si-marquee]');
  const metrics = await evalPage(page, `(() => {
    const root = document.querySelector('[data-si-marquee]');
    const items = [...root.querySelectorAll('.si-marquee__group:not([aria-hidden="true"]) li')];
    const box = root.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      left: box.left,
      right: box.right,
      width: document.documentElement.clientWidth,
      items: items.length,
    };
  })()`);
  check(metrics.overflow <= 1, `${width}px homepage overflow ${metrics.overflow}px`);
  check(metrics.left >= -1 && metrics.right <= metrics.width + 1,
    `${width}px marquee box ${metrics.left}..${metrics.right} outside ${metrics.width}`);
  await shot(page, file);
}

async function scenarioReduced(page, origin) {
  await size(page, 390, 700, true);
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await go(page, `${origin}/index.html`);
  await delay(200);
  const state = await evalPage(page, `(() => {
    const root = document.querySelector('[data-si-marquee]');
    const items = [...root.querySelectorAll('.si-marquee__group li')];
    const marqueeBox = root.getBoundingClientRect();
    return {
      animated: root.classList.contains('is-animated'),
      groups: root.querySelectorAll('.si-marquee__group').length,
      hiddenButton: document.querySelector('.si-marquee__toggle').hidden,
      names: window.__siAnim || [],
      jsMotion: document.documentElement.classList.contains('js-motion'),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      clipped: items.some(li => li.getBoundingClientRect().bottom > marqueeBox.bottom + 1 || li.getBoundingClientRect().right > marqueeBox.right + 1),
      hero: getComputedStyle(document.querySelector('.hero h1')).visibility,
      texts: items.map(li => li.textContent),
    };
  })()`);
  check(state.animated === false && state.groups === 1 && state.hiddenButton === true,
    `reduced motion should keep a static single list, got ${JSON.stringify(state)}`);
  check(!state.names.includes('si-marquee-scroll'), `reduced motion started the marquee: ${state.names}`);
  check(state.jsMotion === false && state.hero === 'visible', `reduced motion should not pre-hide the hero, got ${JSON.stringify(state)}`);
  check(state.overflow <= 1 && state.clipped === false, `reduced motion 390 overflow/clip ${JSON.stringify(state)}`);
  check(state.texts.length === 6, `reduced motion should show all collections, got ${state.texts}`);
  await reveal(page, '[data-si-marquee]');
  await shot(page, 'motion_home_reduced_390.png');
  await resetMedia(page);
}

async function scenarioScriptOff(page, origin) {
  await size(page, 390, 700, true);
  const disabled = await page.send('Emulation.setScriptExecutionDisabled', { value: true }).then(() => true, (error) => error.message);
  check(disabled === true, `could not disable JavaScript: ${disabled}`);
  await go(page, `${origin}/index.html`);
  await delay(150);
  const state = await evalPage(page, `(() => {
    const root = document.querySelector('[data-si-marquee]');
    return {
      animated: root.classList.contains('is-animated'),
      groups: root.querySelectorAll('.si-marquee__group').length,
      texts: [...root.querySelectorAll('li')].map(li => li.textContent),
      hiddenButton: document.querySelector('.si-marquee__toggle').hidden,
      hero: document.querySelector('.hero h1')?.textContent || '',
      search: !!document.querySelector('#home-search'),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`);
  check(state.animated === false && state.groups === 1 && state.texts.length === 6 && state.hiddenButton === true,
    `no-JS marquee should stay readable, got ${JSON.stringify(state)}`);
  check(state.hero.includes('Super Intelligence') && state.search && state.overflow <= 1,
    `no-JS homepage content/overflow failed: ${JSON.stringify(state)}`);
  await reveal(page, '[data-si-marquee]');
  await shot(page, 'motion_home_nojs_390.png');
  await page.send('Emulation.setScriptExecutionDisabled', { value: false });
}

async function scenarioDirectory(page, origin) {
  await resetMedia(page);
  await size(page, 1280, 900, false);
  await go(page, `${origin}/directory.html`);
  await waitFor(page, `document.querySelector('[data-results] .result')`, 12000);
  await waitFor(page, `document.querySelector('[data-si-stagger], [data-results].is-staggering')`, 2000);
  await reveal(page, '[data-results] .result');
  await shot(page, 'motion_directory_stagger.png');
  await waitFor(page, `!document.querySelector('[data-results]').classList.contains('is-staggering')`, 2500);
  const state = await evalPage(page, `(() => {
    const rows = [...document.querySelectorAll('[data-results] > .result')];
    const marked = rows.filter(row => row.hasAttribute('data-si-stagger'));
    return {
      count: rows.length,
      marked: marked.length,
      staggering: document.querySelector('[data-results]').classList.contains('is-staggering'),
      opacity: rows.slice(0, 5).map(row => getComputedStyle(row).opacity),
      names: (window.__siAnim || []).filter(name => name === 'si-stagger-in').length,
      link: rows[0]?.querySelector('a')?.getAttribute('href') || '',
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  })()`);
  check(state.marked === 5 && state.staggering === false, `stagger should run once on five rows then clear, got ${JSON.stringify(state)}`);
  check(state.names >= 5, `expected stagger animationstart events, got ${state.names}`);
  check(state.opacity.every((value) => Number(value) > 0.95), `rows stuck hidden: ${state.opacity}`);
  check(state.link.startsWith('http') && state.overflow <= 1, `directory link/overflow failed: ${JSON.stringify(state)}`);
  await shot(page, 'motion_directory_desktop.png');

  await evalPage(page, `document.querySelector('[data-source="public"]').click()`);
  await delay(100);
  const again = await evalPage(page, `(() => {
    const rows = [...document.querySelectorAll('[data-results] > .result')];
    return {
      marked: rows.filter(row => row.hasAttribute('data-si-stagger')).length,
      staggering: document.querySelector('[data-results]').classList.contains('is-staggering'),
      count: rows.length,
    };
  })()`);
  check(again.count > 0 && again.marked === 0 && again.staggering === false,
    `filtering must not replay stagger, got ${JSON.stringify(again)}`);
}

async function scenarioDirectoryReduced(page, origin) {
  await size(page, 1280, 900, false);
  await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await go(page, `${origin}/directory.html`);
  await waitFor(page, `document.querySelector('[data-results] .result')`, 12000);
  await delay(250);
  const state = await evalPage(page, `(() => {
    const rows = [...document.querySelectorAll('[data-results] > .result')];
    return {
      marked: rows.filter(row => row.hasAttribute('data-si-stagger')).length,
      names: (window.__siAnim || []).includes('si-stagger-in'),
      opacity: getComputedStyle(rows[0]).opacity,
    };
  })()`);
  check(state.marked === 0 && state.names === false && Number(state.opacity) > 0.95,
    `reduced motion directory should not stagger, got ${JSON.stringify(state)}`);
  await resetMedia(page);
}

async function scenarioDirectoryNarrow(page, origin) {
  for (const width of [320, 390]) {
    await size(page, width, 700, true);
    await go(page, `${origin}/directory.html`);
    await waitFor(page, `document.querySelector('.journey')`);
    await delay(400);
    const overflow = await evalPage(page, `document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    check(overflow <= 1, `directory ${width}px overflow ${overflow}px`);
  }
  await shot(page, 'motion_directory_390.png');
}

async function reveal(page, selector) {
  await evalPage(page, `document.documentElement.style.scrollBehavior='auto';document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',behavior:'instant'})`);
  await delay(60);
}

async function trackState(page) {
  return evalPage(page, `(() => {
    const root = document.querySelector('[data-si-marquee]');
    const button = root.querySelector('.si-marquee__toggle');
    const track = root.querySelector('.si-marquee__track');
    return {
      play: getComputedStyle(track).animationPlayState,
      name: getComputedStyle(track).animationName,
      pressed: button.getAttribute('aria-pressed'),
      held: root.classList.contains('is-held'),
    };
  })()`);
}

async function resetMedia(page) {
  await page.send('Emulation.setEmulatedMedia', { media: '', features: [] });
}

async function size(page, width, height, mobile) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile,
  });
}

async function go(page, url) {
  await page.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
  await page.send('Page.navigate', { url });
  await waitFor(page, `document.readyState === 'complete'`, 8000);
  await delay(40);
}

async function waitFor(page, expression, timeout = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await evalPage(page, expression);
    if (value) return value;
    await delay(40);
  }
  throw new Error(`timed out waiting for ${expression}`);
}

async function evalPage(page, expression) {
  const { result, exceptionDetails } = await page.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (exceptionDetails) {
    throw new Error(exceptionDetails.text || exceptionDetails.exception?.description || expression);
  }
  return result?.value;
}

async function shot(page, name) {
  const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(artifacts, name), Buffer.from(data, 'base64'));
  console.log('screenshot', name);
}

async function waitForHttp(url) {
  const start = Date.now();
  while (Date.now() - start < 8000) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch { /* server still starting */ }
    await delay(40);
  }
  throw new Error(`server did not start for ${url}`);
}

async function waitForJson(url) {
  const start = Date.now();
  let last = '';
  while (Date.now() - start < 8000) {
    try {
      const response = await fetch(url);
      if (response.ok) return response.json();
      last = `${response.status}`;
    } catch (error) { last = error.message; }
    await delay(40);
  }
  throw new Error(`chrome debugging port not ready (${last}) ${chromeLog.slice(-500)}`);
}

function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  const listeners = new Map();
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
    session(sessionId) {
      return {
        targetId: sessionId,
        send(method, params = {}) { return api.send(method, params, sessionId); },
        waitLoad: null,
      };
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
    if (message.method === 'Page.loadEventFired' && message.sessionId) {
      // Delivered below once we can see the session wrapper. Stored on a map.
      const waiter = loaders.get(message.sessionId);
      if (waiter) waiter();
    }
  });
  const loaders = new Map();
  const originalSession = api.session.bind(api);
  api.session = (sessionId) => {
    const page = originalSession(sessionId);
    const realSend = page.send.bind(page);
    page.send = async (method, params) => {
      if (method === 'Page.navigate') {
        const pendingLoad = new Promise((resolve) => {
          const timer = setTimeout(resolve, 8000);
          loaders.set(sessionId, () => { clearTimeout(timer); loaders.delete(sessionId); resolve(); });
        });
        const result = await realSend(method, params);
        await pendingLoad;
        return result;
      }
      return realSend(method, params);
    };
    return page;
  };
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(api));
    ws.addEventListener('error', () => reject(new Error('chrome websocket failed')));
  });
}
