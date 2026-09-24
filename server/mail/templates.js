// Branded HTML + plain-text emails in English and Georgian.
//   render('verify', 'ka', { code: '123456' }) -> { subject, html, text }
// All values interpolated into HTML are escaped here, so callers pass raw data.
const config = require('../config');
const { escapeHtml } = require('../email');

const COLORS = { ink: '#2b2440', soft: '#746e94', bg: '#eaf6f1', card: '#ffffff', accent: '#ff6f59', quote: '#eefaf4' };

// Text with {placeholders}; each placeholder is escaped for HTML (or left raw for plain text).
const fill = (str, data, esc = true) => String(str).replace(/\{(\w+)\}/g, (m, k) => (data[k] === undefined ? m : (esc ? escapeHtml(data[k]) : String(data[k]))));

const S = {
  en: {
    tagline: "Real advice, from people who've done it.",
    linkFallback: "If the button doesn't work, copy this link into your browser:",
    verify: {
      subject: 'Your Wisecall verification code', heading: 'Verify your email',
      intro: 'Use this code to finish setting up your account:', expiry: 'The code expires in 15 minutes.',
      footer: "If you didn't create a Wisecall account, you can safely ignore this email."
    },
    reset: {
      subject: 'Reset your Wisecall password', heading: 'Reset your password',
      intro: 'Someone (hopefully you) asked to reset your password. Choose a new one with the button below. The link expires in 1 hour.',
      button: 'Choose a new password', footer: "If you didn't ask for this, ignore this email. Your password will not change."
    },
    newQuestion: {
      subject: 'You have a new paid question on Wisecall', heading: 'New paid question',
      intro: '{amount} was paid to ask you:',
      after: "Answer within {days} days. If you don't, the buyer is refunded automatically and you won't be paid for it.",
      button: 'Answer the question'
    },
    answered: {
      subject: '{mentor} answered your question', heading: 'You got an answer', intro: '{mentor} answered your question:',
      after: 'Rating the answer helps others find great mentors.', button: 'Read it in your dashboard'
    },
    refundSeeker: {
      subject: 'Your Wisecall payment was refunded', heading: 'Your payment was refunded',
      intro: 'We refunded {amount} for your question to {mentor} because {reason}.',
      after: 'It can take 5–10 business days to appear on your statement.',
      reasons: { no_answer_deadline: 'they did not answer within {days} days', refunded_at_bank: 'the payment was refunded by our payment provider', other: 'our team refunded it' }
    },
    refundMentor: {
      subject: 'A question was refunded on Wisecall', heading: 'A question was refunded',
      intro: 'The question below was refunded to the buyer because {reason}. You will not receive a payout for it.',
      reasons: { no_answer_deadline: 'it was not answered within {days} days', refunded_at_bank: 'the payment was refunded by our payment provider', other: 'our team refunded it' }
    },
    deadlineSoon: {
      subject: 'Answer soon or the question will be refunded', heading: 'A paid question is waiting',
      intro: 'You have a paid question waiting:', after: "If it isn't answered by {date}, the buyer is refunded automatically.", button: 'Answer now'
    },
    mentorApproved: {
      subject: "You're approved as a Wisecall mentor", heading: 'Welcome aboard',
      intro: 'Your mentor application was approved.',
      after: 'One last step: add your name and IBAN in Settings so you appear in Browse experts and can be paid.', button: 'Add payout details'
    },
    mentorRejected: {
      subject: 'About your Wisecall mentor application', heading: "We couldn't approve your application yet",
      intro: "Thanks for applying. We couldn't approve it this time.", reasonLabel: 'Reason:',
      after: 'You can update your details and apply again from Settings.', button: 'Open settings'
    },
    workEmailCode: {
      subject: 'Your Wisecall work email code', heading: 'Confirm your work email',
      intro: 'Use this code to confirm that you can read email at your work address ({domain}):', expiry: 'The code expires in 15 minutes.',
      footer: "If you didn't ask for this, you can safely ignore this email."
    },
    interviewBooked: {
      subject: 'Your Wisecall video interview is booked', heading: 'Your interview is booked',
      intro: 'Your video interview is booked for {date}. It takes about {minutes} minutes.',
      after: "We'll email you the meeting link before then. You can change the time in your verification settings up to 12 hours before it starts.", button: 'Open verification'
    },
    interviewLink: {
      subject: 'The meeting link for your Wisecall interview', heading: 'Your meeting link',
      intro: 'Here is the meeting link for your video interview on {date}:', after: 'Please join a couple of minutes early and have your ID and licence to hand.', button: 'Join the meeting'
    },
    interviewCancelled: {
      subject: 'Your Wisecall interview was cancelled', heading: 'We had to cancel your interview',
      intro: 'We are sorry: we had to cancel your video interview on {date}.', reasonLabel: 'Reason:',
      after: 'Please choose another time in your verification settings.', button: 'Choose a new time'
    },
    payoutPaid: {
      subject: 'Your Wisecall payout has been sent', heading: 'Your payout is on its way',
      intro: 'We sent {amount} to your bank account ending in {last4}.', referenceLabel: 'Bank transfer reference:',
      after: 'Bank transfers usually arrive within 1 to 3 working days. You can see all your earnings in your dashboard.', button: 'Open dashboard'
    },
    contact: { subject: 'New message from the Wisecall contact form', heading: 'New contact message' }
  },

  ka: {
    tagline: 'რეალური რჩევა მათგან, ვინც ეს გაიარა.',
    linkFallback: 'თუ ღილაკი არ მუშაობს, დააკოპირე ეს ბმული ბრაუზერში:',
    verify: {
      subject: 'შენი Wisecall-ის დადასტურების კოდი', heading: 'დაადასტურე ელფოსტა',
      intro: 'გამოიყენე ეს კოდი ანგარიშის შექმნის დასასრულებლად:', expiry: 'კოდი მოქმედია 15 წუთის განმავლობაში.',
      footer: 'თუ Wisecall-ზე ანგარიში შენ არ შეგიქმნია, უბრალოდ უგულებელყავი ეს წერილი.'
    },
    reset: {
      subject: 'Wisecall-ის პაროლის აღდგენა', heading: 'პაროლის აღდგენა',
      intro: 'ვიღაცამ (იმედია, შენ) მოითხოვა პაროლის აღდგენა. ახალი პაროლის ასარჩევად დააჭირე ღილაკს. ბმული მოქმედია 1 საათის განმავლობაში.',
      button: 'აირჩიე ახალი პაროლი', footer: 'თუ ეს შენ არ მოგითხოვია, უგულებელყავი წერილი. პაროლი არ შეიცვლება.'
    },
    newQuestion: {
      subject: 'Wisecall-ზე ახალი ფასიანი კითხვა გაქვს', heading: 'ახალი ფასიანი კითხვა',
      intro: '{amount} გადაიხადეს შენთვის კითხვის დასასმელად:',
      after: 'უპასუხე {days} დღის განმავლობაში. თუ არ უპასუხე, თანხა ავტომატურად დაუბრუნდება მყიდველს და ამ კითხვაზე ანაზღაურებას ვერ მიიღებ.',
      button: 'კითხვაზე პასუხი'
    },
    answered: {
      subject: '{mentor}-მ უპასუხა შენს კითხვას', heading: 'პასუხი მიიღე', intro: '{mentor}-მ უპასუხა შენს კითხვას:',
      after: 'პასუხის შეფასება ეხმარება სხვებს, იპოვონ კარგი მენტორები.', button: 'წაიკითხე პირად კაბინეტში'
    },
    refundSeeker: {
      subject: 'შენი Wisecall-ის გადახდა დაგიბრუნდა', heading: 'თანხა დაგიბრუნდა',
      intro: '{mentor}-სთვის დასმულ კითხვაზე {amount} დაგიბრუნეთ, რადგან {reason}.',
      after: 'თანხა ბანკის ამონაწერში 5–10 სამუშაო დღეში გამოჩნდება.',
      reasons: { no_answer_deadline: 'მან არ უპასუხა {days} დღის განმავლობაში', refunded_at_bank: 'გადახდა დაბრუნდა გადახდის სისტემიდან', other: 'ჩვენმა გუნდმა დააბრუნა თანხა' }
    },
    refundMentor: {
      subject: 'Wisecall-ზე კითხვის თანხა დაბრუნდა', heading: 'კითხვის თანხა დაბრუნდა',
      intro: 'ქვემოთ მოცემული კითხვის თანხა დაუბრუნდა მყიდველს, რადგან {reason}. ამ კითხვაზე ანაზღაურებას ვერ მიიღებ.',
      reasons: { no_answer_deadline: 'პასუხი {days} დღის განმავლობაში არ გაიცა', refunded_at_bank: 'გადახდა დაბრუნდა გადახდის სისტემიდან', other: 'ჩვენმა გუნდმა დააბრუნა თანხა' }
    },
    deadlineSoon: {
      subject: 'უპასუხე მალე, თორემ კითხვის თანხა დაბრუნდება', heading: 'ფასიანი კითხვა გელოდება',
      intro: 'გელოდება ფასიანი კითხვა:', after: 'თუ {date}-მდე არ უპასუხე, თანხა ავტომატურად დაუბრუნდება მყიდველს.', button: 'უპასუხე ახლა'
    },
    mentorApproved: {
      subject: 'შენ დამტკიცდი Wisecall-ის მენტორად', heading: 'კეთილი იყოს შენი მობრძანება',
      intro: 'შენი მენტორის განაცხადი დამტკიცდა.',
      after: 'ბოლო ნაბიჯი: პარამეტრებში მიუთითე შენი სახელი და IBAN, რომ გამოჩნდე ექსპერტების სიაში და ანაზღაურება მიიღო.', button: 'გადახდის მონაცემების დამატება'
    },
    mentorRejected: {
      subject: 'შენი მენტორის განაცხადის შესახებ', heading: 'განაცხადის დამტკიცება ჯერ ვერ შევძელით',
      intro: 'მადლობა განაცხადისთვის. ამჯერად ვერ დავამტკიცეთ.', reasonLabel: 'მიზეზი:',
      after: 'შეგიძლია განაახლო მონაცემები და თავიდან გაგზავნო განაცხადი პარამეტრებიდან.', button: 'პარამეტრების გახსნა'
    },
    workEmailCode: {
      subject: 'შენი Wisecall-ის სამსახურეობრივი ელფოსტის კოდი', heading: 'დაადასტურე სამსახურეობრივი ელფოსტა',
      intro: 'გამოიყენე ეს კოდი, რომ დაადასტურო, რომ შენს სამსახურეობრივ მისამართზე ({domain}) წერილების წაკითხვა შეგიძლია:', expiry: 'კოდი მოქმედია 15 წუთის განმავლობაში.',
      footer: 'თუ ეს შენ არ მოგითხოვია, უბრალოდ უგულებელყავი ეს წერილი.'
    },
    interviewBooked: {
      subject: 'შენი Wisecall-ის ვიდეო ინტერვიუ დაჯავშნილია', heading: 'ინტერვიუ დაჯავშნილია',
      intro: 'შენი ვიდეო ინტერვიუ დაჯავშნილია: {date}. გრძელდება დაახლოებით {minutes} წუთი.',
      after: 'შეხვედრის ბმულს ამ დრომდე გამოგიგზავნით ელფოსტაზე. დროის შეცვლა შეგიძლია ვერიფიკაციის პარამეტრებში, დაწყებამდე არაუგვიანეს 12 საათით ადრე.', button: 'ვერიფიკაციის გახსნა'
    },
    interviewLink: {
      subject: 'შენი Wisecall-ის ინტერვიუს ბმული', heading: 'შეხვედრის ბმული',
      intro: 'აი, შეხვედრის ბმული შენი ვიდეო ინტერვიუსთვის ({date}):', after: 'გთხოვთ, რამდენიმე წუთით ადრე შემოხვიდე და პირადობა და ლიცენზია ხელთ გქონდეს.', button: 'შეხვედრაში შესვლა'
    },
    interviewCancelled: {
      subject: 'შენი Wisecall-ის ინტერვიუ გაუქმდა', heading: 'ინტერვიუ გავაუქმეთ',
      intro: 'ბოდიში: შენი ვიდეო ინტერვიუ ({date}) გაუქმებული გვქონდა.', reasonLabel: 'მიზეზი:',
      after: 'გთხოვთ, ვერიფიკაციის პარამეტრებში სხვა დრო აირჩიო.', button: 'ახალი დროის არჩევა'
    },
    payoutPaid: {
      subject: 'შენი Wisecall-ის ანაზღაურება გაიგზავნა', heading: 'შენი ანაზღაურება გზაშია',
      intro: '{amount} გავგზავნეთ შენს საბანკო ანგარიშზე, რომელიც მთავრდება {last4}-ით.', referenceLabel: 'საბანკო გადარიცხვის რეფერენსი:',
      after: 'საბანკო გადარიცხვა ჩვეულებრივ 1-3 სამუშაო დღეში აისახება. ყველა შემოსავალი შეგიძლია იხილო დაფაზე.', button: 'დაფის გახსნა'
    },
    contact: { subject: 'ახალი შეტყობინება Wisecall-ის საკონტაქტო ფორმიდან', heading: 'ახალი შეტყობინება' }
  }
};

// Each template returns a list of blocks; the layout turns them into HTML and plain text.
//   { p: text }  paragraph      { code }  big code box      { quote }  quoted text
//   { button: label, url }      { small: text }             { link: url } fallback link
const BUILDERS = {
  verify: (s, d) => ({
    heading: s.verify.heading,
    blocks: [{ p: s.verify.intro }, { code: d.code }, { small: s.verify.expiry }, { small: s.verify.footer }]
  }),
  reset: (s, d) => ({
    heading: s.reset.heading,
    blocks: [{ p: s.reset.intro }, { button: s.reset.button, url: d.url }, { small: s.linkFallback }, { link: d.url }, { small: s.reset.footer }]
  }),
  newQuestion: (s, d) => ({
    heading: s.newQuestion.heading,
    blocks: [{ p: fill(s.newQuestion.intro, d), raw: true }, { quote: d.question }, { p: fill(s.newQuestion.after, d), raw: true }, { button: s.newQuestion.button, url: `${config.PUBLIC_URL}/dashboard.html` }]
  }),
  answered: (s, d) => ({
    heading: s.answered.heading,
    blocks: [{ p: fill(s.answered.intro, d), raw: true }, { quote: d.answer }, { p: s.answered.after }, { button: s.answered.button, url: `${config.PUBLIC_URL}/dashboard.html` }]
  }),
  refundSeeker: (s, d) => ({
    heading: s.refundSeeker.heading,
    blocks: [{ p: fill(s.refundSeeker.intro, { ...d, reason: fill(s.refundSeeker.reasons[d.reason] || s.refundSeeker.reasons.other, d, false) }), raw: true }, { small: s.refundSeeker.after }]
  }),
  refundMentor: (s, d) => ({
    heading: s.refundMentor.heading,
    blocks: [{ p: fill(s.refundMentor.intro, { reason: fill(s.refundMentor.reasons[d.reason] || s.refundMentor.reasons.other, d, false) }), raw: true }, { quote: d.question }]
  }),
  deadlineSoon: (s, d) => ({
    heading: s.deadlineSoon.heading,
    blocks: [{ p: s.deadlineSoon.intro }, { quote: d.question }, { p: fill(s.deadlineSoon.after, d), raw: true }, { button: s.deadlineSoon.button, url: `${config.PUBLIC_URL}/dashboard.html` }]
  }),
  mentorApproved: (s) => ({
    heading: s.mentorApproved.heading,
    blocks: [{ p: s.mentorApproved.intro }, { p: s.mentorApproved.after }, { button: s.mentorApproved.button, url: `${config.PUBLIC_URL}/settings.html` }]
  }),
  mentorRejected: (s, d) => ({
    heading: s.mentorRejected.heading,
    blocks: [{ p: s.mentorRejected.intro }, ...(d.note ? [{ quote: `${s.mentorRejected.reasonLabel} ${d.note}` }] : []), { p: s.mentorRejected.after }, { button: s.mentorRejected.button, url: `${config.PUBLIC_URL}/settings.html` }]
  }),
  workEmailCode: (s, d) => ({
    heading: s.workEmailCode.heading,
    blocks: [{ p: fill(s.workEmailCode.intro, d), raw: true }, { code: d.code }, { small: s.workEmailCode.expiry }, { small: s.workEmailCode.footer }]
  }),
  interviewBooked: (s, d) => ({
    heading: s.interviewBooked.heading,
    blocks: [{ p: fill(s.interviewBooked.intro, d), raw: true }, { p: s.interviewBooked.after }, { button: s.interviewBooked.button, url: `${config.PUBLIC_URL}/settings.html?tab=verification` }]
  }),
  interviewLink: (s, d) => ({
    heading: s.interviewLink.heading,
    blocks: [{ p: fill(s.interviewLink.intro, d), raw: true }, { button: s.interviewLink.button, url: d.link }, { small: s.linkFallback }, { link: d.link }, { p: s.interviewLink.after }]
  }),
  interviewCancelled: (s, d) => ({
    heading: s.interviewCancelled.heading,
    blocks: [{ p: fill(s.interviewCancelled.intro, d), raw: true }, ...(d.reason ? [{ quote: `${s.interviewCancelled.reasonLabel} ${d.reason}` }] : []), { p: s.interviewCancelled.after }, { button: s.interviewCancelled.button, url: `${config.PUBLIC_URL}/settings.html?tab=verification` }]
  }),
  payoutPaid: (s, d) => ({
    heading: s.payoutPaid.heading,
    blocks: [{ p: fill(s.payoutPaid.intro, d), raw: true }, { quote: `${s.payoutPaid.referenceLabel} ${d.reference}` }, { p: s.payoutPaid.after }, { button: s.payoutPaid.button, url: `${config.PUBLIC_URL}/dashboard.html` }]
  }),
  contact: (s, d) => ({
    heading: s.contact.heading,
    blocks: [{ p: `${d.name} <${d.email}>` }, { quote: d.message }]
  })
};

function layout(lang, heading, blocks) {
  const s = S[lang];
  const rows = blocks.map((b) => {
    const text = b.raw ? b.p : (b.p !== undefined ? escapeHtml(b.p) : '');
    if (b.p !== undefined) return `<p style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${COLORS.ink}">${text}</p>`;
    if (b.code) return `<div style="margin:6px 0 18px;padding:18px;text-align:center;background:${COLORS.quote};border-radius:14px;font-size:34px;font-weight:700;letter-spacing:8px;color:${COLORS.ink};font-family:'Courier New',monospace">${escapeHtml(b.code)}</div>`;
    if (b.quote) return `<div style="margin:0 0 18px;padding:14px 16px;background:${COLORS.quote};border-radius:14px;font-size:15px;line-height:1.55;color:${COLORS.ink};white-space:pre-wrap">${escapeHtml(b.quote)}</div>`;
    if (b.button) return `<p style="margin:8px 0 20px"><a href="${escapeHtml(b.url)}" style="display:inline-block;padding:13px 26px;background:${COLORS.accent};color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;border-radius:999px">${escapeHtml(b.button)}</a></p>`;
    if (b.link) return `<p style="margin:0 0 16px;font-size:13px;word-break:break-all"><a href="${escapeHtml(b.link)}" style="color:${COLORS.accent}">${escapeHtml(b.link)}</a></p>`;
    if (b.small) return `<p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:${COLORS.soft}">${escapeHtml(b.small)}</p>`;
    return '';
  }).join('');

  const support = config.SUPPORT_EMAIL ? ` · <a href="mailto:${escapeHtml(config.SUPPORT_EMAIL)}" style="color:${COLORS.soft}">${escapeHtml(config.SUPPORT_EMAIL)}</a>` : '';
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(heading)}</title></head>
<body style="margin:0;padding:0;background:${COLORS.bg};font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${COLORS.bg};padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px">
<tr><td style="padding:0 6px 14px;font-size:26px;font-weight:800;color:${COLORS.ink}">Wisecall<span style="color:${COLORS.accent}">.</span></td></tr>
<tr><td style="background:${COLORS.card};border-radius:22px;padding:30px 28px">
<h1 style="margin:0 0 18px;font-size:24px;line-height:1.25;color:${COLORS.ink}">${escapeHtml(heading)}</h1>
${rows}
</td></tr>
<tr><td style="padding:16px 8px;text-align:center;font-size:12px;color:${COLORS.soft}">${escapeHtml(s.tagline)}${support}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [heading, '', ...blocks.map((b) => {
    if (b.p !== undefined) return b.raw ? b.p.replace(/&[a-z#0-9]+;/g, (e) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[e] || e)) : b.p;
    if (b.code) return b.code;
    if (b.quote) return `"${b.quote}"`;
    if (b.button) return `${b.button}: ${b.url}`;
    if (b.link) return b.link;
    return b.small || '';
  }), '', s.tagline].join('\n');
  return { html, text };
}

function render(name, lang, data = {}) {
  const l = S[lang] ? lang : 'en';
  const s = S[l];
  const build = BUILDERS[name];
  if (!build) throw new Error(`Unknown email template: ${name}`);
  const d = { days: config.ANSWER_DEADLINE_DAYS, ...data };
  const { heading, blocks } = build(s, d);
  const subject = fill(s[name].subject, d, false).replace(/[<>]/g, '');
  return { subject, ...layout(l, heading, blocks) };
}

module.exports = { render, TEMPLATE_NAMES: Object.keys(BUILDERS) };
