// PDF documents (receipts, monthly statements) with pdfkit and Noto Sans Georgian (SIL Open Font License, server/fonts/OFL-LICENSE.txt).
// The font comes as two files, Georgian letters and Latin letters, so text is written in runs: each run in the file that has its
// letters. Amounts are written "25.00 GEL" (the lari sign is in neither file).
const path = require('path');
const PDFDocument = require('pdfkit');
const config = require('./config');

const FONT_DIR = path.join(__dirname, 'fonts');
const FONTS = {
  ka: 'noto-sans-georgian-georgian-400-normal.woff', kaBold: 'noto-sans-georgian-georgian-700-normal.woff',
  la: 'noto-sans-georgian-latin-400-normal.woff', laBold: 'noto-sans-georgian-latin-700-normal.woff'
};
const GEORGIAN = /[\u10A0-\u10FF\u1C90-\u1CBF\u2D00-\u2D2F]/;
const RUNS = /[\u10A0-\u10FF\u1C90-\u1CBF\u2D00-\u2D2F]+|[^\u10A0-\u10FF\u1C90-\u1CBF\u2D00-\u2D2F]+/g;

const money = (tetri) => `${(Number(tetri || 0) / 100).toFixed(2)} GEL`;

// A new A4 document; collect() resolves with the finished PDF as a Buffer.
function newDoc(title) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: title, Author: 'Wisecall', Producer: 'Wisecall' } });
  Object.entries(FONTS).forEach(([name, file]) => doc.registerFont(name, path.join(FONT_DIR, file)));
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  return { doc, collect: () => { doc.end(); return done; } };
}

// Text that may mix Georgian and Latin letters, in one paragraph.
function text(doc, value, { bold = false, size = 10.5, color = '#25213b', ...opts } = {}) {
  const runs = String(value === null || value === undefined ? '' : value).match(RUNS) || [' '];
  doc.fontSize(size).fillColor(color);
  runs.forEach((run, i) => {
    doc.font(GEORGIAN.test(run) ? (bold ? 'kaBold' : 'ka') : (bold ? 'laBold' : 'la'));
    doc.text(run, { ...opts, continued: i < runs.length - 1 || Boolean(opts.continued) });
  });
}

// The heading every document starts with: the brand, and the seller's legal details when they are set (LEGAL_NAME, LEGAL_ID,
// LEGAL_ADDRESS), as Georgian e-commerce rules expect on a receipt.
function header(doc, title) {
  text(doc, 'Wisecall', { bold: true, size: 20, color: '#cf4129' });
  const legal = [config.LEGAL_NAME, config.LEGAL_ID && `ID ${config.LEGAL_ID}`, config.LEGAL_ADDRESS].filter(Boolean);
  if (legal.length) text(doc, legal.join(' · '), { size: 9, color: '#5f5880' });
  text(doc, config.PUBLIC_URL.replace(/^https?:\/\//, ''), { size: 9, color: '#5f5880' });
  doc.moveDown(1.2);
  text(doc, title, { bold: true, size: 16 });
  doc.moveDown(0.6);
}

// "Label: value" lines.
function rows(doc, pairs) {
  for (const [label, value] of pairs) {
    text(doc, `${label}: `, { bold: true, continued: true });
    text(doc, value);
  }
}

module.exports = { newDoc, text, header, rows, money };
