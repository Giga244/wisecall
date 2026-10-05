# Design system (October 2026 refresh)

The look of the site lives in `public/css/style.css` (tokens and shared components), `public/css/home.css` and `public/css/app.css`.
Direction chosen with the UI/UX Pro Max design skill (queries: "trustworthy professional marketplace", "modern professional clean",
"tab indicator active state", "scroll reveal subtle"), then adapted for Georgian and for the existing accessibility rules.

## Principles
- **Calm and trustworthy, not playful.** People pay doctors, lawyers and accountants here: clean surfaces, one clear action per screen.
- **Georgian first.** Every font has to draw Georgian; Georgian headings keep normal letter spacing (Latin headings are set tighter).
- **Accessible by construction.** Every colour is a token checked by `npm run check:contrast` (WCAG AA in light and dark) and
  `npm run check:colors` (no hard-coded colours).

## Colour
| Role | Token | Light | Dark |
|---|---|---|---|
| Text (the logo's navy) | `--ink` | `#25213B` | `#F1F5F9` |
| Page | `--bg` | `#F6F7FB` | `#0B1020` |
| Cards | `--card` | `#FFFFFF` | `#141A2E` |
| Action (buttons, links, chosen tab) | `--accent-strong` / `--accent-text` | `#4F46E5` / `#4338CA` | `#818CF8` / `#A5B4FC` |
| Decoration indigo | `--accent` | `#6366F1` | `#818CF8` |
| Trust / verified / success | `--accent2-strong` / `--accent2-text` | `#047857` | `#34D399` / `#6EE7B7` |
| Ratings | `--gold-text` | `#92400E` | `#FCD34D` |
| Errors | `--red-strong` | `#BE123C` | `#FDA4AF` |

The logo keeps its own colours (coral and navy, `public/brand`); the logo's navy, mint and sun are still tokens (`--ink`, `--mint`, `--sun`).
Payment-network marks use their own brand colours (`--mc-red`, `--mc-yellow`). Emails keep their own light palette (`server/mail/templates.js`).

## Type
- Latin text: **Inter**; Latin headings: **Manrope** (800, −0.02em).
- Georgian (text and headings) and extended Latin incl. the lari sign ₾: **Noto Sans Georgian** — the same family the PDF receipts use.
- Self-hosted variable WOFF2 files in `public/fonts` (licences in `public/fonts/LICENSES.md`); each loads only for the characters a page uses.

## Shape and depth
- Radius: `--radius` 18px (cards), `--radius-sm` 12px; buttons 12px; chips stay pill-shaped.
- Elevation: `--shadow-1` (resting card, with a 1px `--border` outline) and `--shadow-2` (hover). Dark theme has deeper shadows.

## Motion
- One easing for everything: `--ease` (`cubic-bezier(.2,.8,.2,1)`), 150–300ms for interactions, 600ms for reveals.
- Hover: cards rise 3–4px and gain `--shadow-2`; buttons rise 1px and press to 98% on click. No rotation, no bounce.
- Scroll reveal: cards and section headings below the first screen fade up 16px, staggered 70ms within a group
  (`public/js/header.js`, CSS "Motion" in `style.css`). Never applied to what is on screen at load, never without JavaScript, never under
  `prefers-reduced-motion`; the classes are removed after the reveal so hover is not delayed.
- Tabs: the chosen tab's underline grows in (`scaleX`), and the new panel fades up 6px.

## Tabs
Underline tabs on a hairline (`.tabs` / `.tab` / `.tab.active`): muted labels, the chosen one in `--accent-text` with a 3px bar. On phones
the row scrolls sideways with faded edges (`app.css`). Counts (`.tab-count`) are indigo pills.

## Checklist before shipping a UI change
- `npm run check:contrast` and `npm run check:colors` pass
- Looks right at 375 / 768 / 1024 / 1440px, light and dark, English and Georgian
- Visible focus ring on every control; nothing relies on hover alone; motion respects reduced-motion
