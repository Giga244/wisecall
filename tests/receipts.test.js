// Receipts for payments and refunds (email + a PDF only the asker and admins can open, EN and KA), and mentors' monthly statements
// (CSV and PDF). Resend is faked so the receipt emails can be read.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('pg');
const { resetDatabase, startServer, client, approveMentor, addPayoutDetails, bookAndPay, longAnswer, SAMPLE, wait } = require('./helpers');
const { createFakeResend, signupByEmail } = require('./fakeResend');

const resend = createFakeResend();
const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
let srv, base, admin, asker, other, mentor, mentorId, paid;

async function raw(c, path) {
  const res = await c.raw(path);
  return { status: res.status, type: res.headers.get('content-type'), disposition: res.headers.get('content-disposition'), body: Buffer.from(await res.arrayBuffer()) };
}

before(async () => {
  await resend.start();
  await resetDatabase();
  srv = await startServer(4711, { EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 're_test_key', RESEND_API_URL: resend.url, EMAIL_FROM: 'Wisecall <hello@wisecall.example>', RATE_LIMIT_MULTIPLIER: '20',
    LEGAL_NAME: 'Wisecall LLC', LEGAL_ID: '400000000', LEGAL_ADDRESS: 'Tbilisi, Test street 1' });
  base = srv.base;
  admin = await signupByEmail(resend, base, 'QA Admin', 'qa-admin@example.com');
  asker = await signupByEmail(resend, base, 'ნინო ბერიძე', 'nino@example.com', 'ka');
  other = await signupByEmail(resend, base, 'Otto Other', 'otto@example.com');
  mentor = await signupByEmail(resend, base, 'Mika Mentor', 'mika@example.com');
  await mentor.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Engineer', niche: 'tech', price: 25, sampleAnswer: SAMPLE } });
  mentorId = await approveMentor(admin, mentor);
  await addPayoutDetails(mentor, undefined, 'Mika Mentor');
});
after(async () => { if (srv) srv.proc.kill(); await resend.stop(); await pool.end(); });

describe('receipts', () => {
  test('a confirmed payment gets a numbered receipt, emailed to the asker in their language with a link to the PDF', async () => {
    paid = await bookAndPay(base, asker, mentorId, 'როგორ დავიწყო Python-ის სწავლა ნულიდან, თუ დღეში ერთი საათი მაქვს?');
    const r = (await pool.query(`SELECT * FROM receipts WHERE booking_id = $1`, [paid.id])).rows;
    assert.equal(r.length, 1);
    assert.equal(r[0].kind, 'payment');
    assert.equal(r[0].amount, 2500);
    const mail = await resend.waitFor('nino@example.com', 'ქვითარი');
    assert.match(mail.body.text, /R-\d{6}/);
    assert.match(mail.body.text, /25\.00 ₾/);
    const mine = await asker.api('/bookings/mine');
    assert.equal(mine.asked[0].receipts[0].kind, 'payment');
  });

  test('the PDF opens for the asker (and admins) only; nobody else can see it', async () => {
    const id = (await pool.query(`SELECT id FROM receipts WHERE booking_id = $1`, [paid.id])).rows[0].id;
    const ka = await raw(asker, `/api/receipts/${id}.pdf?lang=ka`);
    assert.equal(ka.status, 200);
    assert.match(ka.type, /application\/pdf/);
    assert.match(ka.disposition, /attachment; filename="wisecall-R-\d{6}\.pdf"/);
    assert.equal(ka.body.slice(0, 5).toString(), '%PDF-');
    assert.ok(ka.body.length > 2000);
    assert.equal((await raw(admin, `/api/receipts/${id}.pdf`)).status, 200);
    assert.equal((await raw(other, `/api/receipts/${id}.pdf`)).status, 404);
    assert.equal((await raw(mentor, `/api/receipts/${id}.pdf`)).status, 404, 'the mentor does not see the buyer\'s receipt');
    assert.equal((await raw(client(base), `/api/receipts/${id}.pdf`)).status, 401);
  });

  test('a refund gets a refund receipt too', async () => {
    const b = await bookAndPay(base, asker, mentorId, 'What is the best way to learn SQL joins properly with real data?');
    const r = await admin.api(`/admin/bookings/${b.id}/refund`, { method: 'POST' });
    assert.ok([200, 409].includes(r.status), r.text);
    for (let i = 0; i < 30; i++) {
      const rows = (await pool.query(`SELECT kind, amount FROM receipts WHERE booking_id = $1 ORDER BY number`, [b.id])).rows;
      if (rows.length === 2) { assert.deepEqual(rows.map((x) => x.kind), ['payment', 'refund']); assert.equal(rows[1].amount, 2500); return; }
      await wait(200);
    }
    assert.fail('no refund receipt');
  });
});

describe('monthly statements for mentors', () => {
  test('the months with earnings are listed; CSV and PDF download; nobody else gets one', async () => {
    const r = await mentor.api(`/bookings/${paid.id}/answer`, { method: 'POST', body: { answer: longAnswer('Start with the basics: variables, loops and functions.') } });
    assert.equal(r.status, 200, r.text);
    const months = (await mentor.api('/me/statements')).months;
    const month = new Date().toISOString().slice(0, 7);
    assert.deepEqual(months, [month]);
    const csv = await raw(mentor, `/api/me/statements/${month}.csv`);
    assert.equal(csv.status, 200);
    const text = csv.body.toString('utf8');
    assert.match(text, /^﻿Date,Question,Price,Platform fee,Your share/);
    assert.match(text, /25\.00,5\.00,20\.00/);
    const kaCsv = (await raw(mentor, `/api/me/statements/${month}.csv?lang=ka`)).body.toString('utf8');
    assert.match(kaCsv, /თარიღი/);
    const pdf = await raw(mentor, `/api/me/statements/${month}.pdf`);
    assert.equal(pdf.body.slice(0, 5).toString(), '%PDF-');
    assert.equal((await raw(asker, `/api/me/statements/${month}.csv`)).status, 404, 'askers have no statements');
    assert.equal((await raw(mentor, '/api/me/statements/2026-13.csv')).status, 404);
  });

  test('a question text that looks like a spreadsheet formula is written as text in the CSV', async () => {
    const b = await bookAndPay(base, other, mentorId, '=HYPERLINK("http://evil.example","click") is what I saw in a file, what does it mean?');
    await mentor.api(`/bookings/${b.id}/answer`, { method: 'POST', body: { answer: longAnswer('It is a spreadsheet formula that makes a link.') } });
    const month = new Date().toISOString().slice(0, 7);
    const text = (await raw(mentor, `/api/me/statements/${month}.csv`)).body.toString('utf8');
    assert.match(text, /"'=HYPERLINK\(/);
  });
});
