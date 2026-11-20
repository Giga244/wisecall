# "ჩემი გზა" as tabs on the mentor profile

The three parts of a mentor's story („სად დავიწყე“, „როგორ გავუმკლავდი“, „სად ვარ ახლა“) used to be three narrow columns. On a phone that left one or two words per line. They are now tabs over one card, for every mentor.

## Where

- `public/js/profile.js` (`storyHtml`) draws the parts one under the other, each its own card with its title. This is what is read when scripts don't run.
- `public/js/story-tabs.js` (new) turns them into tabs:
  - one tab per part, then one card;
  - a tap or click, a swipe on the card (left: next, right: previous), and the arrow keys, Home and End;
  - a 150ms fade, none with reduced motion;
  - `role="tablist"`, `"tab"` and `"tabpanel"`, plus `aria-selected`;
  - dots under the card, and a „გადაფურცლე → შემდეგი“ hint on touch screens only.
- `public/css/app.css` (the `.story-*` rules) is mobile first: at most 720px wide and centred.
- `public/css/tokens.css` holds the `--story-*` colours in both themes:
  - The dark theme uses the approved colours, except two that needed 4.5:1 contrast. The active tab is `#7262e9` (white on `#8b7cf6` is 3.3:1), and the hint is `#8a84b3` (`#7d77a6` on the dark page is 4.45:1).
  - The light theme uses a pale lavender bar, a deep purple active tab, a white card and ink text.
- `server/mentorStory.js` (`publicView`) now sends each part that counts (at least 40 characters, real writing), not only all three together. Two parts give two tabs. One part gives its card with its title and no tab bar. No parts means no section.
- `public/i18n/*.json` has two new keys: `profile.story.label` („მენტორის ისტორია“) and `profile.story.hint`.

## Tests

- `e2e/mentor-story-tabs.spec.js`: three parts at 390px (tap, swipe, arrow keys, dots, line breaks, no overflow); two parts, one part and none; and the parts all shown without the script.
- `tests/mentor-story.test.js`: `publicView` with some parts.
- `e2e/mentor-story.spec.js` now looks for `.story-panel`, which replaces `.path-block`.
