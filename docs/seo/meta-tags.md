# Proposed titles, descriptions and share tags (EN + KA)

Today every page is served in **English only** (`<html lang="en">`, English `<title>`/description/OG), because the language is chosen in the
browser (localStorage) after the page loads. Search engines and link previews (Facebook, Messenger, Viber, LinkedIn) therefore always get
English, even for Georgian visitors and Georgian mentors. The plan below needs a Georgian URL per page (recommended: `/ka/` prefix, see
`docs/QUALITY-AUDIT.md` SEO-2) so the server can send the right language in the HTML.

**Rules used:** title ≤ 60 characters, description 120–155 characters, the brand at the end, no keyword stuffing, the same facts the page
shows. Georgian uses the informal შენ like the rest of the site.

| Page | EN title | EN description | KA title | KA description |
|---|---|---|---|---|
| `/` | Wisecall — Ask verified experts in Georgia | Pay per question and get a written answer from a verified mentor within 7 days, or your money back. Founders, engineers, doctors and more. | Wisecall — ჰკითხე გადამოწმებულ ექსპერტებს | გადაიხადე ერთ კითხვაში და მიიღე წერილობითი პასუხი გადამოწმებული მენტორისგან 7 დღეში, ან თანხა დაგიბრუნდება. |
| Browse `/?niche=tech#experts` | Tech mentors — Wisecall | Ask experienced engineers and product people a question. Every mentor is ID-checked and reviewed by our team. | ტექნოლოგიების მენტორები — Wisecall | დაუსვი კითხვა გამოცდილ ინჟინრებსა და პროდუქტის სპეციალისტებს. ყველა მენტორი გადამოწმებულია. |
| Mentor profile `/u/<name>` | {name}, {role} — Wisecall | Ask {name} ({role}) a question for {price} GEL. {first 100 chars of bio} | {name}, {role} — Wisecall | დაუსვი კითხვა: {name} ({role}), {price} ₾. {bio-ს პირველი 100 სიმბოლო} |
| `/about.html` | About Wisecall — how it works | How Wisecall checks mentors, how payment and refunds work, and who we are. | Wisecall-ის შესახებ — როგორ მუშაობს | როგორ ვამოწმებთ მენტორებს, როგორ მუშაობს გადახდა და თანხის დაბრუნება, და ვინ ვართ. |
| `/contact.html` | Contact Wisecall | Questions, feedback or a refund request? Write to the Wisecall team and we will reply by email. | დაგვიკავშირდი — Wisecall | შეკითხვა, შენიშვნა ან თანხის დაბრუნების მოთხოვნა? მოგვწერე და ელფოსტით გიპასუხებთ. |
| `/terms.html` | Terms of Service — Wisecall | The rules for asking and answering on Wisecall: payment, refunds, mentors’ duties and reviews. | მომსახურების პირობები — Wisecall | Wisecall-ის წესები: გადახდა, თანხის დაბრუნება, მენტორის ვალდებულებები და შეფასებები. |
| `/privacy.html` | Privacy Policy — Wisecall | What personal data Wisecall keeps, why, for how long, who helps us process it, and your rights. | კონფიდენციალურობის პოლიტიკა — Wisecall | რა მონაცემებს ინახავს Wisecall, რატომ და რამდენ ხანს, ვინ გვეხმარება და რა უფლებები გაქვს. |
| `/signup.html` (noindex) | Create your account — Wisecall | Sign up free to ask verified mentors, or to apply as one. | ანგარიშის შექმნა — Wisecall | დარეგისტრირდი უფასოდ, რომ მენტორებს კითხვა დაუსვა ან თავად გახდე მენტორი. |
| `/login.html` (noindex) | Log in — Wisecall | Log in to your Wisecall account. | შესვლა — Wisecall | შედი შენს Wisecall-ის ანგარიშში. |

**Today's problems in these tags**
- Profile description mixes languages for Georgian mentors: “Ask თამარ ლომიძე (ციფრული მარკეტინგის ხელმძღვანელი) a question on Wisecall for 25 GEL.
  ვეხმარები…” (English template around Georgian text). Pick the template by the page language, not the mentor.
- The description is cut mid-word at 300 characters (`server/pages.js:72`); cut at ~155 on a word boundary and add “…”.
- `og:image` is the same generic image on every page, including mentor profiles. For listed mentors, use their photo (512×512 is fine for
  `summary` cards; or render a 1200×630 card with name, role and price).
- `og:locale` is missing: add `og:locale` (`ka_GE` / `en_US`) and `og:locale:alternate`.
- `twitter:site` is missing (only if there is an X account).
- `signup.html` and `login.html` are in the sitemap and indexable: thin pages; mark them `noindex, follow` and drop them from the sitemap.
- The 404 page has `<link rel="canonical" href="/404.html">`, and `/404.html` itself answers 404 (and is noindex). Drop the canonical on
  error pages.

## hreflang and canonical (every indexable page)

```html
<!-- on https://wisecall.ge/u/tamar-lomidze (English) -->
<html lang="en">
<link rel="canonical" href="https://wisecall.ge/u/tamar-lomidze">
<link rel="alternate" hreflang="en" href="https://wisecall.ge/u/tamar-lomidze">
<link rel="alternate" hreflang="ka" href="https://wisecall.ge/ka/u/tamar-lomidze">
<link rel="alternate" hreflang="x-default" href="https://wisecall.ge/ka/u/tamar-lomidze">
<meta property="og:locale" content="en_US">
<meta property="og:locale:alternate" content="ka_GE">

<!-- on https://wisecall.ge/ka/u/tamar-lomidze (Georgian): the same three alternates, and -->
<html lang="ka">
<link rel="canonical" href="https://wisecall.ge/ka/u/tamar-lomidze">
<meta property="og:locale" content="ka_GE">
```
Each language version is its own canonical (never point the Georgian page's canonical at the English one). `x-default` → Georgian, the
main market. The language switch in the header then becomes a link to the other URL (and still saves the choice in localStorage).
