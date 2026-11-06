// Quiet motion for .com only. No dependency beyond this file.
// Homepage marquee: existing collection labels, paused offscreen, in the background,
// on hover, focus, keyboard, and tap. Directory results: one slight stagger.
// Homepage .index-row and .door already stagger in motion-home.js. Do not restagger them.
(() => {
  'use strict';

  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  function setupMarquee(root) {
    const track = root.querySelector('.si-marquee__track');
    const viewport = root.querySelector('.si-marquee__viewport');
    const button = root.querySelector('.si-marquee__toggle');
    const source = track && track.querySelector('.si-marquee__group');
    if (!track || !viewport || !button || !source) return;

    let locked = false;
    let focused = false;
    let resumeWhileFocused = false;
    let hovering = false;
    let inView = false;

    function removeClone() {
      track.querySelector('[data-si-marquee-clone]')?.remove();
    }

    function ensureClone() {
      if (track.querySelector('[data-si-marquee-clone]')) return;
      const clone = source.cloneNode(true);
      clone.setAttribute('aria-hidden', 'true');
      clone.setAttribute('inert', '');
      clone.dataset.siMarqueeClone = '';
      track.append(clone);
    }

    function hold() {
      const focusHold = focused && !resumeWhileFocused;
      return locked || hovering || focusHold || document.hidden || !inView;
    }

    function apply() {
      if (reduceQuery.matches) {
        removeClone();
        root.classList.remove('is-animated', 'is-held');
        button.hidden = true;
        return;
      }
      ensureClone();
      root.classList.add('is-animated');
      button.hidden = false;
      root.classList.toggle('is-held', hold());
      button.setAttribute('aria-pressed', String(locked));
      button.textContent = locked ? 'Play' : 'Pause';
      button.setAttribute('aria-label', locked ? 'Play scrolling collections' : 'Pause scrolling collections');
    }

    button.addEventListener('click', () => {
      locked = !locked;
      // A Play activation keeps the ticker moving while the button itself stays focused.
      // The next focus entry (tabbing back) pauses again.
      resumeWhileFocused = !locked && root.contains(document.activeElement);
      apply();
    });

    root.addEventListener('focusin', () => {
      resumeWhileFocused = false;
      focused = true;
      apply();
    });

    root.addEventListener('focusout', (event) => {
      if (root.contains(event.relatedTarget)) return;
      focused = false;
      resumeWhileFocused = false;
      apply();
    });

    root.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'touch') return;
      hovering = true;
      apply();
    });
    root.addEventListener('pointerleave', (event) => {
      if (event.pointerType === 'touch') return;
      hovering = false;
      apply();
    });

    let touchStart = null;
    viewport.addEventListener('touchstart', (event) => {
      const point = event.changedTouches && event.changedTouches[0];
      if (!point) return;
      touchStart = { x: point.clientX, y: point.clientY };
    }, { passive: true });
    viewport.addEventListener('touchend', (event) => {
      const point = event.changedTouches && event.changedTouches[0];
      const start = touchStart;
      touchStart = null;
      if (!point || !start) return;
      if (Math.hypot(point.clientX - start.x, point.clientY - start.y) > 10) return;
      locked = !locked;
      resumeWhileFocused = !locked && root.contains(document.activeElement);
      apply();
    }, { passive: true });

    document.addEventListener('visibilitychange', apply);
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        inView = entries.some((entry) => entry.isIntersecting);
        apply();
      }, { threshold: 0 });
      observer.observe(root);
    } else {
      inView = true;
    }

    reduceQuery.addEventListener?.('change', apply);
    apply();
  }

  function setupStagger() {
    const results = document.querySelector('[data-results]');
    if (!results) return;
    let played = false;
    let observer = null;

    function clear() {
      results.classList.remove('is-staggering');
    }

    function arm() {
      if (played || reduceQuery.matches) return;
      const rows = [...results.querySelectorAll(':scope > .result')];
      if (!rows.length) return;
      played = true;
      observer?.disconnect();
      const chosen = rows.slice(0, 5);
      chosen.forEach((row, index) => {
        row.dataset.siStagger = String(index);
        row.style.setProperty('--si-i', String(index));
      });
      results.classList.add('is-staggering');
      let pending = chosen.length;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clear();
      };
      const done = (event) => {
        const row = event.currentTarget;
        if (row.dataset.siStaggerDone) return;
        row.dataset.siStaggerDone = '1';
        pending -= 1;
        if (pending <= 0) finish();
      };
      chosen.forEach((row) => {
        row.addEventListener('animationend', done);
        row.addEventListener('animationcancel', done);
      });
      window.setTimeout(finish, 1200);
    }

    observer = new MutationObserver(arm);
    observer.observe(results, { childList: true });
    reduceQuery.addEventListener?.('change', () => {
      if (reduceQuery.matches) clear();
    });
    arm();
  }

  const marquee = document.querySelector('[data-si-marquee]');
  if (marquee) setupMarquee(marquee);
  setupStagger();
})();
