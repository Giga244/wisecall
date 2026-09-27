-- Niches move from code to the database: the 14 that exist, 22 new ones, and "Other (type your own)".
-- ADDITIVE ONLY: a new table and one new column; no existing row changes. Undo: migrations/down/019_niches.down.sql.
-- Which niches are REGULATED (never approved automatically; a licence is required) is decided by server/verification/registries.js, with
-- the sources; the regulated flag here mirrors it for the admin panel and for niches an admin creates later.
CREATE TABLE niches (
  key           text        PRIMARY KEY CHECK (key ~ '^[a-z][a-z0-9_]{1,30}$' AND key <> 'other' AND key <> 'all' AND key <> 'any'),
  name_en       text        NOT NULL CHECK (length(name_en) BETWEEN 2 AND 60),
  name_ka       text        NOT NULL CHECK (length(name_ka) BETWEEN 2 AND 60),
  icon          text        NOT NULL DEFAULT 'spark',     -- a name from the site's icon set (public/js/niche-icons.js)
  regulated     boolean     NOT NULL DEFAULT false,
  sort          smallint    NOT NULL DEFAULT 1000,
  active        boolean     NOT NULL DEFAULT true,        -- inactive: not offered to new mentors or in lists; existing mentors keep it
  promoted_from text,                                     -- the "Other" label it was created from, if an admin promoted one
  created_by    uuid        REFERENCES users (id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

INSERT INTO niches (key, name_en, name_ka, icon, regulated, sort) VALUES
  -- the 14 that exist today (names as on the site now)
  ('business',         'Business',                        'ბიზნესი',                                  'business',    false,  10),
  ('medicine',         'Medicine',                        'მედიცინა',                                 'medicine',    true,   20),
  ('law',              'Law',                             'სამართალი',                                'law',         true,   30),
  ('finance',          'Finance',                         'ფინანსები',                                'finance',     true,   40),
  ('tech',             'Tech',                            'ტექნოლოგია',                               'tech',        false,  50),
  ('teaching',         'Teaching',                        'სწავლება',                                 'teaching',    false,  60),
  ('fitness',          'Fitness',                         'ფიტნესი',                                  'fitness',     false,  70),
  ('creative',         'Creative',                        'კრეატიული',                                'creative',    false,  80),
  ('marketing',        'Marketing',                       'მარკეტინგი',                               'marketing',   false,  90),
  ('design',           'Design',                          'დიზაინი',                                  'design',      false, 100),
  ('writing',          'Writing',                         'წერა',                                     'writing',     false, 110),
  ('parenting',        'Parenting',                       'მშობლობა',                                 'parenting',   false, 120),
  ('engineering',      'Engineering',                     'ინჟინერია',                                'engineering', false, 130),
  ('science',          'Science',                         'მეცნიერება',                               'science',     false, 140),
  -- new (the Georgian names are drafts for the native-speaker review)
  ('study_abroad',     'Studying abroad',                 'საზღვარგარეთ სწავლა',                      'plane',       false, 150),
  ('careers_hr',       'Careers & HR',                    'კარიერა და HR',                            'briefcase',   false, 160),
  ('psychology',       'Psychology & wellbeing',          'ფსიქოლოგია და კეთილდღეობა',                'heart',       true,  170),
  ('real_estate',      'Real estate',                     'უძრავი ქონება',                            'house',       false, 180),
  ('tourism',          'Tourism & hospitality',           'ტურიზმი და სტუმარმასპინძლობა',             'map',         false, 190),
  ('wine_agriculture', 'Wine & agriculture',              'ღვინო და სოფლის მეურნეობა',                'grape',       false, 200),
  ('accounting_tax',   'Accounting & tax',                'ბუღალტერია და გადასახადები',               'calculator',  true,  210),
  ('architecture',     'Architecture',                    'არქიტექტურა',                              'building',    false, 220),
  ('languages',        'Languages & translation',         'ენები და თარგმანი',                        'languages',   false, 230),
  ('film_photo',       'Film & photography',              'კინო და ფოტოგრაფია',                       'camera',      false, 240),
  ('music',            'Music',                           'მუსიკა',                                   'music',       false, 250),
  ('cooking',          'Cooking',                         'კულინარია',                                'chef',        false, 260),
  ('sports_coaching',  'Sports coaching',                 'სპორტული მწვრთნელობა',                     'whistle',     false, 270),
  ('dentistry',        'Dentistry',                       'სტომატოლოგია',                             'tooth',       true,  280),
  ('pharmacy',         'Pharmacy',                        'ფარმაცია',                                 'pill',        true,  290),
  ('nursing',          'Nursing',                         'საექთნო საქმე',                            'nurse',       true,  300),
  ('ecommerce',        'E-commerce',                      'ელექტრონული კომერცია',                     'cart',        false, 310),
  ('freelancing',      'Freelancing',                     'ფრილანსი',                                 'laptop',      false, 320),
  ('content_creation', 'Content creation & social media', 'კონტენტის შექმნა და სოციალური მედია',      'video',       false, 330),
  ('gaming',           'Gaming & esports',                'გეიმინგი და კიბერსპორტი',                  'gamepad',     false, 340),
  ('cybersecurity',    'Cybersecurity',                   'კიბერუსაფრთხოება',                         'shield',      false, 350),
  ('data_ai',          'Data & AI',                       'მონაცემები და ხელოვნური ინტელექტი',        'chip',        false, 360)
ON CONFLICT (key) DO NOTHING;

-- "Other (type your own)": users.niche = 'other' and the mentor's own words here. Admins see these grouped as "Suggested niches" and can
-- promote a suggestion to a real niche (the mentors who typed it move into it) or move them into an existing one.
ALTER TABLE users ADD COLUMN custom_niche text CHECK (custom_niche IS NULL OR length(custom_niche) BETWEEN 3 AND 40);
CREATE INDEX users_custom_niche_idx ON users (lower(custom_niche)) WHERE niche = 'other';
