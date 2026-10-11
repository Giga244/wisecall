// A share card for a live session (Milestone 2): a 1080 x 1080 PNG for Instagram and Facebook with the title, the mentor's photo and
// name, the date (Tbilisi time) and the price. Drawn on the server from an SVG (sharp), no third party. Text is escaped for SVG and
// wrapped by hand; fonts are the system's (Georgian needs a font with Georgian letters on the server, e.g. DejaVu Sans; see DECISIONS).
const sharp = require('sharp');
const { query } = require('../db');
const config = require('../config');

const SIZE = 1080;
const xml = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
// Brand colours (the same as the CSS design tokens; this image is not themed).
// (the site's "Ink & Paper" colours, public/css/tokens.css: text on coral is always ink)
const C = { paper: '#f4f2ee', ink: '#1e1a31', soft: '#4e4963', coral: '#ff6f59', coralText: '#e04a33', card: '#ffffff' };

// Splits text into at most `lines` lines of about `width` characters (the last one ends with … when cut).
function wrap(text, width, lines) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const out = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if ([...next].length > width && cur) { out.push(cur); cur = w; } else cur = next;
    if (out.length === lines) break;
  }
  if (out.length < lines && cur) out.push(cur);
  if (out.length === lines && words.join(' ').length > out.join(' ').length) out[lines - 1] = out[lines - 1].replace(/\s*\S*$/, '') + '…';
  return out.slice(0, lines);
}

// (one formatter per language, made once: R-12)
const WHEN = {};
const whenFormat = (lang) => (WHEN[lang === 'ka' ? 'ka' : 'en'] = WHEN[lang === 'ka' ? 'ka' : 'en']
  || new Intl.DateTimeFormat(lang === 'ka' ? 'ka-GE' : 'en-GB', { timeZone: 'Asia/Tbilisi', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }));

async function render(sessionId) {
  const { rows: [s] } = await query(
    `SELECT s.*, (SELECT count(*)::int FROM live_tickets t WHERE t.session_id = s.id AND t.early AND t.status IN ('held', 'paid', 'refund_pending')) AS early_taken, u.name AS mentor_name, u.role_title, p.data AS photo FROM live_sessions s JOIN users u ON u.id = s.mentor_id
       LEFT JOIN user_photos p ON p.user_id = u.id WHERE s.id = $1 AND s.status IN ('published', 'live', 'ended')`, [/^[0-9a-f-]{36}$/i.test(String(sessionId || '')) ? sessionId : null]);
  if (!s) return null;
  const lang = s.language;
  const when = whenFormat(lang).format(new Date(s.starts_at));
  const now = require('./sessions').currentPrice(s).price;
  const price = `${(now / 100).toFixed(now % 100 ? 2 : 0)} ₾`;
  const label = { qa: lang === 'ka' ? 'ცოცხალი კითხვა-პასუხი' : 'LIVE Q&A', workshop: lang === 'ka' ? 'ვორქშოპი' : 'WORKSHOP', circle: lang === 'ka' ? 'მცირე წრე' : 'SMALL CIRCLE' }[s.kind];
  const titleLines = wrap(s.title, 22, 4);
  const titleSvg = titleLines.map((l, i) => `<text x="110" y="${330 + i * 78}" font-size="64" font-weight="700" fill="${C.ink}">${xml(l)}</text>`).join('');
  const nameY = 330 + titleLines.length * 78 + 70;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" font-family="'Bricolage Grotesque', 'Noto Sans Georgian', 'DejaVu Sans', Arial, Sylfaen, sans-serif">
    <rect width="${SIZE}" height="${SIZE}" fill="${C.paper}"/>
    <rect x="72" y="76" width="${SIZE - 132}" height="${SIZE - 132}" rx="48" fill="${C.ink}"/>
    <rect x="60" y="60" width="${SIZE - 132}" height="${SIZE - 132}" rx="48" fill="${C.card}" stroke="${C.ink}" stroke-width="5"/>
    <rect x="110" y="140" width="${Math.max(220, [...label].length * 22 + 60)}" height="64" rx="32" fill="${C.coral}" stroke="${C.ink}" stroke-width="3"/>
    <text x="140" y="183" font-size="30" font-weight="700" fill="${C.ink}">${xml(label)}</text>
    ${titleSvg}
    <text x="${s.photo ? 270 : 110}" y="${nameY + 10}" font-size="40" font-weight="700" fill="${C.ink}">${xml(s.mentor_name)}</text>
    <text x="${s.photo ? 270 : 110}" y="${nameY + 60}" font-size="30" fill="${C.soft}">${xml(wrap(s.role_title || '', 34, 1)[0] || '')}</text>
    <text x="110" y="890" font-size="38" font-weight="700" fill="${C.ink}">${xml(when)}</text>
    <text x="110" y="950" font-size="40" fill="${C.ink}" font-weight="800">${xml(price)}</text>
    <text x="${SIZE - 122}" y="950" font-size="32" font-weight="700" fill="${C.coralText}" text-anchor="end">${xml(new URL(config.PUBLIC_URL).host)}/live</text>
  </svg>`;
  const layers = [];
  if (s.photo) {
    const round = Buffer.from(`<svg width="130" height="130"><circle cx="65" cy="65" r="65" fill="#fff"/></svg>`);
    const photo = await sharp(s.photo).resize(130, 130).composite([{ input: round, blend: 'dest-in' }]).png().toBuffer();
    layers.push({ input: photo, left: 110, top: nameY - 50 });
  }
  return sharp(Buffer.from(svg)).composite(layers).png().toBuffer();
}

module.exports = { render, wrap, SIZE };
