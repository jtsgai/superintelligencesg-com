(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduceMotion.matches) { document.documentElement.classList.remove('si-motion-ready'); return; }
  const domain = document.querySelector('.domain')?.textContent.trim().toLowerCase();
  const site = domain === '.ai' ? 'lab' : domain === '.org' ? 'commons' : 'navigator';
  document.body.classList.add(`si-site-${site}`);
  const hero = document.querySelector('.hero');
  if (hero) {
    const signal = document.createElement('span');
    signal.className = 'si-signal';
    signal.setAttribute('aria-hidden', 'true');
    hero.append(signal);
    requestAnimationFrame(() => hero.classList.add('si-entered'));
  }
  const sections = [...document.querySelectorAll('main > section:not(.hero)')];
  if (!('IntersectionObserver' in window)) { sections.forEach(section => section.classList.add('is-inview')); return; }
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-inview');
      observer.unobserve(entry.target);
    });
  }, { threshold: .12, rootMargin: '0px 0px -6%' });
  sections.forEach(section => { section.dataset.siReveal = ''; observer.observe(section); });
  if (site !== 'commons') {
    let commonsWarmed = false;
    const warmCommons = () => {
      if (commonsWarmed) return;
      commonsWarmed = true;
      fetch('https://superintelligencesg.org/', { mode: 'no-cors', credentials: 'omit', cache: 'no-store', keepalive: true }).catch(() => {});
    };
    document.querySelectorAll('a[href^="https://superintelligencesg.org"]').forEach(link => {
      link.addEventListener('pointerenter', warmCommons, { once: true });
      link.addEventListener('focus', warmCommons, { once: true });
      link.addEventListener('touchstart', warmCommons, { once: true, passive: true });
    });
  }
})();
