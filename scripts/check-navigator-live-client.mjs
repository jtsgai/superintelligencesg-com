import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../assets/product/si-data.js', import.meta.url), 'utf8');
const fail = message => { throw new Error(message); };

function boot(fetchImpl, src = 'https://superintelligencesg.com/assets/product/si-data.js') {
  const sandbox = {
    document: { currentScript: { src } },
    window: {},
    fetch: fetchImpl,
    AbortSignal,
    URL,
    Intl,
    Error,
    console
  };
  vm.runInNewContext(source, sandbox, { filename: 'si-data.js' });
  return sandbox.window.SIData;
}

const json = (body, { ok = true, status = 200, date = '' } = {}) => Promise.resolve({
  ok,
  status,
  headers: { get: name => (name.toLowerCase() === 'date' ? date : null) },
  json: async () => body
});

const live = boot(async url => {
  const href = String(url);
  if (href.endsWith('/v1/entries?type=organization')) {
    return json({
      entries: [
        { id: 'hidden', name: 'Hidden', url: 'https://example.com/hidden', origin: 'curated', source: 'public', type: 'organization', published: false, updated: '2026-01-01' },
        { id: 'event-1', name: 'Event', url: 'https://example.com/event', origin: 'curated', source: 'public', type: 'event', updated: '2026-01-02' },
        { id: 'public-shown', name: 'Shown Lab', founder: 'Shown', description: 'Public', kind: 'Research', url: 'https://example.com/shown', origin: 'curated', source: 'public', type: 'organization', updated: '2026-10-01', checked_at: '2026-10-28', logo: 'assets/navigator/shown.png' },
        { id: '9dead00b-115e-4312-8d4d-6a4f2904a958', name: 'Commons Org', founder: 'Founded by Already', description: 'Profile', kind: 'Organization', url: 'https://example.org', profile_url: 'https://superintelligencesg.org/organizations.html?id=9dead00b-115e-4312-8d4d-6a4f2904a958', origin: 'commons', type: 'organization', updated: '2026-09-27', logo_url: 'data:image/webp;base64,AAAA', evidence: { verification_status: 'submitted' } }
      ]
    });
  }
  fail('unexpected fetch ' + href);
});

const loaded = await live.load();
if (loaded.origin !== 'live') fail('expected live origin');
if (loaded.entries.map(entry => entry.id).join() !== 'public-shown,9dead00b-115e-4312-8d4d-6a4f2904a958') fail('published:false and non-organization entries must be hidden');
const community = loaded.entries[1];
if (community.source !== 'community' || community.founder !== 'Founded by Already' || community.logo !== 'data:image/webp;base64,AAAA') fail('community mapping should keep an image data URI and the founder line');
if (community.url !== 'https://superintelligencesg.org/organizations.html?id=9dead00b-115e-4312-8d4d-6a4f2904a958') fail('community link should be the Commons profile');
if (loaded.updated !== '2026-10-28') fail('updated stamp should be the latest check date, got ' + loaded.updated);
if (live.formatUpdated('2026-10-28') !== '28 Oct 2026') fail('date-only formatting changed: ' + live.formatUpdated('2026-10-28'));

const fallback = boot(async url => {
  const href = String(url);
  if (href.includes('/v1/entries')) throw new Error('offline');
  if (href.endsWith('/v1/stats')) throw new Error('offline');
  if (href.endsWith('organizations.json')) {
    return json([
      { id: 'public-keep', name: 'Keep', url: 'https://example.com/keep', source: 'public', type: 'organization', updated: '2026-09-01' },
      { id: 'public-hide', name: 'Hide', url: 'https://example.com/hide', source: 'public', published: false, updated: '2026-09-02' }
    ]);
  }
  fail('unexpected fetch ' + href);
});
const offline = await fallback.load();
if (offline.origin !== 'fallback') fail('API failure should use the snapshot');
if (offline.entries.length !== 1 || offline.entries[0].id !== 'public-keep' || offline.entries[0].source !== 'public') fail('snapshot must also hide published:false');
const offlineStats = await fallback.stats();
if (offlineStats.origin !== 'fallback' || offlineStats.source !== 'entries' || offlineStats.stats.by_type.organization !== 1) fail('stats should fall back to the filtered snapshot');

const counted = boot(async url => {
  const href = String(url);
  if (href.endsWith('/v1/entries?type=organization')) return json({ entries: [{ id: 'public-a', name: 'A', url: 'https://example.com/a', origin: 'curated', source: 'public', type: 'organization', updated: '2026-10-12' }] });
  if (href.endsWith('/v1/stats')) return json({ version: 1, total: 101, by_type: { organization: 101 }, by_kind: { Research: 9 } }, { date: 'Wed, 28 Oct 2026 01:10:44 GMT' });
  fail('unexpected fetch ' + href);
});
const stats = await counted.stats();
if (stats.source !== 'stats' || stats.stats.by_type.organization !== 101 || !stats.updated) fail('live stats were not preserved');
const formatted = counted.formatUpdated(stats.updated);
if (!formatted.includes('2026') || !formatted.includes('SGT')) fail('HTTP date was not formatted with a Singapore time: ' + formatted);

console.log('Navigator client check passed.');
