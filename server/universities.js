// Georgian universities we recognise by their web address (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md parts 2 and 4): a lecturer's
// page on one of these is "a university page" in the application, and, once checked, gives the "university lecturer" badge. A page on
// another university (any .edu or ac. address) still counts as a university page, without a name.
//   domain: the address and every sub-address (staff.tsu.ge, www.tsu.ge, ...)
const LIST = [
  { domain: 'tsu.ge', en: 'Tbilisi State University', ka: 'თბილისის სახელმწიფო უნივერსიტეტი' },
  { domain: 'iliauni.edu.ge', en: 'Ilia State University', ka: 'ილიას სახელმწიფო უნივერსიტეტი' },
  { domain: 'ug.edu.ge', en: 'University of Georgia', ka: 'საქართველოს უნივერსიტეტი' },
  { domain: 'btu.edu.ge', en: 'Business and Technology University', ka: 'ბიზნესისა და ტექნოლოგიების უნივერსიტეტი' },
  { domain: 'gtu.ge', en: 'Georgian Technical University', ka: 'საქართველოს ტექნიკური უნივერსიტეტი' },
  { domain: 'sabauni.edu.ge', en: 'Saint Andrew the First-Called Georgian University', ka: 'საქართველოს საპატრიარქოს წმიდა ანდრია პირველწოდებულის სახელობის ქართული უნივერსიტეტი' },
  { domain: 'freeuni.edu.ge', en: 'Free University of Tbilisi', ka: 'თბილისის თავისუფალი უნივერსიტეტი' },
  { domain: 'agruni.edu.ge', en: 'Agricultural University of Georgia', ka: 'საქართველოს აგრარული უნივერსიტეტი' },
  { domain: 'cu.edu.ge', en: 'Caucasus University', ka: 'კავკასიის უნივერსიტეტი' },
  { domain: 'gipa.ge', en: 'Georgian Institute of Public Affairs', ka: 'საქართველოს საზოგადოებრივ საქმეთა ინსტიტუტი' },
  { domain: 'tsmu.edu', en: 'Tbilisi State Medical University', ka: 'თბილისის სახელმწიფო სამედიცინო უნივერსიტეტი' },
  { domain: 'newvision.ge', en: 'New Vision University', ka: 'ახალი ხედვის უნივერსიტეტი' },
  { domain: 'ibsu.edu.ge', en: 'International Black Sea University', ka: 'შავი ზღვის საერთაშორისო უნივერსიტეტი' },
  { domain: 'atsu.edu.ge', en: 'Akaki Tsereteli State University', ka: 'აკაკი წერეთლის სახელმწიფო უნივერსიტეტი' },
  { domain: 'bsu.edu.ge', en: 'Batumi Shota Rustaveli State University', ka: 'ბათუმის შოთა რუსთაველის სახელმწიფო უნივერსიტეტი' },
  { domain: 'tsu.edu.ge', en: 'Tbilisi State University', ka: 'თბილისის სახელმწიფო უნივერსიტეტი' },
  { domain: 'eu.edu.ge', en: 'European University', ka: 'ევროპის უნივერსიტეტი' },
  { domain: 'seu.edu.ge', en: 'Georgian National University SEU', ka: 'საქართველოს ეროვნული უნივერსიტეტი სეუ' },
  { domain: 'tou.edu.ge', en: 'Tbilisi Open University', ka: 'თბილისის ღია უნივერსიტეტი' },
  { domain: 'ens.edu.ge', en: 'Ilia Chavchavadze Pedagogical University', ka: 'ილია ჭავჭავაძის პედაგოგიური უნივერსიტეტი' }
];
const GENERIC = /(^|\.)(edu\.ge|edu|ac\.[a-z]{2}|edu\.[a-z]{2})$/i;

const hostOf = (value) => {
  try { return new URL(String(value)).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, ''); } catch (e) { return String(value || '').toLowerCase().replace(/^www\./, '').replace(/\.$/, ''); }
};
// -> { domain, en, ka } for a known university, { domain: host } for another university, or null
function universityOf(urlOrHost) {
  const host = hostOf(urlOrHost);
  if (!host) return null;
  const known = LIST.find((u) => host === u.domain || host.endsWith('.' + u.domain));
  if (known) return known;
  return GENERIC.test(host) ? { domain: host, en: null, ka: null } : null;
}

module.exports = { LIST, universityOf };
