// Branded HTML + plain-text emails in English and Georgian.
//   render('verify', 'ka', { code: '123456' }) -> { subject, html, text }
// All values interpolated into HTML are escaped here, so callers pass raw data.
const config = require('../config');
const { escapeHtml } = require('../email');

// Names of the niches in each language, read from the site's own dictionaries.
const NICHE_NAMES = { en: require('../../public/i18n/en.json'), ka: require('../../public/i18n/ka.json') };

// (the site's "Ink & Paper" colours, public/css/tokens.css: ink text on the coral button; links in the deeper coral that reads on white)
const COLORS = { ink: '#1e1a31', soft: '#4e4963', bg: '#f4f2ee', card: '#ffffff', accent: '#ff6f59', link: '#b5361f', quote: '#fff6dc' };
const FONT = "Onest,'Noto Sans Georgian',Arial,Helvetica,sans-serif";
const DISPLAY = "'Bricolage Grotesque','Noto Sans Georgian',Arial,Helvetica,sans-serif";
// Dark mode: mail apps that follow the reader's setting (Apple Mail, iOS Mail, Outlook for Mac and Outlook.com, several Android apps)
// switch to these colours and to the logo made for dark backgrounds; the others show the light version (the inline colours).
const DARK = { ink: '#f4f2ee', soft: '#c9c5d6', bg: '#16131f', card: '#221e31', quote: '#2b2643', line: '#d9d5e6', link: '#ff8f7d' };
const DARK_CSS = `:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme:dark){.wc-bg{background:${DARK.bg}!important}.wc-card{background:${DARK.card}!important;border-color:${DARK.line}!important}.wc-link{color:${DARK.link}!important}.wc-ink{color:${DARK.ink}!important}.wc-soft,.wc-soft a{color:${DARK.soft}!important}.wc-quote{background:${DARK.quote}!important;color:${DARK.ink}!important}.wc-light{display:none!important}.wc-dark{display:block!important;max-height:none!important;overflow:visible!important}}
[data-ogsc] .wc-light{display:none!important}[data-ogsc] .wc-dark{display:block!important;max-height:none!important;overflow:visible!important}`;

// Text with {placeholders}; each placeholder is escaped for HTML (or left raw for plain text).
const fill = (str, data, esc = true) => String(str).replace(/\{(\w+)\}/g, (m, k) => (data[k] === undefined ? m : (esc ? escapeHtml(data[k]) : String(data[k]))));

const S = {
  en: {
    tagline: "Real advice, from people who've done it.",
    linkFallback: "If the button doesn't work, copy this link into your browser:",
    verify: {
      subject: 'Wisecall – your code: {code}', heading: 'Verify your email',
      intro: 'Use this code to finish setting up your account:', expiry: 'The code expires in 15 minutes.', page: 'Enter it here',
      footer: "If you didn't create a Wisecall account, you can safely ignore this email."
    },
    loginAttempts: {
      subject: 'Someone is trying to sign in to your Wisecall account', heading: 'Several wrong passwords',
      intro: 'Your Wisecall password was entered wrongly {count} times in {window} minutes, so signing in to your account is paused for {minutes} minutes.',
      after: 'If it was you, wait a few minutes and try again, or choose a new password. If it was not you, nobody got in: your password was not accepted. To be safer, choose a new password you use nowhere else, and turn on two-step verification in Settings.',
      button: 'Choose a new password'
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
      reasons: { no_answer_deadline: 'they did not answer within {days} days', refunded_at_bank: 'the payment was refunded by our payment provider', mentor_suspended: "the mentor's profile was suspended", answer_rejected: 'the answer did not meet our standards', declined_not_qualified: 'the mentor declined it: it is outside what they can answer well', declined_against_rules: "the mentor declined it: the question is against Wisecall's rules", dispute: 'our team agreed with your report about the answer', other: 'our team refunded it' }
    },
    newFreeQuestion: {
      subject: 'You have a new free question on Wisecall', heading: 'New free question',
      intro: 'Someone asked you a free question:',
      after: "Answer within {days} days. If you don't, the question closes and the asker is told.",
      button: 'Answer the question'
    },
    freeClosedSeeker: {
      subject: 'Your free question was closed', heading: 'Your question was closed',
      intro: 'Your free question to {mentor} was closed because {reason}.',
      after: 'Nothing was charged. You can ask it again, or ask another mentor.'
    },
    freeClosedMentor: {
      subject: 'A free question was closed on Wisecall', heading: 'A free question was closed',
      intro: 'The free question below was closed because {reason}.'
    },
    refundMentor: {
      subject: 'A question was refunded on Wisecall', heading: 'A question was refunded',
      intro: 'The question below was refunded to the buyer because {reason}. You will not receive a payout for it.',
      reasons: { no_answer_deadline: 'it was not answered within {days} days', refunded_at_bank: 'the payment was refunded by our payment provider', mentor_suspended: 'your profile was suspended', answer_rejected: 'our team found that the answer did not meet our standards', declined_not_qualified: 'you declined it (outside what you can answer well)', declined_against_rules: "you declined it (against Wisecall's rules)", dispute: "our team upheld the asker's report about the answer", other: 'our team refunded it' }
    },
    mentorJoined: {
      subject: 'A new mentor just joined Wisecall', heading: 'A new mentor just joined',
      intro: 'You asked us to tell you when mentors in {field} join. A mentor has just been listed on Wisecall.',
      after: 'This is the only email you will get about it.', button: 'Browse experts', unsubscribe: 'Changed your mind? Remove your address:', anyField: 'the fields you follow'
    },
    mentorSuspended: {
      subject: 'Your Wisecall mentor profile was suspended', heading: 'Your profile is suspended',
      intro: 'We suspended your mentor profile. It is hidden from Browse experts, and questions that were waiting for your answer were refunded.', reasonLabel: 'Reason:',
      after: 'If you think this is a mistake, please contact us and we will look at it again.', button: 'Contact us'
    },
    deadlineSoon: {
      subject: 'Answer soon or the question will be refunded', heading: 'A paid question is waiting',
      intro: 'You have a paid question waiting:', after: "If it isn't answered by {date}, the buyer is refunded automatically.", button: 'Answer now'
    },
    deadlineSoonFree: {
      subject: 'Answer soon or the free question will close', heading: 'A free question is waiting',
      intro: 'You have a free question waiting:', after: "If it isn't answered by {date}, it closes and the asker is told.", button: 'Answer now'
    },
    applicationReceived: {
      subject: 'We got your Wisecall application', heading: 'Your application is in',
      intro: 'Thank you. Here is what happens next:',
      steps: ['A person on our team reviews it, usually within {days} working days.', 'We email you as soon as you are approved, or if anything is missing.', 'Wisecall opens to students soon: your profile goes public on launch day.'],
      stepsLive: ['A person on our team reviews it, usually within {days} working days.', 'We email you as soon as you are approved, or if anything is missing.', 'Once approved, your profile is public and students can ask you.'],
      button: 'See your application'
    },
    applyReminder: {
      subject: 'Your Wisecall application is waiting', heading: 'Your application is waiting',
      intro: 'You stopped at step {step} of 5. Everything you wrote is saved, so finishing takes only a few minutes.',
      second: 'This is the last reminder we send about it.',
      button: 'Continue at step {step}', unsubscribe: 'No more reminders like this:'
    },
    idReminder: {
      subject: 'One step left: the ID check', heading: 'One step left',
      intro: 'Your application is in. The last step is the ID check: a photo of your ID card or passport and a selfie, about 3 minutes, on your phone.',
      introDraft: 'Everything else in your application is done. The last step is the ID check: a photo of your ID card or passport and a selfie, about 3 minutes, on your phone.',
      reviewAfter: 'We can only review your application once the ID check is done.',
      why: 'We check every mentor this way so students know who they are talking to: 18 or older, and the name matches the ID. Wisecall never sees the ID photos.',
      second: 'This is the last reminder we send about it.',
      button: 'Do the ID check', unsubscribe: 'No more reminders like this:'
    },
    idOneStep: { subject: 'Wisecall – one step left', heading: 'One step left: confirm your identity' },
    rateReminder: {
      subject: 'Please rate your Wisecall question', headingAsker: 'How was the answer?', headingMentor: 'How was the question?',
      introAsker: 'How was the answer from {name}? Your rating helps other people find great mentors.',
      introMentor: 'How was the question from {name}? Your rating tells other mentors whether the question was clear and respectful.',
      after: 'Ratings are private until you have both rated, or until {date}, whichever comes first. You can change yours until then.',
      final: 'This is the last reminder.', button: 'Rate now',
      unsubscribe: "You get these reminders because you had a question on Wisecall. Don't want them? Turn them off here:"
    },
    deletionScheduled: {
      subject: 'Your Wisecall account will be deleted', heading: 'Your account will be deleted',
      intro: 'You asked us to delete your Wisecall account. It is closed now, and on {date} your details will be removed for good.',
      after: 'Changed your mind? Sign in before then and choose "Keep my account". Records of payments stay, without your details, because the law requires them.',
      button: 'Sign in'
    },
    profileHidden: {
      subject: 'Part of your Wisecall profile is hidden', heading: 'Part of your profile is hidden',
      intro: 'Our team hid {part} of your profile from other people.', reasonLabel: 'Reason:',
      after: 'You still see it yourself. Change it in Settings → Profile, or reply to us through the Help centre if you think this is a mistake.',
      whole: 'all', section: 'one part ("{section}")', button: 'Open Settings'
    },
    receipt: {
      subject: 'Your Wisecall receipt {number}', heading: 'Your receipt',
      payment: 'Thank you for your payment for a question to {mentor}.', refund: 'We returned money for your question to {mentor}.',
      paymentLive: 'Thank you for your ticket to the live session "{title}" with {mentor}.', refundLive: 'We returned the money for your ticket to "{title}".',
      lines: 'Receipt {number} · {date} · {amount}', button: 'Download the receipt (PDF)', after: 'You need to be signed in to open it.'
    },
    disputeOpened: {
      subject: 'The asker reported a problem with your answer', heading: 'A problem was reported',
      intro: 'The person who asked the question below reported a problem with your answer. Our team is looking at it and will tell you what they decide.',
      after: 'Your payout for this question is on hold until then.', button: 'Open your dashboard'
    },
    disputeResolved: {
      subject: 'We decided on the reported answer', heading: 'Our decision',
      outcomes: { full_refund: 'The asker is refunded in full.', partial_refund: 'The asker is refunded {amount}.', rejected: 'There is no refund: the answer stands.', upheld: 'Our team agreed with the report. The question was free, so there is nothing to refund.' },
      mentorShare: 'Your payout changes in proportion to the refund.', noteLabel: 'Why:', button: 'Open your dashboard'
    },
    followUpQuestion: {
      subject: '{name} asked a follow-up question', heading: 'A follow-up question',
      intro: '{name} asked one follow-up question about your answer:',
      after: 'Please reply within 3 days, in your Inbox: until you do, your payout for this question waits. You can reply once; after your reply the conversation closes.', button: 'Reply in your Inbox'
    },
    followUpReminder: {
      subject: 'Please reply to the follow-up question', heading: 'A follow-up question is waiting for you',
      intro: '{name} asked a follow-up question about your answer and is still waiting. Please reply by {when}.',
      after: 'Until you reply, your payout for this question waits. If no reply comes in time, the asker can report it to our team.', button: 'Reply in your Inbox'
    },
    followUpReply: {
      subject: '{name} replied to your follow-up question', heading: 'A reply to your follow-up', intro: '{name} replied:',
      after: 'This conversation is now closed. You can still rate the answer.', button: 'Open your Inbox'
    },
    supportReply: {
      subject: 'Wisecall support replied to you', heading: 'A reply from Wisecall support', intro: 'We replied to your message:',
      after: 'You can answer in the same conversation.', button: 'Open the conversation'
    },
    mentorApproved: {
      subject: "You're approved as a Wisecall mentor", heading: 'Welcome aboard',
      intro: 'Your mentor application was approved.',
      after: 'One last step: add your name and IBAN in Settings so you appear in Browse experts and can be paid.', button: 'Add payout details',
      afterFree: 'You answer for free, so you need no bank account: you are in Browse experts now. If you set a price later, add your payout details in Settings first.', buttonFree: 'Open your dashboard',
      prelaunch: "Wisecall has not opened to buyers yet. Your profile goes live on launch day, and we'll email you the day it does."
    },
    mentorRejected: {
      subject: 'About your Wisecall mentor application', heading: "We couldn't approve your application yet",
      intro: "Thanks for applying. We couldn't approve it this time.", reasonLabel: 'Reason:',
      after: 'You can change your application and send it again.', button: 'Open my application'
    },
    verificationUpdate: {
      subject: 'An update on your Wisecall application', heading: 'An update on your application',
      passed: 'Approved: {step}.', failed: "We couldn't approve this yet: {step}.", reasonLabel: 'What we found:',
      stillNeeded: 'Still needed for your application:', allDone: 'Every required step is approved. Our team will give the final approval soon.',
      anyOf: 'At least one of: {options}', state: { todo: 'not started', pending: 'waiting for review', failed: 'needs another try' },
      button: 'Open my application',
      delisted: 'Until this is sorted out, your profile is hidden from Browse experts and nobody can book you. Everything else on your account stays as it is.',
      reasons: {
        license_expired: 'Your license has expired. Please submit the renewed one; until it is approved your profile is hidden from Browse experts.',
        age_under_min: 'The date of birth on your ID shows you are under 18, and mentors must be 18 or older. If the ID was read wrongly, reply to this email or contact support: an admin can run the ID check again.',
        name_mismatch: 'Your profile name no longer matches the name on your ID. Change it back in Settings → Profile, or contact support if your name has changed.',
        kyc_declined: 'The ID check was not approved. Please try again with a valid, undamaged ID and good lighting.',
        kyc_expired: 'The ID check was not completed in time. Please start it again.'
      },
      steps: {
        email: 'Verified email', id_kyc: 'ID and selfie check', age: 'Age 18+', name_match: 'Name match', experience: 'Your experience', sample_answer: 'Sample answer', proof_link: 'Proof link',
        license: 'License or registration', license_document: 'License document', video_interview: 'Video interview', company_id: 'Company ID number',
        role_proof: 'Proof of your role', work_email: 'Work email', diploma: 'Diploma or certificate', portfolio: 'Portfolio'
      }
    },
    workEmailCode: {
      subject: 'Your Wisecall work email code', heading: 'Confirm your work email',
      intro: 'Use this code to confirm that you can read email at your work address ({domain}):', expiry: 'The code expires in 15 minutes.',
      footer: "If you didn't ask for this, you can safely ignore this email."
    },
    interviewRequested: {
      subject: 'A short video call about your Wisecall application', heading: 'We would like to meet you',
      intro: 'Before we decide on your mentor application, our team would like a short video call with you (about 20 minutes).', reasonLabel: 'Why:',
      after: 'Please choose a time that suits you in your application.', button: 'Choose a time'
    },
    verificationSimplified: {
      subject: 'We made mentor verification simpler', heading: 'Mentor verification is simpler now',
      intro: 'We changed how Wisecall checks mentors: an ID check, one short Experience form and an automatic review. Self-taught experts and business owners are welcome, and no employer or work email is needed.',
      after: 'We kept everything you already did. To finish your application, add a few details to the new Experience form (it takes about 2 minutes) and press "Submit for review".',
      button: 'Finish my application'
    },
    interviewBooked: {
      subject: 'Your Wisecall video interview is booked', heading: 'Your interview is booked',
      intro: 'Your video interview is booked for {date}. It takes about {minutes} minutes.',
      after: "We'll email you the meeting link before then. You can change the time in your application up to 12 hours before it starts.", button: 'Open my application'
    },
    interviewLink: {
      subject: 'The meeting link for your Wisecall interview', heading: 'Your meeting link',
      intro: 'Here is the meeting link for your video interview on {date}:', after: 'Please join a couple of minutes early and have your ID and license to hand.', button: 'Join the meeting'
    },
    interviewCancelled: {
      subject: 'Your Wisecall interview was cancelled', heading: 'We had to cancel your interview',
      intro: 'We are sorry: we had to cancel your video interview on {date}.', reasonLabel: 'Reason:',
      after: 'Please choose another time in your application.', button: 'Choose a new time'
    },
    payoutPaid: {
      subject: 'Your Wisecall payout has been sent', heading: 'Your payout is on its way',
      intro: 'We sent {amount} to your bank account ending in {last4}.', referenceLabel: 'Bank transfer reference:',
      after: 'Bank transfers usually arrive within 1 to 3 working days. You can see all your earnings in your dashboard.', button: 'Open dashboard'
    },
    mentorRequestConfirm: {
      subject: 'Confirm your request for a mentor', heading: 'Confirm your request',
      intro: 'You asked Wisecall to find you a mentor for {field}. Confirm it and we will email you once when a matching mentor joins.',
      button: 'Confirm my request', after: 'If you did not ask for this, ignore this email: nothing is kept without confirmation.'
    },
    mentorRequestMatched: {
      subject: 'A mentor for {field} is on Wisecall', heading: 'We found a mentor for you',
      intro: 'You asked for a mentor for {field}. {name} has just been listed on Wisecall.', button: 'See the profile',
      after: 'This is the only email you will get about this request.', unsubscribe: 'Remove my request:'
    },
    liveTicket: {
      subject: 'Your ticket: {title}', heading: 'You have a ticket',
      intro: 'Your place at "{title}" is confirmed: {when}.',
      after: 'The Join button on the session page turns on 10 minutes before the start. You join with your camera and microphone off. The calendar file is attached.',
      button: 'Open the session', calendar: 'Add to Google Calendar'
    },
    liveTimeChanged: {
      subject: 'New time: {title}', heading: 'The time has changed',
      intro: 'The mentor moved "{title}" to {when}.',
      after: 'If the new time does not suit you, you can cancel your ticket for a full refund until the session starts (Dashboard → Live sessions). The new calendar file is attached.',
      button: 'Open the session'
    },
    liveCancelled: {
      subject: 'Cancelled: {title}', heading: 'The session is cancelled',
      intro: '"{title}" ({when}) will not take place. Your ticket is refunded in full: it can take 5-10 business days to appear on your card.',
      reasons: { mentor: 'The mentor cancelled it.', min_not_reached: 'Not enough people booked a place.', no_show: 'The mentor did not join.',
        admin_safety: 'Our team ended it.', provider_failed: 'The video call could not take place.', short: 'The session did not run for the time promised.',
        mentor_suspended: 'The mentor can no longer host sessions.' }
    },
    liveCancelledMentor: {
      subject: 'Your session was cancelled: {title}', heading: 'Your session was cancelled',
      intro: '"{title}" ({when}) was cancelled and everybody who bought a ticket is being refunded.',
      reasons: { min_not_reached: 'Fewer tickets were sold than the minimum you set, 6 hours before the start.', no_show: 'You had not joined 15 minutes after the start.',
        admin_safety: 'Our team ended it for safety.', provider_failed: 'The video call could not take place.', short: 'You were in the session for less than half of the planned time.',
        mentor_suspended: 'Your account can no longer host sessions.' }
    },
    liveApproved: {
      subject: 'Approved: {title}', heading: 'Your session is public',
      intro: '"{title}" was approved and is on Wisecall now. Share the link where people who need your experience will see it.',
      button: 'Open the session'
    },
    liveRejected: {
      subject: 'Not approved yet: {title}', heading: 'Your session needs changes',
      intro: 'Our team did not approve "{title}" yet.', reasonLabel: 'What to change:',
      after: 'Edit it in Dashboard → Live sessions and send it again.'
    },
    liveReminder: {
      subject: 'Soon: {title}', heading: 'Your live session is coming up',
      intro24: '"{title}" starts tomorrow: {when}.', intro1: '"{title}" starts in an hour: {when}.',
      after: 'The Join button turns on 10 minutes before the start. Camera and microphone are off when you join.', button: 'Open the session'
    },
    liveSeatOffered: {
      subject: 'A seat came free: {title}', heading: 'A seat is kept for you',
      intro: 'A seat came free in "{title}" ({when}). It is kept for you until {until}.',
      after: 'If you do not buy it by then, it goes to the next person on the waiting list.', button: 'Buy my seat'
    },
    liveNewSession: {
      subject: 'New live session: {name}', heading: 'A new live session',
      intro: '{name}, whom you follow, will host "{title}": {when}.', after: 'Places are limited.', button: 'See the session',
      unsubscribe: 'You get this because you follow this mentor (at most one email a week). Stop following with one click:'
    },
    liveDiscount: {
      subject: 'Your {percent}% code for a question', heading: 'Thanks for coming',
      intro: 'Thank you for joining "{title}". Here is a one-time code for {percent}% off a personal question to {name}. It works until {until}.',
      after: 'Type it in the "Discount code" field when you ask your question.', button: 'Ask a question'
    },
    liveGift: {
      subject: 'A gift for you: a live session on Wisecall', heading: 'A gift for you',
      intro: '{name} gave you a seat in the live session "{title}": {when}.',
      after: 'Open the link, sign in or create a free account, and the seat is yours. The link works once.', button: 'Claim my seat'
    },
    liveSeriesTicket: {
      subject: 'Your series: {title}', heading: 'You are in the series',
      intro: 'You have a seat in all {count} sessions of "{title}":',
      after: 'The calendar file has every session. The Join button turns on 10 minutes before each start. You can cancel a session up to 24 hours before it starts and get its share back.',
      button: 'Open the series'
    },
    withdrawalRequested: {
      subject: 'We received your withdrawal request', heading: 'Withdrawal requested',
      intro: 'You asked us to send {amount} to your bank account ending in {last4}.',
      after: 'We will email you as soon as the transfer is made, with its bank reference.', button: 'See your balance'
    },
    withdrawalRejected: {
      subject: 'Your withdrawal was not sent', heading: 'Withdrawal not sent',
      intro: 'We did not send your withdrawal of {amount}. The money is back in your available balance.', reasonLabel: 'Reason:',
      after: 'If anything is unclear, write to us.', button: 'See your balance'
    },
    payoutChanged: {
      subject: 'Your Wisecall payout details were changed', heading: 'Your payout details were changed',
      intro: 'The bank account for your Wisecall payouts was changed from the one ending in {oldLast4} to the one ending in {newLast4}.',
      hold: 'For your safety, payouts wait until {holdUntil}.',
      notYou: 'If you did not do this, change your password now and write to us: someone may be using your account.', button: 'Open payout settings'
    },
    twoFactorOff: {
      subject: 'Two-step verification was turned off on your Wisecall account', heading: 'Two-step verification was turned off',
      intro: 'Two-step verification was turned off for your Wisecall account on {device}, {when}. Signing in now needs only your password.',
      others: 'For your safety, every other device was signed out.',
      notYou: 'If you did not do this, change your password now, turn two-step verification on again and write to us: someone may be using your account.',
      button: 'Open security settings'
    },
    passwordSet: {
      subject: 'A password was added to your Wisecall account', heading: 'A password was added to your account',
      intro: 'A password was added to your Wisecall account on {device}, {when}. You can now sign in with it as well as with Google.',
      others: 'For your safety, every other device was signed out.',
      notYou: 'If you did not do this, sign in with Google now, choose a new password with "Forgot password" and write to us: someone may be using your account.',
      button: 'Open security settings'
    },
    contact: { subject: 'New message from the Wisecall contact form', heading: 'New contact message' }
  },

  ka: {
    tagline: 'რეალური რჩევა მათგან, ვინც ეს გაიარა.',
    linkFallback: 'თუ ღილაკი არ მუშაობს, დააკოპირე ეს ბმული ბრაუზერში:',
    verify: {
      subject: 'Wisecall – შენი კოდი: {code}', heading: 'დაადასტურე ელფოსტა', page: 'კოდი აქ ჩაწერე',
      intro: 'გამოიყენე ეს კოდი ანგარიშის შექმნის დასასრულებლად:', expiry: 'კოდი მოქმედია 15 წუთის განმავლობაში.',
      footer: 'თუ Wisecall-ზე ანგარიში შენ არ შეგიქმნია, უბრალოდ უგულებელყავი ეს წერილი.'
    },
    loginAttempts: {
      subject: 'ვიღაც ცდილობს შენს Wisecall-ის ანგარიშში შესვლას', heading: 'რამდენიმე არასწორი პაროლი',
      intro: 'შენი Wisecall-ის პაროლი {window} წუთში {count}-ჯერ შეიყვანეს არასწორად, ამიტომ ანგარიშში შესვლა {minutes} წუთით შეჩერებულია.',
      after: 'თუ ეს შენ იყავი, რამდენიმე წუთში სცადე თავიდან ან აირჩიე ახალი პაროლი. თუ შენ არ ყოფილხარ, ანგარიშში ვერავინ შევიდა: პაროლი არ იქნა მიღებული. მეტი უსაფრთხოებისთვის აირჩიე ახალი პაროლი, რომელსაც სხვაგან არ იყენებ, და ჩართე ორსაფეხურიანი დადასტურება პარამეტრებში.',
      button: 'აირჩიე ახალი პაროლი'
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
      reasons: { no_answer_deadline: 'მან არ უპასუხა {days} დღის განმავლობაში', refunded_at_bank: 'გადახდა დაბრუნდა გადახდის სისტემიდან', mentor_suspended: 'მენტორის პროფილი შეჩერდა', answer_rejected: 'პასუხი ჩვენს სტანდარტებს არ შეესაბამებოდა', declined_not_qualified: 'მენტორმა კითხვა უარყო: ეს სცდება იმას, რაზეც კარგად უპასუხებს', declined_against_rules: 'მენტორმა კითხვა უარყო: კითხვა Wisecall-ის წესებს ეწინააღმდეგება', dispute: 'ჩვენმა გუნდმა გაიზიარა შენი საჩივარი პასუხზე', other: 'ჩვენმა გუნდმა დააბრუნა თანხა' }
    },
    newFreeQuestion: {
      subject: 'Wisecall-ზე ახალი უფასო კითხვა გაქვს', heading: 'ახალი უფასო კითხვა',
      intro: 'შენ უფასო კითხვა დაგისვეს:',
      after: 'უპასუხე {days} დღის განმავლობაში. თუ არ უპასუხე, კითხვა დაიხურება და მის ავტორს ვაცნობებთ.',
      button: 'კითხვაზე პასუხი'
    },
    freeClosedSeeker: {
      subject: 'შენი უფასო კითხვა დაიხურა', heading: 'კითხვა დაიხურა',
      intro: '{mentor}-სთვის დასმული შენი უფასო კითხვა დაიხურა, რადგან {reason}.',
      after: 'არაფერი ჩამოგეჭრა. შეგიძლია ხელახლა ჰკითხო ან სხვა მენტორს მიმართო.'
    },
    freeClosedMentor: {
      subject: 'Wisecall-ზე უფასო კითხვა დაიხურა', heading: 'უფასო კითხვა დაიხურა',
      intro: 'ქვემოთ მოცემული უფასო კითხვა დაიხურა, რადგან {reason}.'
    },
    refundMentor: {
      subject: 'Wisecall-ზე კითხვის თანხა დაბრუნდა', heading: 'კითხვის თანხა დაბრუნდა',
      intro: 'ქვემოთ მოცემული კითხვის თანხა დაუბრუნდა მყიდველს, რადგან {reason}. ამ კითხვაზე ანაზღაურებას ვერ მიიღებ.',
      reasons: { no_answer_deadline: 'პასუხი {days} დღის განმავლობაში არ გაიცა', refunded_at_bank: 'გადახდა დაბრუნდა გადახდის სისტემიდან', mentor_suspended: 'შენი პროფილი შეჩერდა', answer_rejected: 'ჩვენმა გუნდმა დაადგინა, რომ პასუხი ჩვენს სტანდარტებს არ შეესაბამებოდა', declined_not_qualified: 'კითხვა უარყავი (სცდება იმას, რაზეც კარგად უპასუხებ)', declined_against_rules: 'კითხვა უარყავი (Wisecall-ის წესებს ეწინააღმდეგება)', dispute: 'ჩვენმა გუნდმა გაიზიარა კითხვის ავტორის საჩივარი პასუხზე', other: 'ჩვენმა გუნდმა დააბრუნა თანხა' }
    },
    mentorJoined: {
      subject: 'Wisecall-ზე ახალი მენტორი გამოჩნდა', heading: 'ახალი მენტორი გამოჩნდა',
      intro: 'გვთხოვე, გაცნობებინა, როცა {field} სფეროში მენტორები შემოვლენ. Wisecall-ზე ახლახან გამოჩნდა მენტორი.',
      after: 'ამ თემაზე მხოლოდ ეს ერთი წერილი მოგივა.', button: 'ექსპერტების ნახვა', unsubscribe: 'გადაიფიქრე? წაშალე შენი მისამართი:', anyField: 'შენთვის საინტერესო სფეროები'
    },
    mentorSuspended: {
      subject: 'შენი Wisecall-ის მენტორის პროფილი შეჩერდა', heading: 'შენი პროფილი შეჩერებულია',
      intro: 'შენი მენტორის პროფილი შევაჩერეთ. ის ექსპერტების სიაში დამალულია, ხოლო კითხვები, რომლებიც შენს პასუხს ელოდა, დაბრუნდა.', reasonLabel: 'მიზეზი:',
      after: 'თუ გგონია, რომ ეს შეცდომაა, დაგვიკავშირდი და თავიდან განვიხილავთ.', button: 'დაგვიკავშირდი'
    },
    deadlineSoon: {
      subject: 'უპასუხე მალე, თორემ კითხვის თანხა დაბრუნდება', heading: 'ფასიანი კითხვა გელოდება',
      intro: 'გელოდება ფასიანი კითხვა:', after: 'თუ {date}-მდე არ უპასუხე, თანხა ავტომატურად დაუბრუნდება მყიდველს.', button: 'უპასუხე ახლა'
    },
    deadlineSoonFree: {
      subject: 'უპასუხე მალე, თორემ უფასო კითხვა დაიხურება', heading: 'უფასო კითხვა გელოდება',
      intro: 'გელოდება უფასო კითხვა:', after: 'თუ {date}-მდე არ უპასუხე, კითხვა დაიხურება და მის ავტორს ვაცნობებთ.', button: 'უპასუხე ახლავე'
    },
    applicationReceived: {
      subject: 'შენი განაცხადი Wisecall-ზე მიღებულია', heading: 'განაცხადი მიღებულია',
      intro: 'გმადლობ. აი, რა მოხდება შემდეგ:',
      steps: ['ჩვენი გუნდის წევრი განაცხადს განიხილავს, ჩვეულებრივ {days} სამუშაო დღეში.', 'დამტკიცებისთანავე მოგწერთ, ან თუ რამე დააკლდება.', 'Wisecall სტუდენტებისთვის მალე გაიხსნება: შენი პროფილი გახსნის დღეს გამოჩნდება.'],
      stepsLive: ['ჩვენი გუნდის წევრი განაცხადს განიხილავს, ჩვეულებრივ {days} სამუშაო დღეში.', 'დამტკიცებისთანავე მოგწერთ, ან თუ რამე დააკლდება.', 'დამტკიცების შემდეგ შენი პროფილი გამოჩნდება და სტუდენტები შეძლებენ კითხვის დასმას.'],
      button: 'განაცხადის ნახვა'
    },
    applyReminder: {
      subject: 'შენი განაცხადი Wisecall-ზე გელოდება', heading: 'განაცხადი გელოდება',
      intro: 'შეჩერდი მე-{step} ნაბიჯზე (სულ 5-ია). ყველაფერი, რაც დაწერე, შენახულია, ასე რომ დასრულებას რამდენიმე წუთი სჭირდება.',
      second: 'ამაზე ეს ბოლო შეხსენებაა.',
      button: 'გაგრძელება მე-{step} ნაბიჯიდან', unsubscribe: 'მსგავსი შეხსენებები აღარ მინდა:'
    },
    idReminder: {
      subject: 'დარჩა ერთი ნაბიჯი: პირადობის შემოწმება', heading: 'დარჩა ერთი ნაბიჯი',
      intro: 'განაცხადი მიღებულია. ბოლო ნაბიჯი პირადობის შემოწმებაა: პირადობის მოწმობის ან პასპორტის ფოტო და სელფი, დაახლოებით 3 წუთი, ტელეფონით.',
      introDraft: 'განაცხადში ყველაფერი დანარჩენი შევსებულია. ბოლო ნაბიჯი პირადობის შემოწმებაა: პირადობის მოწმობის ან პასპორტის ფოტო და სელფი, დაახლოებით 3 წუთი, ტელეფონით.',
      reviewAfter: 'განაცხადს მხოლოდ პირადობის დადასტურების შემდეგ განვიხილავთ.',
      why: 'ყველა მენტორს ასე ვამოწმებთ, რომ სტუდენტმა იცოდეს, ვის ესაუბრება: 18 წლის ან უფროსი, და სახელი ემთხვევა დოკუმენტს. დოკუმენტის ფოტოებს Wisecall ვერ ხედავს.',
      second: 'ამაზე ეს ბოლო შეხსენებაა.',
      button: 'პირადობის შემოწმება', unsubscribe: 'მსგავსი შეხსენებები აღარ მინდა:'
    },
    idOneStep: { subject: 'Wisecall – დარჩა ერთი ნაბიჯი', heading: 'დარჩა ერთი ნაბიჯი: პირადობის დადასტურება' },
    rateReminder: {
      subject: 'შეაფასე შენი Wisecall-ის კითხვა', headingAsker: 'როგორი იყო პასუხი?', headingMentor: 'როგორი იყო კითხვა?',
      introAsker: 'როგორი იყო {name}-ის პასუხი? შენი შეფასება სხვებს ეხმარება კარგი მენტორების პოვნაში.',
      introMentor: 'როგორი იყო {name}-ის კითხვა? შენი შეფასება სხვა მენტორებს ეუბნება, იყო თუ არა კითხვა გასაგები და პატივისცემით დაწერილი.',
      after: 'შეფასებები დახურულია, სანამ ორივე არ შეაფასებთ ან სანამ {date} არ დადგება — რომელიც უფრო ადრე მოხდება. მანამდე შეგიძლია შენი შეფასება შეცვალო.',
      final: 'ეს ბოლო შეხსენებაა.', button: 'შეაფასე ახლა',
      unsubscribe: 'ამ შეხსენებებს იღებ, რადგან Wisecall-ზე კითხვა გქონდა. აღარ გინდა? აქ შეგიძლია გამორთო:'
    },
    deletionScheduled: {
      subject: 'შენი Wisecall-ის ანგარიში წაიშლება', heading: 'შენი ანგარიში წაიშლება',
      intro: 'გვთხოვე შენი Wisecall-ის ანგარიშის წაშლა. ანგარიში ახლა დახურულია, ხოლო {date}-ს შენი მონაცემები სამუდამოდ წაიშლება.',
      after: 'გადაიფიქრე? მანამდე შედი სისტემაში და აირჩიე „ანგარიშის შენარჩუნება“. გადახდების ჩანაწერები რჩება შენი მონაცემების გარეშე, რადგან ამას კანონი მოითხოვს.',
      button: 'შესვლა'
    },
    profileHidden: {
      subject: 'შენი Wisecall-ის პროფილის ნაწილი დამალულია', heading: 'პროფილის ნაწილი დამალულია',
      intro: 'ჩვენმა გუნდმა შენი პროფილის {part} სხვა ადამიანებისგან დამალა.', reasonLabel: 'მიზეზი:',
      after: 'შენ ისევ ხედავ მას. შეცვალე პარამეტრებში → პროფილი, ან მოგვწერე დახმარების ცენტრიდან, თუ ფიქრობ, რომ ეს შეცდომაა.',
      whole: 'მთელი გვერდი', section: 'ერთი ნაწილი („{section}“)', button: 'პარამეტრების გახსნა'
    },
    receipt: {
      subject: 'შენი Wisecall-ის ქვითარი {number}', heading: 'შენი ქვითარი',
      payment: 'მადლობა გადახდისთვის: კითხვა {mentor}-სთვის.', refund: 'შენი კითხვისთვის ({mentor}) თანხა დაგიბრუნეთ.',
      paymentLive: 'მადლობა ბილეთისთვის: ცოცხალი სესია „{title}“ ({mentor}).', refundLive: 'ბილეთის თანხა („{title}“) დაგიბრუნეთ.',
      lines: 'ქვითარი {number} · {date} · {amount}', button: 'ქვითრის ჩამოტვირთვა (PDF)', after: 'გასახსნელად სისტემაში უნდა იყო შესული.'
    },
    disputeOpened: {
      subject: 'კითხვის ავტორმა შენს პასუხზე პრობლემა დააფიქსირა', heading: 'პრობლემა დაფიქსირდა',
      intro: 'ქვემოთ მოცემული კითხვის ავტორმა შენს პასუხზე პრობლემა დააფიქსირა. ჩვენი გუნდი ამას განიხილავს და გადაწყვეტილებას შეგატყობინებს.',
      after: 'მანამდე ამ კითხვის ანაზღაურება შეჩერებულია.', button: 'პირადი კაბინეტის გახსნა'
    },
    disputeResolved: {
      subject: 'გადაწყვეტილება საჩივარზე პასუხის შესახებ', heading: 'ჩვენი გადაწყვეტილება',
      outcomes: { full_refund: 'კითხვის ავტორს თანხა სრულად დაუბრუნდება.', partial_refund: 'კითხვის ავტორს დაუბრუნდება {amount}.', rejected: 'თანხა არ ბრუნდება: პასუხი ძალაში რჩება.', upheld: 'ჩვენმა გუნდმა საჩივარი გაიზიარა. კითხვა უფასო იყო, ამიტომ დასაბრუნებელი თანხა არ არის.' },
      mentorShare: 'შენი ანაზღაურება თანხის დაბრუნების პროპორციულად იცვლება.', noteLabel: 'მიზეზი:', button: 'პირადი კაბინეტის გახსნა'
    },
    followUpQuestion: {
      subject: '{name}-მ დამატებითი კითხვა დაგისვა', heading: 'დამატებითი კითხვა',
      intro: '{name}-მ შენს პასუხზე ერთი დამატებითი კითხვა დაგისვა:',
      after: 'გთხოვ, უპასუხე 3 დღეში, შემოსულებში: მანამდე ამ კითხვის ანაზღაურება შეჩერებულია. შეგიძლია ერთხელ უპასუხო; შენი პასუხის შემდეგ საუბარი დაიხურება.', button: 'უპასუხე შემოსულებში'
    },
    followUpReminder: {
      subject: 'გთხოვ, უპასუხე დამატებით კითხვას', heading: 'დამატებითი კითხვა შენს პასუხს ელოდება',
      intro: '{name}-მ შენს პასუხზე დამატებითი კითხვა დაგისვა და ჯერ კიდევ პასუხს ელოდება. გთხოვ, უპასუხე {when}-მდე.',
      after: 'სანამ არ უპასუხებ, ამ კითხვის ანაზღაურება შეჩერებულია. თუ დროულად არ უპასუხებ, კითხვის ავტორს ამის შესახებ ჩვენი გუნდისთვის შეტყობინება შეეძლება.', button: 'უპასუხე შემოსულებში'
    },
    followUpReply: {
      subject: '{name}-მ უპასუხა შენს დამატებით კითხვას', heading: 'პასუხი დამატებით კითხვაზე', intro: '{name}-ის პასუხი:',
      after: 'ეს საუბარი ახლა დახურულია. პასუხის შეფასება კვლავ შეგიძლია.', button: 'შემოსულების გახსნა'
    },
    supportReply: {
      subject: 'Wisecall-ის მხარდაჭერამ გიპასუხა', heading: 'პასუხი Wisecall-ის მხარდაჭერისგან', intro: 'შენს შეტყობინებას ვუპასუხეთ:',
      after: 'შეგიძლია იმავე საუბარში უპასუხო.', button: 'საუბრის გახსნა'
    },
    mentorApproved: {
      subject: 'შენ დამტკიცდი Wisecall-ის მენტორად', heading: 'კეთილი იყოს შენი მობრძანება',
      intro: 'შენი მენტორის განაცხადი დამტკიცდა.',
      after: 'ბოლო ნაბიჯი: პარამეტრებში მიუთითე შენი სახელი და IBAN, რომ გამოჩნდე ექსპერტების სიაში და ანაზღაურება მიიღო.', button: 'გადახდის მონაცემების დამატება',
      afterFree: 'უფასოდ პასუხობ, ამიტომ საბანკო ანგარიში არ გჭირდება: უკვე ჩანხარ ექსპერტების სიაში. თუ მოგვიანებით ფასს დააწესებ, ჯერ პარამეტრებში მიუთითე ანაზღაურების მონაცემები.', buttonFree: 'პირადი კაბინეტის გახსნა',
      prelaunch: 'Wisecall ჯერ მყიდველებისთვის არ გახსნილა. შენი პროფილი გამოჩნდება გახსნის დღეს და იმ დღესვე მოგწერთ ელფოსტით.'
    },
    mentorRejected: {
      subject: 'შენი მენტორის განაცხადის შესახებ', heading: 'განაცხადის დამტკიცება ჯერ ვერ შევძელით',
      intro: 'მადლობა განაცხადისთვის. ამჯერად ვერ დავამტკიცეთ.', reasonLabel: 'მიზეზი:',
      after: 'შეგიძლია შეცვალო განაცხადი და ხელახლა გაგზავნო.', button: 'ჩემი განაცხადის გახსნა'
    },
    verificationUpdate: {
      subject: 'სიახლე შენი Wisecall-ის განაცხადის შესახებ', heading: 'სიახლე შენი განაცხადის შესახებ',
      passed: 'დამტკიცდა: {step}.', failed: 'ჯერ ვერ დავამტკიცეთ: {step}.', reasonLabel: 'რა აღმოვაჩინეთ:',
      stillNeeded: 'განაცხადისთვის კიდევ საჭიროა:', allDone: 'ყველა სავალდებულო ნაბიჯი დამტკიცებულია. ჩვენი გუნდი მალე მიიღებს საბოლოო გადაწყვეტილებას.',
      anyOf: 'სულ მცირე ერთი: {options}', state: { todo: 'არ დაწყებულა', pending: 'განხილვას ელოდება', failed: 'საჭიროა ხელახლა ცდა' },
      button: 'ჩემი განაცხადის გახსნა',
      delisted: 'სანამ ეს არ მოგვარდება, შენი პროფილი ექსპერტების სიაში დამალულია და ვერავინ დაგიჯავშნის. ანგარიშზე დანარჩენი ყველაფერი უცვლელი რჩება.',
      reasons: {
        age_under_min: 'შენი დოკუმენტის დაბადების თარიღით 18 წლამდე ხარ, მენტორი კი მინიმუმ 18 წლის უნდა იყოს. თუ დოკუმენტი არასწორად წაიკითხა სისტემამ, უპასუხე ამ წერილს ან დაუკავშირდი მხარდაჭერას: ადმინისტრატორს შეუძლია შემოწმების თავიდან გაშვება.',
        name_mismatch: 'შენი პროფილის სახელი აღარ ემთხვევა დოკუმენტზე მითითებულ სახელს. დააბრუნე ის პარამეტრებში → პროფილი, ან დაუკავშირდი მხარდაჭერას, თუ სახელი შეგეცვალა.',
        license_expired: 'შენი ლიცენზიის ვადა ამოიწურა. გთხოვ, გამოგვიგზავნე განახლებული; სანამ ის არ დამტკიცდება, შენი პროფილი ექსპერტების სიაში დამალულია.',
        kyc_declined: 'პირადობის შემოწმება ვერ დამტკიცდა. სცადე თავიდან ვალიდური, დაუზიანებელი დოკუმენტით და კარგ განათებაზე.',
        kyc_expired: 'პირადობის შემოწმება დროულად ვერ დასრულდა. დაიწყე თავიდან.'
      },
      steps: {
        email: 'დადასტურებული ელფოსტა', id_kyc: 'პირადობის და სელფის შემოწმება', age: '18+ ასაკი', name_match: 'სახელის დამთხვევა', experience: 'შენი გამოცდილება', sample_answer: 'საცდელი პასუხი', proof_link: 'დამადასტურებელი ბმული',
        license: 'ლიცენზია ან რეგისტრაცია', license_document: 'ლიცენზიის დოკუმენტი', video_interview: 'ვიდეო-ინტერვიუ', company_id: 'კომპანიის საიდენტიფიკაციო ნომერი',
        role_proof: 'შენი როლის დადასტურება', work_email: 'სამსახურეობრივი ელფოსტა', diploma: 'დიპლომი ან სერტიფიკატი', portfolio: 'პორტფოლიო'
      }
    },
    workEmailCode: {
      subject: 'შენი Wisecall-ის სამსახურეობრივი ელფოსტის კოდი', heading: 'დაადასტურე სამსახურეობრივი ელფოსტა',
      intro: 'გამოიყენე ეს კოდი, რომ დაადასტურო, რომ შენს სამსახურეობრივ მისამართზე ({domain}) წერილების წაკითხვა შეგიძლია:', expiry: 'კოდი მოქმედია 15 წუთის განმავლობაში.',
      footer: 'თუ ეს შენ არ მოგითხოვია, უბრალოდ უგულებელყავი ეს წერილი.'
    },
    interviewRequested: {
      subject: 'მოკლე ვიდეოზარი შენი Wisecall-ის განაცხადის შესახებ', heading: 'გვსურს გაგიცნოთ',
      intro: 'სანამ შენს მენტორის განაცხადზე გადაწყვეტილებას მივიღებთ, ჩვენს გუნდს სურს შენთან მოკლე ვიდეოზარი (დაახლოებით 20 წუთი).', reasonLabel: 'რატომ:',
      after: 'გთხოვ, შენს განაცხადში აირჩიე შენთვის მოსახერხებელი დრო.', button: 'დროის არჩევა'
    },
    verificationSimplified: {
      subject: 'მენტორების ვერიფიკაცია გავამარტივეთ', heading: 'მენტორის ვერიფიკაცია ახლა უფრო მარტივია',
      intro: 'შევცვალეთ, როგორ ამოწმებს Wisecall მენტორებს: პირადობის შემოწმება, ერთი მოკლე ფორმა გამოცდილების შესახებ და ავტომატური განხილვა. თვითნასწავლი ექსპერტები და ბიზნესის მფლობელები სასურველნი არიან; დამსაქმებელი ან სამსახურეობრივი ელფოსტა საჭირო არ არის.',
      after: 'ყველაფერი, რაც უკვე გააკეთე, შენახულია. განაცხადის დასასრულებლად ახალ ფორმაში რამდენიმე დეტალი დაამატე (დაახლოებით 2 წუთი) და დააჭირე „განსახილველად გაგზავნას“.',
      button: 'განაცხადის დასრულება'
    },
    interviewBooked: {
      subject: 'შენი Wisecall-ის ვიდეო ინტერვიუ დაჯავშნილია', heading: 'ინტერვიუ დაჯავშნილია',
      intro: 'შენი ვიდეო ინტერვიუ დაჯავშნილია: {date}. გრძელდება დაახლოებით {minutes} წუთი.',
      after: 'შეხვედრის ბმულს ამ დრომდე გამოგიგზავნით ელფოსტაზე. დროის შეცვლა შეგიძლია შენს განაცხადში, დაწყებამდე არაუგვიანეს 12 საათით ადრე.', button: 'ჩემი განაცხადის გახსნა'
    },
    interviewLink: {
      subject: 'შენი Wisecall-ის ინტერვიუს ბმული', heading: 'შეხვედრის ბმული',
      intro: 'აი, შეხვედრის ბმული შენი ვიდეო ინტერვიუსთვის ({date}):', after: 'გთხოვ, რამდენიმე წუთით ადრე შემოხვიდე და პირადობა და ლიცენზია ხელთ გქონდეს.', button: 'შეხვედრაში შესვლა'
    },
    interviewCancelled: {
      subject: 'შენი Wisecall-ის ინტერვიუ გაუქმდა', heading: 'ინტერვიუ გავაუქმეთ',
      intro: 'ბოდიში: შენი ვიდეო ინტერვიუ ({date}) გაუქმებული გვქონდა.', reasonLabel: 'მიზეზი:',
      after: 'გთხოვ, შენს განაცხადში სხვა დრო აირჩიო.', button: 'ახალი დროის არჩევა'
    },
    payoutPaid: {
      subject: 'შენი Wisecall-ის ანაზღაურება გაიგზავნა', heading: 'შენი ანაზღაურება გზაშია',
      intro: '{amount} გავგზავნეთ შენს საბანკო ანგარიშზე, რომელიც მთავრდება {last4}-ით.', referenceLabel: 'საბანკო გადარიცხვის რეფერენსი:',
      after: 'საბანკო გადარიცხვა ჩვეულებრივ 1-3 სამუშაო დღეში აისახება. ყველა შემოსავალი შეგიძლია იხილო დაფაზე.', button: 'დაფის გახსნა'
    },
    mentorRequestConfirm: {
      subject: 'დაადასტურე მენტორის მოთხოვნა', heading: 'დაადასტურე მოთხოვნა',
      intro: 'Wisecall-ს სთხოვე, მოგიძებნოს მენტორი სფეროში: {field}. დაადასტურე და ერთხელ მოგწერთ, როცა შესაფერისი მენტორი შემოგვიერთდება.',
      button: 'მოთხოვნის დადასტურება', after: 'თუ ეს შენ არ გითხოვია, ყურადღება არ მიაქციო: დადასტურების გარეშე არაფერი ინახება.'
    },
    mentorRequestMatched: {
      subject: 'Wisecall-ზე გამოჩნდა მენტორი სფეროში: {field}', heading: 'მენტორი ვიპოვეთ',
      intro: 'მოითხოვე მენტორი სფეროში: {field}. Wisecall-ზე ახლახან გამოჩნდა: {name}.', button: 'პროფილის ნახვა',
      after: 'ამ მოთხოვნაზე ეს ერთადერთი წერილია.', unsubscribe: 'მოთხოვნის წაშლა:'
    },
    liveTicket: {
      subject: 'შენი ბილეთი: {title}', heading: 'ბილეთი გაქვს',
      intro: 'შენი ადგილი სესიაზე „{title}“ დადასტურებულია: {when}.',
      after: 'სესიის გვერდზე ღილაკი „შესვლა“ დაწყებამდე 10 წუთით ადრე ჩაირთვება. შეხვალ გამორთული კამერითა და მიკროფონით. კალენდრის ფაილი თანდართულია.',
      button: 'სესიის გახსნა', calendar: 'Google Calendar-ში დამატება'
    },
    liveTimeChanged: {
      subject: 'ახალი დრო: {title}', heading: 'დრო შეიცვალა',
      intro: 'მენტორმა სესია „{title}“ გადაიტანა: {when}.',
      after: 'თუ ახალი დრო არ გაწყობს, ბილეთის გაუქმება და სრული თანხის დაბრუნება სესიის დაწყებამდე შეგიძლია (პირადი კაბინეტი → ცოცხალი სესიები). ახალი კალენდრის ფაილი თანდართულია.',
      button: 'სესიის გახსნა'
    },
    liveCancelled: {
      subject: 'გაუქმდა: {title}', heading: 'სესია გაუქმდა',
      intro: 'სესია „{title}“ ({when}) არ ჩატარდება. ბილეთის თანხა სრულად დაგიბრუნდება: ბარათზე ასახვას შეიძლება 5-10 სამუშაო დღე დასჭირდეს.',
      reasons: { mentor: 'მენტორმა გააუქმა.', min_not_reached: 'საკმარისმა ადამიანმა ვერ დაჯავშნა ადგილი.', no_show: 'მენტორი არ შემოვიდა.',
        admin_safety: 'ჩვენმა გუნდმა შეწყვიტა.', provider_failed: 'ვიდეოზარი ვერ შედგა.', short: 'სესია დაპირებულ დროს არ გაგრძელდა.',
        mentor_suspended: 'მენტორს სესიების ჩატარება აღარ შეუძლია.' }
    },
    liveCancelledMentor: {
      subject: 'შენი სესია გაუქმდა: {title}', heading: 'შენი სესია გაუქმდა',
      intro: 'სესია „{title}“ ({when}) გაუქმდა და ყველას, ვინც ბილეთი იყიდა, თანხა უბრუნდება.',
      reasons: { min_not_reached: 'დაწყებამდე 6 საათით ადრე შენ მიერ დადგენილ მინიმუმზე ნაკლები ბილეთი იყო გაყიდული.', no_show: 'დაწყებიდან 15 წუთში არ შემოხვედი.',
        admin_safety: 'ჩვენმა გუნდმა უსაფრთხოების მიზნით შეწყვიტა.', provider_failed: 'ვიდეოზარი ვერ შედგა.', short: 'სესიაზე დაგეგმილი დროის ნახევარზე ნაკლები იყავი.',
        mentor_suspended: 'შენს ანგარიშს სესიების ჩატარება აღარ შეუძლია.' }
    },
    liveApproved: {
      subject: 'დამტკიცდა: {title}', heading: 'შენი სესია საჯაროა',
      intro: 'სესია „{title}“ დამტკიცდა და უკვე Wisecall-ზეა. გააზიარე ბმული იქ, სადაც შენი გამოცდილება სჭირდებათ.',
      button: 'სესიის გახსნა'
    },
    liveRejected: {
      subject: 'ჯერ არ დამტკიცებულა: {title}', heading: 'შენს სესიას ცვლილებები სჭირდება',
      intro: 'ჩვენმა გუნდმა სესია „{title}“ ჯერ არ დაამტკიცა.', reasonLabel: 'რა უნდა შეიცვალოს:',
      after: 'შეცვალე ის პირად კაბინეტში → ცოცხალი სესიები და ხელახლა გამოგზავნე.'
    },
    liveReminder: {
      subject: 'მალე: {title}', heading: 'შენი ცოცხალი სესია ახლოვდება',
      intro24: 'სესია „{title}“ ხვალ იწყება: {when}.', intro1: 'სესია "{title}" ერთ საათში იწყება: {when}.',
      after: 'ღილაკი „შესვლა“ დაწყებამდე 10 წუთით ადრე ჩაირთვება. შესვლისას კამერა და მიკროფონი გამორთულია.', button: 'სესიის გახსნა'
    },
    liveSeatOffered: {
      subject: 'ადგილი გათავისუფლდა: {title}', heading: 'ადგილი შენთვის შევინახეთ',
      intro: 'სესიაზე „{title}“ ({when}) ადგილი გათავისუფლდა. შენთვის შენახულია ამ დრომდე: {until}.',
      after: 'თუ მანამდე არ იყიდი, ადგილი მოლოდინის სიაში შემდეგ ადამიანს გადაეცემა.', button: 'ადგილის ყიდვა'
    },
    liveNewSession: {
      subject: 'ახალი ცოცხალი სესია: {name}', heading: 'ახალი ცოცხალი სესია',
      intro: '{name}, რომელსაც გამოწერილი გაქვს, ჩაატარებს სესიას „{title}“: {when}.', after: 'ადგილები შეზღუდულია.', button: 'სესიის ნახვა',
      unsubscribe: 'ამ წერილს იღებ, რადგან ეს მენტორი გამოწერილი გაქვს (კვირაში მაქსიმუმ ერთი წერილი). გამოწერის გაუქმება ერთი დაჭერით:'
    },
    liveDiscount: {
      subject: 'შენი {percent}%-იანი კოდი კითხვისთვის', heading: 'მადლობა, რომ შემოგვიერთდი',
      intro: 'მადლობა, რომ სესიას „{title}“ დაესწარი. აი ერთჯერადი კოდი: {percent}% ფასდაკლება პირად კითხვაზე, მენტორთან {name}. მოქმედებს ამ დრომდე: {until}.',
      after: 'კითხვის დასმისას ჩაწერე ის ველში „ფასდაკლების კოდი“.', button: 'კითხვის დასმა'
    },
    liveGift: {
      subject: 'საჩუქარი შენთვის: ცოცხალი სესია Wisecall-ზე', heading: 'საჩუქარი შენთვის',
      intro: '{name} გჩუქნის ადგილს ცოცხალ სესიაზე „{title}“: {when}.',
      after: 'გახსენი ბმული, შედი ან შექმენი უფასო ანგარიში და ადგილი შენია. ბმული მხოლოდ ერთხელ მუშაობს.', button: 'ადგილის მიღება'
    },
    liveSeriesTicket: {
      subject: 'შენი სერია: {title}', heading: 'სერიაში ხარ',
      intro: 'სერიის „{title}“ ყველა {count} სესიაზე ადგილი გაქვს:',
      after: 'კალენდრის ფაილში ყველა სესიაა. ღილაკი „შესვლა“ თითოეულის დაწყებამდე 10 წუთით ადრე ჩაირთვება. სესიის გაუქმება მის დაწყებამდე 24 საათით ადრე შეგიძლია და მისი წილი დაგიბრუნდება.',
      button: 'სერიის გახსნა'
    },
    withdrawalRequested: {
      subject: 'თანხის გატანის მოთხოვნა მივიღეთ', heading: 'თანხის გატანა მოთხოვნილია',
      intro: 'გვთხოვე, {amount} გადაგირიცხოთ შენს საბანკო ანგარიშზე, რომელიც მთავრდება {last4}-ით.',
      after: 'გადარიცხვისთანავე მოგწერთ ელფოსტით, საბანკო რეფერენსითურთ.', button: 'ბალანსის ნახვა'
    },
    withdrawalRejected: {
      subject: 'თანხის გატანა არ შესრულდა', heading: 'თანხა არ გადაირიცხა',
      intro: '{amount}-ის გატანა არ შევასრულეთ. თანხა ისევ შენს ხელმისაწვდომ ბალანსზეა.', reasonLabel: 'მიზეზი:',
      after: 'თუ რამე გაუგებარია, მოგვწერე.', button: 'ბალანსის ნახვა'
    },
    payoutChanged: {
      subject: 'შენი Wisecall-ის ანაზღაურების მონაცემები შეიცვალა', heading: 'შენი ანაზღაურების მონაცემები შეიცვალა',
      intro: 'Wisecall-ის ანაზღაურებისთვის განკუთვნილი საბანკო ანგარიში შეიცვალა: {oldLast4}-ით დამთავრებულის ნაცვლად ახლა არის {newLast4}-ით დამთავრებული.',
      hold: 'შენი უსაფრთხოებისთვის ანაზღაურება {holdUntil}-მდე შეჩერებულია.',
      notYou: 'თუ ეს შენ არ გაგიკეთებია, ახლავე შეცვალე პაროლი და მოგვწერე: შესაძლოა, შენს ანგარიშს სხვა იყენებს.', button: 'ანაზღაურების პარამეტრები'
    },
    twoFactorOff: {
      subject: 'შენს Wisecall-ის ანგარიშზე ორსაფეხურიანი შემოწმება გამოირთო', heading: 'ორსაფეხურიანი შემოწმება გამოირთო',
      intro: 'შენს Wisecall-ის ანგარიშზე ორსაფეხურიანი შემოწმება გამოირთო მოწყობილობიდან {device}, {when}. ახლა შესასვლელად მხოლოდ პაროლია საჭირო.',
      others: 'შენი უსაფრთხოებისთვის ყველა სხვა მოწყობილობიდან გამოგიყვანეთ.',
      notYou: 'თუ ეს შენ არ გაგიკეთებია, ახლავე შეცვალე პაროლი, ხელახლა ჩართე ორსაფეხურიანი შემოწმება და მოგვწერე: შესაძლოა, შენს ანგარიშს სხვა იყენებს.',
      button: 'უსაფრთხოების პარამეტრები'
    },
    passwordSet: {
      subject: 'შენს Wisecall-ის ანგარიშს პაროლი დაემატა', heading: 'შენს ანგარიშს პაროლი დაემატა',
      intro: 'შენს Wisecall-ის ანგარიშს პაროლი დაემატა მოწყობილობიდან {device}, {when}. ახლა მისით შესვლაც შეგიძლია და Google-ითაც.',
      others: 'შენი უსაფრთხოებისთვის ყველა სხვა მოწყობილობიდან გამოგიყვანეთ.',
      notYou: 'თუ ეს შენ არ გაგიკეთებია, ახლავე შედი Google-ით, „დაგავიწყდა პაროლი?“-ით აირჩიე ახალი პაროლი და მოგვწერე: შესაძლოა, შენს ანგარიშს სხვა იყენებს.',
      button: 'უსაფრთხოების პარამეტრები'
    },
    contact: { subject: 'ახალი შეტყობინება Wisecall-ის საკონტაქტო ფორმიდან', heading: 'ახალი შეტყობინება' }
  }
};

// Each template returns a list of blocks; the layout turns them into HTML and plain text.
//   { p: text }  paragraph      { code }  big code box      { quote }  quoted text
//   { button: label, url }      { small: text }             { link: url } fallback link
const BUILDERS = {
  // The code email is as plain as an email can be (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 1): the code in the subject, no
  // pictures, no tracking, a text part; mail filters (Outlook, live.com) treat short plain mail best.
  verify: (s, d) => ({
    heading: s.verify.heading,
    plain: true,
    blocks: [{ p: s.verify.intro }, { code: d.code }, { small: s.verify.expiry }, { link: `${config.PUBLIC_URL}/verify-email.html`, label: s.verify.page }, { small: s.verify.footer }]
  }),
  loginAttempts: (s, d) => ({
    heading: s.loginAttempts.heading,
    blocks: [{ p: fill(s.loginAttempts.intro, d), raw: true }, { p: s.loginAttempts.after }, { button: s.loginAttempts.button, url: d.url }]
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
  newFreeQuestion: (s, d) => ({
    heading: s.newFreeQuestion.heading,
    blocks: [{ p: s.newFreeQuestion.intro }, { quote: d.question }, { p: fill(s.newFreeQuestion.after, d), raw: true }, { button: s.newFreeQuestion.button, url: `${config.PUBLIC_URL}/dashboard.html` }]
  }),
  // A free question that ended without an answer (or was taken back): nothing to refund. The reasons are the refund emails' own.
  freeClosedSeeker: (s, d) => ({
    heading: s.freeClosedSeeker.heading,
    blocks: [{ p: fill(s.freeClosedSeeker.intro, { ...d, reason: fill(s.refundSeeker.reasons[d.reason] || s.refundSeeker.reasons.other, d, false) }), raw: true }, { small: s.freeClosedSeeker.after }]
  }),
  freeClosedMentor: (s, d) => ({
    heading: s.freeClosedMentor.heading,
    blocks: [{ p: fill(s.freeClosedMentor.intro, { reason: fill(s.refundMentor.reasons[d.reason] || s.refundMentor.reasons.other, d, false) }), raw: true }, { quote: d.question }]
  }),
  refundMentor: (s, d) => ({
    heading: s.refundMentor.heading,
    blocks: [{ p: fill(s.refundMentor.intro, { reason: fill(s.refundMentor.reasons[d.reason] || s.refundMentor.reasons.other, d, false) }), raw: true }, { quote: d.question }]
  }),
  deadlineSoonFree: (s, d) => ({
    heading: s.deadlineSoonFree.heading,
    blocks: [{ p: s.deadlineSoonFree.intro }, { quote: d.question }, { p: fill(s.deadlineSoonFree.after, d), raw: true }, { button: s.deadlineSoonFree.button, url: `${config.PUBLIC_URL}/dashboard.html` }]
  }),
  deadlineSoon: (s, d) => ({
    heading: s.deadlineSoon.heading,
    blocks: [{ p: s.deadlineSoon.intro }, { quote: d.question }, { p: fill(s.deadlineSoon.after, d), raw: true }, { button: s.deadlineSoon.button, url: `${config.PUBLIC_URL}/dashboard.html` }]
  }),
  // The mentor journey (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 2): what happens after sending, and the reminders.
  applicationReceived: (s, d) => ({
    heading: s.applicationReceived.heading,
    blocks: [{ p: s.applicationReceived.intro }, ...(d.prelaunch ? s.applicationReceived.steps : s.applicationReceived.stepsLive).map((x, i) => ({ p: `${i + 1}. ${fill(x, d, false)}` })),
      { button: s.applicationReceived.button, url: `${config.PUBLIC_URL}/apply.html` }]
  }),
  applyReminder: (s, d) => ({
    heading: s.applyReminder.heading,
    blocks: [{ p: fill(s.applyReminder.intro, d, false) }, ...(d.second ? [{ small: s.applyReminder.second }] : []),
      { button: fill(s.applyReminder.button, d, false), url: `${config.PUBLIC_URL}/apply.html?step=${Number(d.step) || 1}` },
      ...(d.unsubscribeUrl ? [{ small: s.applyReminder.unsubscribe }, { link: d.unsubscribeUrl }] : [])]
  }),
  // (only the ID check: when it is the one thing missing, nothing else is asked; the button starts it, docs/CLAUDE-CODE-ID-CHECK-VISIBLE.md 4)
  idReminder: (s, d) => ({
    heading: s.idReminder.heading,
    blocks: [{ p: d.draft ? s.idReminder.introDraft : s.idReminder.intro }, { p: s.idReminder.reviewAfter }, { small: s.idReminder.why }, ...(d.second ? [{ small: s.idReminder.second }] : []),
      { button: s.idReminder.button, url: `${config.PUBLIC_URL}/apply.html?step=5&start=id` },
      ...(d.unsubscribeUrl ? [{ small: s.idReminder.unsubscribe }, { link: d.unsubscribeUrl }] : [])]
  }),
  // Right after sending without the ID check: the same words as the reminder, once.
  idOneStep: (s) => ({
    heading: s.idOneStep.heading,
    blocks: [{ p: s.idReminder.intro }, { p: s.idReminder.reviewAfter }, { small: s.idReminder.why }, { button: s.idReminder.button, url: `${config.PUBLIC_URL}/apply.html?step=5&start=id` }]
  }),
  rateReminder: (s, d) => {
    const asker = d.role !== 'mentor';
    return {
      heading: asker ? s.rateReminder.headingAsker : s.rateReminder.headingMentor,
      blocks: [
        { p: fill(asker ? s.rateReminder.introAsker : s.rateReminder.introMentor, d), raw: true },
        { p: fill(s.rateReminder.after, d), raw: true },
        ...(d.final ? [{ small: s.rateReminder.final }] : []),
        { button: s.rateReminder.button, url: `${config.PUBLIC_URL}/dashboard.html` },
        ...(d.unsubscribeUrl ? [{ small: s.rateReminder.unsubscribe }, { link: d.unsubscribeUrl }] : [])
      ]
    };
  },
  deletionScheduled: (s, d) => ({
    heading: s.deletionScheduled.heading,
    blocks: [{ p: fill(s.deletionScheduled.intro, d), raw: true }, { p: s.deletionScheduled.after }, { button: s.deletionScheduled.button, url: `${config.PUBLIC_URL}/login.html` }]
  }),
  profileHidden: (s, d) => ({
    heading: s.profileHidden.heading,
    blocks: [{ p: fill(s.profileHidden.intro, { part: d.section ? fill(s.profileHidden.section, d, false) : s.profileHidden.whole }), raw: true },
      ...(d.reason ? [{ quote: `${s.profileHidden.reasonLabel} ${d.reason}` }] : []), { p: s.profileHidden.after },
      { button: s.profileHidden.button, url: `${config.PUBLIC_URL}/settings.html?tab=profile` }]
  }),
  receipt: (s, d) => ({
    heading: s.receipt.heading,
    blocks: [{ p: fill(d.title ? (d.kind === 'refund' ? s.receipt.refundLive : s.receipt.paymentLive) : (d.kind === 'refund' ? s.receipt.refund : s.receipt.payment), d), raw: true }, { p: fill(s.receipt.lines, d), raw: true },
      { button: s.receipt.button, url: d.url }, { small: s.receipt.after }]
  }),
  disputeOpened: (s, d) => ({
    heading: s.disputeOpened.heading,
    blocks: [{ p: s.disputeOpened.intro }, { quote: d.question }, { p: s.disputeOpened.after }, { button: s.disputeOpened.button, url: `${config.PUBLIC_URL}/dashboard.html` }]
  }),
  disputeResolved: (s, d) => ({
    heading: s.disputeResolved.heading,
    blocks: [
      { p: fill(s.disputeResolved.outcomes[d.outcome] || '', d), raw: true },
      ...(d.role === 'mentor' && ['full_refund', 'partial_refund'].includes(d.outcome) ? [{ p: s.disputeResolved.mentorShare }] : []),
      ...(d.note ? [{ quote: `${s.disputeResolved.noteLabel} ${d.note}` }] : []),
      { button: s.disputeResolved.button, url: `${config.PUBLIC_URL}/dashboard.html` }
    ]
  }),
  followUpQuestion: (s, d) => ({
    heading: s.followUpQuestion.heading,
    blocks: [{ p: fill(s.followUpQuestion.intro, d), raw: true }, { quote: d.body }, { p: s.followUpQuestion.after }, { button: s.followUpQuestion.button, url: `${config.PUBLIC_URL}/inbox.html?thread=${d.threadId}` }]
  }),
  followUpReminder: (s, d) => ({
    heading: s.followUpReminder.heading,
    blocks: [{ p: fill(s.followUpReminder.intro, d), raw: true }, { p: s.followUpReminder.after }, { button: s.followUpReminder.button, url: `${config.PUBLIC_URL}/inbox.html?thread=${d.threadId}` }]
  }),
  followUpReply: (s, d) => ({
    heading: s.followUpReply.heading,
    blocks: [{ p: fill(s.followUpReply.intro, d), raw: true }, { quote: d.body }, { p: s.followUpReply.after }, { button: s.followUpReply.button, url: `${config.PUBLIC_URL}/inbox.html?thread=${d.threadId}` }]
  }),
  supportReply: (s, d) => ({
    heading: s.supportReply.heading,
    blocks: [{ p: s.supportReply.intro }, { quote: d.body }, { p: s.supportReply.after }, { button: s.supportReply.button, url: `${config.PUBLIC_URL}/inbox.html?thread=${d.threadId}` }]
  }),
  mentorApproved: (s, d) => ({
    heading: s.mentorApproved.heading,
    blocks: [{ p: s.mentorApproved.intro }, { p: d.free ? s.mentorApproved.afterFree : s.mentorApproved.after }, ...(config.LAUNCH_MODE === 'prelaunch' ? [{ p: s.mentorApproved.prelaunch }] : []),
      d.free ? { button: s.mentorApproved.buttonFree, url: `${config.PUBLIC_URL}/dashboard.html` } : { button: s.mentorApproved.button, url: `${config.PUBLIC_URL}/settings.html` }]
  }),
  mentorRejected: (s, d) => ({
    heading: s.mentorRejected.heading,
    blocks: [{ p: s.mentorRejected.intro }, ...(d.note ? [{ quote: `${s.mentorRejected.reasonLabel} ${d.note}` }] : []), { p: s.mentorRejected.after }, { button: s.mentorRejected.button, url: `${config.PUBLIC_URL}/apply.html` }]
  }),
  mentorJoined: (s, d, lang) => {
    const names = NICHE_NAMES[lang] || NICHE_NAMES.en;
    const known = d.niche && d.niche !== 'any' && require('../niches').get(d.niche);
    const field = require('../categories').nameOf(d.niche, lang) || (known ? require('../niches').nameOf(d.niche, lang) : (names['niche.' + d.niche] || s.mentorJoined.anyField));
    return {
      heading: s.mentorJoined.heading,
      blocks: [
        { p: fill(s.mentorJoined.intro, { field }), raw: true }, { p: s.mentorJoined.after },
        { button: s.mentorJoined.button, url: `${config.PUBLIC_URL}/index.html${d.mentorField ? '?niche=' + encodeURIComponent(d.mentorField) : ''}#experts` },
        { small: s.mentorJoined.unsubscribe }, { link: d.unsubscribeUrl }
      ]
    };
  },
  mentorSuspended: (s, d) => ({
    heading: s.mentorSuspended.heading,
    blocks: [{ p: s.mentorSuspended.intro }, ...(d.note ? [{ quote: `${s.mentorSuspended.reasonLabel} ${d.note}` }] : []), { p: s.mentorSuspended.after }, { button: s.mentorSuspended.button, url: `${config.PUBLIC_URL}/contact.html` }]
  }),
  verificationUpdate: (s, d) => {
    const u = s.verificationUpdate;
    const name = (k) => u.steps[k] || k;
    const line = (m) => `• ${m.steps.length > 1 ? fill(u.anyOf, { options: m.steps.map(name).join(', ') }, false) : name(m.steps[0])} (${u.state[m.state] || m.state})`;
    const missing = d.missing || [];
    return {
      heading: u.heading,
      blocks: [
        { p: fill(d.status === 'passed' ? u.passed : u.failed, { step: name(d.step) }), raw: true },
        ...(d.status === 'failed' && (u.reasons[d.reasonKey] || d.reason) ? [{ quote: `${u.reasonLabel} ${u.reasons[d.reasonKey] || d.reason}` }] : []),
        ...(d.delisted ? [{ p: u.delisted }] : []),
        ...(missing.length ? [{ p: u.stillNeeded }, { quote: missing.map(line).join('\n') }] : [{ p: u.allDone }]),
        { button: u.button, url: `${config.PUBLIC_URL}/apply.html` }
      ]
    };
  },
  workEmailCode: (s, d) => ({
    heading: s.workEmailCode.heading,
    blocks: [{ p: fill(s.workEmailCode.intro, d), raw: true }, { code: d.code }, { small: s.workEmailCode.expiry }, { small: s.workEmailCode.footer }]
  }),
  interviewRequested: (s, d) => ({
    heading: s.interviewRequested.heading,
    blocks: [{ p: s.interviewRequested.intro }, ...(d.reason ? [{ quote: `${s.interviewRequested.reasonLabel} ${d.reason}` }] : []), { p: s.interviewRequested.after }, { button: s.interviewRequested.button, url: `${config.PUBLIC_URL}/apply.html` }]
  }),
  verificationSimplified: (s) => ({
    heading: s.verificationSimplified.heading,
    blocks: [{ p: s.verificationSimplified.intro }, { p: s.verificationSimplified.after }, { button: s.verificationSimplified.button, url: `${config.PUBLIC_URL}/apply.html` }]
  }),
  interviewBooked: (s, d) => ({
    heading: s.interviewBooked.heading,
    blocks: [{ p: fill(s.interviewBooked.intro, d), raw: true }, { p: s.interviewBooked.after }, { button: s.interviewBooked.button, url: `${config.PUBLIC_URL}/apply.html` }]
  }),
  interviewLink: (s, d) => ({
    heading: s.interviewLink.heading,
    blocks: [{ p: fill(s.interviewLink.intro, d), raw: true }, { button: s.interviewLink.button, url: d.link }, { small: s.linkFallback }, { link: d.link }, { p: s.interviewLink.after }]
  }),
  interviewCancelled: (s, d) => ({
    heading: s.interviewCancelled.heading,
    blocks: [{ p: fill(s.interviewCancelled.intro, d), raw: true }, ...(d.reason ? [{ quote: `${s.interviewCancelled.reasonLabel} ${d.reason}` }] : []), { p: s.interviewCancelled.after }, { button: s.interviewCancelled.button, url: `${config.PUBLIC_URL}/apply.html` }]
  }),
  payoutPaid: (s, d) => ({
    heading: s.payoutPaid.heading,
    blocks: [{ p: fill(s.payoutPaid.intro, d), raw: true }, { quote: `${s.payoutPaid.referenceLabel} ${d.reference}` }, { p: s.payoutPaid.after }, { button: s.payoutPaid.button, url: `${config.PUBLIC_URL}/dashboard.html` }]
  }),
  mentorRequestConfirm: (s, d) => ({
    heading: s.mentorRequestConfirm.heading,
    blocks: [{ p: fill(s.mentorRequestConfirm.intro, d), raw: true }, { button: s.mentorRequestConfirm.button, url: d.url }, { small: s.linkFallback }, { link: d.url }, { small: s.mentorRequestConfirm.after }]
  }),
  mentorRequestMatched: (s, d) => ({
    heading: s.mentorRequestMatched.heading,
    blocks: [{ p: fill(s.mentorRequestMatched.intro, d), raw: true }, { button: s.mentorRequestMatched.button, url: d.url }, { small: s.mentorRequestMatched.after },
      { small: s.mentorRequestMatched.unsubscribe }, { link: d.unsubscribeUrl }]
  }),
  liveTicket: (s, d) => ({
    heading: s.liveTicket.heading,
    blocks: [{ p: fill(s.liveTicket.intro, d), raw: true }, { p: s.liveTicket.after }, { button: s.liveTicket.button, url: d.url },
      { link: d.calendarUrl, label: s.liveTicket.calendar }]
  }),
  liveTimeChanged: (s, d) => ({
    heading: s.liveTimeChanged.heading,
    blocks: [{ p: fill(s.liveTimeChanged.intro, d), raw: true }, { p: s.liveTimeChanged.after }, { button: s.liveTimeChanged.button, url: d.url }]
  }),
  liveCancelled: (s, d) => ({
    heading: s.liveCancelled.heading,
    blocks: [{ p: fill(s.liveCancelled.intro, d), raw: true }, ...(s.liveCancelled.reasons[d.reason] ? [{ p: s.liveCancelled.reasons[d.reason] }] : [])]
  }),
  liveCancelledMentor: (s, d) => ({
    heading: s.liveCancelledMentor.heading,
    blocks: [{ p: fill(s.liveCancelledMentor.intro, d), raw: true }, ...(s.liveCancelledMentor.reasons[d.reason] ? [{ p: s.liveCancelledMentor.reasons[d.reason] }] : [])]
  }),
  liveApproved: (s, d) => ({
    heading: s.liveApproved.heading,
    blocks: [{ p: fill(s.liveApproved.intro, d), raw: true }, { button: s.liveApproved.button, url: d.url }]
  }),
  liveRejected: (s, d) => ({
    heading: s.liveRejected.heading,
    blocks: [{ p: fill(s.liveRejected.intro, d), raw: true }, ...(d.reason ? [{ quote: `${s.liveRejected.reasonLabel} ${d.reason}` }] : []), { p: s.liveRejected.after }]
  }),
  liveReminder: (s, d) => ({
    heading: s.liveReminder.heading,
    blocks: [{ p: fill(Number(d.hours) === 1 ? s.liveReminder.intro1 : s.liveReminder.intro24, d), raw: true }, { p: s.liveReminder.after }, { button: s.liveReminder.button, url: d.url }]
  }),
  liveSeatOffered: (s, d) => ({
    heading: s.liveSeatOffered.heading,
    blocks: [{ p: fill(s.liveSeatOffered.intro, d), raw: true }, { p: s.liveSeatOffered.after }, { button: s.liveSeatOffered.button, url: d.url }]
  }),
  liveNewSession: (s, d) => ({
    heading: s.liveNewSession.heading,
    blocks: [{ p: fill(s.liveNewSession.intro, d), raw: true }, { p: s.liveNewSession.after }, { button: s.liveNewSession.button, url: d.url },
      ...(d.unsubscribeUrl ? [{ small: s.liveNewSession.unsubscribe }, { link: d.unsubscribeUrl }] : [])]
  }),
  liveDiscount: (s, d) => ({
    heading: s.liveDiscount.heading,
    blocks: [{ p: fill(s.liveDiscount.intro, d), raw: true }, { code: d.code }, { p: s.liveDiscount.after }, { button: s.liveDiscount.button, url: d.url }]
  }),
  liveGift: (s, d) => ({
    heading: s.liveGift.heading,
    blocks: [{ p: fill(s.liveGift.intro, d), raw: true }, { p: s.liveGift.after }, { button: s.liveGift.button, url: d.url }]
  }),
  liveSeriesTicket: (s, d) => ({
    heading: s.liveSeriesTicket.heading,
    blocks: [{ p: fill(s.liveSeriesTicket.intro, d), raw: true }, { quote: String(d.sessions || '') }, { p: s.liveSeriesTicket.after },
      { button: s.liveSeriesTicket.button, url: d.url }]
  }),
  withdrawalRequested: (s, d) => ({
    heading: s.withdrawalRequested.heading,
    blocks: [{ p: fill(s.withdrawalRequested.intro, d), raw: true }, { p: s.withdrawalRequested.after },
      { button: s.withdrawalRequested.button, url: `${config.PUBLIC_URL}/dashboard.html?tab=earnings` }]
  }),
  withdrawalRejected: (s, d) => ({
    heading: s.withdrawalRejected.heading,
    blocks: [{ p: fill(s.withdrawalRejected.intro, d), raw: true }, ...(d.reason ? [{ quote: `${s.withdrawalRejected.reasonLabel} ${d.reason}` }] : []),
      { p: s.withdrawalRejected.after }, { button: s.withdrawalRejected.button, url: `${config.PUBLIC_URL}/dashboard.html?tab=earnings` }]
  }),
  payoutChanged: (s, d) => ({
    heading: s.payoutChanged.heading,
    blocks: [{ p: fill(s.payoutChanged.intro, d), raw: true }, ...(d.holdUntil ? [{ p: fill(s.payoutChanged.hold, d), raw: true }] : []), { p: s.payoutChanged.notYou },
      { button: s.payoutChanged.button, url: `${config.PUBLIC_URL}/settings.html?tab=payouts` }]
  }),
  twoFactorOff: (s, d) => ({
    heading: s.twoFactorOff.heading,
    blocks: [{ p: fill(s.twoFactorOff.intro, d), raw: true }, { p: s.twoFactorOff.others }, { p: s.twoFactorOff.notYou },
      { button: s.twoFactorOff.button, url: `${config.PUBLIC_URL}/settings.html?tab=account` }]
  }),
  passwordSet: (s, d) => ({
    heading: s.passwordSet.heading,
    blocks: [{ p: fill(s.passwordSet.intro, d), raw: true }, { p: s.passwordSet.others }, { p: s.passwordSet.notYou },
      { button: s.passwordSet.button, url: `${config.PUBLIC_URL}/settings.html?tab=account` }]
  }),
  contact: (s, d) => ({
    heading: s.contact.heading,
    blocks: [{ p: `${d.name} <${d.email}>` }, { quote: d.message }]
  })
};

function layout(lang, heading, blocks, { plain = false } = {}) {
  const s = S[lang];
  const rows = blocks.map((b) => {
    const text = b.raw ? b.p : (b.p !== undefined ? escapeHtml(b.p) : '');
    if (b.p !== undefined) return `<p class="wc-ink" style="margin:0 0 16px;font-size:16px;line-height:1.55;color:${COLORS.ink}">${text}</p>`;
    if (b.code) return `<div class="wc-quote" style="margin:6px 0 18px;padding:18px;text-align:center;background:${COLORS.quote};border:2px dashed ${COLORS.ink};border-radius:14px;font-size:34px;font-weight:700;letter-spacing:8px;color:${COLORS.ink};font-family:'Courier New',monospace">${escapeHtml(b.code)}</div>`;
    if (b.quote) return `<div class="wc-quote" style="margin:0 0 18px;padding:14px 16px;background:${COLORS.quote};border-radius:14px 14px 14px 4px;font-size:15px;line-height:1.55;color:${COLORS.ink};white-space:pre-wrap">${escapeHtml(b.quote)}</div>`;
    if (b.button) return `<p style="margin:8px 0 20px"><a href="${escapeHtml(b.url)}" style="display:inline-block;padding:12px 24px;background:${COLORS.accent};color:${COLORS.ink};border:2px solid ${COLORS.ink};text-decoration:none;font-weight:700;font-size:16px;border-radius:14px;font-family:${FONT}">${escapeHtml(b.button)}</a></p>`;
    if (b.link) return `<p style="margin:0 0 16px;font-size:13px;word-break:break-all"><a href="${escapeHtml(b.link)}" class="wc-link" style="color:${COLORS.link}">${escapeHtml(b.label || b.link)}</a></p>`;
    if (b.small) return `<p class="wc-soft" style="margin:0 0 12px;font-size:13px;line-height:1.5;color:${COLORS.soft}">${escapeHtml(b.small)}</p>`;
    return '';
  }).join('');

  const support = config.SUPPORT_EMAIL ? ` · <a href="mailto:${escapeHtml(config.SUPPORT_EMAIL)}" style="color:${COLORS.soft}">${escapeHtml(config.SUPPORT_EMAIL)}</a>` : '';
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><title>${escapeHtml(heading)}</title><style>${DARK_CSS}</style></head>
<body class="wc-bg" style="margin:0;padding:0;background:${COLORS.bg};font-family:${FONT}">
<table role="presentation" class="wc-bg" width="100%" cellspacing="0" cellpadding="0" style="background:${COLORS.bg};padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px">
<tr><td style="padding:0 6px 14px">${plain ? `<span class="wc-ink" style="font-size:24px;font-weight:800;color:${COLORS.ink}">Wisecall</span>` : `<a href="${escapeHtml(config.PUBLIC_URL)}" style="text-decoration:none"><img src="${escapeHtml(config.PUBLIC_URL)}/brand/wisecall-logo-email.png" width="200" height="48" alt="Wisecall" class="wc-light" style="display:block;border:0;outline:none;height:auto;max-width:100%;font-size:26px;font-weight:800;color:${COLORS.ink}"><!--[if !mso]><!--><div class="wc-dark" style="display:none;max-height:0;overflow:hidden"><img src="${escapeHtml(config.PUBLIC_URL)}/brand/wisecall-logo-email-dark.png" width="200" height="48" alt="Wisecall" style="display:block;border:0;outline:none;height:auto;max-width:100%"></div><!--<![endif]--></a>`}</td></tr>
<tr><td class="wc-card" style="background:${COLORS.card};border:2px solid ${COLORS.ink};border-radius:24px;padding:30px 28px">
<h1 class="wc-ink" style="margin:0 0 18px;font-family:${DISPLAY};font-size:26px;font-weight:800;letter-spacing:-0.01em;line-height:1.2;color:${COLORS.ink}">${escapeHtml(heading)}</h1>
${rows}
</td></tr>
<tr><td class="wc-soft" style="padding:16px 8px;text-align:center;font-size:12px;color:${COLORS.soft}">${escapeHtml(s.tagline)}${support}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [heading, '', ...blocks.map((b) => {
    if (b.p !== undefined) return b.raw ? b.p.replace(/&[a-z#0-9]+;/g, (e) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" }[e] || e)) : b.p;
    if (b.code) return b.code;
    if (b.quote) return `"${b.quote}"`;
    if (b.button) return `${b.button}: ${b.url}`;
    if (b.link) return b.label ? `${b.label}: ${b.link}` : b.link;
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
  const { heading, blocks, plain } = build(s, d, l);
  const subject = fill(s[name].subject, d, false).replace(/[<>]/g, '');
  return { subject, ...layout(l, heading, blocks, { plain: Boolean(plain) }) };
}

module.exports = { render, TEMPLATE_NAMES: Object.keys(BUILDERS) };
