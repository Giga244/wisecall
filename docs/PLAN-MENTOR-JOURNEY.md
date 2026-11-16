# Plan: the mentor journey, categories and what makes Wisecall ours

The plan for docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md: what exists, what changes, the risks. Seven commits, in order. Before every
push the whole local suite runs (unit, e2e, cloud e2e, colours, contrast, npm audit): GitHub Actions minutes are used up this month.

Unchanged: the 18+ ID check, a verified email before applying, human review of regulated fields, probation, the 7-day deadline, refunds,
no calls or meetings. Nothing below changes a rule about money, identity or 18+. If one turns out to, I stop and ask.

## Part 1. Emails must arrive

**Exists.** Resend sends everything (server/email.js, a text part already goes with every email). The verify email has the code only, and
the logo images in its header. POST /api/auth/resend-verification exists (6 per 15 minutes per address). verify-email.html asks for the code.

**DNS today** (public lookups, 2026-10-28; no Resend key on this machine, it only lives on the server): SPF and MX on send.wisecall.ge,
the resend._domainkey DKIM key and `_dmarc` with `p=none` are all there. The root SPF lists only Cloudflare email routing (fine: Resend sends
from send.wisecall.ge). Nothing is missing. To do, by the owner: check "Verified" in Resend, then tighten DMARC with a report address
(docs/EMAIL-DNS.md).

**Changes.**
- The verify email: subject "Wisecall – შენი კოდი: 123456" / "Wisecall – your code: 123456", no images, no tracking, plain HTML plus a text
  part. Reply-To is the support address; the sender is EMAIL_FROM, set to "Wisecall <hello@wisecall.ge>" (docs).
- The code screen: the address it went to, with "change email"; "resend code" with a 60 s countdown (the server keeps its limit); the
  Spam / Junk line.
- Resend webhook: POST /api/email/webhook, signed (Svix headers, RESEND_WEBHOOK_SECRET). It keeps the last result per address (delivered,
  bounced, complained, delayed) in a small table. Admin shows "last email: delivered / bounced / pending" for each user.

**Risk.** The webhook is off until the owner adds the endpoint in Resend and sets the secret. Without it, admin shows "pending".

## Part 2. The mentor sign-up, step by step

**Exists.** /ka/mentor → signup?as=mentor → email code → /apply.html (5 steps, per-field errors, progress counting completed steps, story
check shared with the server, price free or paid with the 80% line, proof with link-kind detection, the ID step with a "soon" note before
launch, the done screen).

**Changes.**
- become-a-mentor: the 5 steps with minutes, what to have ready, the line for lecturers.
- Step 1: years as a select (0–50, "50+"); headline examples that follow the category.
- Step 2: two examples per category (a lecturer, a practitioner).
- Step 3: the price range hint for the category (the median of listed mentors once 3 or more; until then 20–50 ₾).
- Step 4: Georgian university domains are recognised ("university page"); a link whose page shows the mentor's name is ticked at once (the
  existing link check). Regulated wording comes from registries.js (diploma or licence, already done for psychology and nursing).
- Step 5: a box that says what happens, why and what stays private. On a computer, a QR code of the ID partner's link, to continue on a
  phone (qrcode is already a dependency). Failures in plain words.
- After sending: the "what happens next" screen and the same as an email.
- Reminders: one email 2 days and one 7 days after the last change to an unsent application, linking to the step it stopped at; a separate
  one when only the ID check is left. Never a third. The footer switches them off (a new email category, "reminders").

## Part 3. Categories

**Exists.** 36 niches in the database, `users.niche`, `custom_niche` (their own words), a suggestion from the words (server/fieldSuggest.js,
1 result), and admin → Niches with the "Other" suggestions.

**Changes.**
- `users.extra_niches` (text[], up to 2; migration). `niche` stays the main one. Browse, the field pages and search use all three.
- fieldSuggest: more Georgian stems and synonyms; the API gives the top 3, shown as chips with "Other" last. 30 real phrases in a test.
- KA labels reviewed (each change listed in the commit).
- `users.practice` ('academic' | 'practitioner' | 'both' | null), shown as a small tag. For a regulated field the text says what an
  academic may answer (study, career, research) and what needs the licence review (advice for one person's case). The rules don't change.
- admin → Niches: the count of mentors for each "Other" phrase.

**Risk.** Browse filters change shape (niche OR extra). Covered by the existing tests plus new ones.

## Part 4. What makes Wisecall ours

- `users.founding_mentor_at`: set on approval while LAUNCH_MODE is prelaunch, and for mentors already approved (migration). A badge on the
  card and the profile.
- University badge: from verified evidence on a known Georgian university domain; admin can confirm or remove it (`users.university_badge`).
- Home "our mentors": `users.show_on_home` (off by default, a checkbox in Settings), approved mentors only; the count line from 5.
- Sample answers: admin adds sample questions; an approved mentor writes one answer; an admin checks it; published on /answers and the
  profile marked "სანიმუშო". A new table; the public-answers checks (text safety, admin review, the mentor can withdraw) apply.
- Answer tips: the three-point hint above the answer box.

## Part 5. Students before launch

- Waitlist: "შენ ხარ #N სიაში" and a share link after joining; one email at launch (already: launchDay()).
- `?ref=tiktok|instagram|...` kept with the existing attribution (waitlist and signup keep their source).
- The home "what an answer looks like" block rotates published sample answers; until there are some, the current example.

## Part 6. Analytics

Plausible events without personal data (the list in the task), docs/ANALYTICS.md (goals and funnel), and the same funnel from the database
for the last 30 days in admin → Overview.

## Part 7. Trust

The About founder block exists and is hidden until FOUNDER_NAME is set; a placeholder photo and text are added, to be replaced
(docs/TODO-OWNER.md). Company details: LEGAL_NAME / LEGAL_ID / LEGAL_ADDRESS exist and show in the footer when set; the Terms get them too.

**Risk.** A visible placeholder on the live prelaunch site would be read by the invited lecturers. So the placeholder ships as files and
docs, and the block stays hidden until the owner sets their own name. This is written in TODO-OWNER.md.
