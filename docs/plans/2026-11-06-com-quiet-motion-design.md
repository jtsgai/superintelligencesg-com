# .com quiet motion — marquee and stagger

Date: 6 November 2026. Scope is `superintelligencesg.com` only. No new animation library.

## What already exists

- Homepage GSAP (`assets/product/motion-home.js`) already reveals the hero and, on scroll, staggers `.index-row` and `.door` once (`stagger: 0.14`). That is the card/row entrance for the homepage. Do not add a second entrance on those elements: GSAP leaves an inline `transform`, and Hover Lift uses the independent `translate` property.
- Hover Lift in `motion-home.css` stays as shipped.
- `si-motion.js` is not loaded on the homepage. Directory, map, and other pages have no entrance motion.
- `dist/` was not updated by the GSAP or Hover Lift changes. This change follows that and does not touch `dist/`.

## Marquee

One slow ticker, directly under the homepage hero and inside `main`, so the first screen stays the hero, search, and source line. It does not sit on the directory: the collection controls there are real buttons, and a second moving copy would compete with search.

Copy is the six collection labels already published on `directory.html` (`.journey` buttons): Trusted deployment, Research & frontier, Build & deploy, Trust & safety, National capability, Community profiles. No organization names, counts, logos, or partnership language. The visible kicker is “Collections”.

Behaviour:

- Static HTML contains one list, so the labels are visible with CSS or JS unavailable and are read once.
- JS clones a second list only when motion is allowed. The clone is `aria-hidden` and `inert` (not read, not tabbed).
- Scroll uses the `translate` property, not `transform`, so it cannot fight Hover Lift or GSAP.
- About 90 seconds per loop. Pauses on hover (fine pointer), focus inside the control, the Pause/Play button, a tap on the ticker, `document.hidden`, and when the ticker leaves the viewport.
- `prefers-reduced-motion: reduce` keeps the single wrapping list and does not scroll. The Pause button stays hidden because there is nothing to pause.
- The track is clipped inside a container with `min-width: 0` and inline-size containment, so 320px and 390px widths do not grow the page.

## Stagger

Directory result rows (`.result` in `[data-results]`) have no entrance. The first time rows appear, the first five move 8px and fade in, 45ms apart, once. Later filter, search, and data refreshes do not replay it. Rows stay in flow (no layout shift). A one-second fallback removes the animation class so a failed animation cannot leave rows invisible. Reduced motion does not add the class.

Homepage rows and doors are not given this animation.

## Out of scope

Other domains, 3D, new dependencies, directory marquee, restaggering GSAP targets, and `dist/` republish.
