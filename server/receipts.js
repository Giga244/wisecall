// Receipts and monthly statements.
//   receipt    one numbered receipt for every payment (when the bank confirms it) and every refund (full, when confirmed; partial, when
//              sent). The asker gets it by email with a link to the PDF (EN or KA); only the asker and admins can open it.
//   statement  for mentors, per calendar month: what they earned (price, platform fee, their share, refunds taken off) and what was
//              paid to them, as CSV or PDF.
const { query } = require('./db');
const config = require('./config');
const pdf = require('./pdf');

const numberOf = (n) => `R-${String(n).padStart(6, '0')}`;
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''));
const runner = (client) => (client ? client.query.bind(client) : query);

// Records a receipt (a payment has at most one). Returns it, or null when it already existed.
async function issue(bookingId, kind, amount, client) {
  if (!(amount > 0)) return null;
  const { rows } = await runner(client)(
    `INSERT INTO receipts (booking_id, kind, amount) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING *`, [bookingId, kind, amount]);
  return rows[0] || null;
}

// A live session ticket's receipt (server/live/tickets.js): the same numbering and rules.
async function issueTicket(ticketId, kind, amount, client) {
  if (!(amount > 0)) return null;
  const { rows } = await runner(client)(
    `INSERT INTO receipts (ticket_id, kind, amount) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING *`, [ticketId, kind, amount]);
  return rows[0] || null;
}

// A series payment (one receipt for the bundle) and a replay pass (server/live/series.js, server/live/replays.js).
async function issueSeriesOrder(orderId, kind, amount, client) {
  if (!(amount > 0)) return null;
  const { rows } = await runner(client)(
    `INSERT INTO receipts (series_order_id, kind, amount) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING *`, [orderId, kind, amount]);
  return rows[0] || null;
}
async function issueReplay(purchaseId, kind, amount, client) {
  if (!(amount > 0)) return null;
  const { rows } = await runner(client)(
    `INSERT INTO receipts (replay_purchase_id, kind, amount) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING *`, [purchaseId, kind, amount]);
  return rows[0] || null;
}

// The asker (or the ticket's buyer) is emailed the receipt (after the change that caused it is saved).
const SOURCE_SQL = {
  ticket_id: `SELECT t.buyer_id AS seeker_id, m.name AS mentor_name, s.title FROM live_tickets t JOIN live_sessions s ON s.id = t.session_id JOIN users m ON m.id = s.mentor_id WHERE t.id = $1`,
  series_order_id: `SELECT o.buyer_id AS seeker_id, m.name AS mentor_name, ls.title FROM live_series_orders o JOIN live_series ls ON ls.id = o.series_id JOIN users m ON m.id = ls.mentor_id WHERE o.id = $1`,
  replay_purchase_id: `SELECT p.buyer_id AS seeker_id, m.name AS mentor_name, s.title FROM live_replay_purchases p JOIN live_sessions s ON s.id = p.session_id JOIN users m ON m.id = s.mentor_id WHERE p.id = $1`,
  booking_id: `SELECT b.seeker_id, m.name AS mentor_name, NULL AS title FROM bookings b JOIN users m ON m.id = b.mentor_id WHERE b.id = $1`
};
const sourceOf = (r) => ['ticket_id', 'series_order_id', 'replay_purchase_id', 'booking_id'].find((k) => r[k]);
async function email(receipt) {
  if (!receipt) return;
  const source = sourceOf(receipt);
  const { rows } = await query(SOURCE_SQL[source], [receipt[source]]);
  if (!rows[0]) return;
  const asker = await require('./models').getUserById(rows[0].seeker_id);
  require('./notify').notifyReceipt(asker, {
    number: numberOf(receipt.number), kind: receipt.kind, amount: pdf.money(receipt.amount), mentor: rows[0].mentor_name, title: rows[0].title || null,
    date: new Date(receipt.issued_at).toISOString().slice(0, 10), url: `${config.PUBLIC_URL}/api/receipts/${receipt.id}.pdf`
  });
}

// The asker's receipts for their bookings: { [bookingId]: [{ id, number, kind, amount, issuedAt }] }
async function forBookings(ids) {
  if (!ids.length) return {};
  const { rows } = await query('SELECT * FROM receipts WHERE booking_id = ANY($1::uuid[]) ORDER BY number', [ids]);
  const out = {};
  rows.forEach((r) => { (out[r.booking_id] = out[r.booking_id] || []).push({ id: r.id, number: numberOf(r.number), kind: r.kind, amount: r.amount, issuedAt: r.issued_at }); });
  return out;
}

const WORDS = {
  en: {
    payment: 'Receipt', refund: 'Refund receipt', number: 'Receipt no.', date: 'Date', payer: 'Paid by', to: 'For', question: 'A question to {mentor} on Wisecall', live: 'Live session "{title}" with {mentor} on Wisecall', series: 'Live series "{title}" with {mentor} on Wisecall', replay: 'Replay of the live session "{title}" with {mentor} on Wisecall (30 days)', ticket: 'Ticket reference',
    liveNote: 'This receipt confirms a payment received by Wisecall for a ticket to a live session held through the platform.',
    amount: 'Amount', refunded: 'Refunded', method: 'Paid through', booking: 'Question reference', note: 'This receipt confirms a payment received by Wisecall for a question answered through the platform.',
    refundNote: 'This receipt confirms money returned by Wisecall to the card it was paid with. It can take 5-10 business days to appear.',
    statement: 'Monthly statement', month: 'Month', mentor: 'Mentor', earned: 'Earned this month', paidOut: 'Paid to you this month',
    cols: ['Date', 'Question', 'Price', 'Platform fee', 'Your share', 'Refunded (your part)', 'Status'],
    total: 'Total', none: 'Nothing this month.', ref: 'Bank reference', statuses: { pending: 'not paid yet', paid: 'paid', void: 'refunded' }
  },
  ka: {
    payment: 'ქვითარი', refund: 'თანხის დაბრუნების ქვითარი', number: 'ქვითრის No.', date: 'თარიღი', payer: 'გადამხდელი', to: 'დანიშნულება', question: 'კითხვა {mentor}-სთვის Wisecall-ზე', live: 'ცოცხალი სესია „{title}“ ({mentor}) Wisecall-ზე', series: 'ცოცხალი სესიების სერია „{title}“ ({mentor}) Wisecall-ზე', replay: 'ცოცხალი სესიის „{title}“ ({mentor}) ჩანაწერი Wisecall-ზე (30 დღე)', ticket: 'ბილეთის ნომერი',
    liveNote: 'ეს ქვითარი ადასტურებს, რომ Wisecall-მა მიიღო გადახდა პლატფორმით ჩატარებული ცოცხალი სესიის ბილეთისთვის.',
    amount: 'თანხა', refunded: 'დაბრუნებული თანხა', method: 'გადახდის საშუალება', booking: 'კითხვის ნომერი', note: 'ეს ქვითარი ადასტურებს, რომ Wisecall-მა მიიღო გადახდა პლატფორმით პასუხგაცემული კითხვისთვის.',
    refundNote: 'ეს ქვითარი ადასტურებს, რომ Wisecall-მა თანხა დააბრუნა იმ ბარათზე, რომლითაც გადაიხადე. ასახვას შეიძლება 5-10 სამუშაო დღე დასჭირდეს.',
    statement: 'თვიური ამონაწერი', month: 'თვე', mentor: 'მენტორი', earned: 'ამ თვეში გამომუშავებული', paidOut: 'ამ თვეში გადმორიცხული',
    cols: ['თარიღი', 'კითხვა', 'ფასი', 'პლატფორმის საკომისიო', 'შენი წილი', 'დაბრუნებული (შენი ნაწილი)', 'სტატუსი'],
    total: 'სულ', none: 'ამ თვეში არაფერია.', ref: 'საბანკო მითითება', statuses: { pending: 'ჯერ არ გადარიცხულა', paid: 'გადარიცხულია', void: 'დაბრუნებულია' }
  }
};
const PROVIDERS = { bog: 'Bank of Georgia', tbc: 'TBC Bank', mock: 'Test bank' };
const words = (lang) => WORDS[lang === 'ka' ? 'ka' : 'en'];

// The receipt, if this user may see it (the asker; admins too). -> { receipt, booking } or null
async function loadFor(user, receiptId, { admin = false } = {}) {
  if (!isUuid(receiptId)) return null;
  // (a question, a ticket, a series payment or a replay pass: exactly one of them)
  const { rows } = await query(
    `SELECT r.*, COALESCE(b.seeker_id, t.buyer_id, so.buyer_id, rp.buyer_id) AS seeker_id, COALESCE(b.provider, t.provider, so.provider, rp.provider) AS provider,
            COALESCE(b.amount, t.price, so.price, rp.price) AS price, COALESCE(ls.title, rs.title) AS session_title, ser.title AS series_title,
            s.name AS payer_name, m.name AS mentor_name
       FROM receipts r LEFT JOIN bookings b ON b.id = r.booking_id LEFT JOIN live_tickets t ON t.id = r.ticket_id
       LEFT JOIN live_sessions ls ON ls.id = t.session_id
       LEFT JOIN live_series_orders so ON so.id = r.series_order_id LEFT JOIN live_series ser ON ser.id = so.series_id
       LEFT JOIN live_replay_purchases rp ON rp.id = r.replay_purchase_id LEFT JOIN live_sessions rs ON rs.id = rp.session_id
       JOIN users s ON s.id = COALESCE(b.seeker_id, t.buyer_id, so.buyer_id, rp.buyer_id)
       JOIN users m ON m.id = COALESCE(b.mentor_id, ls.mentor_id, ser.mentor_id, rs.mentor_id)
      WHERE r.id = $1`, [receiptId]);
  const r = rows[0];
  if (!r || (!admin && r.seeker_id !== user.id)) return null;
  return r;
}

async function receiptPdf(r, lang) {
  const w = words(lang);
  const { doc, collect } = pdf.newDoc(`${numberOf(r.number)}`);
  pdf.header(doc, `${r.kind === 'refund' ? w.refund : w.payment} ${numberOf(r.number)}`);
  const fill = (s) => s.replace('{title}', r.series_title || r.session_title || '').replace('{mentor}', r.mentor_name);
  const what = r.series_order_id ? fill(w.series) : r.replay_purchase_id ? fill(w.replay) : r.ticket_id ? fill(w.live) : fill(w.question);
  const live = Boolean(r.ticket_id || r.series_order_id || r.replay_purchase_id);
  pdf.rows(doc, [
    [w.number, numberOf(r.number)],
    [w.date, new Date(r.issued_at).toISOString().slice(0, 10)],
    [w.payer, r.payer_name],
    [w.to, what],
    [r.kind === 'refund' ? w.refunded : w.amount, pdf.money(r.amount)],
    [w.method, PROVIDERS[r.provider] || r.provider],
    [live ? w.ticket : w.booking, String(r.booking_id || r.ticket_id || r.series_order_id || r.replay_purchase_id).slice(0, 8).toUpperCase()]
  ]);
  doc.moveDown(1);
  pdf.text(doc, r.kind === 'refund' ? w.refundNote : (live ? w.liveNote : w.note), { size: 9, color: '#5f5880' });
  return collect();
}

// ---- Monthly statements (mentors) -----------------------------------------------------------------------------------------------
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const monthRange = (month) => {
  const m = MONTH_RE.exec(String(month || ''));
  if (!m) return null;
  const from = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return { from, to: new Date(Date.UTC(Number(m[1]), Number(m[2]), 1)) };
};

// The months with anything to show, newest first.
async function statementMonths(mentorId) {
  const { rows } = await query(
    `SELECT DISTINCT to_char(date_trunc('month', t AT TIME ZONE 'UTC'), 'YYYY-MM') AS m FROM (
        SELECT created_at AS t FROM payouts WHERE mentor_id = $1
        UNION ALL SELECT paid_at FROM payout_batches WHERE mentor_id = $1 AND status = 'paid') x ORDER BY m DESC LIMIT 36`, [mentorId]);
  return rows.map((r) => r.m);
}

async function statement(mentorId, month) {
  const range = monthRange(month);
  if (!range) return null;
  const [earned, paid] = await Promise.all([
    // (a live session is one line: its tickets' prices, fees and shares added up, as they were when it ended)
    query(`SELECT p.created_at, p.status, p.amount, p.refunded_share,
                  COALESCE(b.amount, lt.price, rp.price) AS price, COALESCE(b.platform_fee_amount, lt.fee, rp.fee) AS fee, COALESCE(b.mentor_net_amount, lt.net, rp.net) AS net,
                  COALESCE(left(b.question, 80), 'Live: ' || left(ls.title, 74), 'Replay: ' || left(rs.title, 72)) AS question
             FROM payouts p LEFT JOIN bookings b ON b.id = p.booking_id LEFT JOIN live_sessions ls ON ls.id = p.live_session_id
             LEFT JOIN live_replay_purchases rp ON rp.id = p.replay_purchase_id LEFT JOIN live_sessions rs ON rs.id = rp.session_id
             LEFT JOIN LATERAL (SELECT sum(t.price)::int AS price, sum(t.fee)::int AS fee, sum(t.net)::int AS net FROM live_tickets t
                                 WHERE t.session_id = p.live_session_id AND (t.status IN ('paid', 'refund_pending') OR t.refunded_at > p.created_at)) lt ON true
            WHERE p.mentor_id = $1 AND p.created_at >= $2 AND p.created_at < $3 ORDER BY p.created_at`,
      [mentorId, range.from, range.to]),
    query(`SELECT paid_at, amount, reference FROM payout_batches WHERE mentor_id = $1 AND status = 'paid' AND paid_at >= $2 AND paid_at < $3 ORDER BY paid_at`, [mentorId, range.from, range.to])
  ]);
  const lines = earned.rows.map((r) => ({
    date: new Date(r.created_at).toISOString().slice(0, 10), question: r.question, price: r.price, fee: r.fee, share: r.net,
    refunded: r.status === 'void' ? r.net : r.refunded_share, status: r.status
  }));
  const sum = (k) => lines.reduce((s, l) => s + (l[k] || 0), 0);
  return {
    month, lines, paid: paid.rows.map((r) => ({ date: new Date(r.paid_at).toISOString().slice(0, 10), amount: r.amount, reference: r.reference })),
    totals: { price: sum('price'), fee: sum('fee'), share: sum('share'), refunded: sum('refunded'), paid: paid.rows.reduce((s, r) => s + r.amount, 0) }
  };
}

const csvCell = (v) => {
  const s = String(v === null || v === undefined ? '' : v);
  // (a cell a spreadsheet would read as a formula is written as text)
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
const lari = (tetri) => (Number(tetri || 0) / 100).toFixed(2);

function statementCsv(s, lang) {
  const w = words(lang);
  const out = [w.cols.map(csvCell).join(',')];
  s.lines.forEach((l) => out.push([l.date, l.question, lari(l.price), lari(l.fee), lari(l.share), lari(l.refunded), w.statuses[l.status] || l.status].map(csvCell).join(',')));
  out.push([w.total, '', lari(s.totals.price), lari(s.totals.fee), lari(s.totals.share), lari(s.totals.refunded), ''].map(csvCell).join(','));
  out.push('');
  out.push([w.paidOut, w.date, w.amount, w.ref].map(csvCell).join(','));
  s.paid.forEach((p) => out.push(['', p.date, lari(p.amount), p.reference].map(csvCell).join(',')));
  return '\uFEFF' + out.join('\r\n') + '\r\n';
}

async function statementPdf(s, mentorName, lang) {
  const w = words(lang);
  const { doc, collect } = pdf.newDoc(`${w.statement} ${s.month}`);
  pdf.header(doc, `${w.statement} · ${s.month}`);
  pdf.rows(doc, [[w.mentor, mentorName], [w.month, s.month]]);
  doc.moveDown(0.8);
  pdf.text(doc, w.earned, { bold: true, size: 12 });
  if (!s.lines.length) pdf.text(doc, w.none);
  s.lines.forEach((l) => pdf.text(doc, `${l.date} · ${l.question} · ${w.cols[2]} ${pdf.money(l.price)} · ${w.cols[3]} ${pdf.money(l.fee)} · ${w.cols[4]} ${pdf.money(l.share)}${l.refunded ? ` · ${w.cols[5]} ${pdf.money(l.refunded)}` : ''} · ${w.statuses[l.status] || l.status}`, { size: 9 }));
  doc.moveDown(0.4);
  pdf.text(doc, `${w.total}: ${w.cols[2]} ${pdf.money(s.totals.price)} · ${w.cols[3]} ${pdf.money(s.totals.fee)} · ${w.cols[4]} ${pdf.money(s.totals.share)} · ${w.cols[5]} ${pdf.money(s.totals.refunded)}`, { bold: true, size: 10 });
  doc.moveDown(0.8);
  pdf.text(doc, w.paidOut, { bold: true, size: 12 });
  if (!s.paid.length) pdf.text(doc, w.none);
  s.paid.forEach((p) => pdf.text(doc, `${p.date} · ${pdf.money(p.amount)} · ${w.ref}: ${p.reference}`, { size: 10 }));
  return collect();
}

module.exports = { numberOf, issue, issueTicket, issueSeriesOrder, issueReplay, email, forBookings, loadFor, receiptPdf, statementMonths, statement, statementCsv, statementPdf, monthRange };
