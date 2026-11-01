# Things only the owner can do

The code is ready for each of these. Nothing here needs a code change: they are settings, records and words that have to come from you.
Keys and passwords go in Render → wisecall → Environment, never into the code or a chat.

## 1. Email: DNS and Resend (docs/EMAIL-DNS.md has every step)

- [ ] Resend → Domains → wisecallge.ge: every row *Verified*.
- [ ] Resend: turn **off** click tracking and open tracking.
- [ ] Cloudflare → DNS: the `_dmarc` TXT record with a `rua=` address for reports (exact value in docs/EMAIL-DNS.md, step 3).
- [ ] Render: `EMAIL_FROM` = `Wisecall <hello@wisecallge.ge>`, `SUPPORT_EMAIL` = the support address.
- [ ] Optional: Resend → Webhooks → add `https://wisecallge.ge/api/email/webhook` (events: sent, delivered, delivery delayed, bounced,
      complained), then put its signing secret in Render as `RESEND_WEBHOOK_SECRET`. Admin → Mentors then shows whether each person's last
      email arrived.
- [ ] If live.com / Outlook still puts codes in Junk: Microsoft SNDS (docs/EMAIL-DNS.md, step 6).

## 2. About: who's behind Wisecall (your photo and words)

The About page has a "Who's behind Wisecall" block. In production it stays hidden until you fill it in. Outside production it shows a
grey placeholder picture and text marked **[Placeholder]**, so you can see where everything goes.

- [ ] A square photo of you, at least 240 × 240 px, as JPG, PNG or WebP. Put it in `public/brand/` (for example `public/brand/founder.jpg`).
      It must be a file on this site: the security rules block pictures from other sites.
- [ ] In Render, set:
  - `FOUNDER_NAME`: your name as you want it shown
  - `FOUNDER_ROLE`: for example `Founder`
  - `FOUNDER_PHOTO`: `/brand/founder.jpg`
  - `FOUNDER_STORY_KA`, `FOUNDER_STORY_EN`: two or three sentences each (plain text; a blank line starts a new paragraph). Who you are, why
    you started Wisecall, and what you want it to be.

## 3. Company details (after registering)

Shown in the footer on every page and at the start of the Terms ("Wisecall is run by …"), each part only once it is set. Receipts use
them too.

- [ ] `LEGAL_NAME`: the registered name (company or individual entrepreneur)
- [ ] `LEGAL_ID`: the identification number
- [ ] `LEGAL_ADDRESS`: the legal address

## 4. Analytics (docs/ANALYTICS.md)

- [ ] Plausible → Site settings → Goals: add each event in the table in docs/ANALYTICS.md, then the custom properties `field`, `source`,
      `role`, `method` and `age_group`.
- [ ] Optional (Business plan): the "Mentor journey" funnel. The same funnel from the database is already in Admin → Overview.

## 5. Before launch: askers from age 16

- [ ] **A lawyer must review the minors and data-protection text before launch.** (Terms section 2, Privacy Policy section 12, in Georgian and English:
      askers 16+, the parent or guardian permission the minor confirms themselves, what is kept and for how long, and how a parent asks for an account to be closed.)
- [ ] Live sessions have no age rule for 16–17-year-olds yet. They are off in production; decide what minors may do before ever turning them on.

## 6. Before launch: content you choose

- [ ] Admin → Answers → Sample questions: add the questions you want approved mentors to answer (for example "როგორ ავირჩიო
      ფაკულტეტი?"). Each answer comes back to the same screen for your check before it is public.
- [ ] Ask the first approved mentors to tick Settings → "ჩემი პროფილი მთავარ გვერდზე გამოჩნდეს". The home page's "first mentors" section
      appears once one of them does.
