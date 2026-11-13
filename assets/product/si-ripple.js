// Ripple for .com primary actions marked data-si-ripple. Decorative only: it listens
// passively, never calls preventDefault, and never delays navigation or form submit.
// click covers mouse, touch, and keyboard (Enter/Space and implicit form submit report
// detail 0 with no real point, so those ripple from the center).
(() => {
  'use strict';

  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const LIFETIME = 700;

  document.addEventListener('click', (event) => {
    if (reduceQuery.matches) return;
    const host = event.target instanceof Element && event.target.closest('[data-si-ripple]');
    if (!host || host.disabled || host.getAttribute('aria-disabled') === 'true') return;

    const box = host.getBoundingClientRect();
    if (!box.width || !box.height) return;
    const pointer = event.detail > 0 && (event.clientX || event.clientY);
    const x = pointer ? event.clientX - box.left : box.width / 2;
    const y = pointer ? event.clientY - box.top : box.height / 2;
    const radius = Math.hypot(Math.max(x, box.width - x), Math.max(y, box.height - y));

    host.querySelectorAll(':scope > .si-ripple').forEach((old) => old.remove());
    const ink = document.createElement('span');
    ink.className = 'si-ripple';
    ink.setAttribute('aria-hidden', 'true');
    ink.style.width = ink.style.height = `${radius * 2}px`;
    ink.style.left = `${x - radius}px`;
    ink.style.top = `${y - radius}px`;
    host.append(ink);

    const remove = () => ink.remove();
    ink.addEventListener('animationend', remove, { once: true });
    ink.addEventListener('animationcancel', remove, { once: true });
    window.setTimeout(remove, LIFETIME);
  }, { passive: true });
})();
