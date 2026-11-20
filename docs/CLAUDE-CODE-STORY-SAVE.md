# "ჩემი გზა" refused for one "I can help with" line

## What happened

On 2026-11-20 a listed mentor saved "ჩემი გზა" on Settings → My details and got `400 helpPoints_too_long` on `PUT /api/me/details`.

- Each "I can help with" line was capped at **90 characters** (`server/mentorStory.js` `LIMITS.pointMax`). The form never said so: no count, no limit, the hint said "3 short points".
- His line was **126 characters**. The three path blocks (385, 255 and 338 characters) were within their 400.
- The server stopped at the first refused field, so **nothing** in the form was saved: not the path, not the About, not the links.
- The message under the help lines said "The text is too long", without the limit.

## What changed

- **Limit**: 200 characters per "I can help with" line. The form gets the same number from the server (`/api/me/details` → `story.limits`).
- **Counts everywhere**: each help line and the sample question now have a live count with their limit, like the path blocks, About and sample answer. Over the limit the count turns red and says so; nothing typed is cut (no `maxlength`).
- **One bad field never blocks the others**: My details checks each part of the story form on its own (`mentorStory.GROUPS`: the path, the sample question and answer, the tags, the help lines, the links, the field suggestion, About).
  - Refused parts come back as `refused: [{ field, error }]`. The parts that were saved come back as `saved` (with `user`), still with status 400.
  - Each reason is shown under its own field, and the first is in focus. The line by the button says the rest was saved.
  - The path stays one part, because it is all three blocks or none.
- **What is stored is never refused for its length**: a text sent back exactly as stored is accepted even if a limit has changed since.
- **Messages**: "too long" now names the limit, in Georgian and English (`story.err.too_long` with `{max}`). The help hint says "up to 3 points, each up to 200 characters".
- **Tests**: `tests/story-save.test.js` (unit) and `e2e/mentor-story-limits.spec.js` (375px, Georgian) cover the reported case: Georgian text, a 126-character help line, long path blocks with a line break.

Not changed:
- The work links have no count. Their limit is 300 characters per address and a bad address is refused as a link.
- The application's step 2 (`/verification/experience`) still stops at the first refused field. That page saves drafts as they are typed, and the counts now show the limits there too.

## The one-off data fix (owner runs it)

`scripts/oneoff/set-mentor-story.js` with `scripts/oneoff/2026-11-20-story.json`:

- It first shows what is stored now (the profile fields and the decrypted `user_drafts` rows) and changes nothing.
- With `--apply` it sets the texts exactly as given, as an admin change: saved at once, no review queue, no email. It writes a `verification_audit` row.
- It stops, changing nothing, if a text is over its limit, would be refused by the site's checks, or would not be stored exactly as given.
