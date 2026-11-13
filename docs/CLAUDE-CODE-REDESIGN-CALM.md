# Full redesign: the "calm" design for the whole site

Change the design of the whole Wisecall site to the approved "calm" design. This **replaces** every earlier design brief: `CLAUDE-CODE-COMPACT-HOME.md`, `CLAUDE-CODE-COMPACT-SITE.md`, the design parts of `CLAUDE-CODE-FABLE-IMPROVE.md`, and the three directions in `docs/redesign/directions/` (მთა, წერილი, მზე). Don't build those.

**Change only how the site looks.** No changes to logic, routes, API, database, payments, emails, or any age, ID, consent or safety check. If a page needs a logic change to look right, list it in the report instead of doing it.

## The approved mockups: `docs/redesign/calm/`
- `home-1280.png`, `home-375.png` (+ `home.html`): the home page, light and dark
- `experts-1280.png` (+ `experts.html`): the experts list
- `profile-1280.png`, `ask-1280.png`, `dashboard-1280.png` (+ the `*-desktop.html` files)
- `phone-pages.png` (+ `phone-pages.html`): 8 phone screens: experts, profile, ask, sign-up, my questions, mentor dashboard, mentor application, 404

The HTML files are mockups for sizes, spacing and colours. Build with the site's own components, tokens, i18n and fonts; don't paste the mockups in. All mentors, prices and numbers in them are invented: the real site shows real data only.

## The design in words
- **Feeling:** calm, light, lots of space, easy. One accent colour. Few boxes.
- **Colours (as tokens):**
  - Light: page `#fbfaf7`, card `#ffffff`, text `#1e1a31`, soft text `#6a6580`, line `#ebe7e0`, coral `#ff6f59` (buttons, with dark text on them), coral text `#d9482f`, verified green `#1b7f5f`, tint `#ffe9e4` (avatar circles, the circle behind Jikhva).
  - Dark: page `#15121e`, card `#1e1a2b`, text `#f4f2ee`, soft `#aaa5bb`, line `#2c2840`, coral text `#ff8f7d`, green `#7fd9b8`, tint `#2b2029`.
  - No other colours: remove the pastel yellow, mint, lavender and blush fills, and the purple gradients. Keep every text pair at 4.5:1 contrast or better.
- **Type:** the fonts the site already serves. Headings: Bricolage Grotesque / Noto Sans Georgian, bold. Body: Onest / Noto Sans Georgian, 16px on computers and 15px on phones, line-height 1.5. Phone page title 25–35px, computer 36–52px.
- **Space:** 24px side padding on phones, 32px on computers, content max 1000px. 56–64px between sections on phones, 80–96px on computers.
- **Shapes:** buttons and inputs 14px radius, cards 22px, thin 1px lines. Shadows only on the hero example card and pinned buttons.
- **Buttons:** one coral primary per screen. Secondary = outlined. Text links in coral text with an arrow.
- **Icons:** one line-icon set (2px stroke). No emoji in the interface.
- **Jikhva:** in the logo (head behind the "ll", coral dot: keep the approved logo), full-body in the home hero in front of the tint circle, waving in the "ექსპერტი ხარ?" block and on sign-up, and on empty states and the 404 page. Nowhere else.
- **Lists instead of card grids:** mentors, questions and answers are rows separated by thin lines.
- **Sections that open** ("დამატებითი პარამეტრები", FAQ): a full-width bordered row at least 56px tall, with the title, a grey "არასავალდებულო" chip when optional, a one-line hint, and a chevron that turns when open. Use `<button aria-expanded>`.
- **Phones:** the header has the logo, a small coral "ჩაეწერე" button (prelaunch) and the menu. On the profile, ask and form pages the main button is pinned at the bottom, and hides while the same button is visible in the page.
- **Footer:** one line: ©, a few links, and the real Instagram, TikTok and Facebook icons.

## Home page (top to bottom)
1. "მალე იხსნება" pill, the headline with "უკვე გაიარა" in coral text, one sentence.
2. The waitlist form: email + "ჩაეწერე სიაში", the required "16 წლის ან უფროსი ვარ" checkbox, the real rounded count (hidden under 50) and the privacy link. The Cloudflare slot stays **under** the email row (don't regress `CLAUDE-CODE-TURNSTILE-FIX.md`).
3. Jikhva + the example card. Keep the live typing animation and the rotation; an example is labelled "მაგალითი" with no name, badge or stars; ends with "პასუხი 7 დღეში". On computers this sits to the right of the form.
4. "პოპულარული" field chips (one swipe row on phones).
5. "როგორ მუშაობს": one white panel, 3 numbered steps, then the 3 trust ticks.
6. "გაიცანი ექსპერტები": up to 3 real approved, opted-in mentors (name, profession, verified, one line, price, "პროფილი →"). Hidden if there are none.
7. "ხშირი კითხვები": 3–4 questions, closed.
8. The dark "ექსპერტი ხარ?" block with the waving Jikhva.
In launch mode the form becomes the search box; everything else is the same.

## Hard rules (never break)
- Askers 16+, mentors 18+ with the Didit ID check. Keep every age, consent, payment, privacy and contact-safety rule and text.
- Never show invented people, reviews, ratings or numbers as real.
- KA and EN, KA first, natural Georgian. Use "პირველი მენტორი", never "დამფუძნებელი მენტორი". Written-only: never offer calls.
- Light and dark themes; 360px to 1440px; no sideways overflow; tap targets 44px+; `prefers-reduced-motion`.
- Run all unit and e2e tests before each push. Update tests that check the old look; don't delete or skip any.
- Our usage is limited: read only what you need, reuse shared components, keep messages short.

## How to work
**Step 1: shared tokens and components + the home page + the experts page. Locally only.**
Screenshot both at 375px and 1280px, light and dark, prelaunch (and launch for home). Save them in `docs/redesign/calm/built/`, compare with the mockups, fix differences, then **stop and show me. Do not push until I say OK**, because a push goes live.

**Step 2 (after my OK):** push step 1, then do the rest in groups, committing and pushing after each ("Design: <area>"):
1. mentor profile, the ask flow, checkout and success
2. sign-up, log-in, email code, password pages
3. student pages (my questions, answer view, settings)
4. mentor pages (dashboard, answering, withdraw, my details, application form)
5. become-a-mentor, how it works, pricing, FAQ, about, contact, how we verify, legal pages
6. waitlist pages, 404/403/500, emails' header and button colours only
7. admin: only make it readable and not overflowing; no redesign

**Step 3:** screenshot every page at 375px and 1280px, light and dark, into `docs/redesign/calm/built/`. Write `docs/REDESIGN-CALM-REPORT.md`: what changed, the test results, anything skipped, anything that needs my decision.
