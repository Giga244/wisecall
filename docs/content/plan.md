# Content plan — 12 Georgian guide articles (+ English versions)

Articles: `docs/content/articles/ka/*.md` (Georgian, primary) and `docs/content/articles/en/*.md` (English versions, same slugs).
Each file has front matter (`title`, `description` = meta description, `slug`, `lang`, `field` = the Wisecall field page it links to).

**No search volumes are quoted here.** Nothing was measured. Before you publish, check real demand for each topic in Google Search
Console (after launch), Google Keyword Planner or Google Trends (region: Georgia) [VERIFY]. The reasons below are about **search
intent**: what the person typing the query wants, and why Wisecall can answer it.

## Where to publish (needs code — not in this PR)

The site has no article route today (`server/pages.js` serves field pages at `/advice/<niche_key>`, and the sitemap has no guides). Suggested:
`/guides/<slug>` for Georgian and `/en/guides/<slug>` for English (or whatever the i18n pattern is), `hreflang` pairs between the two
versions, `Article` JSON-LD, and each guide added to `sitemap.xml`. Put this in a `docs/TODO-*` file when you decide.

## Why these 12 topics (search intent)

| # | Slug | Typical queries (Georgian / English) | Intent | Why Wisecall fits |
|---|---|---|---|---|
| 1 | studying-in-germany | „სწავლა გერმანიაში“, „გერმანიაში ჩაბარება“, “study in Germany from Georgia” | Informational, going to act within 6–18 months | Rules are official, but *how it really goes* (city, visa wait, motivation letter) needs someone who did it |
| 2 | studying-in-poland | „სწავლა პოლონეთში“, “study in Poland for Georgians” | Informational + comparing options | Cost-of-living and residence-permit reality varies by city — a current student answers best |
| 3 | studying-in-the-usa | „სწავლა ამერიკაში“, „ამერიკაში სტიპენდია“, “F-1 visa Georgia” | Informational, high stakes (money) | Strategy questions (which schools give aid, essay voice, visa interview) are personal |
| 4 | first-it-job | „IT-ში სამსახური გამოცდილების გარეშე“, „პირველი სამსახური პროგრამისტად“ | Informational → transactional (courses) | Paid bootcamp decisions and CV reviews are ideal paid questions |
| 5 | career-change | „პროფესიის შეცვლა“, „30 წლის ასაკში პროფესიის შეცვლა“ | Informational, emotional | People want someone who made the same switch |
| 6 | starting-a-business-in-georgia | „ბიზნესის დაწყება საქართველოში“, „ი/მ თუ შპს“, “register a company in Georgia” | Informational + legal/tax | IE vs LLC, VAT and first customers — founder and accountant mentors |
| 7 | freelancing-from-georgia | „ფრილანსი საქართველოში“, „მცირე ბიზნესის სტატუსი ფრილანსერი“ | Informational + tax | Getting paid from abroad and small-business status are common, specific questions |
| 8 | medical-residency-abroad | „რეზიდენტურა გერმანიაში“, „USMLE საქართველოდან“, “Approbation Georgian doctor” | Informational, long process, high willingness to pay | Licensed doctors who did it (Wisecall checks medical licences) |
| 9 | national-exams-preparation | „ეროვნული გამოცდები“, „ეროვნულებისთვის მომზადება“, „პრიორიტეტები“ | Informational, seasonal, parents + students | Teachers and recent top scorers; strong seasonal peaks [VERIFY in Google Trends] |
| 10 | working-abroad-legally | „საზღვარგარეთ მუშაობა ლეგალურად“, „სამუშაო ვიზა გერმანიაში“, „სეზონური სამუშაო“ | Informational + safety (scam avoidance) | People who work abroad legally and HR/legal mentors; serves a real public need |
| 11 | scholarships-abroad | „სტიპენდია საზღვარგარეთ“, „Chevening“, „DAAD სტიპენდია“, „Erasmus Mundus“ | Informational, deadline-driven | Past winners reviewing a motivation letter = a perfect paid question |
| 12 | job-interview-preparation | „გასაუბრებისთვის მომზადება“, „გასაუბრების კითხვები“, „ხელფასზე საუბარი“ | Informational, urgent (interview this week) | HR/recruiter mentors; the 7-day answer window fits “interview next week” (say so in the product) |

Topics deliberately **not** chosen: medical or legal advice for a specific case (Wisecall answers are general guidance, not a consultation),
immigration “hacks”, and anything where the honest answer is “ask a licensed professional in person”.

## Publishing order

Goal: launch with the topics where Wisecall will have mentors first, then follow the calendar.

| Order | Article | Why now |
|---|---|---|
| 1 | 01 studying-in-germany | Core field (study abroad); easy to recruit current students |
| 2 | 04 first-it-job | Big audience; IT mentors are easy to reach through the founders’ networks [YOU: confirm] |
| 3 | 11 scholarships-abroad | Links from 01/02/03; many scholarship deadlines fall in autumn–winter [VERIFY each programme] |
| 4 | 06 starting-a-business-in-georgia | Business + accounting fields (higher price range) |
| 5 | 12 job-interview-preparation | Evergreen; links from 04 and 05 |
| 6 | 02 studying-in-poland | Completes the study-abroad cluster |
| 7 | 07 freelancing-from-georgia | Links from 04 and 06 |
| 8 | 05 career-change | Links to 04, 07, 12 |
| 9 | 03 studying-in-the-usa | Publish before the US application season (autumn) [VERIFY] |
| 10 | 09 national-exams-preparation | Publish ahead of the registration period and again before the exams [VERIFY dates on naec.ge] |
| 11 | 08 medical-residency-abroad | Publish only once at least 2–3 licence-verified doctor mentors are live |
| 12 | 10 working-abroad-legally | Publish once a law/HR mentor has reviewed it; sensitive topic |

A pace of **one article per week** gives a full cluster in about three months; adjust to your capacity. Update the dates and the [VERIFY]
facts on each article at least once a year.

## Internal links

Add these links in the body text (a sentence such as “see also…”) when you publish — they are **not** in the article files yet, because
the guide URLs don’t exist yet.

| Article | Link to these guides | Wisecall field pages |
|---|---|---|
| 01 Germany | 11 scholarships, 02 Poland, 08 residency (for medics) | /advice/study_abroad, /advice/languages |
| 02 Poland | 01 Germany, 11 scholarships, 10 working abroad (student work rules) | /advice/study_abroad |
| 03 USA | 11 scholarships, 09 national exams (school grades) | /advice/study_abroad |
| 04 First IT job | 12 interviews, 07 freelancing, 05 career change | /advice/tech, /advice/data_ai, /advice/design |
| 05 Career change | 04 first IT job, 07 freelancing, 12 interviews | /advice/careers_hr |
| 06 Small business | 07 freelancing | /advice/business, /advice/accounting_tax, /advice/law |
| 07 Freelancing | 06 small business, 04 first IT job | /advice/freelancing, /advice/accounting_tax |
| 08 Residency | 01 Germany, 03 USA, 10 working abroad | /advice/medicine |
| 09 National exams | 11 scholarships, 03 USA | /advice/teaching, /advice/study_abroad |
| 10 Working abroad | 12 interviews, 08 residency | /advice/careers_hr, /advice/law |
| 11 Scholarships | 01 Germany, 02 Poland, 03 USA | /advice/study_abroad, /advice/languages |
| 12 Interviews | 04 first IT job, 05 career change | /advice/careers_hr |

Also link **from each field page back to its guides** (for example `/advice/study_abroad` → 01, 02, 03, 11) and from the help center where
relevant (`docs/help/*`).

## Mentors to recruit before each article goes live

An article whose closing link lands on an empty field page wastes the visit. Recruit at least **3 approved mentors** in the linked field
before publishing (the field page should show real people).

| Article | Mentor types to recruit | Where to find them (ideas) |
|---|---|---|
| 01 Germany | Georgian students and graduates at German universities (bachelor’s and master’s, both German- and English-taught); someone who did Studienkolleg | Alumni networks, Georgian student associations in Germany, DAAD alumni [VERIFY names before contacting] |
| 02 Poland | Current Georgian students in Warsaw, Kraków, Wrocław; someone who went through the residence permit recently | Student communities, university international offices |
| 03 USA | Georgians admitted to US undergrad with financial aid; a Fulbright alumnus; a graduate student with an assistantship | EducationUSA alumni events, Fulbright alumni |
| 04 First IT job | Junior-to-senior developers, QA engineers, data analysts; tech leads who run junior interviews | Tech meetups, GITA events, LinkedIn |
| 05 Career change | People who changed careers (e.g. teacher → IT, finance → UX); HR specialists | LinkedIn, HR communities |
| 06 Small business | Founders of small Georgian businesses (services, e-commerce, food); accountants (accounting_tax); a business lawyer (law, licence checked) | Business associations, coworkings, accountant networks |
| 07 Freelancing | Freelancers with international clients (design, development, translation, marketing); an accountant familiar with IE / small-business status | Freelance communities, LinkedIn |
| 08 Residency | Georgian doctors with German Approbation; Georgian IMGs matched in the US (licence verified) | Georgian medical diaspora communities, university alumni |
| 09 National exams | Experienced school teachers per subject; recent high scorers (18+ only — Wisecall mentors must be adults) | Schools, teacher communities |
| 10 Working abroad | People working legally abroad (seasonal and skilled work); HR specialists; an immigration lawyer (law, licence checked) | Diaspora communities, legal networks |
| 11 Scholarships | Past Chevening, Fulbright, DAAD, Erasmus Mundus winners | Alumni associations of each programme |
| 12 Interviews | HR managers, recruiters, hiring managers in popular fields | HR communities, LinkedIn |

Every mentor goes through the normal verification (ID + liveness, 18+, name match, human review, licence check in regulated fields, first 5
answers checked). Offer the first mentors the launch fee described in `docs/business/competitors.md` (10% for 3 months) if you adopt it.

## Before publishing each article — checklist

- [ ] Every [VERIFY] mark checked and removed or replaced with the confirmed fact and the date checked
- [ ] Official links open and point to the current page
- [ ] At least 3 approved mentors in the linked field
- [ ] Internal links from the table above added
- [ ] Georgian proofread by a native speaker (informal შენ kept consistent)
- [ ] English version matches the Georgian (same facts, same links)
- [ ] Meta title ≤ ~60 characters and description ≤ ~160 characters where possible (Georgian titles run long — shorten for the `<title>` if
      needed, keep the H1 full)
