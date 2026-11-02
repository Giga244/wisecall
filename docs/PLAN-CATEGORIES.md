# Plan: detailed mentor categories

Brief: `docs/CLAUDE-CODE-CATEGORIES.md`.

## How it works today

- **`users.niche`** is one key from the `niches` table (36 fields), plus up to two `extra_niches`. It's not only a label: **it decides who needs a licence and who can never be approved automatically** (`verification/rules.js`, `registries.js`).
- **`custom_niche`** is the mentor's field in their own words, and it's required. `fieldRules.js` reads those words: "doctor" forces a regulated category whatever was chosen.
- **Other things that read `niche`:** the `/advice/<niche>` pages, public answers, mentor requests, live sessions, the waiting list and emails.
- **Search** is a plain text match (`ILIKE`) with no typo tolerance. **Browse** is one row of field chips.
- **Already exist:** `specialty_tags` (max 8, 40 characters), `years_experience` (a number, required), `current_work`.

## The main decision: add on top, don't replace

`niche` stays exactly as it is, as the rule layer. The new categories sit above it, and every field and chip in `server/categories.js` names the `niche` it counts as. Choosing a chip sets the niche, and **the licence and review rules keep working unchanged**.

- Where a chip could be read as licensed, it maps to the regulated niche. All of medicine maps to `medicine`, `dentistry`, `pharmacy` or `nursing`, including nutrition, veterinary and sports medicine.
- If any chosen chip is regulated, the regulated niche wins.
- The existing word check still runs after this. A mentor can't get out of a licence by choosing a different chip.
- An extra field that is regulated stays refused unless the mentor is academic, as today.

## New data (migration 057, additive, with a down file)

| Where | What |
|---|---|
| `users` | `field_id`, `extra_fields` (max 2), `directions` (max 5), `direction_other` (the "სხვა" text per field), `university`, `country` |
| `bookings` | `direction_id`, the chip the question was asked in |
| `niches` | one new row, `politics`, because field 12 has no niche today |
| reused | `specialty_tags` for level 3, `years_experience`, `current_work` for `current_role` |

No existing column or value changes.

## How existing mentors map

Mapping runs at server start and only fills the new, empty columns, so it can run again safely and never touches `niche`, approvals or licences. The application is not reopened.

| Niche | Field and chip |
|---|---|
| medicine | med |
| dentistry / pharmacy / nursing | med.dentistry / med.pharmacy / med.nurse |
| tech | it |
| data_ai / cybersecurity / gaming | it.ai / it.cyber / it.gamedev |
| business, freelancing, real_estate | biz |
| marketing / careers_hr / ecommerce | biz.marketing / biz.hr / biz.ecommerce |
| finance | fin |
| accounting_tax | fin.accounting |
| law | law |
| engineering | eng |
| architecture | eng.architecture |
| science | sci |
| languages | lang |
| teaching | edu |
| study_abroad | abroad |
| psychology | psy |
| parenting | psy.child |
| design / creative / music | art / art / art.music |
| film_photo / writing / content_creation | media.film / media.writing / media.content |
| fitness / sports_coaching | sport.fitness / sport.coaching |
| tourism / cooking / wine_agriculture | svc.tourism / svc.culinary / svc.agro |

- `extra_niches` map the same way into `extra_fields`.
- `other`, and any niche an admin added: the mentor's own words go through the existing suggestion. If nothing fits, `field_id` stays empty and **the mentor appears in a new admin list, "couldn't be mapped"**. They stay listed and can still be asked, because Browse also shows mentors by their words and search still finds them.

## What gets built

**`server/categories.js`** holds the 16 fields, one line per chip with a stable id, KA and EN names, keywords and its niche. Each field also gets a `<field>.other` chip.

**Mentor side, step 1 of `/apply.html`:**
- The own-words field stays, because the licence check reads it. Typing there suggests the field and chip.
- The 16 icons replace the category and extra-field dropdowns: 1 main field, 2 extras, up to 5 chips, with "სხვა" and a text box.
- Below that: up to 5 specializations (30 characters each), then university with autocomplete, country and current role.
- A live preview: "სტუდენტები შენ ასე გიპოვიან: …".

**Student side:**
- One search box that searches fields, chips, specializations, universities and countries, in KA and EN, with typos and Georgian typed in Latin. `თსუ` also finds TSU and "თბილისის სახელმწიფო".
- 16 icons, then chips with counts. Empty chips are hidden, and chips scroll sideways on a phone.
- An empty field shows "მალე" and the notify button.
- Filters: free or paid, country, years. The search box stays visible.
- The question form opens with the chip already chosen.

**Before launch**, Browse stays hidden as today. The 16 tiles and the hero's waiting-list form use the new fields.

**Notify list:** reuses the waiting list. A field id is stored as its field, and an entry is told when a mentor in that field is listed.

**Admin, new "Categories" tab:** mentors who couldn't be mapped, most-used free tags, and mentors and questions per chip.

**Plausible:** `question_submit` with the category id only.

**Copy:** one line saying Wisecall connects students who have roughly chosen a field with experts in it, and doesn't choose a profession for them.

## Decisions

- **Years of experience stays an exact number** in the form, because it's required today and stored as a number. The bands 1–2, 3–5, 6–10 and 10+ are how it's filtered and shown. "Less than a year" counts in 1–2.
- **Tag limit goes from 8 tags of 40 characters to 5 of 30.** Existing longer lists stay as they are until the mentor edits them.
- **The `/advice/<niche>` pages, public answers, mentor requests and live sessions keep using niches.** They aren't in the brief, and their addresses are indexed by search engines.
- **The admin Niches tab stays**, for the rule layer. Adding a chip is a one-line change in `server/categories.js`.

## Risks

- **Licences are the biggest risk.** A wrong chip mapping could drop a licence requirement, so a test checks that every chip in the regulated fields maps to a regulated niche, and that an existing mentor's niche never changes.
- **Many tests are written against the old form and chips** and will need updating. Behaviour tests stay, and the API keeps accepting `niche` and `extraNiches`.
- **Fuzzy search can over-match.** Short words get no typo tolerance: fewer than 4 letters must match exactly.
- **Free text is public.** Specializations, university and "სხვა" go through the same checks as the existing public labels, with no links or contact details.
- **Page weight on phones.** The category list comes from its own small request, and keywords stay on the server.
- **Georgian and English chip names** are as you wrote them, or my translations. They should get the same native-speaker check as other new text.
