// Branded HTML + plain-text emails in English and Georgian.
//   render('verify', 'ka', { code: '123456' }) -> { subject, html, text }
// All values interpolated into HTML are escaped here, so callers pass raw data.
const config = require('../config');
const { escapeHtml } = require('../email');

// Names of the niches in each language, read from the site's own dictionaries.
const NICHE_NAMES = { en: require('../../public/i18n/en.json'), ka: require('../../public/i18n/ka.json') };

const COLORS = { ink: '#25213b', soft: '#746e94', bg: '#eaf6f1', card: '#ffffff', accent: '#ff6f59', quote: '#eefaf4' };

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
      reasons: { no_answer_deadline: 'they did not answer within {days} days', refunded_at_bank: 'the payment was refunded by our payment provider', mentor_suspended: "the mentor's profile was suspended", answer_rejected: 'the answer did not meet our standards', other: 'our team refunded it' }
    },
    refundMentor: {
      subject: 'A question was refunded on Wisecall', heading: 'A question was refunded',
      intro: 'The question below was refunded to the buyer because {reason}. You will not receive a payout for it.',
      reasons: { no_answer_deadline: 'it was not answered within {days} days', refunded_at_bank: 'the payment was refunded by our payment provider', mentor_suspended: 'your profile was suspended', answer_rejected: 'our team found that the answer did not meet our standards', other: 'our team refunded it' }
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
    rateReminder: {
      subject: 'Please rate your Wisecall question', headingAsker: 'How was the answer?', headingMentor: 'How was the question?',
      introAsker: 'How was the answer from {name}? Your rating helps other people find great mentors.',
      introMentor: 'How was the question from {name}? Your rating tells other mentors whether the question was clear and respectful.',
      after: 'Ratings are private until you have both rated, or until {date}, whichever comes first. You can change yours until then.',
      final: 'This is the last reminder.', button: 'Rate now',
      unsubscribe: "You get these reminders because you had a question on Wisecall. Don't want them? Turn them off here:"
    },
    followUpQuestion: {
      subject: '{name} asked a follow-up question', heading: 'A follow-up question',
      intro: '{name} asked one follow-up question about your answer:',
      after: 'You can reply once, in your Inbox. After your reply the conversation closes.', button: 'Reply in your Inbox'
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
      prelaunch: "Wisecall has not opened to buyers yet. Your profile goes live on launch day, and we'll email you the day it does."
    },
    mentorRejected: {
      subject: 'About your Wisecall mentor application', heading: "We couldn't approve your application yet",
      intro: "Thanks for applying. We couldn't approve it this time.", reasonLabel: 'Reason:',
      after: 'You can update your details and apply again from Settings.', button: 'Open settings'
    },
    verificationUpdate: {
      subject: 'An update on your Wisecall application', heading: 'An update on your application',
      passed: 'Approved: {step}.', failed: "We couldn't approve this yet: {step}.", reasonLabel: 'What we found:',
      stillNeeded: 'Still needed for your application:', allDone: 'Every required step is approved. Our team will give the final approval soon.',
      anyOf: 'At least one of: {options}', state: { todo: 'not started', pending: 'waiting for review', failed: 'needs another try' },
      button: 'Open verification',
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
      after: 'Please choose a time that suits you in your verification settings.', button: 'Choose a time'
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
      after: "We'll email you the meeting link before then. You can change the time in your verification settings up to 12 hours before it starts.", button: 'Open verification'
    },
    interviewLink: {
      subject: 'The meeting link for your Wisecall interview', heading: 'Your meeting link',
      intro: 'Here is the meeting link for your video interview on {date}:', after: 'Please join a couple of minutes early and have your ID and license to hand.', button: 'Join the meeting'
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
      reasons: { no_answer_deadline: 'მან არ უპასუხა {days} დღის განმავლობაში', refunded_at_bank: 'გადახდა დაბრუნდა გადახდის სისტემიდან', mentor_suspended: 'მენტორის პროფილი შეჩერდა', answer_rejected: 'პასუხი ჩვენს სტანდარტებს არ შეესაბამებოდა', other: 'ჩვენმა გუნდმა დააბრუნა თანხა' }
    },
    refundMentor: {
      subject: 'Wisecall-ზე კითხვის თანხა დაბრუნდა', heading: 'კითხვის თანხა დაბრუნდა',
      intro: 'ქვემოთ მოცემული კითხვის თანხა დაუბრუნდა მყიდველს, რადგან {reason}. ამ კითხვაზე ანაზღაურებას ვერ მიიღებ.',
      reasons: { no_answer_deadline: 'პასუხი {days} დღის განმავლობაში არ გაიცა', refunded_at_bank: 'გადახდა დაბრუნდა გადახდის სისტემიდან', mentor_suspended: 'შენი პროფილი შეჩერდა', answer_rejected: 'ჩვენმა გუნდმა დაადგინა, რომ პასუხი ჩვენს სტანდარტებს არ შეესაბამებოდა', other: 'ჩვენმა გუნდმა დააბრუნა თანხა' }
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
    rateReminder: {
      subject: 'შეაფასე შენი Wisecall-ის კითხვა', headingAsker: 'როგორი იყო პასუხი?', headingMentor: 'როგორი იყო კითხვა?',
      introAsker: 'როგორი იყო {name}-ის პასუხი? შენი შეფასება სხვებს ეხმარება კარგი მენტორების პოვნაში.',
      introMentor: 'როგორი იყო {name}-ის კითხვა? შენი შეფასება სხვა მენტორებს ეუბნება, იყო თუ არა კითხვა გასაგები და პატივისცემით დაწერილი.',
      after: 'შეფასებები დახურულია, სანამ ორივე არ შეაფასებთ ან სანამ {date} არ დადგება — რომელიც უფრო ადრე მოხდება. მანამდე შეგიძლია შენი შეფასება შეცვალო.',
      final: 'ეს ბოლო შეხსენებაა.', button: 'შეაფასე ახლა',
      unsubscribe: 'ამ შეხსენებებს იღებ, რადგან Wisecall-ზე კითხვა გქონდა. აღარ გინდა? აქ შეგიძლია გამორთო:'
    },
    followUpQuestion: {
      subject: '{name}-მ დამატებითი კითხვა დაგისვა', heading: 'დამატებითი კითხვა',
      intro: '{name}-მ შენს პასუხზე ერთი დამატებითი კითხვა დაგისვა:',
      after: 'შეგიძლია ერთხელ უპასუხო შემოსულებში. შენი პასუხის შემდეგ საუბარი დაიხურება.', button: 'უპასუხე შემოსულებში'
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
      prelaunch: 'Wisecall ჯერ მყიდველებისთვის არ გახსნილა. შენი პროფილი გამოჩნდება გახსნის დღეს და იმ დღესვე მოგწერთ ელფოსტით.'
    },
    mentorRejected: {
      subject: 'შენი მენტორის განაცხადის შესახებ', heading: 'განაცხადის დამტკიცება ჯერ ვერ შევძელით',
      intro: 'მადლობა განაცხადისთვის. ამჯერად ვერ დავამტკიცეთ.', reasonLabel: 'მიზეზი:',
      after: 'შეგიძლია განაახლო მონაცემები და თავიდან გაგზავნო განაცხადი პარამეტრებიდან.', button: 'პარამეტრების გახსნა'
    },
    verificationUpdate: {
      subject: 'სიახლე შენი Wisecall-ის განაცხადის შესახებ', heading: 'სიახლე შენი განაცხადის შესახებ',
      passed: 'დამტკიცდა: {step}.', failed: 'ჯერ ვერ დავამტკიცეთ: {step}.', reasonLabel: 'რა აღმოვაჩინეთ:',
      stillNeeded: 'განაცხადისთვის კიდევ საჭიროა:', allDone: 'ყველა სავალდებულო ნაბიჯი დამტკიცებულია. ჩვენი გუნდი მალე მიიღებს საბოლოო გადაწყვეტილებას.',
      anyOf: 'სულ მცირე ერთი: {options}', state: { todo: 'არ დაწყებულა', pending: 'განხილვას ელოდება', failed: 'საჭიროა ხელახლა ცდა' },
      button: 'ვერიფიკაციის გახსნა',
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
      after: 'გთხოვ, ვერიფიკაციის პარამეტრებში აირჩიე შენთვის მოსახერხებელი დრო.', button: 'დროის არჩევა'
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
      after: 'შეხვედრის ბმულს ამ დრომდე გამოგიგზავნით ელფოსტაზე. დროის შეცვლა შეგიძლია ვერიფიკაციის პარამეტრებში, დაწყებამდე არაუგვიანეს 12 საათით ადრე.', button: 'ვერიფიკაციის გახსნა'
    },
    interviewLink: {
      subject: 'შენი Wisecall-ის ინტერვიუს ბმული', heading: 'შეხვედრის ბმული',
      intro: 'აი, შეხვედრის ბმული შენი ვიდეო ინტერვიუსთვის ({date}):', after: 'გთხოვ, რამდენიმე წუთით ადრე შემოხვიდე და პირადობა და ლიცენზია ხელთ გქონდეს.', button: 'შეხვედრაში შესვლა'
    },
    interviewCancelled: {
      subject: 'შენი Wisecall-ის ინტერვიუ გაუქმდა', heading: 'ინტერვიუ გავაუქმეთ',
      intro: 'ბოდიში: შენი ვიდეო ინტერვიუ ({date}) გაუქმებული გვქონდა.', reasonLabel: 'მიზეზი:',
      after: 'გთხოვ, ვერიფიკაციის პარამეტრებში სხვა დრო აირჩიო.', button: 'ახალი დროის არჩევა'
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
  followUpQuestion: (s, d) => ({
    heading: s.followUpQuestion.heading,
    blocks: [{ p: fill(s.followUpQuestion.intro, d), raw: true }, { quote: d.body }, { p: s.followUpQuestion.after }, { button: s.followUpQuestion.button, url: `${config.PUBLIC_URL}/inbox.html?thread=${d.threadId}` }]
  }),
  followUpReply: (s, d) => ({
    heading: s.followUpReply.heading,
    blocks: [{ p: fill(s.followUpReply.intro, d), raw: true }, { quote: d.body }, { p: s.followUpReply.after }, { button: s.followUpReply.button, url: `${config.PUBLIC_URL}/inbox.html?thread=${d.threadId}` }]
  }),
  supportReply: (s, d) => ({
    heading: s.supportReply.heading,
    blocks: [{ p: s.supportReply.intro }, { quote: d.body }, { p: s.supportReply.after }, { button: s.supportReply.button, url: `${config.PUBLIC_URL}/inbox.html?thread=${d.threadId}` }]
  }),
  mentorApproved: (s) => ({
    heading: s.mentorApproved.heading,
    blocks: [{ p: s.mentorApproved.intro }, { p: s.mentorApproved.after }, ...(config.LAUNCH_MODE === 'prelaunch' ? [{ p: s.mentorApproved.prelaunch }] : []), { button: s.mentorApproved.button, url: `${config.PUBLIC_URL}/settings.html` }]
  }),
  mentorRejected: (s, d) => ({
    heading: s.mentorRejected.heading,
    blocks: [{ p: s.mentorRejected.intro }, ...(d.note ? [{ quote: `${s.mentorRejected.reasonLabel} ${d.note}` }] : []), { p: s.mentorRejected.after }, { button: s.mentorRejected.button, url: `${config.PUBLIC_URL}/settings.html` }]
  }),
  mentorJoined: (s, d, lang) => {
    const names = NICHE_NAMES[lang] || NICHE_NAMES.en;
    const known = d.niche && d.niche !== 'any' && require('../niches').get(d.niche);
    const field = known ? require('../niches').nameOf(d.niche, lang) : (names['niche.' + d.niche] || s.mentorJoined.anyField);
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
        { button: u.button, url: `${config.PUBLIC_URL}/settings.html?tab=verification` }
      ]
    };
  },
  workEmailCode: (s, d) => ({
    heading: s.workEmailCode.heading,
    blocks: [{ p: fill(s.workEmailCode.intro, d), raw: true }, { code: d.code }, { small: s.workEmailCode.expiry }, { small: s.workEmailCode.footer }]
  }),
  interviewRequested: (s, d) => ({
    heading: s.interviewRequested.heading,
    blocks: [{ p: s.interviewRequested.intro }, ...(d.reason ? [{ quote: `${s.interviewRequested.reasonLabel} ${d.reason}` }] : []), { p: s.interviewRequested.after }, { button: s.interviewRequested.button, url: `${config.PUBLIC_URL}/settings.html?tab=verification` }]
  }),
  verificationSimplified: (s) => ({
    heading: s.verificationSimplified.heading,
    blocks: [{ p: s.verificationSimplified.intro }, { p: s.verificationSimplified.after }, { button: s.verificationSimplified.button, url: `${config.PUBLIC_URL}/settings.html?tab=verification` }]
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
<tr><td style="padding:0 6px 14px"><a href="${escapeHtml(config.PUBLIC_URL)}" style="text-decoration:none"><img src="${escapeHtml(config.PUBLIC_URL)}/brand/wisecall-logo-email.png" width="200" height="48" alt="Wisecall" style="display:block;border:0;outline:none;height:auto;max-width:100%;font-size:26px;font-weight:800;color:${COLORS.ink}"></a></td></tr>
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
  const { heading, blocks } = build(s, d, l);
  const subject = fill(s[name].subject, d, false).replace(/[<>]/g, '');
  return { subject, ...layout(l, heading, blocks) };
}

module.exports = { render, TEMPLATE_NAMES: Object.keys(BUILDERS) };
