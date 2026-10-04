# Georgian texts to double-check

Every Georgian text added or changed since commit `0c67940`, with its English text. Read the Georgian aloud: it should sound
natural, use the informal შენ, and mean the same as the English. Placeholders such as `{amount}` are filled in by the site; keep them.
Regenerate with `node scripts/ka-review.js 0c67940`.

## Site (403)

### about

| Key | English | Georgian | |
|---|---|---|---|
| `about.contact.body` | Questions, ideas or a problem? We read every message. | შეკითხვა, იდეა ან პრობლემა? ყველა შეტყობინებას ვკითხულობთ. | new |
| `about.contact.link` | Write to us | მოგვწერე | new |
| `about.contact.title` | Contact | კონტაქტი | new |
| `about.founder.title` | The founder | დამფუძნებელი | new |

### ap

| Key | English | Georgian | |
|---|---|---|---|
| `ap.age.failed` | Your ID shows you are under 18. Mentors must be 18 or older. This result is final for this ID; if it was read wrongly, contact support and an admin can run the check again. | შენი დოკუმენტის მიხედვით 18 წლამდე ხარ. მენტორი უნდა იყოს 18 წლის ან მეტის. ეს შედეგი ამ დოკუმენტისთვის საბოლოოა; თუ დოკუმენტი არასწორად წაიკითხა სისტემამ, დაუკავშირდი მხარდაჭერას და ადმინისტრატორი შემოწმებას თავიდან გაუშვებს. | changed |
| `ap.err.invalid_custom_niche` | Write your field in 3 to 60 characters, without links, email addresses, phone numbers or rude words. | ჩაწერე შენი სფერო 3-დან 60 სიმბოლომდე, ბმულების, ელფოსტის მისამართების, ტელეფონის ნომრების და უხეში სიტყვების გარეშე. | changed |
| `ap.ev.upload` | Upload a diploma or certificate (PDF or JPG, up to 10 MB) | ატვირთე დიპლომი ან სერტიფიკატი (PDF ან JPG, მაქსიმუმ 10 MB) | changed |
| `ap.f.customNiche` | Your field | შენი სფერო | changed |
| `ap.f.customNiche.hint` | In your own words, 3 to 60 characters, for example "Crypto trading", "Nail artist" or "Study in Germany". This is what people see on your profile and card. | შენი სიტყვებით, 3-დან 60 სიმბოლომდე, მაგალითად „კრიპტოვაჭრობა“, „ფრჩხილების მასტერი“ ან „სწავლა გერმანიაში“. ეს გამოჩნდება შენს პროფილსა და ბარათზე. | changed |
| `ap.f.niche` | Closest category | უახლოესი კატეგორია | changed |
| `ap.f.niche.choose` | Choose the closest category | აირჩიე უახლოესი კატეგორია | changed |
| `ap.f.niche.hint` | Used for browsing and search. Choose "Other" if none fits. | გამოიყენება დათვალიერებისა და ძიებისთვის. თუ არცერთი არ შეესაბამება, აირჩიე „სხვა“. | new |
| `ap.f.niche.other` | Other (none of these fits) | სხვა (არცერთი არ შეესაბამება) | changed |
| `ap.f.regulatedByWords` | Your field or title names a licensed profession, so it counts as "{niche}": a licence is needed and a person reviews your application. If that is a mistake, write to support. | შენი სფერო ან წოდება ლიცენზირებულ პროფესიას ასახელებს, ამიტომ ის „{niche}“ კატეგორიად ითვლება: საჭიროა ლიცენზია და შენს განაცხადს ადამიანი განიხილავს. თუ ეს შეცდომაა, მოგვწერე მხარდაჭერაში. | new |
| `ap.missing.field` | Your field, in your own words | შენი სფერო, შენი სიტყვებით | new |
| `ap.missing.niche` | The closest category | უახლოესი კატეგორია | changed |
| `ap.progressText` | {done} of {total} steps done | {done} / {total} ნაბიჯი დასრულებულია | changed |
| `ap.rev.needs_attention` | A required step above needs your attention. Until it is sorted out your profile is hidden from Browse experts and nobody can book you. | ზემოთ მოცემული სავალდებულო ნაბიჯი შენს ყურადღებას საჭიროებს. სანამ ეს არ მოგვარდება, შენი პროფილი ექსპერტების სიაში დამალულია და ვერავინ დაგიჯავშნის. | new |

### auth

| Key | English | Georgian | |
|---|---|---|---|
| `auth.adult` | I'm 18 or older | 18 წლის ან უფროსი ვარ | new |
| `auth.adultRequired` | Wisecall is for people who are 18 or older. Please confirm your age. | Wisecall 18 წლის და უფროსი ადამიანებისთვისაა. გთხოვ, დაადასტურე შენი ასაკი. | new |
| `auth.error.breached` | This password has appeared in a data breach on another site, so it's easy to guess. Please choose a different one. | ეს პაროლი სხვა საიტზე მონაცემების გაჟონვაში გამოჩნდა, ამიტომ მისი გამოცნობა მარტივია. გთხოვ, აირჩიე სხვა. | new |
| `auth.error.missingFields` | Please fill in every field. | შეავსე ყველა ველი. | changed |
| `auth.field.username.hint` | your profile link. You can change it later. | შენი პროფილის ბმული. მოგვიანებით შეცვლაც შეგიძლია. | changed |
| `auth.google.err.bad_state` | That sign-in link expired, or it was opened in a different browser. Please start again. | შესვლის ბმულს ვადა გაუვიდა ან სხვა ბრაუზერში გაიხსნა. დაიწყე თავიდან. | changed |
| `auth.google.err.link_needed` | An account with this email address already exists. To keep it safe, log in with your password first, then connect Google in Settings → Account. | ამ ელფოსტით ანგარიში უკვე არსებობს. უსაფრთხოებისთვის ჯერ პაროლით შედი, შემდეგ კი პარამეტრები → ანგარიშში დააკავშირე Google. | changed |
| `auth.google.err.no_email` | Google did not share an email address with us, so we could not sign you in. Please sign up with your email instead. | Google-მა ელფოსტის მისამართი არ გადმოგვცა, ამიტომ შესვლა ვერ მოხერხდა. დარეგისტრირდი ელფოსტით. | changed |
| `auth.google.err.unavailable` | Google sign-in is not available right now. Please use your email and password. | Google-ით შესვლა ახლა მიუწვდომელია. გამოიყენე ელფოსტა და პაროლი. | changed |
| `auth.twoStep.again` | This took too long. Please sign in again. | ძალიან დიდი დრო გავიდა. გთხოვ, თავიდან შედი. | new |
| `auth.twoStep.code` | Code | კოდი | new |
| `auth.twoStep.cta` | Continue | გაგრძელება | new |
| `auth.twoStep.empty` | Enter the code. | შეიყვანე კოდი. | new |
| `auth.twoStep.help` | Enter the 6-digit code from your authenticator app. | შეიყვანე 6-ნიშნა კოდი შენი ავთენტიფიკატორის აპიდან. | new |
| `auth.twoStep.locked` | Too many wrong codes. Please wait a few minutes and try again. | ძალიან ბევრი არასწორი კოდი. გთხოვ, რამდენიმე წუთი დაელოდე და სცადე თავიდან. | new |
| `auth.twoStep.recovery` | Recovery code | აღდგენის კოდი | new |
| `auth.twoStep.title` | Two-step verification | ორსაფეხურიანი ვერიფიკაცია | new |
| `auth.twoStep.useCode` | Use a code from the app instead | ამის ნაცვლად აპის კოდის გამოყენება | new |
| `auth.twoStep.useRecovery` | Use a recovery code instead | ამის ნაცვლად აღდგენის კოდის გამოყენება | new |
| `auth.twoStep.wrong` | That code didn't work. Check the time on your phone and try the newest code. | კოდი არ გამოდგა. შეამოწმე ტელეფონის დრო და სცადე უახლესი კოდი. | new |
| `auth.verify.tooManyAttempts` | Too many wrong codes, so this code no longer works. Ask for a new code below. | ძალიან ბევრჯერ შეიყვანე არასწორი კოდი, ამიტომ ეს კოდი აღარ მუშაობს. ქვემოთ მოითხოვე ახალი. | new |

### common

| Key | English | Georgian | |
|---|---|---|---|
| `common.retry` | Try again | თავიდან ცდა | new |

### contact

| Key | English | Georgian | |
|---|---|---|---|
| `contact.openInbox` | Open Inbox | შემოსულების გახსნა | new |
| `contact.sentInbox` | Sent. You can follow the conversation in your Inbox. | გაიგზავნა. საუბრის ნახვა შემოსულებში შეგიძლია. | new |

### dash

| Key | English | Georgian | |
|---|---|---|---|
| `dash.answer.err.deadline` | The time to answer this question has passed, so the asker gets their money back. It can no longer be answered. | ამ კითხვაზე პასუხის გაცემის დრო ამოიწურა, ამიტომ კითხვის ავტორს თანხა უბრუნდება. მასზე პასუხის გაცემა აღარ შეიძლება. | new |
| `dash.conversation` | Conversation | საუბარი | new |
| `dash.deadline.seeker` | {name} has until {date} to answer. If they don't, you are refunded automatically. | მენტორს პასუხისთვის {date}-მდე აქვს დრო. თუ არ გიპასუხებს, თანხა ავტომატურად დაგიბრუნდება. | changed |
| `dash.decline.against_rules` | It's against Wisecall's rules | კითხვა Wisecall-ის წესებს ეწინააღმდეგება | new |
| `dash.decline.confirm` | Decline this question? The asker is refunded in full, and you can't answer it afterwards. | უარყოფ ამ კითხვას? კითხვის ავტორს თანხა სრულად დაუბრუნდება და მასზე პასუხს ვეღარ გასცემ. | new |
| `dash.decline.done` | Declined. The asker is being refunded. | უარყოფილია. კითხვის ავტორს თანხა უბრუნდება. | new |
| `dash.decline.help` | The asker is refunded in full at once and sees the reason you chose. | კითხვის ავტორს თანხა მაშინვე სრულად დაუბრუნდება და შენ მიერ არჩეულ მიზეზს დაინახავს. | new |
| `dash.decline.not_qualified` | It's outside what I can answer well | ეს სცდება იმას, რაზეც კარგად ვუპასუხებ | new |
| `dash.decline.note` | A note for our team (optional; the asker only sees the reason above) | შენიშვნა ჩვენი გუნდისთვის (არასავალდებულო; კითხვის ავტორი მხოლოდ ზემოთ არჩეულ მიზეზს ხედავს) | new |
| `dash.decline.open` | Can't answer this question? | ამ კითხვაზე პასუხს ვერ გასცემ? | new |
| `dash.decline.pick` | Choose a reason. | აირჩიე მიზეზი. | new |
| `dash.decline.send` | Decline and refund | უარყოფა და თანხის დაბრუნება | new |
| `dash.decline.why` | Why are you declining it? | რატომ უარყოფ? | new |
| `dash.dispute.already` | You already reported this answer. | ამ პასუხზე უკვე შეგვატყობინე. | new |
| `dash.dispute.closed` | The time to report a problem with this answer has passed. | ამ პასუხზე პრობლემის შეტყობინების ვადა გავიდა. | new |
| `dash.dispute.details` | Tell us more (optional) | მოგვიყევი მეტი (არასავალდებულო) | new |
| `dash.dispute.help` | If the answer doesn't answer your question, is wrong or harmful, off topic or rude, tell us by {date}. Our team decides: a full refund, a partial refund, or none. The mentor's payout waits until then. | თუ პასუხი შენს კითხვას არ პასუხობს, არასწორია ან ზიანის მომტანი, თემას სცდება ან უხეშია, შეგვატყობინე {date}-მდე. ჩვენი გუნდი გადაწყვეტს: სრული დაბრუნება, ნაწილობრივი დაბრუნება ან არაფერი. მანამდე მენტორის ანაზღაურება შეჩერებულია. | new |
| `dash.dispute.open` | Report a problem with this answer | პასუხთან დაკავშირებით პრობლემის შეტყობინება | new |
| `dash.dispute.openAsker` | You reported a problem with this answer. Our team is looking at it and will let you know. | ამ პასუხზე პრობლემა შეგვატყობინე. ჩვენი გუნდი განიხილავს და შეგატყობინებს. | new |
| `dash.dispute.openMentor` | The asker reported a problem with your answer. Our team is looking at it; your payout for this question is on hold until then. | კითხვის ავტორმა შენს პასუხზე პრობლემა შეგვატყობინა. ჩვენი გუნდი განიხილავს; მანამდე ამ კითხვის ანაზღაურება შეჩერებულია. | new |
| `dash.dispute.outcome.full_refund` | Decided: the asker is refunded in full. | გადაწყვეტილება: კითხვის ავტორს თანხა სრულად უბრუნდება. | new |
| `dash.dispute.outcome.partial_refund` | Decided: the asker is refunded {amount}. | გადაწყვეტილება: კითხვის ავტორს უბრუნდება {amount}. | new |
| `dash.dispute.outcome.rejected` | Decided: no refund, the answer stands. | გადაწყვეტილება: თანხა არ ბრუნდება, პასუხი ძალაში რჩება. | new |
| `dash.dispute.r.not_an_answer` | It doesn't answer my question | ჩემს კითხვას არ პასუხობს | new |
| `dash.dispute.r.off_topic` | It's about something else | სხვა რამეზეა | new |
| `dash.dispute.r.other` | Something else | სხვა | new |
| `dash.dispute.r.rude` | It's rude or disrespectful | უხეში ან უპატივცემულოა | new |
| `dash.dispute.r.wrong_or_harmful` | It's wrong or could cause harm | არასწორია ან შეიძლება ზიანი მოიტანოს | new |
| `dash.dispute.reason` | What's the problem? | რა არის პრობლემა? | new |
| `dash.dispute.send` | Send the report | შეტყობინების გაგზავნა | new |
| `dash.dispute.sent` | Sent. Our team will look at it and let you know. | გაიგზავნა. ჩვენი გუნდი განიხილავს და შეგატყობინებს. | new |
| `dash.dispute.why` | Why: | მიზეზი: | new |
| `dash.receipt.payment` | Receipt | ქვითარი | new |
| `dash.receipt.refund` | Refund receipt | დაბრუნების ქვითარი | new |
| `dash.received.notListed.body` | Finish your verification and add your payout details, then people can find you and ask you questions. | დაასრულე ვერიფიკაცია და დაამატე ანაზღაურების მონაცემები, შემდეგ ადამიანები შეძლებენ შენს პოვნას და კითხვების დასმას. | changed |
| `dash.refund.declined_against_rules` | Refunded in full: the mentor declined it because the question is against Wisecall's rules. | თანხა სრულად დაბრუნდა: მენტორმა კითხვა უარყო, რადგან ის Wisecall-ის წესებს ეწინააღმდეგება. | new |
| `dash.refund.declined_not_qualified` | Refunded in full: the mentor declined it because it's outside what they can answer well. | თანხა სრულად დაბრუნდა: მენტორმა კითხვა უარყო, რადგან ის სცდება იმას, რაზეც კარგად უპასუხებს. | new |
| `dash.refund.dispute` | Refunded: our team agreed with the report about the answer. | თანხა დაბრუნდა: ჩვენმა გუნდმა გაიზიარა საჩივარი პასუხზე. | new |
| `dash.refund.partial` | Partly refunded: {amount}. | ნაწილობრივ დაბრუნდა: {amount}. | new |
| `dash.statements.title` | Monthly statements | თვიური ამონაწერები | new |

### expert

| Key | English | Georgian | |
|---|---|---|---|
| `expert.askTitle` | Ask {name} a question | დაუსვი კითხვა — {name} | changed |
| `expert.err.tooManyBookings` | You have started {n} questions in the last hour. Please wait a little before asking another one. | ბოლო ერთ საათში {n} კითხვა დაიწყე. გთხოვ, ცოტა დაელოდე, სანამ კიდევ ერთს დასვამ. | new |
| `expert.err.tooManyUnpaid` | You already have {n} payments you started and did not finish. Finish or cancel one at the bank (or wait about 40 minutes) before asking another question. | უკვე გაქვს {n} დაწყებული და დაუსრულებელი გადახდა. სანამ ახალ კითხვას დასვამ, ერთი მათგანი ბანკში დაასრულე ან გააუქმე (ან დაელოდე დაახლოებით 40 წუთი). | new |
| `expert.loginToAsk` | Log in to ask {name} a question. | შედი სისტემაში, რომ კითხვა დაუსვა — {name}. | changed |

### faq

| Key | English | Georgian | |
|---|---|---|---|
| `faq.11.a` | Yes, one, for free. Once you can read the answer you have 7 days to ask one follow-up question in your Inbox, and the mentor can reply once. | დიახ, ერთის, უფასოდ. როცა პასუხის წაკითხვა შეგეძლება, 7 დღე გაქვს, რომ შემოსულებში ერთი დამატებითი კითხვა დასვა, მენტორს კი ერთხელ პასუხის გაცემა შეუძლია. | new |
| `faq.11.q` | Can I ask a follow-up question? | შემიძლია დამატებითი კითხვის დასმა? | new |
| `faq.13.a` | Yes. In Settings → Account you can download everything we keep about your account, or delete the account. Deleting closes it at once; after 14 days your details are removed, and only payment records stay, without your name, because the law requires them. | დიახ. პარამეტრებში → ანგარიში შეგიძლია ჩამოტვირთო ყველაფერი, რასაც შენს ანგარიშზე ვინახავთ, ან წაშალო ანგარიში. წაშლა მას მაშინვე ხურავს; 14 დღის შემდეგ შენი მონაცემები იშლება და მხოლოდ გადახდების ჩანაწერები რჩება, შენი სახელის გარეშე, რადგან ამას კანონი მოითხოვს. | new |
| `faq.13.q` | Can I download or delete my data? | შემიძლია ჩემი მონაცემების ჩამოტვირთვა ან წაშლა? | new |
| `faq.14.a` | Use a strong password you don't use anywhere else (we refuse passwords known from data breaches) and turn on two-step verification in Settings → Account. There you can also see where you're signed in and sign out other devices. | გამოიყენე ძლიერი პაროლი, რომელსაც სხვაგან არ იყენებ (მონაცემების გაჟონვებიდან ცნობილ პაროლებს არ ვიღებთ), და ჩართე ორსაფეხურიანი ვერიფიკაცია პარამეტრებში → ანგარიში. იქვე ნახავ, სად ხარ შესული, და სხვა მოწყობილობებიდან გამოსვლაც შეგიძლია. | new |
| `faq.14.q` | How do I keep my account safe? | როგორ დავიცვა ჩემი ანგარიში? | new |
| `faq.15.a` | Wisecall is not an emergency service. If you or someone else is in danger, call 112. If a question sounds like an emergency, we don't take the payment and show you where to get help right away. | Wisecall გადაუდებელი დახმარების სამსახური არ არის. თუ შენ ან სხვა ვინმე საფრთხეში ხართ, დარეკე 112-ზე. თუ კითხვა გადაუდებელ შემთხვევას ჰგავს, თანხას არ ვიღებთ და მაშინვე გაჩვენებთ, სად მიიღო დახმარება. | new |
| `faq.15.q` | What if I'm in an emergency? | რა ვქნა, თუ გადაუდებელ მდგომარეობაში ვარ? | new |
| `faq.5.a` | Every mentor passes an ID and selfie check, shows real evidence of their experience, and is reviewed before anyone can ask them; in regulated fields such as medicine and law a person also checks their licence in the official register. Read how we verify mentors. | ყოველი მენტორი გადის პირადობისა და სელფის შემოწმებას, აჩვენებს გამოცდილების რეალურ მტკიცებულებას და განიხილება, სანამ ვინმე კითხვას დაუსვამს; რეგულირებად სფეროებში (მაგალითად, მედიცინა და სამართალი) ჩვენი გუნდის წევრი მის ლიცენზიასაც ოფიციალურ რეესტრში ამოწმებს. წაიკითხე, როგორ ვამოწმებთ მენტორებს. | changed |
| `faq.6.a` | Not because you disliked it: an honest review is the way to say that. But if the answer doesn't answer your question, is wrong or harmful, off topic or rude, report it from your dashboard within {disputeDays} days. Our team decides on a full, partial or no refund and tells you why. | მხოლოდ იმიტომ, რომ არ მოგეწონა — არა: ამის სათქმელად პატიოსანი შეფასება არსებობს. მაგრამ თუ პასუხი შენს კითხვას არ პასუხობს, არასწორია ან ზიანის მომტანი, თემას სცდება ან უხეშია, შეგვატყობინე პირადი კაბინეტიდან {disputeDays} დღეში. ჩვენი გუნდი გადაწყვეტს სრულ, ნაწილობრივ ან არანაირ დაბრუნებას და მიზეზს გეტყვის. | changed |
| `faq.all` | All questions and answers | ყველა კითხვა და პასუხი | new |
| `faq.contact` | Still have a question? Contact us | კიდევ გაქვს კითხვა? დაგვიკავშირდი | new |
| `faq.group.account` | Your account and data | შენი ანგარიში და მონაცემები | new |
| `faq.group.asking` | Asking a question | კითხვის დასმა | new |
| `faq.group.mentors` | Mentors | მენტორები | new |
| `faq.group.payments` | Payments and refunds | გადახდა და თანხის დაბრუნება | new |
| `faq.page.intro` | The short answers about asking, paying, refunds, mentors and your account. Can't find yours? Write to us. | მოკლე პასუხები კითხვის დასმაზე, გადახდაზე, თანხის დაბრუნებაზე, მენტორებსა და შენს ანგარიშზე. ვერ იპოვე შენი? მოგვწერე. | new |
| `faq.page.title` | Questions and answers | კითხვები და პასუხები | new |

### footer

| Key | English | Georgian | |
|---|---|---|---|
| `footer.weAccept` | We accept | ვიღებთ | new |

### help

| Key | English | Georgian | |
|---|---|---|---|
| `help.articles` | Articles | სტატიები | new |
| `help.intro` | Short guides for asking, paying, refunds, becoming a mentor and your account. | მოკლე სახელმძღვანელოები კითხვის დასმაზე, გადახდაზე, თანხის დაბრუნებაზე, მენტორობასა და შენს ანგარიშზე. | new |
| `help.more` | More help | მეტი დახმარება | new |
| `help.title` | Help centre | დახმარების ცენტრი | new |

### hero

| Key | English | Georgian | |
|---|---|---|---|
| `hero.sub` | Doctors, founders, teachers, engineers, and more — book a real answer from someone who's lived the path you want to walk. | ექიმები, დამფუძნებლები, მასწავლებლები, ინჟინრები და სხვები — მიიღე რეალური პასუხი მისგან, ვინც უკვე გაიარა შენთვის საინტერესო გზა. | changed |

### hvp

| Key | English | Georgian | |
|---|---|---|---|
| `hvp.ask` | Browse verified mentors | გადამოწმებული მენტორების ნახვა | new |
| `hvp.intro` | Nobody can be asked a question on Wisecall just by signing up. Every mentor goes through these checks first, and keeps being watched afterwards. Self-taught experts and business owners are welcome: what counts is what they have really done. | Wisecall-ზე მხოლოდ რეგისტრაციით ვერავინ გახდება მენტორი, რომელსაც კითხვას დაუსვამენ. ყოველი მენტორი ჯერ ამ შემოწმებებს გადის და შემდეგაც ვაკვირდებით. თვითნასწავლი ექსპერტები და მეწარმეებიც მისასალმებელნი არიან: მთავარია, რა გაუკეთებიათ სინამდვილეში. | new |
| `hvp.never.title` | What we never show | რას არასდროს ვაჩვენებთ | new |
| `hvp.regulated.body` | In these fields a mentor also shows their licence or registration, and a person on our team checks it before approving them: | ამ სფეროებში მენტორი ლიცენზიას ან რეგისტრაციასაც წარმოადგენს და ჩვენი გუნდის წევრი მას დამტკიცებამდე ამოწმებს: | new |
| `hvp.regulated.title` | Regulated fields | რეგულირებადი სფეროები | new |
| `hvp.steps` | The checks, step by step | შემოწმებები, ნაბიჯ-ნაბიჯ | new |
| `hvp.title` | How we verify mentors | როგორ ვამოწმებთ მენტორებს | new |

### inbox

| Key | English | Georgian | |
|---|---|---|---|
| `inbox.answerHeld` | Our team checks this answer before the asker can read it (a new mentor's first answers are checked). | ამ პასუხს ჩვენი გუნდი ამოწმებს, სანამ კითხვის ავტორი წაიკითხავს (ახალი მენტორის პირველ პასუხებს ვამოწმებთ). | new |
| `inbox.back` | All conversations | ყველა საუბარი | new |
| `inbox.conversations` | Conversations | საუბრები | new |
| `inbox.declineReason.against_rules` | Reason: the question is against Wisecall's rules. | მიზეზი: კითხვა Wisecall-ის წესებს ეწინააღმდეგება. | new |
| `inbox.declineReason.not_qualified` | Reason: it's outside what the mentor can answer well. | მიზეზი: ეს სცდება იმას, რაზეც მენტორი კარგად უპასუხებს. | new |
| `inbox.deleted` | (deleted) | (წაშლილია) | new |
| `inbox.empty` | No conversations yet. When you ask a question, or someone pays for one of yours, the conversation appears here. | საუბრები ჯერ არ არის. როცა კითხვას დასვამ ან ვინმე შენს კითხვაზე გადაიხდის, საუბარი აქ გამოჩნდება. | new |
| `inbox.emptyThread` | Nothing here yet. You can always write to our support team. | აქ ჯერ არაფერია. ჩვენს მხარდაჭერის გუნდს ყოველთვის შეგიძლია მისწერო. | new |
| `inbox.err.contact` | This can't be sent: it looks like it contains | ამის გაგზავნა შეუძლებელია: როგორც ჩანს, შეიცავს | new |
| `inbox.err.contact.email` | an email address | ელფოსტის მისამართს | new |
| `inbox.err.contact.external_payment` | a request to pay outside Wisecall | Wisecall-ის გარეთ გადახდის თხოვნას | new |
| `inbox.err.contact.messenger` | a messenger or social media handle | მესენჯერის ან სოციალური ქსელის ანგარიშს | new |
| `inbox.err.contact.phone` | a phone number | ტელეფონის ნომერს | new |
| `inbox.err.contactFix` | Please remove it and send again. Keeping contact and payments on Wisecall protects both of you. | გთხოვ, წაშალე ეს და თავიდან გაგზავნე. კონტაქტი და გადახდა Wisecall-ზე რომ რჩება, ეს ორივეს გიცავთ. | new |
| `inbox.err.empty` | Please write a message. | გთხოვ, დაწერე შეტყობინება. | new |
| `inbox.err.notOpen` | A follow-up can be asked once you can read the answer, for 7 days. | დამატებითი კითხვის დასმა შეგიძლია მას შემდეგ, რაც პასუხს წაიკითხავ, 7 დღის განმავლობაში. | new |
| `inbox.err.offensive` | Please keep it respectful: this contains words we don't allow. | გთხოვ, დაიცავი პატივისცემა: ტექსტი შეიცავს სიტყვებს, რომლებიც დაუშვებელია. | new |
| `inbox.err.rate` | Too many messages in a short time. Please try again later. | მოკლე დროში ძალიან ბევრი შეტყობინება. გთხოვ, მოგვიანებით სცადე. | new |
| `inbox.err.tooLong` | Please keep it under {max} characters. | გთხოვ, არ გადააჭარბო {max} სიმბოლოს. | new |
| `inbox.err.tooManyOpen` | You already have several open conversations with support. Please reply in one of them. | მხარდაჭერასთან უკვე რამდენიმე ღია საუბარი გაქვს. გთხოვ, ერთ-ერთში უპასუხე. | new |
| `inbox.err.tooShort` | Please write at least {min} characters. | გთხოვ, დაწერე მინიმუმ {min} სიმბოლო. | new |
| `inbox.err.used` | You've already used the free follow-up question for this answer. | ამ პასუხზე უფასო დამატებითი კითხვა უკვე გამოიყენე. | new |
| `inbox.ev.answered` | The answer arrived. | პასუხი მოვიდა. | new |
| `inbox.ev.approved` | Your mentor application was approved. Welcome to Wisecall! | შენი მენტორის განაცხადი დამტკიცდა. კეთილი იყოს შენი მობრძანება Wisecall-ში! | new |
| `inbox.ev.declined` | The mentor declined this question, and the payment is refunded in full. | მენტორმა ეს კითხვა უარყო და თანხა სრულად ბრუნდება. | new |
| `inbox.ev.delisted` | Until this is sorted out, your profile is hidden from Browse experts. | სანამ ეს არ მოგვარდება, შენი პროფილი ექსპერტების სიაში დამალულია. | new |
| `inbox.ev.dispute.full_refund` | Our team decided: the asker is refunded in full. | ჩვენი გუნდის გადაწყვეტილება: კითხვის ავტორს თანხა სრულად უბრუნდება. | new |
| `inbox.ev.dispute.partial_refund` | Our team decided: the asker is refunded {amount}. | ჩვენი გუნდის გადაწყვეტილება: კითხვის ავტორს უბრუნდება {amount}. | new |
| `inbox.ev.dispute.rejected` | Our team decided: no refund, the answer stands. | ჩვენი გუნდის გადაწყვეტილება: თანხა არ ბრუნდება, პასუხი ძალაში რჩება. | new |
| `inbox.ev.dispute_opened` | A problem with the answer was reported. Our team is looking at it; the mentor's payout for it is on hold. | პასუხთან დაკავშირებით პრობლემა დაფიქსირდა. ჩვენი გუნდი განიხილავს; მანამდე მენტორის ანაზღაურება შეჩერებულია. | new |
| `inbox.ev.follow_up_closed` | The follow-up has its reply, so this conversation is closed. | დამატებით კითხვას პასუხი გაეცა, ამიტომ საუბარი დაიხურა. | new |
| `inbox.ev.interview_requested` | We'd like a short video interview before we decide. | გადაწყვეტილებამდე მოკლე ვიდეო-ინტერვიუ გვინდა. | new |
| `inbox.ev.paid` | The question was paid. | კითხვის საფასური გადახდილია. | new |
| `inbox.ev.payout_sent` | We sent you {amount}. Bank reference: {reference}. | გადმოგირიცხეთ {amount}. საბანკო მითითება: {reference}. | new |
| `inbox.ev.refunded` | {amount} was refunded to the asker. | კითხვის ავტორს {amount} დაუბრუნდა. | new |
| `inbox.ev.rejected` | We couldn't approve your mentor application yet. | შენი მენტორის განაცხადის დამტკიცება ჯერ ვერ შევძელით. | new |
| `inbox.ev.stepFailed` | Needs attention: {step}. | ყურადღებას საჭიროებს: {step}. | new |
| `inbox.ev.stepPassed` | Approved: {step}. | დამტკიცდა: {step}. | new |
| `inbox.ev.suspended` | Your mentor profile is suspended. | შენი მენტორის პროფილი შეჩერებულია. | new |
| `inbox.fu.askLabel` | One free follow-up question | ერთი უფასო დამატებითი კითხვა | new |
| `inbox.fu.askNote` | You can ask one follow-up question about this answer, free, until {date}. The mentor can reply once. | ამ პასუხზე ერთი დამატებითი კითხვის დასმა უფასოდ შეგიძლია {date}-მდე. მენტორს ერთხელ პასუხის გაცემა შეუძლია. | new |
| `inbox.fu.closed` | This conversation is closed: every question comes with one free follow-up and one reply. You can ask a new question any time. | ეს საუბარი დახურულია: ყოველ კითხვას ერთი უფასო დამატებითი კითხვა და ერთი პასუხი ახლავს. ახალი კითხვის დასმა ნებისმიერ დროს შეგიძლია. | new |
| `inbox.fu.expired` | The time for a free follow-up question has passed. | უფასო დამატებითი კითხვის დასმის ვადა გავიდა. | new |
| `inbox.fu.mentorWait` | The asker may send one follow-up question; you'll be able to reply here. | კითხვის ავტორს შეუძლია ერთი დამატებითი კითხვის გამოგზავნა; მას აქ უპასუხებ. | new |
| `inbox.fu.questionLabel` | Follow-up question | დამატებითი კითხვა | new |
| `inbox.fu.replyLabel` | Reply to the follow-up | პასუხი დამატებით კითხვაზე | new |
| `inbox.fu.replyLabelField` | Your reply to the follow-up | შენი პასუხი დამატებით კითხვაზე | new |
| `inbox.fu.replyNote` | You can reply once. After your reply the conversation closes. | პასუხის გაცემა ერთხელ შეგიძლია. შენი პასუხის შემდეგ საუბარი დაიხურება. | new |
| `inbox.fu.send` | Send follow-up | დამატებითი კითხვის გაგზავნა | new |
| `inbox.fu.sendReply` | Send reply | პასუხის გაგზავნა | new |
| `inbox.fu.sent` | Sent. | გაიგზავნა. | new |
| `inbox.fu.waitingReply` | Your follow-up was sent. The mentor can reply once. | შენი დამატებითი კითხვა გაიგზავნა. მენტორს ერთხელ პასუხის გაცემა შეუძლია. | new |
| `inbox.kind.asked` | Your question | შენი კითხვა | new |
| `inbox.kind.received` | A question for you | კითხვა შენთვის | new |
| `inbox.kind.support` | Support | მხარდაჭერა | new |
| `inbox.kind.system` | From Wisecall | Wisecall-ისგან | new |
| `inbox.linkWarning` | Links are shown as plain text. Only open links you trust. | ბმულები ჩვეულებრივი ტექსტით ჩანს. გახსენი მხოლოდ ის ბმული, რომელსაც ენდობი. | new |
| `inbox.n.answered` | Your question was answered. | შენს კითხვას უპასუხეს. | new |
| `inbox.n.approved` | Your mentor application was approved. | შენი მენტორის განაცხადი დამტკიცდა. | new |
| `inbox.n.declined` | A mentor declined your question; you're refunded in full. | მენტორმა შენი კითხვა უარყო; თანხა სრულად დაგიბრუნდება. | new |
| `inbox.n.dispute_opened` | The asker reported a problem with your answer. | კითხვის ავტორმა შენს პასუხზე პრობლემა შეგვატყობინა. | new |
| `inbox.n.dispute_resolved` | We decided on a reported answer. | საჩივარზე გადაწყვეტილება მივიღეთ. | new |
| `inbox.n.empty` | No notifications yet. | შეტყობინებები ჯერ არ არის. | new |
| `inbox.n.follow_up_question` | You have a follow-up question. | დამატებითი კითხვა გაქვს. | new |
| `inbox.n.follow_up_reply` | Your follow-up question was answered. | შენს დამატებით კითხვას უპასუხეს. | new |
| `inbox.n.interview_requested` | We asked for a short video interview. | მოკლე ვიდეო-ინტერვიუ გთხოვეთ. | new |
| `inbox.n.markAll` | Mark all as read | ყველას წაკითხულად მონიშვნა | new |
| `inbox.n.new_question` | You have a new paid question. | ახალი გადახდილი კითხვა გაქვს. | new |
| `inbox.n.payout_sent` | We sent you {amount}. | გადმოგირიცხეთ {amount}. | new |
| `inbox.n.rating_revealed` | A rating for you is now visible. | შენი შეფასება ახლა ხილულია. | new |
| `inbox.n.refunded` | A payment of {amount} was refunded. | {amount} დაბრუნდა. | new |
| `inbox.n.rejected` | An update on your mentor application. | სიახლე შენი მენტორის განაცხადის შესახებ. | new |
| `inbox.n.support_reply` | Wisecall support replied. | Wisecall-ის მხარდაჭერამ გიპასუხა. | new |
| `inbox.n.suspended` | Your mentor profile is suspended. | შენი მენტორის პროფილი შეჩერებულია. | new |
| `inbox.notFound` | This conversation doesn't exist, or it isn't yours. | ეს საუბარი არ არსებობს ან შენ არ გეკუთვნის. | new |
| `inbox.pick` | Choose a conversation. | აირჩიე საუბარი. | new |
| `inbox.reason.age_under_min` | The date of birth on your ID shows you are under 18. If it was read wrongly, write to support. | შენი დოკუმენტის დაბადების თარიღით 18 წლამდე ხარ. თუ დოკუმენტი არასწორად წაიკითხა სისტემამ, მიწერე მხარდაჭერას. | new |
| `inbox.reason.kyc_declined` | The ID check was not approved. Please try again with a valid, undamaged ID and good lighting. | პირადობის შემოწმება ვერ დამტკიცდა. სცადე თავიდან ვალიდური, დაუზიანებელი დოკუმენტით და კარგ განათებაზე. | new |
| `inbox.reason.kyc_expired` | The ID check was not finished in time. Please start it again. | პირადობის შემოწმება დროულად ვერ დასრულდა. დაიწყე თავიდან. | new |
| `inbox.reason.license_expired` | Your licence has expired. Please submit the renewed one. | შენი ლიცენზიის ვადა ამოიწურა. გთხოვ, გამოგვიგზავნე განახლებული. | new |
| `inbox.reason.name_mismatch` | Your profile name no longer matches the name on your ID. | შენი პროფილის სახელი აღარ ემთხვევა დოკუმენტზე მითითებულ სახელს. | new |
| `inbox.report.already` | You already reported this message. | ამ შეტყობინებაზე საჩივარი უკვე გამოგზავნე. | new |
| `inbox.report.done` | Thanks. Our team will look at it. | მადლობა. ჩვენი გუნდი განიხილავს. | new |
| `inbox.report.open` | Report | საჩივარი | new |
| `inbox.report.reason.abuse` | Abusive or rude | შეურაცხმყოფელი ან უხეში | new |
| `inbox.report.reason.contact_details` | Shares contact details | საკონტაქტო მონაცემებს აზიარებს | new |
| `inbox.report.reason.other` | Something else | სხვა | new |
| `inbox.report.reason.scam` | A scam, or asks for money | თაღლითობა ან ფულს ითხოვს | new |
| `inbox.report.reason.spam` | Spam | სპამი | new |
| `inbox.report.send` | Send report | საჩივრის გაგზავნა | new |
| `inbox.report.why` | What's wrong? | რა პრობლემაა? | new |
| `inbox.rules` | To keep everyone safe, phone numbers, email addresses, messenger or social handles and payments outside Wisecall aren't allowed here. | ყველას უსაფრთხოებისთვის აქ დაუშვებელია ტელეფონის ნომრები, ელფოსტის მისამართები, მესენჯერის ან სოციალური ქსელის ანგარიშები და Wisecall-ის გარეთ გადახდა. | new |
| `inbox.someone` | Someone | მომხმარებელი | new |
| `inbox.sub` | Your conversations about questions, messages from Wisecall and our support team. | საუბრები შენს კითხვებზე, შეტყობინებები Wisecall-ისგან და ჩვენი მხარდაჭერის გუნდისგან. | new |
| `inbox.support.message` | Your message | შენი შეტყობინება | new |
| `inbox.support.name` | Wisecall support | Wisecall-ის მხარდაჭერა | new |
| `inbox.support.new` | Write to support | მიწერე მხარდაჭერას | new |
| `inbox.support.note` | Our team reads every message. Please don't send passwords or card numbers. | ჩვენი გუნდი ყველა შეტყობინებას კითხულობს. გთხოვ, არ გამოგზავნო პაროლი ან ბარათის ნომერი. | new |
| `inbox.support.replyLabel` | Your reply | შენი პასუხი | new |
| `inbox.support.send` | Send | გაგზავნა | new |
| `inbox.support.sent` | Sent. We'll reply here and by email. | გაიგზავნა. გიპასუხებთ აქ და ელფოსტით. | new |
| `inbox.support.sub` | Our team usually replies within a day. | ჩვენი გუნდი ჩვეულებრივ ერთ დღეში გპასუხობს. | new |
| `inbox.support.subject` | Subject (optional) | თემა (არასავალდებულო) | new |
| `inbox.support.title` | Support | მხარდაჭერა | new |
| `inbox.system.readOnly` | You can't reply here. To write to us, use "Write to support". | აქ პასუხის გაცემა შეუძლებელია. მოგვწერე ღილაკით „მიწერე მხარდაჭერას“. | new |
| `inbox.system.sub` | Updates about your account | სიახლეები შენი ანგარიშის შესახებ | new |
| `inbox.system.title` | Wisecall | Wisecall | new |
| `inbox.tab.messages` | Messages | საუბრები | new |
| `inbox.tab.notifications` | Notifications | შეტყობინებები | new |
| `inbox.theAnswer` | The answer | პასუხი | new |
| `inbox.theQuestion` | The question | კითხვა | new |
| `inbox.title` | Inbox | შემოსულები | new |
| `inbox.unread` | Unread | წაუკითხავი | new |
| `inbox.waitingAnswer` | Waiting for the answer (until {date}). | პასუხის მოლოდინში ({date}-მდე). | new |
| `inbox.you` | You | შენ | new |
| `inbox.yourQuestion` | Your question | შენი კითხვა | new |

### legal

| Key | English | Georgian | |
|---|---|---|---|
| `legal.about.sections` | [object Object],[object Object],[object Object],[object Object],[object Object] | [object Object],[object Object],[object Object],[object Object],[object Object] | changed |
| `legal.privacy.sections` | [object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object] | [object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object] | changed |
| `legal.terms.sections` | [object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object] | [object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object],[object Object] | changed |

### meta

| Key | English | Georgian | |
|---|---|---|---|
| `meta.about.description` | How Wisecall checks mentors, how payment and refunds work, and who we are. | როგორ ვამოწმებთ მენტორებს, როგორ მუშაობს გადახდა და თანხის დაბრუნება, და ვინ ვართ. | new |
| `meta.about.title` | About Wisecall — how it works | Wisecall-ის შესახებ — როგორ მუშაობს | new |
| `meta.choose-username.description` | Pick the address of your Wisecall profile. | აირჩიე შენი Wisecall-ის პროფილის მისამართი. | new |
| `meta.choose-username.title` | Choose your username — Wisecall | აირჩიე მომხმარებლის სახელი — Wisecall | new |
| `meta.contact.description` | Questions, feedback or a refund request? Write to the Wisecall team and we will reply by email. | შეკითხვა, შენიშვნა ან თანხის დაბრუნების მოთხოვნა? მოგვწერე და ელფოსტით გიპასუხებთ. | new |
| `meta.contact.title` | Contact Wisecall | დაგვიკავშირდი — Wisecall | new |
| `meta.dashboard.description` | Your questions, answers and earnings on Wisecall. | შენი კითხვები, პასუხები და შემოსავალი Wisecall-ზე. | new |
| `meta.dashboard.title` | Dashboard — Wisecall | პირადი კაბინეტი — Wisecall | new |
| `meta.faq.description` | How asking works, what it costs, refunds, how mentors are checked and paid, and your data: the short answers. | როგორ დასვა კითხვა, რა ღირს, თანხის დაბრუნება, როგორ ვამოწმებთ და ვუხდით მენტორებს და შენი მონაცემები: მოკლე პასუხები. | new |
| `meta.faq.title` | Questions and answers — Wisecall | კითხვები და პასუხები — Wisecall | new |
| `meta.forgot-password.description` | Reset your Wisecall password. | აღადგინე შენი Wisecall-ის პაროლი. | new |
| `meta.forgot-password.title` | Reset password — Wisecall | პაროლის აღდგენა — Wisecall | new |
| `meta.help.description` | Short guides for asking, paying, refunds, becoming a mentor and your account on Wisecall. | მოკლე სახელმძღვანელოები კითხვის დასმაზე, გადახდაზე, თანხის დაბრუნებაზე, მენტორობასა და შენს ანგარიშზე Wisecall-ზე. | new |
| `meta.help.title` | Help centre — Wisecall | დახმარების ცენტრი — Wisecall | new |
| `meta.how-we-verify.description` | Every mentor passes an ID and selfie check, shows their experience, and is reviewed before anyone can ask them. Here is exactly how. | ყოველი მენტორი გადის პირადობისა და სელფის შემოწმებას, აჩვენებს გამოცდილებას და განიხილება, სანამ ვინმე კითხვას დაუსვამს. | new |
| `meta.how-we-verify.title` | How we verify mentors — Wisecall | როგორ ვამოწმებთ მენტორებს — Wisecall | new |
| `meta.inbox.description` | Your conversations and notifications on Wisecall. | შენი საუბრები და შეტყობინებები Wisecall-ზე. | new |
| `meta.inbox.title` | Inbox — Wisecall | შემოსულები — Wisecall | new |
| `meta.index.description` | Pay per question and get a written answer from a verified mentor within 7 days, or your money back. Founders, engineers, doctors and more. | გადაიხადე ერთ კითხვაში და მიიღე წერილობითი პასუხი გადამოწმებული მენტორისგან 7 დღეში, ან თანხა დაგიბრუნდება. | new |
| `meta.index.title` | Wisecall — Ask verified experts in Georgia | Wisecall — ჰკითხე გადამოწმებულ ექსპერტებს | new |
| `meta.login.description` | Log in to your Wisecall account. | შედი შენს Wisecall-ის ანგარიშში. | new |
| `meta.login.title` | Log in — Wisecall | შესვლა — Wisecall | new |
| `meta.privacy.description` | What personal data Wisecall keeps, why, for how long, who helps us process it, and your rights. | რა მონაცემებს ინახავს Wisecall, რატომ და რამდენ ხანს, ვინ გვეხმარება და რა უფლებები გაქვს. | new |
| `meta.privacy.title` | Privacy Policy — Wisecall | კონფიდენციალურობის პოლიტიკა — Wisecall | new |
| `meta.reset-password.description` | Choose a new password for your Wisecall account. | აირჩიე ახალი პაროლი შენი Wisecall-ის ანგარიშისთვის. | new |
| `meta.reset-password.title` | Set a new password — Wisecall | ახალი პაროლი — Wisecall | new |
| `meta.settings.description` | Manage your Wisecall profile, mentor application, password and language. | მართე შენი Wisecall-ის პროფილი, მენტორის განაცხადი, პაროლი და ენა. | new |
| `meta.settings.title` | Settings — Wisecall | პარამეტრები — Wisecall | new |
| `meta.signup.description` | Sign up free to ask verified mentors, or to apply as one. | დარეგისტრირდი უფასოდ, რომ მენტორებს კითხვა დაუსვა ან თავად გახდე მენტორი. | new |
| `meta.signup.title` | Create your account — Wisecall | ანგარიშის შექმნა — Wisecall | new |
| `meta.status.description` | Whether every part of Wisecall is working right now. | მუშაობს თუ არა Wisecall-ის ყველა ნაწილი ახლა. | new |
| `meta.status.title` | Status — Wisecall | სტატუსი — Wisecall | new |
| `meta.terms.description` | The rules for asking and answering on Wisecall: payment, refunds, mentors' duties and reviews. | Wisecall-ის წესები: გადახდა, თანხის დაბრუნება, მენტორის ვალდებულებები და შეფასებები. | new |
| `meta.terms.title` | Terms of Service — Wisecall | მომსახურების პირობები — Wisecall | new |
| `meta.unsubscribe.description` | Turn off optional emails from Wisecall, such as reminders to rate. | გამორთე Wisecall-ის არასავალდებულო წერილები, მაგალითად შეფასების შეხსენებები. | new |
| `meta.unsubscribe.title` | Email settings — Wisecall | წერილების პარამეტრები — Wisecall | new |
| `meta.verify-email.description` | Verify your email address to finish setting up your Wisecall account. | დაადასტურე ელფოსტის მისამართი, რომ Wisecall-ის ანგარიშის შექმნა დაასრულო. | new |
| `meta.verify-email.title` | Verify your email — Wisecall | ელფოსტის დადასტურება — Wisecall | new |
| `meta.waitlist-unsubscribe.description` | Stop getting a notice when mentors join Wisecall. | აღარ მიიღო შეტყობინება, როცა Wisecall-ზე მენტორები შემოვლენ. | new |
| `meta.waitlist-unsubscribe.title` | Unsubscribe — Wisecall | გამოწერის გაუქმება — Wisecall | new |

### nav

| Key | English | Georgian | |
|---|---|---|---|
| `nav.deletionBanner` | Your account will be deleted on {date}. | შენი ანგარიში წაიშლება {date}. | new |
| `nav.deletionKeep` | Keep my account | ანგარიშის შენარჩუნება | new |
| `nav.inbox` | Inbox | შემოსულები | new |
| `nav.inboxUnread` | Inbox, {n} unread | შემოსულები, {n} წაუკითხავი | new |

### profile

| Key | English | Georgian | |
|---|---|---|---|
| `profile.loadError` | We couldn't load this profile. Check your connection and try again. | პროფილი ვერ ჩაიტვირთა. შეამოწმე ინტერნეტი და სცადე თავიდან. | new |
| `profile.photo.err.size` | That picture is bigger than 5 MB. | ეს სურათი ძალიან დიდია: მაქსიმუმ 5 MB. | changed |
| `profile.photo.hint` | JPG, PNG or WebP, up to 5 MB. We crop it to a square, resize it and remove hidden data such as the place it was taken. | JPG, PNG ან WebP, მაქსიმუმ 5 MB. ვჭრით კვადრატად, ვამცირებთ და ვშლით დამალულ მონაცემებს, მაგალითად გადაღების ადგილს. | changed |
| `profile.username.invalid` | Use 3–30 lowercase letters, numbers or single dashes (no dash at the start or the end). | გამოიყენე 3–30 პატარა ლათინური ასო, ციფრი ან ერთი დეფისი (დეფისი არ შეიძლება დასაწყისში ან ბოლოში). | changed |
| `profile.username.rule` | 3–30 lowercase letters, numbers or dashes. You can change it once every 30 days; the old link keeps working. | 3–30 პატარა ლათინური ასო, ციფრი ან დეფისი. შეცვლა 30 დღეში ერთხელ შეგიძლია; ძველი ბმულიც იმუშავებს. | changed |
| `profile.visibility.contactsHint` | Only people you have asked or answered a question with can see your profile. Search engines can’t find it. | პროფილს ხედავენ მხოლოდ ისინი, ვისთანაც კითხვა-პასუხი გქონია. საძიებო სისტემები მას ვერ პოულობენ. | changed |

### rate

| Key | English | Georgian | |
|---|---|---|---|
| `rate.asker.hint` | Was this a clear, respectful question from {name}? | იყო თუ არა კითხვა გასაგები და პატივისცემით დაწერილი? | changed |
| `rate.mentor.hint` | How was the answer from {name}? | როგორი იყო პასუხი? | changed |
| `rate.revealedOne` | Your rating is now visible. {name} didn’t rate this question. | შენი შეფასება ახლა ჩანს. {name}: ამ კითხვის შეფასება არ დაუტოვებია. | new |
| `rate.theirNone` | {name} did not rate this question. | {name}: ამ კითხვის შეფასება არ დაუტოვებია. | changed |
| `rate.theirs` | {name}’s rating | შეფასება — {name} | changed |

### safety

| Key | English | Georgian | |
|---|---|---|---|
| `safety.112` | emergency services (police, ambulance, fire), free, 24/7 | გადაუდებელი დახმარება (პოლიცია, სასწრაფო, სახანძრო), უფასო, 24/7 | new |
| `safety.body` | Wisecall mentors answer within a day or two, so we can't help in an emergency, and we haven't taken any payment. If you or someone else is in danger, please get help now: | Wisecall-ის მენტორები ერთ-ორ დღეში პასუხობენ, ამიტომ გადაუდებელ შემთხვევაში ვერ დაგეხმარებით და თანხა არ ჩამოგვიჭრია. თუ შენ ან სხვა ვინმე საფრთხეში ხართ, გთხოვ, ახლავე მიმართე: | new |
| `safety.notAlone` | If you are thinking about ending your life, please call 112 or go to the nearest emergency department, and tell someone you trust. You don't have to go through this alone. | თუ სიცოცხლის დასრულებაზე ფიქრობ, გთხოვ, დარეკე 112-ზე ან მიდი უახლოეს საავადმყოფოს გადაუდებელ განყოფილებაში და უთხარი ვინმეს, ვისაც ენდობი. ამის გავლა მარტოს არ გიწევს. | new |
| `safety.notPaid` | Nothing was paid. If we misunderstood your question, you can change it and ask again. | არაფერი გადახდილა. თუ შენი კითხვა არასწორად გავიგეთ, შეგიძლია შეცვალო და თავიდან დასვა. | new |
| `safety.title` | It sounds like you may need help right now | როგორც ჩანს, ახლა შეიძლება დახმარება გჭირდებოდეს | new |
| `safety.violence` | hotline for people facing violence, free and confidential, 24/7 | ცხელი ხაზი ძალადობის მსხვერპლთათვის, უფასო და კონფიდენციალური, 24/7 | new |

### settings

| Key | English | Georgian | |
|---|---|---|---|
| `settings.connected.body` | Sign in faster by connecting your Google account. Wisecall only learns your name, email address and picture, and Google learns nothing about your questions. | დააკავშირე Google-ის ანგარიში და უფრო სწრაფად შედი. Wisecall იგებს მხოლოდ შენს სახელს, ელფოსტასა და სურათს, Google კი შენი კითხვების შესახებ არაფერს იგებს. | changed |
| `settings.connected.err.hasOther` | A different Google account is already connected. Disconnect it first. | სხვა Google ანგარიში უკვე დაკავშირებულია. ჯერ ის გათიშე. | changed |
| `settings.connected.err.setPassword` | Google is currently the only way you can log in. Set a password below first, then disconnect Google. | ამჟამად Google შესვლის ერთადერთი გზაა. ჯერ ქვემოთ დააყენე პაროლი, შემდეგ გათიშე Google. | changed |
| `settings.data.already` | Deleting this account is already scheduled. | ამ ანგარიშის წაშლა უკვე დაგეგმილია. | new |
| `settings.data.confirm` | Delete your account? It closes now and is deleted after {days} days. | წავშალოთ შენი ანგარიში? ის ახლავე დაიხურება და {days} დღის შემდეგ წაიშლება. | new |
| `settings.data.delete` | Delete my account | ანგარიშის წაშლა | new |
| `settings.data.deleteBody` | Your account closes at once and is deleted after {days} days; until then you can sign in and keep it. Records of payments stay, without your details, because the law requires them. Anything still open must be finished first. | ანგარიში მაშინვე დაიხურება და {days} დღის შემდეგ წაიშლება; მანამდე შეგიძლია შეხვიდე და შეინარჩუნო. გადახდების ჩანაწერები რჩება შენი მონაცემების გარეშე, რადგან ამას კანონი მოითხოვს. ჯერ ყველაფერი ღია უნდა დასრულდეს. | new |
| `settings.data.deleteTitle` | Delete my account | ანგარიშის წაშლა | new |
| `settings.data.export` | Download my data | ჩემი მონაცემების ჩამოტვირთვა | new |
| `settings.data.exportBody` | Download a copy of everything Wisecall keeps about your account, as a file (JSON). | ჩამოტვირთე ყველაფრის ასლი, რასაც Wisecall შენი ანგარიშის შესახებ ინახავს, ფაილის სახით (JSON). | new |
| `settings.data.googleReauth` | For your safety, sign out, sign in again with Google, and come back here within 10 minutes. | უსაფრთხოებისთვის გამოდი, თავიდან შედი Google-ით და 10 წუთში დაბრუნდი აქ. | new |
| `settings.data.keep` | Keep my account | ანგარიშის შენარჩუნება | new |
| `settings.data.kept` | Your account is kept. | ანგარიში შენარჩუნებულია. | new |
| `settings.data.open` | Before you can delete your account: | ანგარიშის წაშლამდე: | new |
| `settings.data.open.money_owed` | you owe money back after a refund. | თანხის დაბრუნების შემდეგ თანხა გმართებს. | new |
| `settings.data.open.money_to_pay_out` | you have earnings that were not paid out yet; | გაქვს ანაზღაურება, რომელიც ჯერ არ გადმოგირიცხავს; | new |
| `settings.data.open.open_reports` | a reported problem with an answer is still being decided; | პასუხთან დაკავშირებით საჩივარზე გადაწყვეტილება ჯერ არ მიღებულა; | new |
| `settings.data.open.questions_to_answer` | a paid question is waiting for your answer (answer it or decline it); | გადახდილი კითხვა შენს პასუხს ელოდება (უპასუხე ან უარყავი); | new |
| `settings.data.open.questions_waiting` | a question you asked is still waiting for its answer or refund; | შენი დასმული კითხვა ჯერ კიდევ პასუხს ან თანხის დაბრუნებას ელოდება; | new |
| `settings.data.password` | Your password | შენი პაროლი | new |
| `settings.data.pending` | Your account will be deleted on {date}. | შენი ანგარიში წაიშლება {date}. | new |
| `settings.data.title` | Your data | შენი მონაცემები | new |
| `settings.data.wrongPassword` | That password is incorrect. | პაროლი არასწორია. | new |
| `settings.notif.always` | Always sent, because you need them: payments and refunds, your questions and answers, follow-ups, application decisions, payouts, replies from support, and account security. | ყოველთვის იგზავნება, რადგან გჭირდება: გადახდები და თანხის დაბრუნება, შენი კითხვები და პასუხები, დამატებითი კითხვები, განაცხადის გადაწყვეტილებები, ანაზღაურება, მხარდაჭერის პასუხები და ანგარიშის უსაფრთხოება. | new |
| `settings.notif.inbox` | Everything also appears in your Inbox. | ყველაფერი ასევე ჩანს შენს შემოსულებში. | new |
| `settings.notif.optional` | You can turn these off: | ამათი გამორთვა შეგიძლია: | new |
| `settings.notif.rating_reminders` | Reminders to rate a question or an answer | შეხსენებები კითხვის ან პასუხის შეფასებაზე | new |
| `settings.notif.saved` | Saved. | შენახულია. | new |
| `settings.notif.tips` | Tips and news from Wisecall (rarely) | რჩევები და სიახლეები Wisecall-ისგან (იშვიათად) | new |
| `settings.notif.title` | Emails from Wisecall | Wisecall-ის წერილები | new |
| `settings.payouts.err.password` | Enter your current password to save payout details. | ანაზღაურების მონაცემების შესანახად შეიყვანე შენი მიმდინარე პაროლი. | new |
| `settings.payouts.err.tooMany` | Too many tries. Please wait 15 minutes and try again. | ძალიან ბევრი მცდელობა. დაელოდე 15 წუთი და სცადე თავიდან. | new |
| `settings.payouts.err.wrongPassword` | That password is not right. | პაროლი არასწორია. | new |
| `settings.payouts.held` | Because they changed, payouts wait until {date}. | რადგან მონაცემები შეიცვალა, ანაზღაურება {date}-მდე შეჩერებულია. | new |
| `settings.payouts.needForListing` | You're approved! Add your payout details below so you appear in Browse experts and can receive questions. | დამტკიცდი! ქვემოთ დაამატე ანაზღაურების მონაცემები, რომ ექსპერტების სიაში გამოჩნდე და კითხვები მიიღო. | changed |
| `settings.payouts.notSaved` | No payout details yet. You won't appear in Browse experts until you add them. | ანაზღაურების მონაცემები ჯერ არ გაქვს. ექსპერტების სიაში არ გამოჩნდები, სანამ არ დაამატებ. | changed |
| `settings.payouts.password` | Your current password | შენი მიმდინარე პაროლი | new |
| `settings.payouts.passwordHint` | Needed to save payout details, so nobody else can redirect your money. | საჭიროა ანაზღაურების მონაცემების შესანახად, რომ შენი თანხა სხვამ ვერ გადაამისამართოს. | new |
| `settings.payouts.reauth` | For your safety, sign out and sign in again right before you change payout details (within 10 minutes). | შენი უსაფრთხოებისთვის, ანაზღაურების მონაცემების შეცვლამდე გამოდი და თავიდან შედი (10 წუთის განმავლობაში). | new |
| `settings.payouts.save` | Save payout details | ანაზღაურების მონაცემების შენახვა | changed |
| `settings.payouts.saved` | Payout details saved. | ანაზღაურების მონაცემები შენახულია. | changed |
| `settings.payouts.title` | Payout details | ანაზღაურების მონაცემები | changed |
| `settings.progress.status` | See where it stands | ნახე, რა ეტაპზეა | new |
| `settings.sessions.body` | Sign out a device you don't recognise, or every device except this one. Changing your password also signs out every other device. | გამოდი მოწყობილობიდან, რომელსაც ვერ ცნობ, ან ყველა მოწყობილობიდან ამის გარდა. პაროლის შეცვლაც ყველა სხვა მოწყობილობიდან გამოგიყვანს. | new |
| `settings.sessions.confirm` | Sign out every device except this one? | გამოხვიდე ყველა მოწყობილობიდან ამის გარდა? | new |
| `settings.sessions.done` | Signed out. | გამოსულია. | new |
| `settings.sessions.doneAll` | Every other device is signed out. | ყველა სხვა მოწყობილობიდან გამოხვედი. | new |
| `settings.sessions.lastSeen` | Last active {date} | ბოლოს აქტიური: {date} | new |
| `settings.sessions.others` | Sign out all other devices | ყველა სხვა მოწყობილობიდან გამოსვლა | new |
| `settings.sessions.signOut` | Sign out | გამოსვლა | new |
| `settings.sessions.this` | This device | ეს მოწყობილობა | new |
| `settings.sessions.title` | Where you're signed in | სად ხარ შესული | new |
| `settings.sessions.unknown` | A device | მოწყობილობა | new |
| `settings.sub` | Your profile, mentor application, payouts and account. | შენი პროფილი, მენტორის განაცხადი, ანაზღაურება და ანგარიში. | changed |
| `settings.tab.notifications` | Notifications | შეტყობინებები | new |
| `settings.tab.payouts` | Payouts | ანაზღაურება | changed |
| `settings.twoStep.admin` | As an admin you manage two-step verification on the admin page; it can't be turned off. | როგორც ადმინისტრატორი, ორსაფეხურიან ვერიფიკაციას ადმინისტრატორის გვერდზე მართავ; მისი გამორთვა შეუძლებელია. | new |
| `settings.twoStep.body` | Add a code from an authenticator app (such as Google Authenticator) to your password, so a stolen password alone can't open your account. | პაროლს დაუმატე კოდი ავთენტიფიკატორის აპიდან (მაგალითად, Google Authenticator), რომ მხოლოდ მოპარული პაროლით შენს ანგარიშში ვერავინ შევიდეს. | new |
| `settings.twoStep.bodyMentor` | Strongly recommended for mentors: your earnings and your public profile are behind this account. Add a code from an authenticator app (such as Google Authenticator) to your password. | მენტორებს მკაცრად ვურჩევთ: ამ ანგარიშზეა შენი შემოსავალი და საჯარო პროფილი. პაროლს დაუმატე კოდი ავთენტიფიკატორის აპიდან (მაგალითად, Google Authenticator). | new |
| `settings.twoStep.codeLabel` | Code from the app | კოდი აპიდან | new |
| `settings.twoStep.codes` | Two-step verification is on. Keep these recovery codes somewhere safe: each one signs you in once if you lose your phone. They are shown only now. | ორსაფეხურიანი ვერიფიკაცია ჩართულია. ეს აღდგენის კოდები უსაფრთხო ადგილას შეინახე: თითოეული ერთხელ შეგიყვანს, თუ ტელეფონს დაკარგავ. ისინი მხოლოდ ახლა ჩანს. | new |
| `settings.twoStep.codesDone` | I've saved them | შევინახე | new |
| `settings.twoStep.confirm` | Turn it on | ჩართვა | new |
| `settings.twoStep.key` | Can't scan? Type this key into the app: | ვერ ასკანერებ? აპში ეს გასაღები ჩაწერე: | new |
| `settings.twoStep.off` | Two-step verification is off. | ორსაფეხურიანი ვერიფიკაცია გამორთულია. | new |
| `settings.twoStep.on` | On | ჩართულია | new |
| `settings.twoStep.recoveryLeft` | {n} recovery codes left. | დარჩა {n} აღდგენის კოდი. | new |
| `settings.twoStep.scan` | Scan this QR code with your authenticator app, then type the 6-digit code it shows. | დაასკანერე ეს QR კოდი ავთენტიფიკატორის აპით და შეიყვანე 6-ნიშნა კოდი, რომელსაც აჩვენებს. | new |
| `settings.twoStep.start` | Turn on two-step verification | ორსაფეხურიანი ვერიფიკაციის ჩართვა | new |
| `settings.twoStep.title` | Two-step verification | ორსაფეხურიანი ვერიფიკაცია | new |
| `settings.twoStep.turnOff` | Turn it off | გამორთვა | new |
| `settings.verify.needs_attention` | Needs attention — hidden from Browse experts | საჭიროებს ყურადღებას — ექსპერტების სიაში დამალულია | new |

### status

| Key | English | Georgian | |
|---|---|---|---|
| `status.c.database` | Accounts and data | ანგარიშები და მონაცემები | new |
| `status.c.email` | Email | ელფოსტა | new |
| `status.c.idChecks` | ID checks for mentors | მენტორების პირადობის შემოწმება | new |
| `status.c.jobs` | Background tasks (deadlines, refunds, reminders) | ფონური დავალებები (ვადები, თანხის დაბრუნება, შეხსენებები) | new |
| `status.c.payments` | Card payments | ბარათით გადახდა | new |
| `status.c.website` | Website | ვებსაიტი | new |
| `status.checked` | Checked at {time}. | შემოწმდა {time}-ზე. | new |
| `status.overall.degraded` | Wisecall works, but some background tasks are running late. | Wisecall მუშაობს, მაგრამ ზოგიერთი ფონური დავალება იგვიანებს. | new |
| `status.overall.down` | Wisecall has a problem right now. We are on it. | Wisecall-ს ახლა პრობლემა აქვს. ამაზე ვმუშაობთ. | new |
| `status.overall.ok` | Everything is working. | ყველაფერი მუშაობს. | new |
| `status.report` | Something not working? Tell us | რამე არ მუშაობს? მოგვწერე | new |
| `status.s.delayed` | Running late | იგვიანებს | new |
| `status.s.down` | Not working | არ მუშაობს | new |
| `status.s.not_open` | Not open yet | ჯერ არ გახსნილა | new |
| `status.s.off` | Off | გამორთულია | new |
| `status.s.ok` | Working | მუშაობს | new |
| `status.s.starting` | Starting | ირთვება | new |
| `status.title` | Status | სტატუსი | new |

### unsub

| Key | English | Georgian | |
|---|---|---|---|
| `unsub.bad` | This link doesn't work. You can choose your emails in Settings → Notifications. | ეს ბმული არ მუშაობს. წერილების არჩევა შეგიძლია პარამეტრებში → შეტყობინებები. | new |
| `unsub.done.rating_reminders` | Done: you won't get reminders to rate any more. You can turn them back on in Settings → Notifications. | მზადაა: შეფასების შეხსენებებს აღარ მიიღებ. ხელახლა ჩართვა შეგიძლია პარამეტრებში → შეტყობინებები. | new |
| `unsub.done.tips` | Done: you won't get tips and news any more. You can turn them back on in Settings → Notifications. | მზადაა: რჩევებსა და სიახლეებს აღარ მიიღებ. ხელახლა ჩართვა შეგიძლია პარამეტრებში → შეტყობინებები. | new |
| `unsub.settings` | Open Settings | პარამეტრების გახსნა | new |
| `unsub.title` | Emails from Wisecall | Wisecall-ის წერილები | new |
| `unsub.working` | One moment… | ერთი წამით… | new |

### vt

| Key | English | Georgian | |
|---|---|---|---|
| `vt.doc.choose` | Choose a PDF or JPG file (up to 10 MB) | აირჩიე PDF ან JPG ფაილი (მაქსიმუმ 10 MB) | changed |
| `vt.doc.err.size` | That file is larger than 10 MB. | ეს ფაილი ძალიან დიდია: მაქსიმუმ 10 MB. | changed |
| `vt.fillIn` | Please fill in every field. | შეავსე ყველა ველი. | changed |
| `vt.iv.none` | No times are available right now. Please check back soon. | ამჟამად თავისუფალი დრო არ არის. მალე ისევ შემოიხედე. | changed |
| `vt.iv.tooLate` | It's too close to the start time to cancel here. Please contact us. | დაწყებამდე ძალიან ცოტა დროა დარჩენილი და აქ ვეღარ გააუქმებ. დაგვიკავშირდი. | changed |
| `vt.lic.expired` | Your license has expired. Please submit the renewed one. | შენი ლიცენზიის ვადა ამოიწურა. გამოგვიგზავნე განახლებული. | changed |
| `vt.progress` | {done} of {total} steps complete | {done} / {total} ნაბიჯი დასრულებულია | changed |
| `vt.status.needsAttention` | Needs attention: a required step failed. You're hidden from Browse experts until it's sorted out | საჭიროებს ყურადღებას: სავალდებულო ნაბიჯი ვერ შესრულდა. სანამ ეს არ მოგვარდება, ექსპერტების სიაში არ ჩანხარ | new |
| `vt.we.tooManyAttempts` | Too many wrong codes, so this code no longer works. Send yourself a new one. | ძალიან ბევრჯერ შეიყვანე არასწორი კოდი, ამიტომ ეს კოდი აღარ მუშაობს. გამოიგზავნე ახალი. | new |

### wait

| Key | English | Georgian | |
|---|---|---|---|
| `wait.error` | Please enter a valid email address. | შეიყვანე სწორი ელფოსტის მისამართი. | changed |

## Admin panel (136)

### admin

| Key | English | Georgian | |
|---|---|---|---|
| `admin.ai.err.analysis_failed` | The analysis failed; a person decides. Run it again if you like. | ანალიზი ვერ შესრულდა; გადაწყვეტილებას ადამიანი იღებს. თუ გინდა, თავიდან გაუშვი. | new |
| `admin.ai.err.api_error` | The AI review did not run: the AI service had an error. | AI-ის განხილვა არ შედგა: AI სერვისში შეცდომა მოხდა. | new |
| `admin.ai.err.auth_failed` | The AI review did not run: the API key was refused. | AI-ის განხილვა არ შედგა: API გასაღები არ მიიღეს. | new |
| `admin.ai.err.bad_request` | The AI review did not run: the AI service refused the request. | AI-ის განხილვა არ შედგა: AI სერვისმა მოთხოვნა არ მიიღო. | new |
| `admin.ai.err.error` | The AI review did not run because of an unexpected error. | AI-ის განხილვა მოულოდნელი შეცდომის გამო არ შედგა. | new |
| `admin.ai.err.interrupted` | The analysis was interrupted (the server restarted). It runs again by itself. | ანალიზი შეწყდა (სერვერი გადაიტვირთა). ის თავიდან თავისით გაეშვება. | new |
| `admin.ai.err.invalid_output` | The AI answered in an unexpected form; a person decides. | AI-მ მოულოდნელი ფორმით უპასუხა; გადაწყვეტილებას ადამიანი იღებს. | new |
| `admin.ai.err.mentor_daily_limit` | The AI review was skipped: this applicant reached today’s limit of reviews. | AI-ის განხილვა გამოტოვებულია: ამ განმცხადებელმა დღევანდელ ლიმიტს მიაღწია. | new |
| `admin.ai.err.model_not_found` | The AI review did not run: the model in ANTHROPIC_MODEL does not exist. | AI-ის განხილვა არ შედგა: ANTHROPIC_MODEL-ში მითითებული მოდელი არ არსებობს. | new |
| `admin.ai.err.monthly_budget_reached` | The AI review was skipped: this month's AI budget is used up (AI_MONTHLY_BUDGET_USD). | AI-ის განხილვა გამოტოვებულია: ამ თვის AI-ის ბიუჯეტი ამოიწურა (AI_MONTHLY_BUDGET_USD). | new |
| `admin.ai.err.not_configured` | AI summaries are off (no API key). The checks above still ran; a person decides. | AI-ის შეჯამება გამორთულია (API გასაღები არ არის). ზემოთ მოცემული შემოწმებები მაინც ჩატარდა; გადაწყვეტილებას ადამიანი იღებს. | new |
| `admin.ai.err.rate_limited` | The AI review did not run: the AI service asked us to slow down. Run it again later. | AI-ის განხილვა არ შედგა: AI სერვისმა შენელება გვთხოვა. მოგვიანებით თავიდან გაუშვი. | new |
| `admin.ai.err.refused` | The AI declined to review this application; a person decides. | AI-მ ამ განაცხადის განხილვაზე უარი თქვა; გადაწყვეტილებას ადამიანი იღებს. | new |
| `admin.ai.err.timeout` | The AI review did not run: the AI service took too long. Run it again. | AI-ის განხილვა არ შედგა: AI სერვისმა ძალიან დიდხანს ილოდინა. თავიდან გაუშვი. | new |
| `admin.ai.err.unreachable` | The AI review did not run: the AI service could not be reached. | AI-ის განხილვა არ შედგა: AI სერვისთან დაკავშირება ვერ მოხერხდა. | new |
| `admin.dis.amount` | Partial refund, in lari | ნაწილობრივი დაბრუნება, ლარში | new |
| `admin.dis.amounts` | Price {price} = platform fee {fee} + mentor {mentor} | ფასი {price} = პლატფორმის საკომისიო {fee} + მენტორი {mentor} | new |
| `admin.dis.badAmount` | Enter an amount above 0 and below the price. | შეიყვანე 0-ზე მეტი და ფასზე ნაკლები თანხა. | new |
| `admin.dis.bankError` | The bank did not accept the refund; nothing changed. Try again. | ბანკმა თანხის დაბრუნება არ მიიღო; არაფერი შეცვლილა. სცადე თავიდან. | new |
| `admin.dis.decide` | Your decision | შენი გადაწყვეტილება | new |
| `admin.dis.help` | The asker reported a problem with an answer. The mentor's payout for it is held until you decide. Both people see your note. | კითხვის ავტორმა პასუხზე პრობლემა დააფიქსირა. მენტორის ანაზღაურება შეჩერებულია, სანამ გადაწყვეტილებას არ მიიღებ. შენს შენიშვნას ორივე მხარე დაინახავს. | new |
| `admin.dis.none` | No disputes. | საჩივრები არ არის. | new |
| `admin.dis.note` | Note to both people (required) | შენიშვნა ორივე მხარისთვის (სავალდებულო) | new |
| `admin.dis.open` | Open | ღია | new |
| `admin.dis.outcome.full_refund` | Full refund | სრული დაბრუნება | new |
| `admin.dis.outcome.partial_refund` | Partial refund | ნაწილობრივი დაბრუნება | new |
| `admin.dis.outcome.rejected` | No refund | დაბრუნების გარეშე | new |
| `admin.dis.people` | Asker: {asker} · Mentor: {mentor} | კითხვის ავტორი: {asker} · მენტორი: {mentor} | new |
| `admin.dis.pick` | Choose a decision. | აირჩიე გადაწყვეტილება. | new |
| `admin.dis.qa` | The question and the answer | კითხვა და პასუხი | new |
| `admin.dis.reason` | Reason: | მიზეზი: | new |
| `admin.dis.resolved` | Decided | გადაწყვეტილი | new |
| `admin.dis.save` | Decide | გადაწყვეტა | new |
| `admin.dis.split` | Of this, {mentor} comes off the mentor's payout and {fee} off the platform fee. | აქედან {mentor} მენტორის ანაზღაურებიდან აიქვითება, {fee} კი პლატფორმის საკომისიოდან. | new |
| `admin.filter.failed_step` | Approved, but a step failed | დამტკიცებული, მაგრამ ნაბიჯი ვერ შესრულდა | new |
| `admin.mv.failedRequired` | A required step failed | სავალდებულო ნაბიჯი ვერ შესრულდა | new |
| `admin.mv.field.category` | Category | კატეგორია | new |
| `admin.mv.field.licenceMissing` | This category needs a licence this approved mentor has not passed. Ask them to add it first. | ამ კატეგორიას სჭირდება ლიცენზია, რომელიც ამ დამტკიცებულ მენტორს არ აქვს გავლილი. ჯერ სთხოვე, დაამატოს. | new |
| `admin.mv.field.notRegulated` | Not a licensed profession (keep a category without a licence) | არ არის ლიცენზირებული პროფესია (დარჩეს კატეგორია ლიცენზიის გარეშე) | new |
| `admin.mv.field.overridden` | not a licensed profession (admin) | არ არის ლიცენზირებული პროფესია (ადმინი) | new |
| `admin.mv.field.regulatedWords` | The words name a licensed profession ({niche}). Tick "Not a licensed profession" to keep this category. | სიტყვები ლიცენზირებულ პროფესიას ასახელებს ({niche}). ამ კატეგორიის შესანარჩუნებლად მონიშნე „არ არის ლიცენზირებული პროფესია“. | new |
| `admin.mv.field.save` | Save field | სფეროს შენახვა | new |
| `admin.mv.field.text` | Field, in the mentor's words | სფერო, მენტორის სიტყვებით | new |
| `admin.mv.field.title` | Field | სფერო | new |
| `admin.mv.field.wordsSay` | The words name a licensed profession ({niche}): without "Not a licensed profession" the category stays {niche}. | სიტყვები ლიცენზირებულ პროფესიას ასახელებს ({niche}): „არ არის ლიცენზირებული პროფესიის“ მონიშვნის გარეშე კატეგორია {niche} დარჩება. | new |
| `admin.mv.kycRerun` | Re-run ID check | პირადობის შემოწმების თავიდან გაშვება | new |
| `admin.mv.kycRerun.age_passed` | The age check now passes. | ასაკის შემოწმება ახლა წარმატებულია. | new |
| `admin.mv.kycRerun.reopened` | The ID check is open again: the mentor can take it once more. | პირადობის შემოწმება ხელახლა გაიხსნა: მენტორს მისი კიდევ ერთხელ გავლა შეუძლია. | new |
| `admin.mv.kycRerun.unchanged` | No new result from the provider: the age waits for an admin. | პროვაიდერისგან ახალი შედეგი არ მოსულა: ასაკს ადმინისტრატორი შეამოწმებს. | new |
| `admin.mv.kycRerunGo` | Re-run the ID check | შემოწმების თავიდან გაშვება | new |
| `admin.mv.kycRerunHelp` | Only if the ID may have been read wrongly (for example the date of birth). The provider is asked again and the age worked out again; if it still fails, the mentor can take the ID check once more. Logged with your reason. | მხოლოდ მაშინ, თუ დოკუმენტი შეიძლება არასწორად წაიკითხა სისტემამ (მაგალითად, დაბადების თარიღი). პროვაიდერს შედეგს თავიდან ვკითხავთ და ასაკს თავიდან გამოვთვლით; თუ ისევ ვერ გაივლის, მენტორს შემოწმების კიდევ ერთხელ გავლა შეეძლება. ჩაიწერება შენი მიზეზით. | new |
| `admin.ov.app.draft` | Started, not sent | დაწყებული, არ გაგზავნილა | new |
| `admin.ov.app.rejected` | Rejected | უარყოფილი | new |
| `admin.ov.app.suspended` | Suspended | შეჩერებული | new |
| `admin.ov.app.verified` | Approved | დამტკიცებული | new |
| `admin.ov.app.waiting` | Waiting for review | განხილვას ელოდება | new |
| `admin.ov.applications` | Mentor applications | მენტორის განაცხადები | new |
| `admin.ov.debt` | Owed back by mentors | მენტორებს დასაბრუნებელი აქვთ | new |
| `admin.ov.disputes.open` | Open disputes | ღია საჩივრები | new |
| `admin.ov.disputes.resolved` | Resolved disputes | გადაწყვეტილი საჩივრები | new |
| `admin.ov.fee` | Wisecall fee ({percent}%, gross) | Wisecall-ის საკომისიო ({percent}%, მთლიანი) | new |
| `admin.ov.flags` | Open flags | ღია შენიშვნები | new |
| `admin.ov.holding` | Mentor money on hold | მენტორების დაკავებული თანხა | new |
| `admin.ov.mentors` | Mentor accounts | მენტორის ანგარიშები | new |
| `admin.ov.money` | Money | ფული | new |
| `admin.ov.moneyHelp` | Received counts paid questions that are not being refunded, minus partial refunds. The fee counts answered questions only and is before bank fees and tax. | „მიღებული“ ითვლის გადახდილ კითხვებს, რომლებზეც თანხა არ ბრუნდება, ნაწილობრივი დაბრუნების გამოკლებით. საკომისიო ითვლის მხოლოდ პასუხგაცემულ კითხვებს, ბანკის საკომისიომდე და გადასახადამდე. | new |
| `admin.ov.month` | New, last 30 days | ახალი, ბოლო 30 დღე | new |
| `admin.ov.paidOut` | Paid out to mentors | მენტორებზე გადარიცხული | new |
| `admin.ov.payable` | Owed to mentors now | ახლა მენტორებს ეკუთვნით | new |
| `admin.ov.problems` | Refunds, disputes and support | თანხის დაბრუნება, საჩივრები და მხარდაჭერა | new |
| `admin.ov.q.answered` | Answered | პასუხგაცემული | new |
| `admin.ov.q.expired` | Expired | ვადაგასული | new |
| `admin.ov.q.month` | Paid, last 30 days | გადახდილი, ბოლო 30 დღე | new |
| `admin.ov.q.paid` | Waiting for an answer | პასუხს ელოდება | new |
| `admin.ov.q.unpaid` | Not paid (yet) | გადაუხდელი (ჯერ) | new |
| `admin.ov.questions` | Questions | კითხვები | new |
| `admin.ov.received` | Received (after refunds) | მიღებული (დაბრუნების შემდეგ) | new |
| `admin.ov.refunds.amount` | Refunded in total | სულ დაბრუნებული | new |
| `admin.ov.refunds.full` | Full refunds | სრული დაბრუნება | new |
| `admin.ov.refunds.partial` | Partial refunds | ნაწილობრივი დაბრუნება | new |
| `admin.ov.refunds.pending` | Refunds in progress | მიმდინარე დაბრუნებები | new |
| `admin.ov.risk` | Waiting, by risk | მოლოდინში, რისკის მიხედვით | new |
| `admin.ov.risk.high` | High | მაღალი | new |
| `admin.ov.risk.low` | Low | დაბალი | new |
| `admin.ov.risk.medium` | Medium | საშუალო | new |
| `admin.ov.risk.none` | Not analysed | არ გაანალიზებულა | new |
| `admin.ov.safety` | Emergency questions to review | გადაუდებელი კითხვები განსახილველად | new |
| `admin.ov.signups` | Sign-ups | რეგისტრაციები | new |
| `admin.ov.support` | Open support conversations | ღია მიმოწერა მხარდაჭერასთან | new |
| `admin.ov.testPayments` | Includes {n} test payment(s) (no real money). | მოიცავს სატესტო გადახდებს ({n}; რეალური ფული არ არის). | new |
| `admin.ov.users` | Accounts | ანგარიშები | new |
| `admin.ov.waitlist` | Waiting list (not told yet) | მოლოდინის სია (ჯერ არ შეგვიტყობინებია) | new |
| `admin.ov.week` | New, last 7 days | ახალი, ბოლო 7 დღე | new |
| `admin.po.noIban` | This mentor has no payout details yet. | ამ მენტორს ანაზღაურების მონაცემები ჯერ არ აქვს. | changed |
| `admin.rv.from` | Written by {name} ({email}) about {ratee} | ავტორი: {name} ({email}) · შეფასებული: {ratee} | changed |
| `admin.rv.reportedBy` | Reported by {name} ({email}): {reason} | გაასაჩივრა: {name} ({email}) · მიზეზი: {reason} | changed |
| `admin.safety.cat.abuse` | Abuse | შეურაცხყოფა/ძალადობა ახლობლისგან | new |
| `admin.safety.cat.medical_emergency` | Medical emergency | სამედიცინო გადაუდებელი შემთხვევა | new |
| `admin.safety.cat.self_harm` | Self-harm | თვითდაზიანება | new |
| `admin.safety.cat.violence` | Violence | ძალადობა | new |
| `admin.safety.deleted` | (the text was deleted after 90 days) | (ტექსტი 90 დღის შემდეგ წაიშალა) | new |
| `admin.safety.help` | Nothing was paid; the person saw help text (112 and a support line). The text is kept for 90 days. | არაფერი გადახდილა; ადამიანმა დახმარების ტექსტი ნახა (112 და ცხელი ხაზი). ტექსტი 90 დღე ინახება. | new |
| `admin.safety.none` | Nothing to review. | განსახილველი არაფერია. | new |
| `admin.safety.note` | Note (optional) | შენიშვნა (არასავალდებულო) | new |
| `admin.safety.reviewed` | Mark as reviewed | განხილულად მონიშვნა | new |
| `admin.safety.title` | Questions that looked like an emergency | კითხვები, რომლებიც გადაუდებელ შემთხვევას ჰგავდა | new |
| `admin.sup.addNote` | Add note | ჩანაწერის დამატება | new |
| `admin.sup.all` | All | ყველა | new |
| `admin.sup.assignMe` | Assign to me | ჩემზე მიმაგრება | new |
| `admin.sup.assigned` | Assigned to {email} | მიმაგრებულია: {email} | new |
| `admin.sup.close` | Close conversation | საუბრის დახურვა | new |
| `admin.sup.closed` | Closed | დახურული | new |
| `admin.sup.empty` | No conversations. | საუბრები არ არის. | new |
| `admin.sup.fromContact` | From the contact form | საკონტაქტო ფორმიდან | new |
| `admin.sup.internal` | Internal note | შიდა ჩანაწერი | new |
| `admin.sup.kind.booking` | question | კითხვა | new |
| `admin.sup.kind.support` | support | მხარდაჭერა | new |
| `admin.sup.noReports` | No reported messages. | საჩივრები არ არის. | new |
| `admin.sup.noteLabel` | Internal note (only admins see it) | შიდა ჩანაწერი (მხოლოდ ადმინისტრატორები ხედავენ) | new |
| `admin.sup.open` | Open | ღია | new |
| `admin.sup.open.btn` | Open | გახსნა | new |
| `admin.sup.person` | {name} ({email}) | {name} ({email}) | new |
| `admin.sup.reopen` | Reopen | ხელახლა გახსნა | new |
| `admin.sup.replyLabel` | Reply to the person (they also get it by email) | პასუხი ადამიანს (ელფოსტითაც მიიღებს) | new |
| `admin.sup.reportBy` | Reported by {name} ({email}): {reason} | საჩივარი: {name} ({email}): {reason} | new |
| `admin.sup.reports` | Reported messages | საჩივრები შეტყობინებებზე | new |
| `admin.sup.resolution` | What you did (required) | რა გააკეთე (სავალდებულო) | new |
| `admin.sup.resolve` | Mark as resolved | მოგვარებულად მონიშვნა | new |
| `admin.sup.send` | Send reply | პასუხის გაგზავნა | new |
| `admin.sup.sender` | Written by {name} ({email}) in a {kind} conversation | ავტორი: {name} ({email}), საუბარი: {kind} | new |
| `admin.sup.unassign` | Unassign | მიმაგრების მოხსნა | new |
| `admin.sup.unassigned` | Not assigned | არავისზე მიმაგრებული | new |
| `admin.sup.waiting` | Waiting for us | ჩვენს პასუხს ელოდება | new |
| `admin.tab.disputes` | Disputes | საჩივრები პასუხებზე | new |
| `admin.tab.overview` | Overview | მიმოხილვა | new |
| `admin.tab.support` | Support | მხარდაჭერა | new |
