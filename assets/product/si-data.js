(() => {
  'use strict';
  // Navigator data: the Commons API first. organizations.json is the offline snapshot if that request fails or times out.
  const ORIGIN = 'https://api.superintelligencesg.org';
  const ENTRIES = ORIGIN + '/v1/entries?type=organization';
  const STATS = ORIGIN + '/v1/stats';
  const TIMEOUT = 4000;
  const STATIC = new URL('organizations.json', document.currentScript?.src || location.href).href;
  const checked = x => x.checked_at || x.evidence?.checked_at || null;

  function logoOf(x) {
    const logo = x.logo || x.logo_url || '';
    if (typeof logo !== 'string' || !logo) return '';
    if (logo.startsWith('data:')) return logo.startsWith('data:image/') ? logo : '';
    return logo;
  }
  function founderLine(value) {
    const name = typeof value === 'string' ? value.trim() : '';
    if (!name) return '';
    return name.startsWith('Founded by ') ? name : 'Founded by ' + name;
  }
  function curated(x) {
    return { id: x.id, name: x.name, founder: x.founder, description: x.description, kind: x.kind, source: 'public', url: x.url, logo: logoOf(x), updated: x.updated, lenses: Array.isArray(x.lenses) ? x.lenses : [], evidence: x.evidence, checked_at: checked(x) };
  }
  function commons(x) {
    return { id: x.id, name: x.name, founder: founderLine(x.founder), description: x.description, kind: x.kind || 'Organization', source: 'community', url: x.profile_url || x.url, logo: logoOf(x), updated: x.updated, lenses: ['community'], location: x.location || '', collaboration: x.collaboration || 'unspecified', collaboration_note: x.collaboration_note || '', verification_status: x.verification_status || x.evidence?.verification_status, checked_at: null };
  }
  function mapEntry(x) {
    if (!x || x.published === false) return null;
    if (x.type && x.type !== 'organization') return null;
    if (!x.id || !x.name) return null;
    return x.origin === 'commons' || x.source === 'community' ? commons(x) : curated(x);
  }
  function stamp(entries) {
    const dates = [];
    entries.forEach(entry => [entry.updated, entry.checked_at, entry.evidence?.checked_at, entry.evidence?.record_updated_at].forEach(value => { if (typeof value === 'string' && value) dates.push(value); }));
    dates.sort();
    return dates.length ? dates[dates.length - 1] : '';
  }
  function formatUpdated(value) {
    if (!value) return '';
    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    const parsed = dateOnly ? new Date(Date.UTC(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3])) : new Date(value);
    if (Number.isNaN(parsed.valueOf())) return '';
    const date = new Intl.DateTimeFormat('en-SG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: dateOnly ? 'UTC' : 'Asia/Singapore' }).format(parsed);
    if (dateOnly) return date;
    const time = new Intl.DateTimeFormat('en-SG', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Singapore' }).format(parsed);
    return date + ', ' + time + ' SGT';
  }
  function fail(code, error) {
    const wrapped = new Error(error && error.message ? error.message : String(code));
    wrapped.name = error && error.name || 'Error';
    wrapped.code = code;
    return wrapped;
  }
  function classify(error) {
    if (error && typeof error.code === 'string') return error.code;
    const name = error && error.name;
    const message = String(error && error.message || '');
    if (name === 'TimeoutError' || /timed out/i.test(message)) return 'timeout';
    if (name === 'AbortError') return 'abort';
    if (error instanceof SyntaxError) return 'format';
    return 'network';
  }
  async function readJson(response) {
    try { return await response.json(); }
    catch (error) { throw fail('format', error); }
  }
  function timedSignal(controller) {
    return AbortSignal.any([controller.signal, AbortSignal.timeout(TIMEOUT)]);
  }
  async function live(signal) {
    let response;
    try { response = await fetch(ENTRIES, { signal }); }
    catch (error) { throw fail(classify(error), error); }
    if (!response.ok) throw fail('http', new Error('HTTP ' + response.status));
    const data = await readJson(response);
    if (!data || !Array.isArray(data.entries)) throw fail('format', new Error('Unexpected data shape'));
    const entries = data.entries.map(mapEntry).filter(Boolean);
    if (data.entries.length && !entries.length) throw fail('format', new Error('Unexpected data shape'));
    return { origin: 'live', entries, updated: stamp(entries) };
  }
  async function bundled(signal) {
    let response;
    try { response = await fetch(STATIC, { signal }); }
    catch (error) { throw fail(classify(error), error); }
    if (!response.ok) throw fail('http', new Error('HTTP ' + response.status));
    const data = await readJson(response);
    if (!Array.isArray(data)) throw fail('format', new Error('Unexpected data shape'));
    const entries = data.map(mapEntry).filter(Boolean);
    if (data.length && !entries.length) throw fail('format', new Error('Unexpected data shape'));
    return { origin: 'fallback', entries, updated: stamp(entries) };
  }
  let generation = 0;
  let controllers = [];
  let pending = null;
  function track(controller) { controllers.push(controller); return controller; }
  function load() {
    if (pending) return pending;
    const gen = generation;
    const controller = track(new AbortController());
    pending = live(timedSignal(controller)).catch(error => {
      if (gen !== generation || controller.signal.aborted) throw fail('abort', error);
      const snap = track(new AbortController());
      return bundled(timedSignal(snap)).catch(snapError => {
        if (gen !== generation || snap.signal.aborted) throw fail('abort', snapError);
        const liveCode = classify(error);
        const snapCode = classify(snapError);
        const code = snapCode === 'timeout' ? 'timeout' : snapCode === 'format' ? 'format' : liveCode === 'timeout' ? 'timeout' : liveCode === 'format' ? 'format' : 'unavailable';
        throw fail(code, snapError);
      });
    });
    return pending;
  }
  function statsFrom(pack) {
    const by_kind = {};
    pack.entries.forEach(entry => { const kind = entry.kind || 'Organization'; by_kind[kind] = (by_kind[kind] || 0) + 1; });
    return { origin: pack.origin === 'live' ? 'live' : 'fallback', source: 'entries', stats: { version: 1, total: pack.entries.length, by_type: { organization: pack.entries.length }, by_kind }, updated: pack.updated };
  }
  async function liveStats(signal) {
    let response;
    try { response = await fetch(STATS, { signal }); }
    catch (error) { throw fail(classify(error), error); }
    if (!response.ok) throw fail('http', new Error('HTTP ' + response.status));
    const stats = await readJson(response);
    if (!stats || typeof stats.total !== 'number' || !stats.by_type || typeof stats.by_type !== 'object') throw fail('format', new Error('Unexpected data shape'));
    return { origin: 'live', source: 'stats', stats, updated: response.headers.get('date') || '' };
  }
  let statsPending = null;
  function stats() {
    if (statsPending) return statsPending;
    const gen = generation;
    const controller = track(new AbortController());
    statsPending = liveStats(timedSignal(controller)).catch(async error => {
      if (gen !== generation || controller.signal.aborted) throw fail('abort', error);
      return statsFrom(await load());
    });
    return statsPending;
  }
  function reload() {
    generation += 1;
    controllers.forEach(controller => controller.abort());
    controllers = [];
    pending = null;
    statsPending = null;
    return Promise.all([stats(), load()]);
  }
  load().catch(() => {});
  window.SIData = { load, stats, reload, formatUpdated, API: ENTRIES, STATS, checked };
})();
