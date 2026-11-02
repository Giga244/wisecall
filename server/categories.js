// The categories students browse and mentors choose (docs/CLAUDE-CODE-CATEGORIES.md): 16 fields (სფერო), and chips (მიმართულება) inside each. To add a
// chip, add one line to its field: c('key', 'ქართული', 'English', 'keywords for the search') makes the id '<field>.<key>'; give a fifth value only when
// it counts as another niche than the field's. Every field also has '<field>.other' ("სხვა", with a text box).
//
// users.niche stays the layer the rules read: a licence, "never approved automatically", the /advice pages (server/verification/rules.js). So every field
// and chip names the niche it counts as, and anything that could be read as licensed work counts as the regulated niche. Tests hold this to the
// researched list (tests/categories-v2.test.js).
const c = (key, ka, en, keywords = '', niche = null) => ({ key, ka, en, keywords, niche });

const FIELDS = [
  { id: 'med', icon: '🩺', ka: 'მედიცინა და ჯანმრთელობა', en: 'Medicine & Health', niche: 'medicine', keywords: 'medical doctor health ექიმი ჯანდაცვა კლინიკა', chips: [
    c('general', 'ზოგადი მედიცინა', 'General medicine', 'family gp ოჯახის ექიმი'),
    c('internal', 'შინაგანი მედიცინა', 'Internal medicine', 'therapy თერაპია'),
    c('surgery', 'ქირურგია', 'Surgery', 'surgeon ქირურგი'),
    c('pediatrics', 'პედიატრია', 'Pediatrics', 'paediatrics children პედიატრი ბავშვთა'),
    c('cardiology', 'კარდიოლოგია', 'Cardiology', 'heart cardiac გული კარდიოქირურგია კარდიოლოგი'),
    c('neurology', 'ნევროლოგია', 'Neurology', 'brain ნევროლოგი'),
    c('gynecology', 'გინეკოლოგია', 'Gynecology', 'gynaecology obstetrics გინეკოლოგი მეანობა'),
    c('dermatology', 'დერმატოლოგია', 'Dermatology', 'skin კანი დერმატოლოგი'),
    c('ophthalmology', 'ოფთალმოლოგია', 'Ophthalmology', 'eye თვალი ოფთალმოლოგი'),
    c('orthopedics', 'ორთოპედია / ტრავმატოლოგია', 'Orthopedics / Traumatology', 'bones ტრავმატოლოგი ორთოპედი'),
    c('psychiatry', 'ფსიქიატრია', 'Psychiatry', 'psychiatrist ფსიქიატრი'),
    c('radiology', 'რადიოლოგია', 'Radiology', 'imaging რადიოლოგი'),
    c('anesthesiology', 'ანესთეზიოლოგია', 'Anesthesiology', 'anaesthesia ანესთეზია'),
    c('emergency', 'სასწრაფო მედიცინა', 'Emergency medicine', 'er urgent გადაუდებელი'),
    c('dentistry', 'სტომატოლოგია', 'Dentistry', 'dental dentist teeth კბილი სტომატოლოგი', 'dentistry'),
    c('pharmacy', 'ფარმაცია', 'Pharmacy', 'pharmacist ფარმაცევტი აფთიაქი', 'pharmacy'),
    c('nurse', 'ექთანი', 'Nursing', 'nurse საექთნო', 'nursing'),
    c('physio', 'ფიზიოთერაპია / რეაბილიტაცია', 'Physiotherapy / Rehabilitation', 'physical therapy რეაბილიტოლოგი'),
    c('nutrition', 'ნუტრიციოლოგია', 'Nutrition', 'dietitian dietetics დიეტოლოგი კვება', 'nutrition'),
    c('public_health', 'საზოგადოებრივი ჯანდაცვა', 'Public health', 'epidemiology ეპიდემიოლოგია'),
    c('veterinary', 'ვეტერინარია', 'Veterinary medicine', 'vet animals ვეტერინარი ცხოველები', 'veterinary'),
    c('residency', 'რეზიდენტურა და USMLE', 'Residency & USMLE', 'usmle resident რეზიდენტი')
  ] },
  { id: 'it', icon: '💻', ka: 'IT და ტექნოლოგიები', en: 'IT & Technology', short: { ka: 'IT', en: 'IT' }, niche: 'tech', keywords: 'programming software developer coding პროგრამირება პროგრამისტი კოდი ტექნოლოგია აიტი', chips: [
    c('frontend', 'Frontend', 'Frontend', 'react vue angular javascript html css ფრონტენდი'),
    c('backend', 'Backend', 'Backend', 'node python java php golang api ბექენდი'),
    c('fullstack', 'Full-stack', 'Full-stack', 'fullstack ფულსტეკი'),
    c('mobile', 'მობილური აპები (iOS / Android)', 'Mobile apps (iOS / Android)', 'flutter swift kotlin react native აპლიკაცია'),
    c('ai', 'AI / Machine Learning', 'AI / Machine Learning', 'ml deep learning ხელოვნური ინტელექტი მანქანური სწავლება'),
    c('data', 'Data Science / ანალიტიკა', 'Data Science / Analytics', 'sql analyst მონაცემები ანალიტიკოსი'),
    c('cyber', 'კიბერუსაფრთხოება', 'Cybersecurity', 'security infosec pentest'),
    c('devops', 'DevOps / Cloud', 'DevOps / Cloud', 'aws azure docker kubernetes'),
    c('qa', 'QA / ტესტირება', 'QA / Testing', 'tester testing ტესტერი'),
    c('gamedev', 'გეიმ-დეველოპმენტი', 'Game development', 'unity unreal games თამაშები'),
    c('embedded', 'Embedded / IoT', 'Embedded / IoT', 'arduino firmware'),
    c('blockchain', 'ბლოკჩეინი', 'Blockchain', 'web3 solidity'),
    c('product', 'IT მენეჯმენტი / Product', 'IT management / Product', 'product manager scrum პროდუქტის მენეჯერი'),
    c('uiux', 'UI/UX დიზაინი', 'UI/UX design', 'figma ux ui დიზაინერი', 'design'),
    c('networks', 'ქსელები / სისტემური ადმინისტრირება', 'Networks / System administration', 'sysadmin cisco linux')
  ] },
  { id: 'biz', icon: '📈', ka: 'ბიზნესი და მენეჯმენტი', en: 'Business & Management', niche: 'business', keywords: 'business company კომპანია ბიზნესი mba', chips: [
    c('management', 'მენეჯმენტი', 'Management', 'manager მენეჯერი mba'),
    c('marketing', 'მარკეტინგი', 'Marketing', 'brand ბრენდი', 'marketing'),
    c('digital', 'ციფრული მარკეტინგი / SMM', 'Digital marketing / SMM', 'smm seo ads facebook instagram სოციალური მედია', 'marketing'),
    c('sales', 'გაყიდვები', 'Sales', 'seller გამყიდველი'),
    c('hr', 'HR', 'HR', 'human resources recruiter career რეკრუტერი ადამიანური რესურსები კარიერა', 'careers_hr'),
    c('projects', 'პროექტების მართვა', 'Project management', 'pmp agile project manager'),
    c('logistics', 'ლოგისტიკა / მიწოდების ჯაჭვი', 'Logistics / Supply chain', 'supply chain'),
    c('startups', 'სტარტაპები და მეწარმეობა', 'Startups & Entrepreneurship', 'startup founder მეწარმე'),
    c('ecommerce', 'ელ-კომერცია', 'E-commerce', 'shopify online store ონლაინ მაღაზია', 'ecommerce'),
    c('consulting', 'კონსალტინგი', 'Consulting', 'consultant კონსულტანტი'),
    c('international', 'საერთაშორისო ბიზნესი', 'International business', 'export იმპორტი ექსპორტი')
  ] },
  { id: 'fin', icon: '💰', ka: 'ფინანსები და ეკონომიკა', en: 'Finance & Economics', niche: 'finance', keywords: 'finance money ფული ფინანსისტი', chips: [
    c('bank', 'ბანკი', 'Banking', 'bank banker ბანკირი საბანკო'),
    c('accounting', 'ბუღალტერია და აუდიტი', 'Accounting & Audit', 'accountant auditor ბუღალტერი აუდიტორი ifrs', 'accounting_tax'),
    c('tax', 'საგადასახადო', 'Tax', 'taxes გადასახადები', 'accounting_tax'),
    c('investments', 'ინვესტიციები', 'Investments', 'stocks investor ინვესტორი აქციები'),
    c('analysis', 'ფინანსური ანალიზი', 'Financial analysis', 'analyst ანალიტიკოსი'),
    c('economics', 'ეკონომიკა', 'Economics', 'economist macroeconomics ეკონომისტი მაკროეკონომიკა', 'business'),
    c('insurance', 'დაზღვევა', 'Insurance', 'დამზღვევი'),
    c('crypto', 'კრიპტო / ფინტექი', 'Crypto / Fintech', 'bitcoin კრიპტოვალუტა'),
    c('acca', 'ACCA / CFA', 'ACCA / CFA', 'cfa acca', 'accounting_tax')
  ] },
  { id: 'law', icon: '⚖️', ka: 'სამართალი', en: 'Law', niche: 'law', keywords: 'lawyer legal attorney იურისტი ადვოკატი იურიდიული', chips: [
    c('criminal', 'სისხლის სამართალი', 'Criminal law', 'criminal'),
    c('civil', 'სამოქალაქო სამართალი', 'Civil law', 'civil'),
    c('corporate', 'ბიზნეს / კორპორაციული სამართალი', 'Business / Corporate law', 'corporate კომპანიის'),
    c('labor', 'შრომის სამართალი', 'Labor law', 'employment labour'),
    c('family', 'საოჯახო სამართალი', 'Family law', 'divorce განქორწინება'),
    c('administrative', 'ადმინისტრაციული სამართალი', 'Administrative law', 'administrative'),
    c('international', 'საერთაშორისო სამართალი', 'International law', 'international'),
    c('human_rights', 'ადამიანის უფლებები', 'Human rights', 'rights'),
    c('it_data', 'IT / მონაცემთა სამართალი', 'IT / Data law', 'gdpr privacy პერსონალური მონაცემები'),
    c('notary', 'ნოტარიუსი', 'Notary', 'notary'),
    c('judge', 'მოსამართლე / პროკურორი', 'Judge / Prosecutor', 'prosecutor court სასამართლო'),
    c('bar', 'საადვოკატო გამოცდა', 'Bar exam', 'bar exam')
  ] },
  { id: 'eng', icon: '🏗️', ka: 'ინჟინერია და არქიტექტურა', en: 'Engineering & Architecture', niche: 'engineering', keywords: 'engineer ინჟინერი მშენებლობა', chips: [
    c('architecture', 'არქიტექტურა', 'Architecture', 'architect არქიტექტორი', 'architecture'),
    c('interior', 'ინტერიერის დიზაინი', 'Interior design', 'interior', 'design'),
    c('urban', 'ურბანისტიკა', 'Urban planning', 'urban ქალაქგეგმარება', 'architecture'),
    c('civil', 'სამშენებლო ინჟინერია', 'Civil engineering', 'construction მშენებელი'),
    c('electrical', 'ელექტროინჟინერია', 'Electrical engineering', 'electronics ელექტრონიკა'),
    c('mechanical', 'მექანიკური ინჟინერია', 'Mechanical engineering', 'mechanic მექანიკა'),
    c('energy', 'ენერგეტიკა', 'Energy', 'solar renewable განახლებადი'),
    c('chemical', 'ქიმიური ინჟინერია', 'Chemical engineering', 'chemical'),
    c('aviation', 'ავიაცია', 'Aviation', 'aerospace aircraft თვითმფრინავი'),
    c('transport', 'სატრანსპორტო / საავტომობილო', 'Transport / Automotive', 'cars automotive მანქანები'),
    c('geodesy', 'გეოდეზია', 'Geodesy', 'surveying')
  ] },
  { id: 'sci', icon: '🔬', ka: 'მეცნიერება', en: 'Science', niche: 'science', keywords: 'science scientist research მეცნიერი კვლევა', chips: [
    c('biology', 'ბიოლოგია', 'Biology', 'biologist ბიოლოგი'),
    c('chemistry', 'ქიმია', 'Chemistry', 'chemist ქიმიკოსი'),
    c('physics', 'ფიზიკა', 'Physics', 'physicist ფიზიკოსი'),
    c('math', 'მათემატიკა', 'Mathematics', 'math maths მათემატიკოსი'),
    c('statistics', 'სტატისტიკა', 'Statistics', 'statistician'),
    c('geology', 'გეოლოგია', 'Geology', 'geologist'),
    c('geography', 'გეოგრაფია', 'Geography', 'gis'),
    c('ecology', 'ეკოლოგია / გარემო', 'Ecology / Environment', 'environment climate კლიმატი'),
    c('astronomy', 'ასტრონომია', 'Astronomy', 'space კოსმოსი'),
    c('biotech', 'ბიოტექნოლოგია', 'Biotechnology', 'biotech'),
    c('research', 'კვლევა და აკადემიური კარიერა (PhD)', 'Research & Academic career (PhD)', 'phd academic დოქტორანტურა')
  ] },
  { id: 'lang', icon: '🗣️', ka: 'ენები და თარგმანი', en: 'Languages & Translation', niche: 'languages', keywords: 'language translation ენა', chips: [
    c('english', 'ინგლისური', 'English', 'english'),
    c('german', 'გერმანული', 'German', 'deutsch'),
    c('french', 'ფრანგული', 'French', 'french'),
    c('spanish', 'ესპანური', 'Spanish', 'spanish'),
    c('italian', 'იტალიური', 'Italian', 'italian'),
    c('russian', 'რუსული', 'Russian', 'russian'),
    c('turkish', 'თურქული', 'Turkish', 'turkish'),
    c('chinese', 'ჩინური', 'Chinese', 'mandarin'),
    c('japanese_korean', 'იაპონური / კორეული', 'Japanese / Korean', 'japanese korean'),
    c('georgian', 'ქართული (უცხოელებისთვის)', 'Georgian (for foreigners)', 'georgian'),
    c('translation', 'თარგმანი / თარჯიმნობა', 'Translation / Interpreting', 'translator interpreter მთარგმნელი თარჯიმანი')
  ] },
  { id: 'edu', icon: '📚', ka: 'გამოცდები და განათლება', en: 'Exams & Education', short: { ka: 'გამოცდები', en: 'Exams' }, niche: 'teaching', keywords: 'exam education teaching გამოცდა განათლება სწავლა', chips: [
    c('national', 'ეროვნული გამოცდები', 'National exams', 'ერთიანი ეროვნული ეეგ exam'),
    c('ielts', 'IELTS', 'IELTS', 'ielts აიელტსი'),
    c('toefl', 'TOEFL', 'TOEFL', 'toefl ტოეფლი'),
    c('sat', 'SAT', 'SAT', 'sat'),
    c('gre_gmat', 'GRE / GMAT', 'GRE / GMAT', 'gre gmat'),
    c('duolingo', 'Duolingo English Test', 'Duolingo English Test', 'det duolingo'),
    c('choosing', 'უნივერსიტეტის / ფაკულტეტის არჩევა', 'Choosing a university / faculty', 'university faculty უნივერსიტეტი ფაკულტეტი აბიტურიენტი'),
    c('teaching', 'მასწავლებლობა', 'School teaching', 'teacher მასწავლებელი'),
    c('lecturing', 'ლექტორობა', 'University lecturing', 'lecturer professor ლექტორი პროფესორი'),
    c('school_mgmt', 'სკოლის მართვა', 'School management', 'principal დირექტორი')
  ] },
  { id: 'abroad', icon: '✈️', ka: 'საზღვარგარეთ სწავლა', en: 'Study Abroad', short: { ka: 'საზღვარგარეთ', en: 'Abroad' }, niche: 'study_abroad', keywords: 'abroad study საზღვარგარეთ უცხოეთი მაგისტრატურა masters', chips: [
    c('grants', 'გრანტები და სტიპენდიები', 'Grants & Scholarships', 'scholarship grant სტიპენდია გრანტი daad chevening fulbright'),
    c('motivation', 'სამოტივაციო წერილი / CV', 'Motivation letter / CV', 'cv resume personal statement რეზიუმე'),
    c('usa', 'აშშ', 'USA', 'america us united states ამერიკა'),
    c('uk', 'დიდი ბრიტანეთი', 'United Kingdom', 'uk britain england ინგლისი ბრიტანეთი'),
    c('germany', 'გერმანია', 'Germany', 'germany deutschland'),
    c('netherlands', 'ნიდერლანდები', 'Netherlands', 'holland ჰოლანდია'),
    c('france', 'საფრანგეთი', 'France', 'france'),
    c('italy', 'იტალია', 'Italy', 'italy'),
    c('spain', 'ესპანეთი', 'Spain', 'spain'),
    c('poland_czech', 'პოლონეთი / ჩეხეთი', 'Poland / Czechia', 'poland czech'),
    c('turkey', 'თურქეთი', 'Turkey', 'turkiye'),
    c('canada', 'კანადა', 'Canada', 'canada'),
    c('asia', 'აზია', 'Asia', 'japan korea china იაპონია კორეა ჩინეთი'),
    c('erasmus', 'Erasmus+', 'Erasmus+', 'erasmus ერასმუსი'),
    c('visa', 'ვიზა და ცხოვრება საზღვარგარეთ', 'Visa & life abroad', 'visa ვიზა')
  ] },
  { id: 'psy', icon: '🧠', ka: 'ფსიქოლოგია და საზოგადოება', en: 'Psychology & Society', niche: 'psychology', keywords: 'psychology psychologist ფსიქოლოგი', chips: [
    c('clinical', 'კლინიკური ფსიქოლოგია', 'Clinical psychology', 'clinical'),
    c('child', 'ბავშვთა ფსიქოლოგია', 'Child psychology', 'children parenting ბავშვები მშობლები'),
    c('organizational', 'ორგანიზაციული ფსიქოლოგია', 'Organizational psychology', 'io organisational'),
    c('therapy_study', 'ფსიქოთერაპიის სწავლა', 'Studying psychotherapy', 'psychotherapy ფსიქოთერაპია'),
    c('sociology', 'სოციოლოგია', 'Sociology', 'sociologist სოციოლოგი', 'science'),
    c('social_work', 'სოციალური მუშაობა', 'Social work', 'social worker სოციალური მუშაკი'),
    c('anthropology', 'ანთროპოლოგია', 'Anthropology', 'anthropologist', 'science'),
    c('philosophy', 'ფილოსოფია', 'Philosophy', 'philosopher', 'science'),
    c('history', 'ისტორია', 'History', 'historian ისტორიკოსი', 'science')
  ] },
  { id: 'pol', icon: '🌍', ka: 'პოლიტიკა და საერთაშორისო ურთიერთობები', en: 'Politics & International Relations', niche: 'politics', keywords: 'politics ir პოლიტიკა პოლიტოლოგია political science', chips: [
    c('ir', 'საერთაშორისო ურთიერთობები', 'International relations', 'ir international relations'),
    c('diplomacy', 'დიპლომატია', 'Diplomacy', 'diplomat დიპლომატი'),
    c('civil_service', 'საჯარო სამსახური', 'Civil service', 'government public sector სახელმწიფო'),
    c('policy', 'საჯარო პოლიტიკა', 'Public policy', 'policy'),
    c('ngo', 'არასამთავრობო სექტორი', 'NGO sector', 'ngo nonprofit'),
    c('intl_orgs', 'საერთაშორისო ორგანიზაციები (UN, EU …)', 'International organizations (UN, EU …)', 'un eu nato გაერო ევროკავშირი')
  ] },
  { id: 'art', icon: '🎨', ka: 'დიზაინი და ხელოვნება', en: 'Design & Arts', niche: 'creative', keywords: 'design art artist დიზაინი ხელოვნება', chips: [
    c('graphic', 'გრაფიკული დიზაინი', 'Graphic design', 'graphic designer photoshop illustrator დიზაინერი', 'design'),
    c('illustration', 'ილუსტრაცია', 'Illustration', 'illustrator ილუსტრატორი'),
    c('animation', '3D / ანიმაცია', '3D / Animation', 'blender maya animation ანიმატორი'),
    c('fashion', 'ფეშენ-დიზაინი', 'Fashion design', 'fashion მოდა', 'design'),
    c('product', 'პროდუქტის დიზაინი', 'Product design', 'industrial', 'design'),
    c('photography', 'ფოტოგრაფია', 'Photography', 'photographer ფოტოგრაფი ფოტო', 'film_photo'),
    c('painting', 'მხატვრობა', 'Painting', 'painter მხატვარი'),
    c('music', 'მუსიკა', 'Music', 'musician singer მუსიკოსი მომღერალი', 'music'),
    c('acting', 'მსახიობობა / თეატრი', 'Acting / Theatre', 'actor მსახიობი თეატრი'),
    c('dance', 'ცეკვა', 'Dance', 'dancer მოცეკვავე')
  ] },
  { id: 'media', icon: '🎬', ka: 'მედია და კომუნიკაცია', en: 'Media & Communication', niche: 'content_creation', keywords: 'media communication მედია კომუნიკაცია', chips: [
    c('journalism', 'ჟურნალისტიკა', 'Journalism', 'journalist ჟურნალისტი', 'writing'),
    c('tv_radio', 'ტელევიზია / რადიო', 'TV / Radio', 'television broadcast', 'film_photo'),
    c('film', 'კინო / ვიდეო მონტაჟი', 'Film / Video editing', 'cinema director რეჟისორი მონტაჟი', 'film_photo'),
    c('pr', 'PR', 'PR', 'public relations პიარი', 'marketing'),
    c('content', 'კონტენტ-შექმნა / ბლოგინგი', 'Content creation / Blogging', 'youtube tiktok blogger ბლოგერი'),
    c('advertising', 'რეკლამა', 'Advertising', 'ads copywriting კოპირაიტინგი', 'marketing'),
    c('writing', 'წერა / ლიტერატურა', 'Writing / Literature', 'writer მწერალი', 'writing')
  ] },
  { id: 'sport', icon: '⚽', ka: 'სპორტი', en: 'Sports', niche: 'sports_coaching', keywords: 'sport athlete სპორტსმენი', chips: [
    c('professional', 'პროფესიონალური სპორტი', 'Professional sport', 'football rugby basketball ფეხბურთი რაგბი კალათბურთი'),
    c('coaching', 'მწვრთნელობა', 'Coaching', 'coach მწვრთნელი'),
    c('fitness', 'ფიტნესი', 'Fitness', 'gym trainer ვარჯიში', 'fitness'),
    c('medicine', 'სპორტული მედიცინა', 'Sports medicine', 'sports doctor', 'medicine'),
    c('management', 'სპორტის მენეჯმენტი', 'Sports management', 'agent')
  ] },
  { id: 'svc', icon: '🍽️', ka: 'სერვისი და სხვა', en: 'Services & Other', niche: 'tourism', keywords: 'service მომსახურება', chips: [
    c('tourism', 'ტურიზმი', 'Tourism', 'travel guide გიდი'),
    c('hotel', 'სასტუმრო ბიზნესი', 'Hotel business', 'hospitality hotel სასტუმრო'),
    c('culinary', 'კულინარია / შეფ-მზარეული', 'Culinary / Chef', 'chef cook მზარეული', 'cooking'),
    c('agro', 'აგრონომია / სოფლის მეურნეობა', 'Agronomy / Agriculture', 'farming wine ღვინო ფერმერი აგრონომი', 'wine_agriculture'),
    c('military', 'სამხედრო / პოლიცია', 'Military / Police', 'army police არმია', 'other'),
    c('aviation_crew', 'საავიაციო (პილოტი / ბორტგამცილებელი)', 'Aviation crew (pilot / flight attendant)', 'pilot cabin crew პილოტი', 'other')
  ] }
];

// Where someone studied or works.
const COUNTRIES = [
  { id: 'ge', ka: 'საქართველო', en: 'Georgia', keywords: 'georgia' },
  { id: 'us', ka: 'აშშ', en: 'USA', keywords: 'america usa united states ამერიკა' },
  { id: 'uk', ka: 'დიდი ბრიტანეთი', en: 'United Kingdom', keywords: 'uk britain england ინგლისი ბრიტანეთი' },
  { id: 'de', ka: 'გერმანია', en: 'Germany', keywords: 'germany deutschland' },
  { id: 'fr', ka: 'საფრანგეთი', en: 'France', keywords: 'france' },
  { id: 'it', ka: 'იტალია', en: 'Italy', keywords: 'italy' },
  { id: 'es', ka: 'ესპანეთი', en: 'Spain', keywords: 'spain' },
  { id: 'nl', ka: 'ნიდერლანდები', en: 'Netherlands', keywords: 'netherlands holland ჰოლანდია' },
  { id: 'pl', ka: 'პოლონეთი', en: 'Poland', keywords: 'poland' },
  { id: 'cz', ka: 'ჩეხეთი', en: 'Czechia', keywords: 'czech czechia' },
  { id: 'tr', ka: 'თურქეთი', en: 'Turkey', keywords: 'turkey turkiye' },
  { id: 'ca', ka: 'კანადა', en: 'Canada', keywords: 'canada' },
  { id: 'other', ka: 'სხვა', en: 'Other', keywords: '' }
];

// How the years of experience are shown and filtered (they are stored as a number: "less than a year" counts as the first band).
const YEARS = [
  { id: '1-2', ka: '1–2', en: '1–2', test: (n) => n <= 2 },
  { id: '3-5', ka: '3–5', en: '3–5', test: (n) => n >= 3 && n <= 5 },
  { id: '6-10', ka: '6–10', en: '6–10', test: (n) => n >= 6 && n <= 10 },
  { id: '10+', ka: '10+', en: '10+', test: (n) => n > 10 }
];
const yearsBand = (n) => (Number.isInteger(n) ? (YEARS.find((y) => y.test(n)) || { id: null }).id : null);

// Universities people write in many ways: any of these words finds the others. (Search only.)
const UNIVERSITY_ALIASES = [
  ['თსუ', 'tsu', 'თბილისის სახელმწიფო', 'ივანე ჯავახიშვილის', 'javakhishvili', 'tbilisi state'],
  ['თსსუ', 'tsmu', 'სამედიცინო უნივერსიტეტი', 'tbilisi state medical'],
  ['სტუ', 'gtu', 'ტექნიკური უნივერსიტეტი', 'georgian technical'],
  ['ილიაუნი', 'iliauni', 'ილიას სახელმწიფო', 'ilia state'],
  ['კიუ', 'kiu', 'კუთაისის საერთაშორისო', 'kutaisi international'],
  ['ბთუ', 'btu', 'ბიზნესისა და ტექნოლოგიების', 'business and technology'],
  ['კავკასიის უნივერსიტეტი', 'cu', 'caucasus university'],
  ['თავისუფალი უნივერსიტეტი', 'freeuni', 'free university'],
  ['აგრარული უნივერსიტეტი', 'agruni', 'agricultural university']
];

// The limits of the mentor's choice.
const LIMITS = { extraFields: 2, directions: 5, specializations: 5, specializationMax: 30, otherMax: 60, universityMax: 100, currentRoleMax: 100 };

// ---- Looked up ------------------------------------------------------------------------------------------------------------------------------
const OTHER_CHIP = 'other';
const chipsOf = (field) => {
  const list = field.chips.map((x) => ({ ...x, id: `${field.id}.${x.key}`, niche: x.niche || field.niche, field: field.id }));
  return [...list, { key: OTHER_CHIP, id: `${field.id}.${OTHER_CHIP}`, ka: 'სხვა', en: 'Other', keywords: '', niche: field.niche, field: field.id, other: true }];
};
const FIELD = new Map(FIELDS.map((f) => [f.id, { ...f, chips: chipsOf(f) }]));
const CHIP = new Map([...FIELD.values()].flatMap((f) => f.chips.map((x) => [x.id, x])));
const fieldIds = () => [...FIELD.keys()];
const isField = (id) => FIELD.has(id);
const isChip = (id) => CHIP.has(id);
const isCountry = (id) => COUNTRIES.some((x) => x.id === id);
const fieldOfChip = (id) => (CHIP.has(id) ? CHIP.get(id).field : null);
const nameOf = (id, lang) => {
  const x = FIELD.get(id) || CHIP.get(id);
  return x ? (lang === 'ka' ? x.ka : x.en) : null;
};

// The niche a mentor's choice counts as, in one field. A regulated one wins: any chosen chip that needs a licence makes the field's niche that one; with no
// such chip, the first chip's, and with no chip the field's. (The rules themselves are in server/verification/rules.js.)
function nicheFor(fieldId, directions = []) {
  const field = FIELD.get(fieldId);
  if (!field) return null;
  const niches = require('./niches');
  const mine = directions.filter((d) => fieldOfChip(d) === fieldId && !CHIP.get(d).other).map((d) => CHIP.get(d).niche);
  return mine.find((n) => niches.isRegulated(n)) || mine[0] || field.niche;
}

// The other way: where a mentor with this niche belongs. -> { fieldId, chip } (chip may be null), or null when no field says so ("other", a niche an admin added).
// Written out, so the list of what an existing mentor becomes can be read in one place (docs/PLAN-CATEGORIES.md).
const FROM_NICHE = {
  medicine: ['med'], dentistry: ['med', 'med.dentistry'], veterinary: ['med', 'med.veterinary'], nutrition: ['med', 'med.nutrition'], pharmacy: ['med', 'med.pharmacy'], nursing: ['med', 'med.nurse'],
  tech: ['it'], data_ai: ['it', 'it.ai'], cybersecurity: ['it', 'it.cyber'], gaming: ['it', 'it.gamedev'],
  business: ['biz'], marketing: ['biz', 'biz.marketing'], careers_hr: ['biz', 'biz.hr'], ecommerce: ['biz', 'biz.ecommerce'], freelancing: ['biz'], real_estate: ['biz'],
  finance: ['fin'], accounting_tax: ['fin', 'fin.accounting'], law: ['law'], engineering: ['eng'], architecture: ['eng', 'eng.architecture'],
  science: ['sci'], languages: ['lang'], teaching: ['edu'], study_abroad: ['abroad'], psychology: ['psy'], parenting: ['psy', 'psy.child'], politics: ['pol'],
  design: ['art'], creative: ['art'], music: ['art', 'art.music'], film_photo: ['media', 'media.film'], writing: ['media', 'media.writing'],
  content_creation: ['media', 'media.content'], fitness: ['sport', 'sport.fitness'], sports_coaching: ['sport', 'sport.coaching'],
  tourism: ['svc', 'svc.tourism'], cooking: ['svc', 'svc.culinary'], wine_agriculture: ['svc', 'svc.agro']
};
function fromNiche(niche) {
  const hit = FROM_NICHE[niche];
  return hit ? { fieldId: hit[0], chip: hit[1] || null } : null;
}

// ---- Checking what a mentor chose ------------------------------------------------------------------------------------------------------------
// Level 3: trimmed, compared in lowercase, duplicates merged, no links or contact details. -> a list, or null when something is not allowed.
function cleanSpecializations(input) {
  const list = Array.isArray(input) ? input : String(input === null || input === undefined ? '' : input).split(',');
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (typeof raw !== 'string') return null;
    const tag = raw.normalize('NFKC').replace(/\s+/g, ' ').trim().replace(/^#/, '');
    if (!tag) continue;
    if ([...tag].length > LIMITS.specializationMax || /[@<>{}]|https?:|www\./i.test(tag)) return null;
    const key = tag.toLowerCase();
    if (!seen.has(key)) { seen.add(key); out.push(tag); }
  }
  return out.length > LIMITS.specializations ? null : out;
}

// ---- Counting and the pages ------------------------------------------------------------------------------------------------------------------
const CATEGORY_COLUMNS = 'field_id, extra_fields, directions';
// What the pages need: the names and ids (the keywords stay on the server), and how many listed mentors each has.
function forClient(counts = { fields: {}, chips: {} }) {
  return {
    fields: [...FIELD.values()].map((f) => ({
      id: f.id, icon: f.icon, ka: f.ka, en: f.en, count: counts.fields[f.id] || 0, regulated: require('./niches').isRegulated(f.niche),
      chips: f.chips.map((x) => ({ id: x.id, ka: x.ka, en: x.en, niche: x.niche, count: counts.chips[x.id] || 0, ...(x.other ? { other: true } : {}) }))
    })),
    countries: COUNTRIES.map(({ id, ka, en }) => ({ id, ka, en })),
    years: YEARS.map(({ id, ka, en }) => ({ id, ka, en })),
    limits: LIMITS
  };
}

async function counts() {
  const { query } = require('./db');
  const { listableSql } = require('./models');
  const { rows } = await query(`SELECT ${CATEGORY_COLUMNS} FROM users WHERE ${listableSql()}`);
  const fields = {};
  const chips = {};
  for (const r of rows) {
    for (const id of new Set([r.field_id, ...(r.extra_fields || [])].filter(Boolean))) fields[id] = (fields[id] || 0) + 1;
    for (const id of new Set(r.directions || [])) chips[id] = (chips[id] || 0) + 1;
  }
  return { fields, chips };
}

// ---- Existing mentors ------------------------------------------------------------------------------------------------------------------------
// Everybody with a niche and no field yet gets one, at each start (so it is safe to run again). Only the new columns are written: the niche, the approval and
// the licence are not touched, and an application is not reopened. "Other" and a niche an admin added: the mentor's own words are tried; if nothing fits the
// field stays empty and the admins see them (unmapped below). They stay listed either way.
async function mapExisting() {
  const { query } = require('./db');
  const suggest = require('./fieldSuggest');
  const { rows } = await query(`SELECT id, niche, extra_niches, custom_niche, role_title FROM users WHERE field_id IS NULL AND niche IS NOT NULL AND deleted_at IS NULL LIMIT 5000`);
  let mapped = 0;
  for (const u of rows) {
    const direct = fromNiche(u.niche);
    const guessed = direct || fromNiche(suggest.suggestField(u.custom_niche, u.role_title));
    if (!guessed) continue;
    const extras = (u.extra_niches || []).map(fromNiche).filter(Boolean);
    const extraFields = [...new Set(extras.map((e) => e.fieldId))].filter((f) => f !== guessed.fieldId).slice(0, LIMITS.extraFields);
    const directions = [...new Set([guessed.chip, ...extras.map((e) => e.chip)].filter(Boolean))].slice(0, LIMITS.directions);
    const { rowCount } = await query('UPDATE users SET field_id = $2, extra_fields = $3, directions = $4 WHERE id = $1 AND field_id IS NULL', [u.id, guessed.fieldId, extraFields, directions]);
    mapped += rowCount;
  }
  if (mapped) console.log(`[categories] ${mapped} mentor(s) got their field from their old category`);
  return mapped;
}

// ---- Admin ------------------------------------------------------------------------------------------------------------------------------------
async function forAdmin() {
  const { query } = require('./db');
  const [unmapped, tags, questions, listed] = await Promise.all([
    query(`SELECT id, name, email, niche, custom_niche, verification_status FROM users
            WHERE field_id IS NULL AND niche IS NOT NULL AND deleted_at IS NULL AND role IN ('mentor', 'both') ORDER BY created_at DESC LIMIT 200`),
    // (the most-used free tags, to promote into real chips later: compared in lowercase)
    query(`SELECT lower(t) AS tag, count(*)::int AS n FROM users, unnest(specialty_tags) AS t WHERE deleted_at IS NULL AND role IN ('mentor', 'both') GROUP BY 1 ORDER BY n DESC, tag LIMIT 50`),
    query(`SELECT direction_id, count(*)::int AS n FROM bookings WHERE direction_id IS NOT NULL AND status NOT IN ('pending_payment', 'expired') GROUP BY 1 ORDER BY n DESC LIMIT 200`),
    counts()
  ]);
  return {
    unmapped: unmapped.rows.map((r) => ({ id: r.id, name: r.name, email: r.email, niche: r.niche, customNiche: r.custom_niche, status: r.verification_status })),
    tags: tags.rows,
    questions: questions.rows.map((r) => ({ id: r.direction_id, n: r.n })),
    fields: [...FIELD.values()].map((f) => ({ id: f.id, ka: f.ka, en: f.en, mentors: listed.fields[f.id] || 0 })),
    chips: [...CHIP.values()].filter((x) => listed.chips[x.id]).map((x) => ({ id: x.id, ka: x.ka, en: x.en, mentors: listed.chips[x.id] }))
  };
}

module.exports = {
  FIELDS, COUNTRIES, YEARS, LIMITS, UNIVERSITY_ALIASES, FROM_NICHE, FIELD, CHIP, fieldIds, isField, isChip, isCountry, fieldOfChip, nameOf, nicheFor, fromNiche, yearsBand,
  cleanSpecializations, forClient, counts, mapExisting, forAdmin
};
