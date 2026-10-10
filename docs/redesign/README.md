# Wisecall redesign: "Ink & Paper"

The approved concept (the "Wisecall redesign" canvas, option A: desktop home and phone) applied to the whole site. Visual and motion
only: features, routes, the meaning of every text and key, the security rules (CSP with no inline scripts, CSRF, rate limits) and what the
tests check stay the same.

## Screenshots

`before/` and `after/` hold the same pages, taken with `scripts/redesign-shots.js` on a local server with the demo data of
`tests/e2e-cloud/seed-dev.js` (WebP; long pages are cut at a sensible height):

- the home page in all eight combinations: desktop 1440 and phone 390, light and dark, English and Georgian
  (`home-desktop-light-en.webp` ... `home-phone-dark-ka.webp`)
- every other page in four that cover each size, theme and language: desktop light EN, desktop dark KA, phone light KA, phone dark EN
  (browse, profile, live list, live session, dashboard, inbox, settings, log in, sign up, help, FAQ), plus the live room, terms,
  the 404 page and admin in two

To take them again: start a local server with mock bank and ID check, `ADMIN_2FA=off` and `LIVE_PROVIDER=fake` on a scratch
database, run `node tests/e2e-cloud/seed-dev.js --base <url>`, then `node scripts/redesign-shots.js --base <url> --out docs/redesign/after`.

## The design system (public/css/tokens.css)

- Colours: ink `#1E1A31`, paper `#F4F2EE`, white, coral `#FF6F59` (fills and accents only; text on coral is ink), coral-text `#E04A33`
  (the hero's accent words only), mint `#DDF3EA`, sun `#FFE7A3`, blush `#FFD3CB`, muted `#4E4963` (`#6B6680` only at 14px bold+).
  Dark: ground `#16131F`, surface `#221E31`, text `#F4F2EE`, the same accents. Body links use a deeper coral `#B5361F` (5.3:1) and
  the focus ring `#D43F28` (4.1:1), both shades of the coral, because the coral itself is under 3:1 on paper.
- Type: Bricolage Grotesque (headings, prices, numerals; 700/800, -0.02em), Onest (text); Noto Sans Georgian for both roles in Georgian
  (`:lang(ka)`, no tracking, no CSS capitals, slightly smaller display sizes). Self-hosted subset WOFF2, `font-display: swap`, the two
  latin files preloaded on every page; licences in `public/fonts/OFL.txt`.
- Shape: 2px ink outlines on cards, buttons and fields; 14px buttons, 22-28px cards, 36-40px panels; the offset shadow
  (`0 8px 0 -2px` ink) under primary actions; 1.5px pill chips that invert on hover; dashed "stamps"; big outlined numerals for steps;
  the logo's speech bubbles as decoration. No gradients, glass, blur, emoji icons, left-border cards or stock illustrations.
- Spacing 4/8/12/16/24/32/48/72/110; container 1280 with 32px gutters (18px on phones).
- The logo keeps its mark; the wordmark is redrawn in Bricolage Grotesque ExtraBold in the same box, so every place that shows it keeps
  its size. The share image, the email logos and the live-session share card use the new look.

## Motion (public/js/motion.js, styles in style.css and home.css)

Hero rise-in (0.9s, cubic-bezier(.2,.8,.2,1), staggered), the looping conversation (CSS only, 12s), the self-drawing underline,
the band of fields (pauses on hover, seamless), scroll reveals once at 20% (IntersectionObserver), card lift with a tiny tilt, buttons
that lift and slide their arrow, the coral underline growing under nav links, the pulsing live dot and the upvote "+1".
`theme-init.js` sets `motion` on `<html>` before the first paint and only without `prefers-reduced-motion`; with reduced motion
nothing moves. Only transform and opacity animate (no layout shift); no page transitions.

## Quality gates

Measured with `scripts/lighthouse.js` (Lighthouse 13, its default mobile throttling) on a local server with the demo data, so the
numbers on the live host will differ a little.

| Lighthouse (Perf / A11y / Best practices / SEO) | Mobile | Desktop |
| --- | --- | --- |
| Home | 96 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| A profile | 96 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| Browse (a field's mentors) | 96 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |
| Georgian home | 93 / 100 / 100 / 100 | 100 / 100 / 100 / 100 |

- axe (WCAG 2.0-2.2 A/AA + best practice): 0 violations on every public, seeker, mentor and admin page, the open menus and
  dialogs, in English, Georgian and dark mode (`e2e/smoke.a11y.spec.js`).
- No sideways scroll at 320px on every public and signed-in page, in English and Georgian (`e2e/redesign.spec.js`).
- 44px touch targets on a phone on the home page, a profile, the live list, log in, help, FAQ, dashboard, inbox and settings
  (links inside running text excepted, as WCAG allows).
- The keyboard focus is a 2px coral outline with a 3px offset, in light and dark.
- Georgian never runs out of a button, chip, tab, badge, card or heading at 320, 390 and 768px.
- With reduced motion nothing moves; layout shift while the home page, a profile and the live list load is under 0.01.
- `tests/redesign.test.js` pins the palette, the contrast of the brief's pairs in both themes, the self-hosted fonts, the
  unchanged CSP and the rules of the concept (no gradients, blur, glass or left-border cards).
- All tests pass: 848 unit and cloud tests (`npm test`), 174 browser tests (5 skipped by design: accessibility checks that
  run in only one of the colour schemes), 30 tests of the cloud setup (`tests/e2e-cloud`), and the colour, contrast and secret
  checks. Tests that pinned the old page colours now pin the new ones; no test lost a check.

## For the owner's eye

- **The home page keeps every section it had.** The concept shows the hero, the band, how it works and the experts; the trust,
  verification, examples, pricing, mentor, FAQ and closing sections were kept and drawn in the same language, since their text and
  links are features.
- **One server change.** The Georgian pages measured a layout shift of 0.17-0.29 on phones: the server sent English text and the
  browser swapped in Georgian after the first paint, which the bigger hero made visible. The server now writes each page's texts
  in its language (the same dictionary and settings, the waiting-list texts in prelaunch; a text with a date or a name it can't
  fill keeps the page's own text), and Georgian pages preload the Georgian font. The browser still runs its own pass, so the result
  on screen is the same as before, only without the swap.
- **Two deeper corals.** The coral `#FF6F59` is under 3:1 on paper, so body links use `#B5361F` and the focus ring `#D43F28`;
  text on coral buttons is ink, never white. The hero's accent words keep `#E04A33` at headline size.
- **White stickers turn pale lavender in dark mode** (`#E6E1F7`), so they don't glare on the dark ground.
- **The wordmark** is drawn from the static ExtraBold instance of Bricolage Grotesque (optical size 14), in the logo's old box.
- **A profile's Follow button** is now drawn at once and updated when its state arrives (it used to appear late and push the page
  down); a click waits for that state.
- **The prelaunch home** keeps the hero search: its button reads "Launching soon · Join the waitlist" and takes the visitor to
  the waiting-list form, as the old hero button did.
- **The share card** of a live session is drawn on the server: it names the brand fonts first, but the server draws it with the
  fonts it has installed (DejaVu Sans or Arial), so its type is close to the site's, not the same. The OG image is a new PNG.
- **The dark-theme scan** in `e2e/theme.spec.js` now accepts the new ink button (`.btn-ink`), which is light-on-dark by design.
- **The Georgian home** scores 93 on mobile Lighthouse (the brief's 95 is for home, profile and browse); the Georgian font is one more download.
- A tiny layout shift (0.0015) is left on a profile when its live sessions arrive; it is under the 0.01 gate.
- Seen while taking the screenshots, not changed (it was there before): in the inbox list, the preview of a Wisecall message about a live
  session reads `Your ticket to &quot;&quot; is confirmed` (the session title is left out and the quotes are escaped twice).
