// Contact details stay on Wisecall: what the filter on questions and answers stops, and what it must let through (docs/CLAUDE-CODE-ASKERS-16-PLUS.md part 4).
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { findBlockedContact } = require('../server/textSafety');

const STOPPED = [
  // Georgian phone numbers
  ['დამიკავშირდი 555 12 34 56', 'phone'],
  ['ჩემი ნომერია 555123456', 'phone'],
  ['+995 555 12 34 56 ზე დამირეკე', 'phone'],
  ['995555123456', 'phone'],
  ['555-12-34-56', 'phone'],
  ['555 123 456', 'phone'],
  ['(555) 12 34 56', 'phone'],
  ['ოფისი: 032 2 12 34 56', 'phone'],
  // international
  ['Call +44 20 7946 0958 after six', 'phone'],
  ['My US number is +1 (415) 555-2671', 'phone'],
  ['0044 20 7946 0958 is my office', 'phone'],
  // emails
  ['Write to nino.beridze@gmail.com please', 'email'],
  ['მომწერე nino@wisecall.ge-ზე', 'email'],
  ['nino (at) example (dot) com', 'email'],
  ['nino at gmail', 'email'],
  // handles
  ['Find me: @nino_beridze', 'handle'],
  ['ჩემი გვერდი @ninoberidze', 'handle'],
  // links to social networks and messengers
  ['https://www.facebook.com/nino.beridze', 'social_link'],
  ['instagram.com/nino', 'social_link'],
  ['see www.tiktok.com/@nino', 'social_link'],
  ['t.me/ninoberidze', 'social_link'],
  ['https://wa.me/995555123456', 'social_link'],
  ['invite: discord.gg/abc123', 'social_link'],
  ['viber://chat?number=995555', 'social_link'],
  ['snapchat.com/add/nino', 'social_link'],
  ['linkedin.com/in/nino-beridze', 'social_link'],
  // an invitation to a messenger
  ['Write me on Telegram and we can talk', 'contact_invite'],
  ['message me on whatsapp', 'contact_invite'],
  ['my instagram has more', 'contact_invite'],
  ['DM me tomorrow', 'contact_invite'],
  ['ვაიბერზე მომწერე', 'contact_invite'],
  ['ტელეგრამში გიპასუხებ', 'contact_invite'],
  ['მომწერე ინსტაგრამზე', 'contact_invite'],
  // the phrases, with digits
  ['დამირეკე 599', 'contact_phrase'],
  ['მომწერე ამ ნომერზე: 577', 'contact_phrase'],
  ['ნომერი 5991', 'contact_phrase'],
  ['call me 598 1', 'contact_phrase']
];

// What must get through in every mode, for everybody.
const LET_THROUGH = [
  '7 დღეში გიპასუხებ.',
  '5 ლარი ღირს ეს კურსი.',
  'სწავლის საფასური 2 250 ლარია წელიწადში.',
  'The fee is 1 500 000 GEL for the whole building.',
  'I studied from 2023 to 2025 at Ilia State University.',
  '2023 2024 2025 were the hardest years.',
  'The exam is on 12.05.2026, and the results come on 2026-06-30.',
  'IELTS 7.5 and GPA 3.8 are enough for most programmes.',
  'Read https://www.tsu.ge/en/faculties and the page at https://example.org/how-to-apply',
  'See netflix.com and box.com for how they hire.',
  'We looked at grades. Then we looked at the interview notes.',
  'You should look at tsu.ge for the programmes.',
  'Many students find internships on LinkedIn, so keep your profile current.',
  'How do I start a career in TikTok marketing and Instagram advertising?',
  'ინსტაგრამის მარკეტინგი კარგი პროფესიაა დამწყებისთვის.',
  'ფეისბუქის რეკლამის სპეციალისტი როგორ გავხდე?',
  'მე-51 სკოლა დავამთავრე და ნომერი 51 მეტყობა ატესტატზე.',
  'მომწერე, თუ კითხვა გაგიჩნდება, აქ, Wisecall-ზე.',
  'Call me old fashioned, but a degree still matters.',
  'In Java you write @Override above the method, and in CSS @media for screen sizes.',
  'ასეთი ნომერი 2024 წელს გამოვიდა.'
];

describe('the contact filter', () => {
  assert.ok(STOPPED.length + LET_THROUGH.length >= 30, 'at least 30 strings');

  for (const [text, kind] of STOPPED) {
    test(`stops: ${text}`, () => {
      assert.ok(findBlockedContact(text).includes(kind), `${kind} in ${JSON.stringify(findBlockedContact(text))}`);
      assert.ok(findBlockedContact(text, { strict: true }).includes(kind), 'and when the asker is a minor');
    });
  }
  for (const text of LET_THROUGH) {
    test(`lets through: ${text}`, () => {
      assert.deepEqual(findBlockedContact(text), []);
    });
    test(`lets through for a minor too: ${text}`, () => {
      assert.deepEqual(findBlockedContact(text, { strict: true }), []);
    });
  }

  describe('only when the asker is 16-17', () => {
    const STRICT = [
      ['Do you use Telegram?', 'messenger'],
      ['ვაიბერი გაქვს?', 'messenger'],
      ['I only check my gmail at night', 'email'],
      ['ჯიმეილი მაქვს', 'email'],
      ['My number is 2 12 34 56', 'phone'],
      ['five five five one two three four', 'spelled_number'],
      ['ხუთი ხუთი ხუთი ერთი ორი სამი ოთხი', 'spelled_number']
    ];
    for (const [text, kind] of STRICT) {
      test(`stops for a minor: ${text}`, () => {
        assert.ok(findBlockedContact(text, { strict: true }).includes(kind), JSON.stringify(findBlockedContact(text, { strict: true })));
      });
    }
    test('an answer to an adult may name a messenger or an email provider in passing', () => {
      assert.deepEqual(findBlockedContact('Companies use Telegram and Gmail for this, so learn both.'), []);
    });
  });

  test('invisible characters do not hide anything', () => {
    assert.ok(findBlockedContact('t​.me/nino').includes('social_link'));
    assert.ok(findBlockedContact('555​123456').includes('phone'));
  });
});
