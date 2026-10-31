// Homepage GSAP scroll polish. Do not load si-motion.js on this page.
// Never pre-hide via .shell[style]: GSAP writes inline style on animated shells
// (including .shell.signal-grid) and that selector kept the signal children hidden.
gsap.registerPlugin(ScrollTrigger);
const q = new URLSearchParams(location.search);
const done = q.get("motion") === "done" || q.get("done") === "1";
const SCROLL = [
  ["#navigator", "#navigator .section-head", 0, 18],
  ["#navigator .index-list", "#navigator .index-row", 0.14, 18],
  ["#navigator .section-action", "#navigator .section-action", 0, 10],
  [".section.signal", ".section.signal .signal-label, .section.signal #october-signal, .section.signal .signal-copy, .section.signal .signal-source, .section.signal .signal-actions", 0.08, 14],
  [".section.doors", ".section.doors .section-head", 0, 18],
  [".section.doors .door-grid", ".section.doors .door", 0.14, 18],
  [".shell.join", ".shell.join .join-copy, .shell.join aside.trust", 0.12, 10],
  ["section.shell.cta-band", "section.shell.cta-band > *", 0.08, 0],
  ["section.shell.cross", "section.shell.cross", 0, 0],
];
gsap.matchMedia().add("(prefers-reduced-motion: no-preference)", () => {
  if (done) return;
  document.documentElement.classList.add("js-motion");
  const ease = "power2.out";
  gsap.fromTo(".hero-copy > *", { autoAlpha: 0, y: 16 }, { autoAlpha: 1, y: 0, duration: 0.7, stagger: 0.09, ease });
  SCROLL.forEach(([trigger, targets, stagger, y]) =>
    gsap.fromTo(
      targets,
      { autoAlpha: 0, y },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.7,
        ease,
        stagger,
        immediateRender: false,
        scrollTrigger: { trigger, start: "top 88%", once: true },
      }
    )
  );
  return () => {
    ScrollTrigger.getAll().forEach((t) => t.kill());
    document.documentElement.classList.remove("js-motion");
  };
});
