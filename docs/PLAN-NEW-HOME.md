# Plan: new home page, Browse without login, the Jikhva logo

Brief: `docs/CLAUDE-CODE-NEW-HOME.md`. Designs: `docs/new-home/` (live and prelaunch, desktop and mobile).

## How it works today

- **Home is also Browse.** `index.html` holds the hero, the 16-field strip, then the whole Browse section (`#experts`: search, filters sheet, field chips, the grid with "მალე" fields). After that come "our mentors", live sessions, how it works, FAQ and a final call to action. Eighteen links across the site (emails, footer, header, dashboard) point to `/index.html#experts`.
- **Browse and profiles are already public** (`/u/<username>`). A visitor sees "log in to ask" with two buttons, but no question box. The draft question is kept per mentor in `sessionStorage`. Sign-up, the email code and Google sign-in all accept `?redirect=` and return there.
- **Prelaunch.** The hero shows the waiting-list form (email, field, "16 or older") instead of the search. The server removes the parts marked `<!-- before launch -->` or `<!-- after launch -->`.
- **Shown Q&As already need consent.** `public_answers` can be `published` only when the asker and the mentor both agreed and an admin approved it. The database enforces this.
- **Home mentors** (`/api/home-mentors`): approved mentors who chose to be shown on the home page, with the "Founding mentor" badge.
- **Social links:** `SOCIAL_INSTAGRAM`, `SOCIAL_TIKTOK`, `SOCIAL_FACEBOOK` (and more) are already in `server/config.js`, in `/api/config`, in the footer and in `sameAs`. They are all empty today.
- **Header logo:** `public/js/header.js` uses `/brand/wisecall-logo.svg`, and the symbol alone under 360px.

## What I'll build

### 1. Logo
- **Built in code, not the PNG.** Jikhva's head (`jikhva-head.png`, shrunk to twice its shown size and saved as WebP, about 15 KB) sits behind "Wisecall." in the header's display font.
  - The letters get a thin outline in the background colour (`paint-order: stroke`). There is no box behind them.
  - The head peeks out from behind the "ll".
- **One version for both themes:** the text and outline colours come from the theme, so the same markup is the navy-text logo on light pages and the white-text logo on dark ones.
- **Header:** taller, with room above for the horns. Tested at 360px and 1280px so nothing is cut off. Under 360px, Jikhva's head alone replaces the old speech-bubble symbol.
- **The plain "Wisecall." stays** in emails, the payment page, PDF receipts and statements, and the favicon.

### 2. Home page (matching the designs)
1. **Hero:** "ჰკითხე მას, ვინც ეს გზა უკვე გაიარა", one sentence, one search box with "ძებნა", and up to 5 popular field chips. No second button.
   - The search sends you to Browse with the words already typed, using the existing category search.
2. **The phone:** drawn in HTML and CSS, beside the hero (below it on a phone). It shows only a published public answer chosen by an admin:
   - the mentor's name, the verified badge and their field;
   - the question in a coral bubble, without the student's name;
   - the answer in a white bubble, cut at about 300 characters with "…";
   - "პასუხი X დღეში" from the real dates;
   - the stars filled only to the real rating, if one was revealed.
   - **Admin setting:** Admin → Public answers gets a "show on the home page" choice (one at a time). It's stored in a small new `site_settings` table (migration 061, additive, with a down file).
   - If nothing is chosen, or the chosen answer is withdrawn, the phone is hidden.
   - **Animation:** an 11-second loop as in `phone-animation.html`: typing, send, "გაგზავნილია ✓", "2 დღის შემდეგ", typing dots, the answer, "✓ პასუხი 2 დღეში", stars. Small CSS and JS only. It pauses off screen, and with reduced motion it shows the final state.
3. **"გაიცანი ჩვენი ექსპერტები":** up to 3 mentors from `/api/home-mentors` (approved and opted in), with avatar, name, role, field, verified, price and "პროფილი →", plus "ყველა ექსპერტი →". The section is hidden when there are none.
   - The badge "დამფუძნებელი მენტორი" becomes **"პირველი მენტორი"** (plural "პირველი მენტორები"), and "Founding mentor" becomes **"First mentor"** in English.
   - That badge is the only user-facing occurrence. "დამფუძნებელი" meaning "company founder" (About page, examples) stays.
4. **How it works:** 3 steps, with the small waving Jikhva.
5. **Trust row:** ID-verified, 7 days or a refund, written answers, contacts kept private.
6. **"ექსპერტი ხარ?" banner:** dark, with Jikhva presenting and a "გახდი მენტორი" button. No phone.
7. **Footer:** one-colour Instagram, TikTok and Facebook icons, opening in a new tab with `rel="noopener"`.
   - The three links become the config defaults. An env value overrides one, and setting one to empty hides its icon.
   - The same icons go on the waiting-list confirmation and unsubscribe pages, in the "your answer has arrived" email, and in the welcome email (see question 1).
   - They're also in the structured data (`sameAs`).
8. **Removed from home:** the field strip and full category list, the filters, the big empty preview box, the "მალე" fields, the FAQ (it stays at `/faq.html`) and the live-sessions block (it stays at `/live`).
- **Images:** the Jikhva pictures are 500–600 KB PNGs. I'll save web copies (WebP, about 30 KB) in `public/brand/`.

### 3. Browse page and Browse without login
- **New `/experts.html` (and `/ka/experts.html`):** today's Browse section moves here unchanged, with the fields, search, filters, grid and "მალე" fields.
  - The header's "ექსპერტები" and every `#experts` link point to it.
  - An old `/index.html#experts` or `?niche=` link from earlier emails still lands on Browse, through a small redirect.
- **The profile shows the question box to visitors too.** "დასვი კითხვა" while logged out keeps the draft and opens the sign-up: a bottom sheet on a phone, a dialog on a computer.
  - It offers: continue with Google, continue with email (the normal sign-up page, with every age and 16+ check, the parent box, terms and the "are you a person" check), and log in.
- **Afterwards** they come back to the profile, and the draft is sent automatically:
  - a free question is sent at once;
  - a paid one goes to the bank page;
  - a 16–17-year-old asking a paid mentor stops at the adult-payer box, with the draft still there.

### 4. Prelaunch (on now, until you switch it)
- **Unchanged:** the waiting list, its admin page and delete button, the unsubscribe and one-click links, and the existing emails.
- **Hero, as in the prelaunch design:**
  - the pill "🚀 მალე იხსნება · ჩაეწერე პირველებში";
  - an email box with "ჩაეწერე სიაში" instead of the search;
  - the popular chips choosing the field (optional; none means "any field");
  - the "I am 16 or older" box. The server needs it, and I'm keeping the age rule.
- **The count line:** "🔥 X+ ადამიანი უკვე მოლოდინის სიაშია · Wisecall მალე იხსნება". X is the real number of addresses, rounded down to 10, and the line is hidden under 50. The server sends only the rounded number.
- **Same as in launch mode:** the phone, mentors, how it works, the trust row and the mentor banner.
- **Browse and profiles stay open.** "დასვი კითხვა" opens the same waiting-list form (email plus an optional field) in the sheet or dialog, with "Wisecall მალე იხსნება. ჩაეწერე და პირველს შეგატყობინებთ".
- **"გახდი მენტორი" keeps working,** so mentors can apply now.
- **After joining:** a thank-you message with the Instagram, TikTok and Facebook links. For an address already on the list, see question 4.
- **Switching to launch mode** turns on the search and the full ask flow. It also starts the existing launch email: each person on the list gets one email once a mentor in their field is listed (`launchDay`, unchanged). There is no separate "Wisecall გაიხსნა" email today, so per the brief I'm keeping the existing one.

### Tests
- New unit and e2e tests:
  - a visitor opens Browse and a profile;
  - the logged-out ask leads to sign-up, then back, then the draft is sent;
  - the home page shows only approved, opted-in mentors;
  - the phone is hidden when nothing is chosen, and shows the chosen answer;
  - the logo isn't cut at 360px or 1280px;
  - prelaunch: the hero form, joining saves the email, a repeated email gets a friendly message, "დასვი კითხვა" opens the form, and the count line is real and hidden under 50;
  - launch mode shows the search;
  - the social links and `sameAs`;
  - the badge wording.
- Existing tests that read the old home (`home-layout`, `home-examples`, `responsive`, `redesign`, `smoke` and others) get updated where they check removed parts. The checks themselves stay, now aimed at the Browse page.
- I'll run all unit, e2e and cloud tests, then commit as "Home: simpler page, browse without login, Jikhva logo" and push.

## Questions before I start
1. **There is no welcome email today.** Should I add one, sent once after the email address is verified, with the social icons? Or skip that part?
2. **Mentor names on the home cards:** the design shows "ნინო ბ.". The profile shows the full name. I'll use the full name, as on their profile, unless you prefer the short form.
3. **Removing the FAQ and live-sessions blocks from the home page** (they stay on their own pages): OK?
4. **"Already on the list".** Today the form gives everyone the same answer on purpose, so nobody can type a stranger's email and learn whether they're on the list.
   - Saying "this email is already on the list" undoes that.
   - **My suggestion:** one friendly message that fits both cases, for example "გმადლობთ! ეს მისამართი სიაშია — Wisecall-ის გახსნისას მოგწერთ." A repeated email still gets a kind answer and no error, and the list stays private.
   - Or do you want the explicit "already on the list" wording anyway?
