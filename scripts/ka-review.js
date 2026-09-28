#!/usr/bin/env node
// The Georgian texts a native speaker should read: every key of public/i18n/ka.json and admin-ka.json that was added or changed since
// a commit, next to its English text.  node scripts/ka-review.js <commit>  ->  docs/KA-REVIEW.md
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const since = process.argv[2];
if (!since) { console.error('Name the commit to compare with: node scripts/ka-review.js <commit>'); process.exit(1); }

const at = (file) => { try { return JSON.parse(execFileSync('git', ['show', `${since}:public/i18n/${file}`], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 })); } catch (e) { return {}; } };
const now = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'i18n', file), 'utf8'));
const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ');

let out = `# Georgian texts to double-check\n\nEvery Georgian text added or changed since commit \`${since}\`, with its English text. Read the Georgian aloud: it should sound\n`
  + `natural, use the informal შენ, and mean the same as the English. Placeholders such as \`{amount}\` are filled in by the site; keep them.\n`
  + `Regenerate with \`node scripts/ka-review.js ${since}\`.\n`;
let total = 0;
for (const [ka, en, title] of [['ka.json', 'en.json', 'Site'], ['admin-ka.json', 'admin-en.json', 'Admin panel']]) {
  const before = at(ka);
  const after = now(ka);
  const english = now(en);
  const keys = Object.keys(after).filter((k) => before[k] !== after[k]).sort();
  total += keys.length;
  const groups = {};
  for (const k of keys) (groups[k.split('.')[0]] = groups[k.split('.')[0]] || []).push(k);
  out += `\n## ${title} (${keys.length})\n`;
  for (const [g, list] of Object.entries(groups)) {
    out += `\n### ${g}\n\n| Key | English | Georgian | |\n|---|---|---|---|\n`;
    for (const k of list) out += `| \`${k}\` | ${cell(english[k] === undefined ? '' : english[k])} | ${cell(after[k])} | ${before[k] === undefined ? 'new' : 'changed'} |\n`;
  }
}
fs.writeFileSync(path.join(ROOT, 'docs', 'KA-REVIEW.md'), out);
console.log(`docs/KA-REVIEW.md: ${total} texts`);
