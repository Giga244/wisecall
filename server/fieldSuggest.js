// The closest category for a field written in someone's own words ("Associate professor of economics", "ქართული ღვინის დაყენება"), so a
// new mentor types one line and never has to read the whole list of categories first (docs/CLAUDE-CODE-UX-WALKTHROUGH.md A2). It is
// only a suggestion: the mentor can change it with one tap, and the home page uses it to pre-fill the waiting list's field.
//
// A regulated category is suggested only when the words name the profession itself (server/fieldRules.js): "personal finance" is not a
// licensed financial adviser, "doctor" is. Everything else comes from the topic words below, then from the categories' own names.
const niches = () => require('./niches');
const { regulatedCategoryIn } = require('./fieldRules');

// category -> words. English words match at the start of a word ("programm" finds programmer and programming; "=ai" only the whole
// word); Georgian stems match anywhere (any ending). A word that starts with "~" is a weak hint (a professor or a university says
// little about the subject): any real topic word wins over it. Order matters on a tie: the more specific categories come first.
// The regulated categories have topic words too ("clinic", "banking"): they are offered among the choices (suggestFields), but one is
// chosen by itself only when the words name the profession (server/fieldRules.js).
const WORDS = [
  ['psychology', ['psycholog', 'mental health', 'therap', 'counsell'], ['ფსიქოლოგ', 'ფსიქიკურ', 'ფსიქოთერაპ', 'თერაპევტ']],
  ['medicine', ['medic', 'clinic', 'healthcare', 'health care', 'hospital'], ['მედიც', 'კლინიკ', 'ჯანდაცვ', 'საავადმყოფ', 'ექიმ']],
  ['dentistry', ['dental', 'teeth', 'tooth'], ['სტომატ', 'კბილ']],
  ['pharmacy', ['pharma', 'medicines'], ['ფარმაც', 'წამლ', 'აფთიაქ']],
  ['nursing', ['nursing'], ['საექთნო', 'ექთნ']],
  ['law', ['=law', '=laws', 'legal', 'jurispruden', 'court'], ['სამართ', 'იურიდ', 'იურისტ', 'ადვოკატ', 'კანონმდებლ', 'სასამართლ']],
  ['accounting_tax', ['accounting', 'bookkeep', 'audit', '=tax', 'taxes', 'taxation', '=ifrs'], ['ბუღალტ', 'აუდიტ', 'გადასახად']],
  ['finance', ['financ', '=bank', 'banking', 'banker', 'invest', 'stock market', 'trading', 'crypto'], ['ფინანს', 'ბანკ', 'საბანკო', 'ინვესტ', 'კრიპტო', 'ტრეიდინგ', 'ბირჟ']],
  ['data_ai', ['data scien', 'data analy', 'machine learning', 'deep learning', 'artificial intelligence', '=ai', 'analytics', 'statistic', 'big data'],
    ['მონაცემ', 'ხელოვნური ინტელექტ', 'მანქანური სწავლ', 'ანალიტიკ', 'სტატისტიკ']],
  ['cybersecurity', ['cybersecurity', 'cyber security', 'infosec', 'information security', 'pentest', 'penetration test', 'ethical hack'],
    ['კიბერუსაფრთხოებ', 'კიბერ', 'ინფორმაციული უსაფრთხოებ']],
  ['gaming', ['gaming', 'esport', 'e-sport', 'game design', 'game develop', 'video game'], ['გეიმინგ', 'კიბერსპორტ', 'ვიდეოთამაშ', 'კომპიუტერული თამაშ']],
  ['ecommerce', ['e-commerce', 'ecommerce', 'online store', 'online shop', 'shopify', 'dropshipping', 'etsy', 'amazon seller'],
    ['ელექტრონული კომერც', 'ონლაინ მაღაზი', 'ინტერნეტ მაღაზი', 'ონლაინ ვაჭრობ']],
  ['content_creation', ['content creat', 'youtube', 'tiktok', 'instagram', 'influencer', 'blogger', 'vlog', 'podcast', 'social media', '=media'],
    ['მედია', 'მედიის', 'მედიაში', 'კონტენტ', 'იუთუბ', 'ტიკტოკ', 'ინსტაგრამ', 'ბლოგერ', 'ვლოგ', 'პოდკასტ', 'სოციალური მედი', 'ინფლუენსერ']],
  ['study_abroad', ['study abroad', 'studying abroad', 'abroad', 'scholarship', 'erasmus', 'student visa', 'ielts', 'toefl', '=gre', 'admission',
    'master\'s in', 'masters in', 'master in', 'phd in', 'study in', '=grant', '=grants'],
  ['საზღვარგარეთ', 'უცხოეთ', 'სტიპენდ', 'გრანტ', 'ერასმუს', 'სტუდენტური ვიზ', 'მაგისტრატურ', 'დოქტორანტურ', 'გერმანიაში', 'ამერიკაში', 'ინგლისში', 'ბრიტანეთში',
    'ევროპაში', 'საფრანგეთში', 'იტალიაში', 'ნიდერლანდებში', 'ავსტრიაში', 'ესპანეთში', 'ჩეხეთში', 'პოლონეთში', 'კანადაში', 'თურქეთში']],
  ['careers_hr', ['career', '=hr', 'human resource', 'recruit', 'job search', 'job interview', '=cv', 'resume', 'hiring', 'talent'],
    ['კარიერ', 'ადამიანური რესურს', 'რეკრუტ', 'დასაქმებ', 'რეზიუმე', 'გასაუბრებ']],
  ['freelancing', ['freelanc', 'upwork', 'fiverr', 'remote work'], ['ფრილანს', 'დისტანციური სამუშაო']],
  ['marketing', ['marketing', 'brand', 'advertis', '=seo', '=smm', '=pr', 'public relations', 'growth hack', 'copywrit'],
    ['მარკეტინგ', 'სმმ', 'ბრენდ', 'რეკლამ', 'პიარ', 'საზოგადოებასთან ურთიერთობ', 'კოპირაიტ']],
  ['tech', ['software', 'programm', 'developer', 'web develop', 'frontend', 'front-end', 'backend', 'back-end', 'coding', 'information technolog', 'computer',
    'javascript', 'python', '=java', 'devops', 'cloud', '=qa', 'mobile app', 'product manag', 'bootcamp'],
  ['პროგრამირ', 'პროგრამისტ', 'პროგრამებ', 'დეველოპ', 'კოდინგ', 'ბუტქემპ', 'ტექნოლოგ', 'კომპიუტერ', 'ვებ-', 'ვებგვერდ', 'აიტი', 'პროგრამული']],
  ['design', ['design', '=ux', '=ui', 'graphic', 'interior', 'fashion', 'figma'], ['დიზაინ', 'გრაფიკ', 'ინტერიერ']],
  ['architecture', ['architect', 'urban plan'], ['არქიტექტ', 'ურბანისტ', 'ქალაქთმშენებლ']],
  ['engineering', ['engineer', 'mechanical', 'electrical', 'civil engineering', 'construction', 'energy', 'manufactur'],
    ['ინჟინერ', 'მშენებლ', 'ენერგეტიკ', 'ელექტრო', 'მექანიკ', 'წარმოებ']],
  ['wine_agriculture', ['wine', 'winemak', 'vineyard', 'agricultur', 'agro', 'farming', 'farm', 'beekeep', 'agronom', 'viticultur'],
    ['ღვინ', 'აგრო', 'მევენახ', 'ვენახ', 'სოფლის მეურნეობ', 'ფერმ', 'აგრონომ', 'მეფუტკრ', 'მარან', 'მეღვინ']],
  ['real_estate', ['real estate', 'property', 'realtor', 'mortgage', 'apartment'], ['უძრავ', 'რიელტორ', 'იპოთეკ', 'ბინის', 'ბინებ']],
  ['tourism', ['touris', 'travel', 'hotel', 'hospitality', 'tour guide'], ['ტურიზმ', 'ტურისტ', 'მოგზაურ', 'სასტუმრ', 'სტუმარმასპინძლ']],
  ['cooking', ['cooking', '=cook', 'chef', 'baking', 'pastry', 'cuisine', 'recipe', 'culinar'], ['კულინარ', 'მზარეულ', 'შეფ-მზარეულ', 'ცხობ', 'კონდიტ', 'სამზარეულ']],
  ['music', ['music', 'singer', 'singing', 'guitar', 'piano', 'composer', 'violin'], ['მუსიკ', 'მომღერ', 'გიტარ', 'ფორტეპიან', 'კომპოზიტ', 'სიმღერ', 'ვიოლინო']],
  ['film_photo', ['film', 'cinema', 'photograph', 'video product', 'videograph', 'filmmak', 'camera'], ['კინო', 'ფოტო', 'რეჟისორ', 'ვიდეოგრაფ', 'მონტაჟ', 'ოპერატორ']],
  ['sports_coaching', ['football', 'soccer', 'basketball', 'rugby', 'tennis', 'wrestl', 'judo', 'swimming', 'athlet', 'sport'],
    ['სპორტ', 'ფეხბურთ', 'კალათბურთ', 'რაგბ', 'ჩოგბურთ', 'ჭიდაობ', 'ძიუდო', 'ცურვ', 'ათლეტ']],
  ['fitness', ['fitness', '=gym', 'personal train', 'workout', 'weight loss', 'yoga', 'pilates', 'bodybuild', 'nutrition'],
    ['ფიტნეს', 'ვარჯიშ', 'სავარჯიშო', 'იოგ', 'პილატეს', 'კვებ', 'წონის']],
  ['parenting', ['parent', 'mother', 'father', 'child', 'baby', 'babies', '=kids', 'pregnan', 'family'], ['მშობლებ', 'მშობლობ', 'დედობ', 'მამობ', 'ბავშვ', 'ჩვილ', 'ორსულ', 'ოჯახ']],
  ['languages', ['language', 'translat', 'interpret', 'linguist', 'english', 'german', 'french', 'russian', 'georgian language'],
    ['თარგმ', 'თარჯიმ', 'ინგლისურ', 'გერმანულ', 'ფრანგულ', 'რუსულ', 'ლინგვისტ', 'ენათმეცნიერ', 'ენების', 'ენის']],
  ['writing', ['writing', 'writer', '=author', '=authors', 'journalis', 'editor', 'poet', 'novel', 'publish', 'literatur'],
    ['მწერალ', 'ჟურნალისტ', 'ჟურნალისტიკ', 'რედაქტორ', 'პოეზი', 'პოეტ', 'რომან', 'გამომცემ', 'ლიტერატურ', 'წიგნ']],
  ['creative', ['=art', 'artist', 'painting', 'painter', 'craft', 'handmade', 'illustrat', 'sculpt', 'ceramic'], ['ხელოვნ', 'მხატვ', 'ხატვ', 'ხელნაკეთ', 'ილუსტრაც', 'ქანდაკ', 'კერამიკ']],
  ['science', ['science', 'scientist', 'research', 'physics', 'physicist', 'chemistry', 'chemist', 'biolog', 'mathemat', '=math', 'geolog', 'astronom', 'ecolog',
    'histor', 'philosoph', 'sociolog', 'political scien', 'anthropolog', 'archaeolog', 'linguistics'],
    ['მეცნიერ', 'კვლევ', 'მკვლევ', 'ფიზიკ', 'ქიმი', 'ბიოლოგ', 'მათემატიკ', 'გეოლოგ', 'ასტრონომ', 'ეკოლოგ', 'ისტორი', 'ფილოსოფ', 'სოციოლოგ', 'პოლიტოლოგ', 'ანთროპოლოგ', 'არქეოლოგ']],
  ['business', ['business', 'entrepreneur', 'startup', 'start-up', 'management', 'manager', '=ceo', 'founder', 'econom', 'macroeconom', 'microeconom', 'sales',
    'strategy', 'consult', '=mba', 'logistic', 'supply chain', 'retail', 'small business'],
  ['ბიზნეს', 'მეწარმ', 'სტარტაპ', 'მენეჯმენტ', 'მენეჯერ', 'ეკონომიკ', 'ეკონომისტ', 'გაყიდვ', 'სტრატეგ', 'კონსულტ', 'ლოჯისტიკ', 'დირექტორ', 'კომპანი']],
  ['teaching', ['teach', 'tutor', 'pedagog', 'school', '=exam', '=exams', 'olympiad', 'education', '~professor', '~lecturer', '~universit', '~academ', '~docent'],
    ['მასწავლ', 'სწავლებ', 'რეპეტიტორ', 'პედაგოგ', 'აღზრდ', 'დიდაქტიკ', 'სკოლ', 'გამოცდ', 'ოლიმპიად', 'განათლებ', '~პროფესორ', '~ლექტორ', '~უნივერსიტეტ', '~აკადემიურ', '~დოცენტ']]
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const RULES = WORDS.map(([niche, en, ka]) => ({
  niche,
  en: en.map((w) => {
    const weak = w.startsWith('~');
    const word = w.replace(/^[~=]/, '');
    const whole = w.startsWith('=');
    return { weak, re: new RegExp(`(?:^|[^a-z])${escapeRe(word).replace(/ /g, '\\s+')}${whole ? '(?![a-z])' : ''}`, 'i') };
  }),
  ka: ka.map((w) => ({ weak: w.startsWith('~'), stem: w.replace(/^~/, '').toLowerCase() }))
}));

const textOf = (texts) => texts.filter((t) => typeof t === 'string' && t.trim()).join(' \n ').normalize('NFKC').slice(0, 3000);
// Every active category the words touch, best first: [{ niche, score }] (10 for each topic word, 1 for each weak hint).
function scored(text) {
  const lower = text.toLowerCase();
  const out = [];
  RULES.forEach((r, order) => {
    if (!niches().isValid(r.niche)) return;
    let strong = 0;
    let weak = 0;
    for (const w of r.en) if (w.re.test(lower)) { if (w.weak) weak += 1; else strong += 1; }
    for (const w of r.ka) if (lower.includes(w.stem)) { if (w.weak) weak += 1; else strong += 1; }
    // ("IT" in capitals is the field; "it" is a word)
    if (r.niche === 'tech' && /(?:^|[^A-Za-z])IT(?![A-Za-z])/.test(text)) strong += 1;
    const score = strong * 10 + weak;
    if (score) out.push({ niche: r.niche, score, order });
  });
  return out.sort((a, b) => b.score - a.score || a.order - b.order);
}

// -> the key of the closest active category, or null when nothing fits (the mentor then picks one, or "Other").
function suggestField(...texts) {
  const text = textOf(texts);
  if (!text) return null;
  const regulated = regulatedCategoryIn(text);
  if (regulated && niches().isValid(regulated)) return regulated;
  const lower = text.toLowerCase();
  // (a regulated category is not chosen from topic words alone: "personal finance" is not a financial adviser)
  const best = scored(text).filter((s) => !niches().isRegulated(s.niche))[0] || null;
  if (best && best.score >= 10) return best.niche;
  // The categories' own names (a category an admin added has no words above), then the weak hints.
  for (const n of niches().active()) {
    if (niches().isRegulated(n.key)) continue;
    if ([n.en, n.ka].some((name) => name && name.length >= 3 && lower.includes(name.toLowerCase()))) return n.key;
  }
  return best ? best.niche : null;
}

// The choices shown as chips under "Your field" (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 3): up to n categories, the one
// suggestField picks first, then the others the words touch, best first ("Other" is always offered after them by the page).
function suggestFields(n, ...texts) {
  const text = textOf(texts);
  if (!text) return [];
  const first = suggestField(text);
  const keys = [first, regulatedCategoryIn(text), ...scored(text).map((s) => s.niche)] // (topic words first, then the weak hints)
    .filter((k) => k && niches().isValid(k));
  return [...new Set(keys)].slice(0, n);
}

module.exports = { suggestField, suggestFields, WORDS };
