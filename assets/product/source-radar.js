(() => {
  'use strict';
  const root = document.querySelector('#radar-items'), status = document.querySelector('#radar-status'), coverage = document.querySelector('#radar-coverage');
  const allowed = new Set(['www.mddi.gov.sg', 'www.imda.gov.sg', 'aisingapore.org', 'www.smartnation.gov.sg']);
  const date = value => value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium' }).format(new Date(value)) : 'Not confirmed';
  async function load(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('Source list unavailable');
    const data = await response.json();
    if (data.version !== 1 || !Array.isArray(data.items) || !Number.isFinite(Date.parse(data.checked_at))) throw new Error('Invalid source list');
    return data;
  }
  function render(data, saved) {
    root.replaceChildren();
    if (coverage) {
      coverage.replaceChildren();
      if (Array.isArray(data.coverage)) {
        for (const item of data.coverage) {
          if (typeof item?.provider !== 'string' || !['checked', 'unavailable'].includes(item.state)) continue;
          const chip = document.createElement('span'); chip.className = 'coverage-chip'; chip.dataset.state = item.state;
          chip.textContent = item.state === 'checked' ? `${item.provider} · ${Number.isInteger(item.listed) ? item.listed : 0} shown` : `${item.provider} · awaiting reliable check`;
          coverage.append(chip);
        }
      }
      coverage.hidden = !coverage.childElementCount;
    }
    const refreshed = new Intl.DateTimeFormat('en-SG', { timeZone: 'Asia/Singapore', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(data.checked_at));
    const stale = Date.now() - Date.parse(data.checked_at) > 48 * 3600000;
    status.textContent = `${saved ? 'Saved snapshot · ' : ''}Last collected ${refreshed} SGT.${stale ? ' Collection is overdue; these links may have changed.' : ''}${saved ? ' Latest refresh unavailable.' : ''}`;
    for (const item of data.items.slice(0, 12)) {
      let url; try { url = new URL(item.url); } catch { continue; }
      if (url.protocol !== 'https:' || !allowed.has(url.hostname) || typeof item.title !== 'string') continue;
      const article = document.createElement('article'); article.className = 'entry';
      const provider = document.createElement('span'); provider.className = 'date'; provider.textContent = item.provider;
      const body = document.createElement('div'), heading = document.createElement('h2'), link = document.createElement('a');
      link.href = url.href; link.textContent = item.title; heading.append(link);
      const note = document.createElement('p'); note.textContent = item.status === 'source_reviewed' ? 'Source reviewed · read the original for details' : item.status === 'cited_source' ? 'Cited in the Lab · automatically checked' : 'Automated discovery · awaiting editorial review';
      const dates = document.createElement('p'); dates.className = 'evidence-line'; dates.textContent = `Article publication: ${date(item.published_at)} · Page modified: ${date(item.source_updated_at)}`;
      body.append(heading, note, dates); article.append(provider, body); root.append(article);
    }
    if (!root.childElementCount) { const empty = document.createElement('p'); empty.textContent = 'No new source candidates to show. Explore the reviewed Navigator or Field Notes below.'; root.append(empty); }
  }
  load('https://raw.githubusercontent.com/jtsgai/superintelligencesg-org/main/assets/product/source-radar.json').then(data => render(data, false)).catch(() => load('/assets/product/source-radar-snapshot.json').then(data => render(data, true)).catch(() => { status.textContent = 'The source list is temporarily unavailable. You can still browse the official publishers below.'; }));
})();
