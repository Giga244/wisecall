# Expert cards: the About, never the story

## What happened

On Browse experts, one mentor's card showed „მყავს ცოლი და ოთხი შვილი.“ (the first sentence of his „სად ვარ ახლა“) instead of the start of his „შესახებ“.

No field was filled wrongly. The card has no field of its own:
- It showed `trust.nowLine`, the first sentence of `path_now`, which `server/mentorStory.js` `cardView` sent whenever a mentor's "ჩემი გზა" was complete.
- Otherwise it showed the About (`users.bio`).

That was the design of the mentor-story feature (docs/CLAUDE-CODE-MENTOR-STORY.md). His path became complete when his texts were set (2026-11-20), so his card switched to it. The other mentors have no complete path, so their cards showed their About.

## What changed

- **What the card shows**, on Browse and on the field pages (`public/js/main.js`, `public/js/advice.js`):
  - the start of the mentor's own About;
  - else their „რაში დაგეხმარები“ lines;
  - else nothing (the headline only).
  - The words of "ჩემი გზა" are never on a card.
  - The text is two lines with „…“ where it is cut (`public/css/style.css`).
- **Server**:
  - `cardView` no longer sends `nowLine`. It sends `hasPath` (used only for the order, as before), `helpPoints`, the start tags and `hasSample`.
  - `/api/experts` sends a mentor's own About only (`ownAbout`): an About that is just a copy of the path is not sent.
- **„სრულად ნახვა →“ / "View full profile →"** is at the foot of every expert card, left-aligned under the badges, coral, bold, 16px.
  - It's a `<span>`: the whole card is already the link, so there is no `<a>` inside an `<a>`.
  - It replaces the old "Read more →", which showed only when the text was cut. The home page's cards keep their own "Read more →".
- **Tests** that pinned the old card were updated, not removed: `tests/mentor-story.test.js`, `tests/matching.test.js`, `tests/never-cut.test.js`, `e2e/mentor-story.spec.js`, `e2e/never-cut.spec.js`.

## Data (the owner runs it)

`scripts/oneoff/2026-11-21-card-and-stop.js <username>`:
- **Without `--apply`** it only reads. It shows the mentor's About, the three parts, the help lines, the headline and the role title. It says where the story sentence is stored, and what the card shows after the deploy.
- **With `--apply`** it changes one thing: in „სად დავიწყე“, „გავრცელებული სწორედ აქ“ becomes „გავრცელებული. სწორედ აქ“. It does this only if that text is there exactly once, prints the old and new text, and writes an audit row.
