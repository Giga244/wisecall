# Plan: mentor profile summary (docs/CLAUDE-CODE-MENTOR-SUMMARY.md)

## Today
- **"ჩემ შესახებ" / About me** = `users.bio` (up to 2000 characters). Shown on the public profile, the Browse cards (3 lines, "სრულად ნახვა →") and the home cards. Edited in Settings → Profile.
- **"შენი ისტორია" / Your story** = `users.story` (100–1500 characters), from the application. While the two texts are the same, writing one writes the other.
- **The admin's application review** shows the story and the AI review of the application (`server/verification/aiReview.js`).
- **The Claude client** already exists: an API key in `ANTHROPIC_API_KEY`, a timeout, the cost of every call logged, and a monthly AI budget (`AI_MONTHLY_BUDGET_USD`). Tests use a fake Claude server.

## What changes
1. **The original is never touched.** `users.bio` stays the mentor's own text. The summary lives beside it (migration 063, additive):
   - `bio_summary_suggested`, `bio_summary_suggested_en`: the suggestion waiting for approval.
   - `bio_summary_approved`, `bio_summary_approved_en`, `bio_summary_approved_at`, `bio_summary_approved_by` (`mentor` | `admin`): what is public.
   - `bio_summary_source`: a hash of the original the suggestion was made from, so a changed original gets a new suggestion.
   - A table `mentor_summary_runs`: each generation's model, tokens, cost, outcome (ok / fact_check_failed / contact_details / timeout / api_error), and what the fact check found. Admin sees the cost.
2. **What is public:** the approved summary if there is one, otherwise the original. An English page shows the approved English version, otherwise the original. Nothing becomes public without approval (mentor or admin). An approved summary stays live until a newer one is approved.
3. **Generating** (`server/mentorSummary.js`, server side only):
   - **When:** after a mentor saves a changed "About me". It runs in the background: saving never waits for it and never fails because of it.
   - **Switch:** it is on only when `MENTOR_SUMMARY=on` and `ANTHROPIC_API_KEY` is set. Otherwise nothing happens, and mentors keep their own text.
   - **Model:** a small, cheap one, `ANTHROPIC_SUMMARY_MODEL` (default `claude-haiku-5-5`), with a 20 s timeout. Each run counts toward the existing monthly AI budget; when the budget is spent, there is no suggestion.
   - **Prompt:** the rules from the brief:
     - keep every name, title, year, number and place;
     - add nothing (no "წამყვანი" / "საუკეთესო" / "ცნობილი" unless they are in the original);
     - drop no job, degree or licence;
     - third person, 60–120 words, no emojis;
     - current role first, then past roles, then education;
     - the answer is in the original's language, plus English from the same facts when the original is Georgian.
4. **Checked in code, not left to the model:**
   - **Fact check:** take from the original every number and year, every Latin-script or capitalised name, and every word that looks like an organisation (ending in უნივერსიტეტი, სკოლა, სამინისტრო, საელჩო, ბანკი, კომპანია, ინსტიტუტი, ჯგუფი, ...). Each must still be in the summary, and the summary may have no number or name that is not in the original.
     - If it fails, generate once more. If it fails again: no suggestion, the original stays, and the failure is logged for the admin.
   - **Contact details:** the existing contact-safety check runs on the summary. Anything found means it is rejected.
   - **The last line, "შემიძლია დაგეხმაროთ: …"**, is written by the code from the mentor's own field, chips and specialisations, never by the model.
   - **Words and emojis:** 60–120 words and no emojis are checked too.
5. **The mentor, in "ჩემი მონაცემები":** a card with "შენი ტექსტი" and "საჯარო ვერსია" side by side (stacked at 360px), with a KA / EN switch for the public version and three buttons:
   - "დადასტურება": makes it public.
   - "რედაქტირება": they edit the summary themselves. Contact details are refused; a missing or new fact gets a warning.
   - "ხელახლა შექმნა": at most 3 a day.
6. **The admin, in the mentor's review:** the original, the suggestion, and a list of differences (facts missing or added, words changed), with approve / edit / reject.
7. **Existing mentors:** their public text never changes on its own. The first time they open "ჩემი მონაცემები" after this, a suggestion is made for them to look at.
8. **Docs:** `ANTHROPIC_SUMMARY_MODEL` and `MENTOR_SUMMARY` go into `docs/SECRETS.md` and `.env.example`.

## Tests
- A changed number, year or organisation name fails the fact check, and so does an added one.
- The public profile shows the original until the mentor approves.
- Contact details never get into a summary.
- The API down or timing out: saving works, with no suggestion and no error.
- "ხელახლა შექმნა" is limited to 3 a day.
- The mentor's card in KA and EN at 360px and 1280px, light and dark.
- The admin's approve / edit / reject.

## Questions for you
1. **The switch:** `MENTOR_SUMMARY` off by default, so you turn it on in Render once the Anthropic key is in. OK?
2. **The model:** `claude-haiku-5-5` (cheapest), counted in the same $20 monthly AI budget. OK, or a separate budget?
3. **The cards:** should Browse and home show the approved summary (shorter and cleaner), with the full original only on the profile? Or the summary everywhere once it is approved?
