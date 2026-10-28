(() => {
  'use strict';
  // Navigator data: the live API first (curated + Commons), the bundled public references if it fails or times out.
  const API = 'https://api.superintelligencesg.org/v1/entries', TIMEOUT = 5000;
  const STATIC = new URL('organizations.json', document.currentScript?.src || location.href).href;
  const checked = x => x.checked_at || x.evidence?.checked_at || null;
  function curated(x) {
    return { id: x.id, name: x.name, founder: x.founder, description: x.description, kind: x.kind, source: 'public', url: x.url, logo: x.logo || x.logo_url, updated: x.updated, lenses: Array.isArray(x.lenses) ? x.lenses : [], evidence: x.evidence, checked_at: checked(x) };
  }
  function commons(x) {
    return { id: x.id, name: x.name, founder: 'Founded by ' + x.founder, description: x.description, kind: x.kind || 'Organization', source: 'community', url: x.profile_url, logo: x.logo_url, updated: x.updated, lenses: ['community'], location: x.location || '', collaboration: x.collaboration || 'unspecified', collaboration_note: x.collaboration_note || '', verification_status: x.evidence?.verification_status, checked_at: null };
  }
  async function live() {
    const response = await fetch(API, { signal: AbortSignal.timeout(TIMEOUT) });
    if (!response.ok) throw Error('HTTP ' + response.status);
    const data = await response.json();
    if (!Array.isArray(data.entries) || !data.entries.length) throw Error('Unexpected data shape');
    return { origin: 'live', entries: data.entries.map(x => x.origin === 'commons' ? commons(x) : curated(x)) };
  }
  async function bundled() {
    const response = await fetch(STATIC);
    if (!response.ok) throw Error('HTTP ' + response.status);
    const data = await response.json();
    return { origin: 'fallback', entries: data.map(curated) };
  }
  let pending = null;
  // Starts on script execution so the request overlaps page parsing; every caller shares the result.
  function load() { return pending || (pending = live().catch(() => bundled())); }
  load().catch(() => {});
  window.SIData = { load, API, checked };
})();
