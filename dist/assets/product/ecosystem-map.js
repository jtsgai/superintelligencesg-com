(() => {
  'use strict';
  // Cluster view of Navigator entries by kind. Layout is deterministic: no rank or relationship is encoded.
  const NS = 'http://www.w3.org/2000/svg', W = 1200, H = 760, $ = s => document.querySelector(s);
  const svg = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
  const date = value => { const d = new Date(value); return Number.isNaN(d.valueOf()) ? '' : d.toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Singapore' }); };
  const state = x => x.source === 'community' ? 'self' : x.checked_at ? 'checked' : 'review';
  const stateText = x => ({ self: 'Self-submitted', checked: 'Checked ' + date(x.checked_at), review: 'Needs review' })[state(x)];
  const entryURL = x => 'directory.html?entry=' + encodeURIComponent(x.id);

  function groups(entries) {
    const map = new Map();
    entries.forEach(x => { const k = x.kind || 'Other'; if (!map.has(k)) map.set(k, []); map.get(k).push(x); });
    return [...map].map(([kind, rows]) => ({ kind, rows: rows.sort((a, b) => a.name.localeCompare(b.name)) })).sort((a, b) => b.rows.length - a.rows.length || a.kind.localeCompare(b.kind));
  }

  function layout(clusters) {
    const others = clusters.length - 1, rx = 420, ry = 250;
    const spacing = Math.min(13, others ? (2 * Math.PI * Math.sqrt((rx * rx + ry * ry) / 2) / others) / (2 * Math.sqrt(Math.max(...clusters.slice(1).map(c => c.rows.length), 1)) + 4) : 13);
    clusters.forEach((c, i) => {
      if (i === 0) { c.x = W / 2; c.y = H / 2 - 10; } else { const a = -Math.PI / 2 + (i - 1) * 2 * Math.PI / others; c.x = W / 2 + rx * Math.cos(a); c.y = H / 2 - 10 + ry * Math.sin(a); }
      c.r = spacing * Math.sqrt(c.rows.length + .5) + 16;
      c.rows.forEach((x, j) => { const r = spacing * Math.sqrt(j + 1), t = (j + 1) * 2.39996; x._x = c.x + r * Math.cos(t); x._y = c.y + r * Math.sin(t); });
    });
  }

  function lattice(g) {
    // Decorative wireframe background, seeded so it is identical on every load.
    let seed = 7; const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const pts = []; for (let y = 30; y < H; y += 74) for (let x = 30; x < W; x += 92) pts.push([x + (rand() - .5) * 50, y + (rand() - .5) * 40]);
    pts.forEach((p, i) => pts.slice(i + 1).filter(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < 112).forEach(q => g.append(svg('line', { x1: p[0], y1: p[1], x2: q[0], y2: q[1] }))));
  }

  function draw(entries) {
    const clusters = groups(entries); layout(clusters);
    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'map-svg', 'aria-labelledby': 'map-title' });
    const defs = svg('defs'), glow = svg('filter', { id: 'glow', x: '-100%', y: '-100%', width: '300%', height: '300%' });
    glow.append(svg('feGaussianBlur', { stdDeviation: '2.4', result: 'b' })); const merge = svg('feMerge'); merge.append(svg('feMergeNode', { in: 'b' }), svg('feMergeNode', { in: 'SourceGraphic' })); glow.append(merge); defs.append(glow); root.append(defs);
    const bg = svg('g', { class: 'grid', 'aria-hidden': 'true' }); lattice(bg); root.append(bg);
    const nodes = [];
    clusters.forEach(c => {
      const g = svg('g', { role: 'group', 'aria-label': `${c.kind}, ${c.rows.length} ${c.rows.length === 1 ? 'entry' : 'entries'}` });
      const deco = svg('g', { 'aria-hidden': 'true' });
      deco.append(svg('circle', { class: 'ring', cx: c.x, cy: c.y, r: c.r }));
      c.rows.forEach(x => deco.append(svg('line', { class: 'spoke', x1: c.x, y1: c.y, x2: x._x, y2: x._y })));
      deco.append(svg('circle', { class: 'hub', cx: c.x, cy: c.y, r: 4 }));
      const label = svg('text', { class: 'cluster-label', x: c.x, y: c.y + c.r + 22, 'text-anchor': 'middle' }); label.textContent = c.kind;
      const count = svg('text', { class: 'cluster-count', x: c.x, y: c.y + c.r + 40, 'text-anchor': 'middle' }); count.textContent = String(c.rows.length);
      deco.append(label, count); g.append(deco);
      c.rows.forEach((x, j) => {
        const a = svg('a', { class: 'node', href: entryURL(x), 'data-state': state(x), 'data-cluster': c.kind, 'aria-label': `${x.name}. ${c.kind}. ${stateText(x)}.` });
        a.append(svg('circle', { cx: x._x, cy: x._y, r: 6 }));
        a._entry = x; a._first = j === 0; nodes.push(a); g.append(a);
      });
      root.append(g);
    });
    const tip = svg('g', { class: 'tip', 'aria-hidden': 'true', visibility: 'hidden' }), box = svg('rect', { rx: 6, height: 44 }), name = svg('text'), sub = svg('text', { class: 'tip-sub' });
    tip.append(box, name, sub); root.append(tip);
    const show = a => { const x = a._entry; name.textContent = x.name; sub.textContent = (x.kind || '') + ' · ' + stateText(x); tip.setAttribute('visibility', 'visible'); const w = Math.max(name.getComputedTextLength(), sub.getComputedTextLength()) + 24; let tx = x._x + 14, ty = x._y - 54; if (tx + w > W - 8) tx = x._x - 14 - w; if (ty < 8) ty = x._y + 14; box.setAttribute('x', tx); box.setAttribute('y', ty); box.setAttribute('width', w); name.setAttribute('x', tx + 12); name.setAttribute('y', ty + 19); sub.setAttribute('x', tx + 12); sub.setAttribute('y', ty + 35); };
    const hide = () => tip.setAttribute('visibility', 'hidden');
    nodes.forEach((a, i) => {
      a.addEventListener('mouseenter', () => show(a)); a.addEventListener('mouseleave', hide); a.addEventListener('focus', () => show(a)); a.addEventListener('blur', hide);
      a.addEventListener('keydown', e => {
        let to = null;
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = nodes[(i + 1) % nodes.length];
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = nodes[(i - 1 + nodes.length) % nodes.length];
        else if (e.key === 'Home') to = nodes[0];
        else if (e.key === 'End') to = nodes[nodes.length - 1];
        else if (e.key === 'PageDown') to = nodes.slice(i + 1).find(n => n._first) || nodes[0];
        else if (e.key === 'PageUp') { const before = nodes.slice(0, a._first ? i : i + 1).filter(n => n._first); to = before[before.length - 1] || nodes.filter(n => n._first).pop(); }
        if (to) { e.preventDefault(); to.focus(); }
      });
    });
    $('#map-canvas').replaceChildren(root);
    return clusters;
  }

  function list(clusters) {
    const grid = $('#map-list-grid'); grid.replaceChildren();
    clusters.forEach(c => {
      const s = el('section'), h = el('h3', c.kind), ul = el('ul'); h.append(el('span', String(c.rows.length))); s.append(h, ul);
      c.rows.forEach(x => { const li = el('li'), a = el('a'), tag = el('small', stateText(x)); a.href = entryURL(x); tag.dataset.state = state(x); a.append(el('span', x.name), tag); li.append(a); ul.append(li); });
      grid.append(s);
    });
  }

  const narrow = matchMedia('(max-width: 720px)'), details = $('#map-list');
  // The list ships open (the mobile view); wide screens start with it collapsed under the map.
  details.open = narrow.matches;
  narrow.addEventListener('change', () => { if (narrow.matches) details.open = true; });

  SIData.load().then(data => {
    const entries = data.entries.filter(x => x && x.id && x.name);
    const clusters = draw(entries); list(clusters);
    const when = window.SIData?.formatUpdated?.(data.updated) || '';
    $('#map-status').textContent = `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} · ${clusters.length} areas of work · ` + (data.origin === 'live' ? 'Live data' : 'Offline snapshot') + (when ? ' · Updated ' + when : '');
  }).catch(() => { $('#map-status').textContent = 'The map data could not be loaded. Try the Navigator search instead.'; });
})();
