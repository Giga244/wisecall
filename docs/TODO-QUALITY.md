# TODO from the quality pack (branch `cloud/quality-pack`)

This branch only **adds** files. Every change to existing code or text is written here, with the file, the line (at commit `2a90c51`) and
the exact fix, so it can be applied on `main` without merge conflicts. IDs match `docs/QUALITY-AUDIT.md`.

## Tests marked `test.fixme` (they fail today; each was run and verified to fail for the stated reason)

File: `tests/e2e-cloud/known-issues.spec.js`. When the fix lands, change `test.fixme(` to `test(`.

| Test | Fails today because | Fix |
|---|---|---|
| QUALITY-SEO-1: a mentor profile is readable without calling /api/ | With `/api/` blocked (as robots.txt tells crawlers), the page shows “We couldn’t find that profile” | SEO-1 below |
| QUALITY-SEO-2: the Georgian version has its own address, `lang="ka"` and a Georgian title | `GET /?lang=ka` returns `lang="en"`, English title, no hreflang | SEO-2 below |
| AUDIT #9: an admin can download a document whose file name is in Georgian | `GET /api/admin/documents/:id` → **500** (`ERR_INVALID_CHAR` in `Content-Disposition`) | `server/routes/adminVerification.js:494-498`: replace the manual header with `res.attachment(doc.meta.filename)` (Express writes an RFC 5987 `filename*=UTF-8''…`) |
| AUDIT #3: changing the password signs out the other devices | The second device’s `/api/me` still returns the user | session versioning, see `docs/TODO-FROM-CLOUD.md` (#3) |

Also: `package.json` has no script for these tests. Suggested: `"test:e2e:cloud": "playwright test -c tests/e2e-cloud"`.

---

## SEO

**SEO-1 🔴 profiles invisible to crawlers**
- `server/pages.js:155` — remove `'Disallow: /api/',` and add the allow/disallow lines of `docs/seo/robots.txt` (quick fix), **or better**:
- `server/pages.js:60-80` (`sendProfile`) — render the profile’s visible content into `profile.html` on the server (a `{{PROFILE_HTML}}`
  placeholder inside `<main>`), built from `profiles.view(owner, null)` with every value escaped with `escapeHtml`; `public/js/profile.js`
  keeps drawing the interactive parts. Then the `/api/` Disallow can stay.
- `public/js/profile.js:30` — see UX-1 (a failed request must not say “not found”).

**SEO-2 🔴 Georgian URLs, lang, hreflang**
- New middleware in `server/index.js` before `pages.pageRoutes()`: if `req.path` starts with `/ka/` (or equals `/ka`), set `req.lang = 'ka'`
  and rewrite `req.url` without the prefix; otherwise `req.lang = 'en'`.
- `server/pages.js:44-47` `baseVars()` — add `LANG`, `TITLE`, `DESCRIPTION`, `OG_LOCALE`, `HREFLANG_EN`, `HREFLANG_KA`, `CANONICAL_URL`
  (with the `/ka` prefix for Georgian) from a small `meta.*` set of keys in `public/i18n/en.json` / `ka.json` (proposed texts:
  `docs/seo/meta-tags.md`).
- Every `public/*.html` head: `<html lang="{{LANG}}">`, `<title>{{TITLE}}</title>`, the description/OG/Twitter tags from the vars, plus
  `<link rel="alternate" hreflang="en|ka|x-default" …>` and `og:locale` / `og:locale:alternate`.
- `public/js/i18n.js:48-51` — on a `/ka/` URL the language is `ka` regardless of localStorage; the header’s language buttons
  (`public/js/header.js:27-29`) become links to the other URL (and still save the choice).
- `server/pages.js:171-178` — sitemap with both language URLs and `xhtml:link` alternates (`docs/seo/sitemap.xml`).

**SEO-3 🟠 structured data** — `server/pages.js`: emit the JSON-LD from `docs/seo/jsonld/` (`WebSite` + `FAQPage` on `/`, `ProfilePage`/
`Person`/`Offer` + `BreadcrumbList` in `sendProfile()` for listed public mentors). Escape `<` as `<` in the JSON.

**SEO-4 🟡**
- `server/pages.js:72` — cut the description at ~155 characters on a word boundary, append “…”; choose the template by page language.
- `public/profile.html:15` + `server/pages.js:69-76` — `og:image` = `{{OG_IMAGE}}`: the mentor’s photo URL (absolute) for listed mentors, the
  site image otherwise; `twitter:card` `summary` when it is the square photo.
- `public/404.html:8` (and `403.html`, `500.html` if present) — remove `<link rel="canonical">`.
- `server/pages.js:171` — drop `/signup.html` and `/login.html` from `staticPages`; add `<meta name="robots" content="noindex, follow">` to
  `public/signup.html` and `public/login.html`.
- `server/pages.js:155-163` — remove the `Disallow` lines for pages that already carry `noindex` (dashboard, settings, verify-email,
  choose-username, reset/forgot-password, waitlist-unsubscribe).
- `server/pages.js:177` — `lastmod` from the latest profile change instead of `created_at`.

---

## Georgian (`public/i18n/ka.json`)

**KA-1 🟠 informal შენ everywhere** — replace the value on each line (only the value; keys and placeholders unchanged):

| Line | Key | Replace with |
|---|---|---|
| 78 | `auth.error.missingFields` | შეავსე ყველა ველი. |
| 489 | `error.403.body` | თუ ფიქრობ, რომ ეს შეცდომაა, დაგვიკავშირდი. |
| 607 | `vt.fillIn` | შეავსე ყველა ველი. |
| 641 | `vt.lic.expired` | შენი ლიცენზიის ვადა ამოიწურა. გამოგვიგზავნე განახლებული. |
| 658 | `vt.iv.none` | ამჟამად თავისუფალი დრო არ არის. მალე ისევ შემოიხედე. |
| 663 | `vt.iv.tooLate` | დაწყებამდე ძალიან ცოტა დროა დარჩენილი და აქ ვეღარ გააუქმებ. დაგვიკავშირდი. |
| 795 | `wait.error` | შეიყვანე სწორი ელფოსტის მისამართი. |
| 955 | `profile.photo.err.type` | აირჩიე JPG, PNG ან WebP ფორმატის სურათი. |
| 957 | `profile.photo.err.invalid` | სურათის წაკითხვა ვერ მოხერხდა. სცადე სხვა. |
| 961 | `profile.username.rule` | 3–30 პატარა ლათინური ასო, ციფრი ან დეფისი. შეცვლა 30 დღეში ერთხელ შეგიძლია; ძველი ბმულიც იმუშავებს. |
| 966 | `profile.username.reserved` | ეს სახელი ვერ გამოიყენება. აირჩიე სხვა. |
| 967 | `profile.username.invalid` | გამოიყენე 3–30 პატარა ლათინური ასო, ციფრი ან ერთი დეფისი (დეფისი არ შეიძლება დასაწყისში ან ბოლოში). |
| 969 | `profile.username.tooSoon` | სახელი ცოტა ხნის წინ შეცვალე. დაელოდე მითითებულ თარიღს. |
| 982 | `profile.visibility.publicHint` | ბმულის მქონე ნებისმიერ ადამიანს შეუძლია ნახოს შენი ფოტო, სახელი, აღწერა და „ჩემ შესახებ“. შენი ელფოსტა, საბანკო მონაცემები და დოკუმენტები არასდროს ჩანს. |
| 983 | `profile.visibility.contactsHint` | პროფილს ხედავენ მხოლოდ ისინი, ვისთანაც კითხვა-პასუხი გქონია. საძიებო სისტემები მას ვერ პოულობენ. |
| 984 | `profile.visibility.lockedMentor` | მყიდველებს უნდა შეეძლოთ შენი პოვნა, ამიტომ Wisecall-ზე გამოჩენილი მენტორის პროფილი ყოველთვის საჯაროა. |
| 986 | `profile.preview.title` | როგორ ხედავენ სხვები შენს პროფილს |
| 988 | `profile.preview.noBio` | აქ გამოჩნდება შენი ტექსტი „ჩემ შესახებ“. |
| 989 | `profile.err.name` | შეიყვანე შენი სახელი. |
| 991 | `profile.err.languages` | აირჩიე მაქსიმუმ {n} ენა. |
| 992 | `profile.err.language` | აირჩიე ენები სიიდან. |
| 993 | `profile.err.linkedin` | შეიყვანე LinkedIn-ის ბმული, მაგალითად https://www.linkedin.com/in/yourname |
| 994 | `profile.err.website` | შეიყვანე ვებსაიტის მისამართი, რომელიც იწყება https://-ით |
| 1002 | `auth.field.username.hint` | შენი პროფილის ბმული. მოგვიანებით შეცვლაც შეგიძლია. |
| 1017 | `auth.google.err.cancelled` | Google-ით შესვლა გააუქმე, ამიტომ არაფერი შეცვლილა. შეგიძლია თავიდან სცადო ან ელფოსტით შეხვიდე. |
| 1018 | `auth.google.err.error` | Google-ით შესვლა ვერ მოხერხდა. სცადე თავიდან ან გამოიყენე ელფოსტა და პაროლი. |
| 1019 | `auth.google.err.bad_state` | შესვლის ბმულს ვადა გაუვიდა ან სხვა ბრაუზერში გაიხსნა. დაიწყე თავიდან. |
| 1020 | `auth.google.err.link_needed` | ამ ელფოსტით ანგარიში უკვე არსებობს. უსაფრთხოებისთვის ჯერ პაროლით შედი, შემდეგ კი პარამეტრები → ანგარიშში დააკავშირე Google. |
| 1022 | `auth.google.err.unavailable` | Google-ით შესვლა ახლა მიუწვდომელია. გამოიყენე ელფოსტა და პაროლი. |
| 1024 | `settings.connected.body` | დააკავშირე Google-ის ანგარიში და უფრო სწრაფად შედი. Wisecall იგებს მხოლოდ შენს სახელს, ელფოსტასა და სურათს, Google კი შენი კითხვების შესახებ არაფერს იგებს. |
| 1029 | `settings.connected.done` | Google დაკავშირებულია შენს ანგარიშთან |
| 1031 | `settings.connected.err.setPassword` | ამჟამად Google შესვლის ერთადერთი გზაა. ჯერ ქვემოთ დააყენე პაროლი, შემდეგ გათიშე Google. |
| 1033 | `settings.connected.err.hasOther` | სხვა Google ანგარიში უკვე დაკავშირებულია. ჯერ ის გათიშე. |
| 1035 | `choose.title` | აირჩიე მომხმარებლის სახელი |
| 1036 | `choose.sub` | ეს შენი საჯარო პროფილის მისამართია. შენი სახელიდან შემოგთავაზეთ ვარიანტი: დატოვე ან ჩაწერე სხვა. |
| 1038 | `choose.later` | მოგვიანებით შეგიძლია შეცვალო პარამეტრებში, 30 დღეში ერთხელ. |
| legal.* | Terms/Privacy in ka.json | These are formal (თქვენ) on purpose in many legal texts; decide with the lawyer (`docs/legal/`), not here. |

Kept: `wait.submit` (792) and `wait.prelaunch.title` (925) „შემატყობინეთ“ — the visitor addresses the Wisecall team (plural);
`auth.panel.login.2` (905) — addresses mentors as a group.

**KA-2 🟠 no hyphenated endings on names**

| Line | Key | Replace with |
|---|---|---|
| 56 | `expert.loginToAsk` | შედი სისტემაში, რომ კითხვა დაუსვა — {name}. |
| 179 | `dash.deadline.seeker` | მენტორს პასუხისთვის {date}-მდე აქვს დრო. თუ არ გიპასუხებს, თანხა ავტომატურად დაგიბრუნდება. |
| 858 | `expert.askTitle` | დაუსვი კითხვა — {name} |
| 1051 | `rate.mentor.hint` | როგორი იყო პასუხი? |
| 1052 | `rate.asker.hint` | იყო თუ არა კითხვა გასაგები და პატივისცემით დაწერილი? |
| 1070 | `rate.theirs` | შეფასება — {name} |
| 1072 | `rate.theirNone` | {name}: ამ კითხვის შეფასება არ დაუტოვებია. |

(`{date}-მდე`, `{date}-ს` stay: a hyphen after digits is correct.)

**KA-3 🟠 „ანაზღაურება“ for money to mentors** — line 586 `settings.tab.payouts`: `ანაზღაურება`; line 915 `settings.sub`: replace
„გადახდები“ with „ანაზღაურება“. Then search `ka.json` for other „გადახდ…“ strings in the mentor payout context (`payout.*`,
`dash.earnings.*`) and use „ანაზღაურება / გადარიცხვა“ consistently (`docs/help/ka` quotes the current label and must be updated with it).

**KA-4 🟡**
| Line | Key | Replace with |
|---|---|---|
| 1149 | `ap.progressText` | {done} / {total} ნაბიჯი დასრულებულია |
| 591 | `vt.progress` | {done} / {total} ნაბიჯი დასრულებულია |
| 14 | `hero.sub` | replace „დაჯავშნე რეალური პასუხი“ with „მიიღე რეალური პასუხი“ (rest unchanged) |

**KA-5 🟡 dates without Georgian locale data** — `public/js/i18n.js`: add `WisecallI18n.formatDate(date, style)` that uses
`Intl.DateTimeFormat('ka-GE', …)` when `Intl.DateTimeFormat.supportedLocalesOf('ka').length`, otherwise builds the date from
`['იანვარი','თებერვალი','მარტი','აპრილი','მაისი','ივნისი','ივლისი','აგვისტო','სექტემბერი','ოქტომბერი','ნოემბერი','დეკემბერი']`;
use it in `profile.js:102`, `ratings.js:11`, `dashboard.js:25`, `badges.js:19`, `settings-profile.js:68`, `settings-verification.js:7-8`,
and the admin scripts (`admin.js:26`, `admin-mentors.js:5,182`, `admin-queue.js:7`, `admin-reviews.js:9`, `admin-waitlist.js:5`,
`admin-interviews.js:7`).

---

## UX

**UX-1 🟠** `public/js/profile.js:30` — `if (!answer.profile) { showMessage(answer.error && answer.error !== 'not_found' ? 'profile.loadError'
: 'profile.notFound', answer.error && answer.error !== 'not_found' ? '<button …data-retry>…</button>' : ''); return; }` with new keys
`profile.loadError` (EN “We couldn’t load this profile. Check your connection and try again.” / KA „პროფილი ვერ ჩაიტვირთა. შეამოწმე
ინტერნეტი და სცადე თავიდან.“) and `common.retry` (“Try again” / „თავიდან ცდა“). Check how `profileRequest` reports errors (line ~15) so a 404
sets `error: 'not_found'`.

**UX-2 🟠** `public/js/ratings.js:90` — when `!v.theirs`, use a new key `rate.revealedOne` (EN “Your rating is now visible. {name} didn’t rate
this question.” / KA „შენი შეფასება ახლა ჩანს. {name}: ამ კითხვის შეფასება არ დაუტოვებია.“) instead of `rate.revealed` + `rate.theirNone`.

**UX-3 🟠** `public/js/settings.js:149` — when `user.applicationSubmittedAt && user.verificationStatus === 'pending'`, show a key
`settings.progress.status` (“See where it stands” / „ნახე, რა ეტაპზეა“) instead of `settings.progress.continue`. `en.json:1255` / ka
`ap.rev.with_team`: add the review target once agreed (“…usually within 2 working days.” / „…ჩვეულებრივ 2 სამუშაო დღეში.“).

**UX-4 🟠** `public/js/admin-mentors.js:86,94,267` — replace `esc(a.aiError)` / `esc(h.aiError)` with
`esc(t('admin.ai.err.' + code) || code)`; for `not_configured` use a neutral `<p class="muted small">` instead of `form-error`. New keys in
`admin-en.json` / `admin-ka.json`: `admin.ai.err.not_configured` (“AI summaries are off (no API key).” / „AI-ის შეჯამება გამორთულია.“),
plus the other codes the analysis can record (`budget_reached`, `daily_limit`, `timeout`, `refused`, `interrupted`, `invalid_output` —
check `server/verification/analysis.js` / `aiReview.js` for the exact list).

**UX-5 🟠** `public/i18n/en.json:263` — delete “Reviews are shown with the reviewer’s first name and the initial of their last name.” and the
same sentence in `ka.json` `legal.terms.sections[8].p[1]` (the paragraph count must stay equal in both files: replace it with a pointer to
section 10 instead of deleting, if the paragraph-count test requires it).

**UX-6 🟡**
- `public/css/style.css:553` (`.tabs`) and the admin `.filters` row on phones: add `mask-image: linear-gradient(to right, #000 85%, transparent)`
  when the row overflows, and `scrollIntoView({ inline: 'center', block: 'nearest' })` on the active tab after render.
- `window.confirm()` → the site’s sheet/dialog: `admin.js:116,173`, `admin-queue.js:82`, `admin-reviews.js:79`, `admin-mentors.js:381`,
  `settings-verification.js:507`.
- `public/css/style.css:225,323,556` — `transition: all 0.18s ease` → `transition: background-color .18s ease, color .18s ease, border-color
  .18s ease;` (the focus outline then appears at once) and wrap in `@media (prefers-reduced-motion: no-preference)`.
- `public/js/main.js:95` — make the accessible name start with the visible text: `` `${t('experts.filters')} ${active}` `` and make sure the
  visible badge shows the same number (or remove the `aria-label` and render the count as visible text).

## Accessibility

**A11Y-1 🟡** `public/settings.html:211-212`, `public/css/app.css:50` — put the field and `.pw-toggle` in a wrapper with
`position: relative`, give the input `min-height: 44px; padding-right: 48px`, and position the button inside the wrapper so it cannot overlap
the next field. Re-run `node tests/e2e-cloud/audit/scan.js --only settings-account` (axe `target-size` should be clean).

---

## Help center (`docs/help/`)
- When KA-3 renames the Georgian Payouts tab, update `docs/help/ka/05`, `07`, `14` (they quote „გადახდები“).
- If a minimum payout or a withdraw button is built, rewrite `docs/help/*/07-how-mentors-get-paid.md`.
- If a delete-account button is built, rewrite `docs/help/*/12-deleting-your-account.md`.
- Publish the articles as pages (e.g. `/help/…`, EN + KA) and add them to the sitemap.
