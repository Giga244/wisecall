# Rich profiles — plan (docs/PROFILES-PROMPT.md)

Optional, LinkedIn-like profile sections for everyone (askers and mentors). Nothing here is ever required to sign up, ask a question,
apply as a mentor or be listed. The existing profile (name, photo, headline, current work, city, about, languages, LinkedIn, website,
"who can open my profile") keeps working as it does; the new sections sit next to it.

## 1. Data model (migration 039_profiles_rich.sql, additive; undo script)

- `profile_items` — one row per item of a list section:
  `id, user_id (cascade), section ('experience' | 'education' | 'licence' | 'project' | 'journey'), position (order), data jsonb, verified_at,
  verified_by, verified_note, created_at, updated_at`. `data` holds the section's fields, checked by the server (server/profileItems.js):
  - experience: title, organisation, location?, type (full_time | part_time | self_employed | freelance | internship | volunteer),
    start {year, month?}, end {year, month?} | current: true, description (≤ 1,000), achievements (≤ 5 lines of ≤ 150);
  - education: school, degree?, field?, start year?, end year?, description (≤ 1,000);
  - licence: name, issuer, issued {year, month?}, expires {year, month?}?, url? (http/https);
  - project: title, url?, description (≤ 500), has_image (the image in `profile_item_images`, the photo pipeline: re-encoded, so no EXIF);
  - journey: date {year, month?}, title (≤ 100), text? (≤ 500).
  Limits: 30 items per section.
- `profile_settings` (one row per person, made on first save): `skills text[]` (≤ 30 tags of ≤ 40), `top_skills text[]` (≤ 3, among
  skills), `language_levels jsonb` ({code: basic | conversational | fluent | native}, for the existing languages list), `links jsonb`
  ({github, behance, instagram, youtube}; LinkedIn and website stay where they are), `visibility jsonb` ({section: everyone | signed_in
  | only_me}), `admin_hidden jsonb` ({section: reason}), `hidden_at, hidden_reason` (the whole profile), `search_text` (the public
  sections as one lowercase text, for Browse search), `updated_at`.
- `profile_item_images` (item_id PK, mime, data bytea) and `profile_reports` (reporter, owner, reason, details, status, resolution).
- `users.bio` may grow to 2,000 characters (About); nothing else changes on `users`.

## 2. Sections and who sees them

Sections: headline, about, experience, education, licences, skills, languages, projects, journey, links. Name and photo follow the
existing "who can open my profile" setting (the outer gate); each section then has its own visibility (the inner gate):
`everyone` (also visitors and search engines), `signed_in` (any signed-in person), `only_me`. The owner and admins always see everything.

Defaults (when the person never chose):
- askers: every section `only_me`;
- mentors: headline, about, experience, education, skills, languages `everyone`; journey `only_me`; licences, projects, links `everyone`
  for links (they are public today) and `only_me` for licences and projects until switched on (the safest default; docs/QUESTIONS.md).
- people who already filled in headline / about / languages / links before this change: those sections keep being shown as today
  (`everyone`), so nothing they chose to share disappears.

Never shown: emails, phone numbers, exact addresses (the contact-details filter refuses them in every text field).

## 3. Verified vs self-reported

Every item is "self-reported" unless an admin marked it verified in the verification panel (with a note): an experience item that matches
the reviewed experience or the work-email domain, a licence that matches the verified licence, an education item that matches a verified
diploma. The check shows as a small "Verified" mark; the panel shows the accepted evidence next to each item to make the match easy.
Editing a verified item removes its check (the server compares the data) until it is reviewed again. The page never says or implies an
item was checked when it was not.

## 4. Where it shows

- Public profile /u/<username> (and /ka/u/...): header (photo, name, headline, city, top skills, verified badges, Ask / Follow / Live
  sessions for mentors), then About, Experience (grouped by organisation with the total time there; durations like "3 yrs 4 mos"
  calculated; "2019 – 2022" without months works), Education, Licences, Projects, Journey (a vertical timeline), Skills, Languages,
  Links — only sections with content that the viewer may see. Server-rendered for visitors (only `everyone` sections), with JSON-LD
  Person (worksFor, alumniOf, knowsAbout, knowsLanguage) from `everyone` sections only.
- Browse experts cards: headline, current position, years of experience (from the earliest experience start, computed), top skills —
  only from `everyone` sections. Search also matches organisations, titles, skills and education through `search_text` (public only).
- Settings → Profile: one collapsible card per section with Add, inline edit/delete, drag to reorder (and up/down buttons for keyboards
  and phones), a visibility choice per section, drafts kept in the browser while typing, and a quiet "profile strength" bar with tips —
  only there, never as a popup or an email.

## 5. Mentor application

The application's experience step gets "Use my profile" (fills the role title and years from the current experience, the story from
About when empty); the profile gets "Fill from my application" (one experience item from the role title, skills from the specialty
tags). They stay separate: the application is what the verification team reviews. The AI review keeps its fixed list of fields (owner's
rule); reading public profile sections stays off until the owner confirms (docs/QUESTIONS.md 2c).

## 6. Moderation and safety

Offensive-word filter and length limits on every field; links http/https only with rel="nofollow ugc noopener"; rate limit on saves and
uploads. "Report profile" for signed-in people → admin queue. An admin can hide one section or the whole profile with a reason (the owner
gets an Inbox message and an email; logged in the audit log), and unhide it.

## 7. Privacy

Included in "Download my data"; deleted with the account (items, images, settings, reports about them anonymised). Images re-encoded (no
EXIF). The help article and the Privacy Policy describe the sections and their visibility.

## 8. Tests

Visibility per section for anonymous / signed-in / owner / admin; asker defaults; existing content kept visible; verified-check rules and
removal on edit; escaping in every field; link validation; reorder persistence; durations and grouping; JSON-LD with public data only;
Browse card fields and search only from public data; export and deletion; reporting and hiding; nothing required for sign-up, asking or
applying. Screenshots: an asker profile, a mentor profile with every section, the settings editor (mobile + desktop, EN + KA).
