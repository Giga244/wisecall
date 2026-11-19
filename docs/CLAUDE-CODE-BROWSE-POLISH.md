# Browse polish: field pills, mentor cards, checkboxes, scrollbars

Visual only. No data, filter, sorting, matching or API changed.

## What changed

- **Field row** (`#fieldChips`): one row that scrolls sideways, native scrollbar hidden, the last ~90px fade out while there is more to see.
  Round arrows (`public/js/chips-scroll.js`) scroll by about 70% of the row's width. The left one shows only once the row has been scrolled;
  each hides when there is nothing more that way. Not shown under 768px or on touch screens (swiping does it). The arrows sit in a
  `.chips-scroll` wrapper *outside* the row, because `main.js` redraws the row's `innerHTML`.
- **Pills**: 42px, round, token colours; selected (`aria-pressed`) is inverted; `.chip-count` and `.chip-soon` are small pills.
- **Mentor cards**: one column, each its own card (16px gap, 20px radius, 24px 28px padding on desktop); hover lifts 2px (not with reduced motion or on touch);
  name 20px/800; role clamped to 2 lines; trust badges wrap and never overflow.
- **Checkboxes** (`public/css/style.css`, end of file): every `input[type=checkbox]` except those inside `.check-chip` (invisible click areas) is a 22px
  coral box with an ink tick, drawn in CSS. The real input stays, so labels, keyboard and screen readers are unchanged. Focus ring, disabled at 50%,
  indeterminate dash, high-contrast mode.
- **Scrollbars** (`style.css`, end): thin and themed (`--scroll-thumb`), `scrollbar-width` plus the WebKit rules.

## Colours

All new colours are tokens in `public/css/tokens.css`, in both themes: `--pill-*`, `--tint-coral-*`, `--arrow-*`, `--mcard-*`, `--trust-*`, `--check-*`, `--scroll-thumb`.
Dark values are the approved ones. `scripts/check-contrast.js` has pairs for them (132 pairs, both themes).

**One deliberate difference:** the light checkbox border is `#8f8a9e`, not the requested `#b9b3c9`. `#b9b3c9` on white is about 1.9:1, under the 3:1 the
site asks of the outline of anything you have to find and use. It is one token (`--check-line`); change it there if the lighter look is wanted.
