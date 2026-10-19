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
const WORDS = [
  ['data_ai', ['data scien', 'data analy', 'machine learning', 'deep learning', 'artificial intelligence', '=ai', 'analytics', 'statistic', 'big data'],
    ['მონაცემ', 'ხელოვნური ინტელექტ', 'მანქანური სწავლ', 'ანალიტიკ', 'სტატისტიკ']],
  ['cybersecurity', ['cybersecurity', 'cyber security', 'infosec', 'information security', 'pentest', 'penetration test', 'ethical hack'],
    ['კიბერუსაფრთხოებ', 'კიბერ', 'ინფორმაციული უსაფრთხოებ']],
  ['gaming', ['gaming', 'esport', 'e-sport', 'game design', 'game develop', 'video game'], ['გეიმინგ', 'კიბერსპორტ', 'ვიდეოთამაშ', 'კომპიუტერული თამაშ']],
  ['ecommerce', ['e-commerce', 'ecommerce', 'online store', 'online shop', 'shopify', 'dropshipping', 'etsy', 'amazon seller'],
    ['ელექტრონული კომერც', 'ონლაინ მაღაზი', 'ინტერნეტ მაღაზი', 'ონლაინ ვაჭრობ']],
  ['content_creation', ['content creat', 'youtube', 'tiktok', 'instagram', 'influencer', 'blogger', 'vlog', 'podcast', 'social media'],
    ['კონტენტ', 'იუთუბ', 'ტიკტოკ', 'ინსტაგრამ', 'ბლოგერ', 'ვლოგ', 'პოდკასტ', 'სოციალური მედი', 'ინფლუენსერ']],
  ['study_abroad', ['study abroad', 'studying abroad', 'abroad', 'scholarship', 'erasmus', 'student visa', 'ielts', 'toefl', '=gre', 'admission',
    'master\'s in', 'masters in', 'master in', 'phd in', 'study in'],
  ['საზღვარგარეთ', 'უცხოეთ', 'სტიპენდი', 'ერასმუს', 'სტუდენტური ვიზ', 'მაგისტრატურ', 'დოქტორანტურ', 'გერმანიაში', 'ამერიკაში', 'ინგლისში', 'ბრიტანეთში',
    'ევროპაში', 'საფრანგეთში', 'იტალიაში', 'ნიდერლანდებში', 'ავსტრიაში', 'ესპანეთში', 'ჩეხეთში', 'პოლონეთში', 'კანადაში', 'თურქეთში']],
  ['careers_hr', ['career', '=hr', 'human resource', 'recruit', 'job search', 'job interview', '=cv', 'resume', 'hiring', 'talent'],
    ['კარიერ', 'ადამიანური რესურს', 'რეკრუტ', 'დასაქმებ', 'რეზიუმე', 'გასაუბრებ']],
  ['freelancing', ['freelanc', 'upwork', 'fiverr', 'remote work'], ['ფრილანს', 'დისტანციური სამუშაო']],
  ['marketing', ['marketing', 'brand', 'advertis', '=seo', '=smm', '=pr', 'public relations', 'growth hack', 'copywrit'],
    ['მარკეტინგ', 'ბრენდ', 'რეკლამ', 'პიარ', 'საზოგადოებასთან ურთიერთობ', 'კოპირაიტ']],
  ['tech', ['software', 'programm', 'developer', 'web develop', 'frontend', 'front-end', 'backend', 'back-end', 'coding', 'information technolog', 'computer',
    'javascript', 'python', '=java', 'devops', 'cloud', '=qa', 'mobile app', 'product manag', 'bootcamp'],
  ['პროგრამირ', 'პროგრამისტ', 'დეველოპ', 'კოდინგ', 'ბუტქემპ', 'ტექნოლოგ', 'კომპიუტერ', 'ვებ-', 'ვებგვერდ', 'აიტი', 'პროგრამული']],
  ['design', ['design', '=ux', '=ui', 'graphic', 'interior', 'fashion', 'figma'], ['დიზაინ', 'გრაფიკ', 'ინტერიერ']],
  ['architecture', ['architect', 'urban plan'], ['არქიტექტ', 'ურბანისტ', 'ქალაქთმშენებლ']],
  ['engineering', ['engineer', 'mechanical', 'electrical', 'civil engineering', 'construction', 'energy', 'manufactur'],
    ['ინჟინერ', 'მშენებლ', 'ენერგეტიკ', 'ელექტრო', 'მექანიკ', 'წარმოებ']],
  ['wine_agriculture', ['wine', 'winemak', 'vineyard', 'agricultur', 'farming', 'farm', 'beekeep', 'agronom', 'viticultur'],
    ['ღვინ', 'მევენახ', 'ვენახ', 'სოფლის მეურნეობ', 'ფერმ', 'აგრონომ', 'მეფუტკრ', 'მარან', 'მეღვინ']],
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
    ['მწერალ', 'ჟურნალისტ', 'რედაქტორ', 'პოეზი', 'პოეტ', 'რომან', 'გამომცემ', 'ლიტერატურ', 'წიგნ']],
  ['creative', ['=art', 'artist', 'painting', 'painter', 'craft', 'handmade', 'illustrat', 'sculpt', 'ceramic'], ['ხელოვნ', 'მხატვ', 'ხატვ', 'ხელნაკეთ', 'ილუსტრაც', 'ქანდაკ', 'კერამიკ']],
  ['science', ['science', 'scientist', 'research', 'physics', 'physicist', 'chemistry', 'chemist', 'biolog', 'mathemat', '=math', 'geolog', 'astronom', 'ecolog',
    'histor', 'philosoph', 'sociolog', 'political scien', 'anthropolog', 'archaeolog', 'linguistics'],
    ['მეცნიერ', 'კვლევ', 'მკვლევ', 'ფიზიკ', 'ქიმი', 'ბიოლოგ', 'მათემატიკ', 'გეოლოგ', 'ასტრონომ', 'ეკოლოგ', 'ისტორი', 'ფილოსოფ', 'სოციოლოგ', 'პოლიტოლოგ', 'ანთროპოლოგ', 'არქეოლოგ']],
  ['business', ['business', 'entrepreneur', 'startup', 'start-up', 'management', 'manager', '=ceo', 'founder', 'econom', 'macroeconom', 'microeconom', 'sales',
    'strategy', 'consult', '=mba', 'logistic', 'supply chain', 'retail', 'small business'],
  ['ბიზნეს', 'მეწარმ', 'სტარტაპ', 'მენეჯმენტ', 'მენეჯერ', 'ეკონომიკ', 'ეკონომისტ', 'გაყიდვ', 'სტრატეგ', 'კონსულტ', 'ლოჯისტიკ', 'დირექტორ', 'კომპანი']],
  ['teaching', ['teach', 'tutor', 'pedagog', 'school', '=exam', '=exams', 'olympiad', 'education', '~professor', '~lecturer', '~universit', '~academ', '~docent'],
    ['მასწავლ', 'სწავლებ', 'რეპეტიტორ', 'პედაგოგ', 'სკოლ', 'გამოცდ', 'ოლიმპიად', 'განათლებ', '~პროფესორ', '~ლექტორ', '~უნივერსიტეტ', '~აკადემიურ', '~დოცენტ']]
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

// -> the key of the closest active category, or null when nothing fits (the mentor then picks one, or "Other").
function suggestField(...texts) {
  const text = texts.filter((t) => typeof t === 'string' && t.trim()).join(' \n ').normalize('NFKC').slice(0, 3000);
  if (!text) return null;
  const regulated = regulatedCategoryIn(text);
  if (regulated && niches().isValid(regulated)) return regulated;
  const lower = text.toLowerCase();
  let best = null;
  for (const r of RULES) {
    if (!niches().isValid(r.niche)) continue;
    let strong = 0;
    let weak = 0;
    for (const w of r.en) if (w.re.test(lower)) { if (w.weak) weak += 1; else strong += 1; }
    for (const w of r.ka) if (lower.includes(w.stem)) { if (w.weak) weak += 1; else strong += 1; }
    const score = strong * 10 + weak;
    if (score && (!best || score > best.score)) best = { niche: r.niche, score };
  }
  if (best && best.score >= 10) return best.niche;
  // The categories' own names (a category an admin added has no words above), then the weak hints.
  for (const n of niches().active()) {
    if (niches().isRegulated(n.key)) continue;
    if ([n.en, n.ka].some((name) => name && name.length >= 3 && lower.includes(name.toLowerCase()))) return n.key;
  }
  return best ? best.niche : null;
}

module.exports = { suggestField, WORDS };
