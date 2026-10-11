// REVIEW-2: who can read or act on what. A second account ("Eve") tries everything the asker and the mentor can do with their
// conversation, dispute, receipt, export, ticket, room token and questions; seats are never oversold when single tickets and a series
// are bought at the same moment; every new kind of write needs the site's own CSRF header; text is shown as text on the pages built
// by the server (and in their JSON-LD); the Content-Security-Policy is relaxed only on the live room page; malformed links and ids are
// refused rather than crashing (REVIEW-2 #9). Mock bank, fake video provider.
// The findings these tests showed are fixed (docs/REVIEW-2.md, "Status"): every test here must pass.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { pool, sql, marketplace, client, signupVerified, answered, published, buyAndPay, bankPays, openRoom, forged, day } = require('./_shared');

let ctx, eve, bookingId, threadId;
const denied = (r) => [403, 404].includes(r.status);

before(async () => {
  ctx = await marketplace(4853, { LIVE_PROVIDER: 'fake' });
  eve = await signupVerified(ctx.base, 'Eve Outsider', 'eve@example.com');
  bookingId = await answered(ctx, 'How should I prepare for my first technical interview at a large company?');
  threadId = (await ctx.seeker.api(`/inbox/booking/${bookingId}`)).threadId;
});
after(async () => { if (ctx) ctx.srv.proc.kill(); await pool.end(); });

describe('a conversation is only for its two people', () => {
  test('another account cannot find, read, write to or report anything in it', async () => {
    assert.ok(threadId, 'the asker has the conversation');
    assert.ok(denied(await eve.api(`/inbox/booking/${bookingId}`)));
    assert.ok(denied(await eve.api(`/inbox/threads/${threadId}`)));
    assert.ok(denied(await eve.api(`/inbox/threads/${threadId}/messages`, { method: 'POST', body: { body: 'Hello, I am not part of this.' } })));
    const thread = await ctx.seeker.api(`/inbox/threads/${threadId}`);
    assert.equal(thread.status, 200, thread.text);
    const any = thread.messages.find((m) => m.id);
    assert.ok(any, 'the conversation has messages');
    assert.ok(denied(await eve.api(`/inbox/messages/${any.id}/report`, { method: 'POST', body: { reason: 'spam' } })));
    assert.equal((await sql('SELECT count(*)::int AS n FROM message_reports'))[0].n, 0);
  });

  test("another account cannot mark someone else's notifications as read", async () => {
    // (the mentor has not opened the conversation, so the "new question" notification is still unread)
    const mine = (await ctx.mentor.api('/inbox/notifications')).notifications;
    const unread = mine.filter((n) => !n.read).map((n) => n.id);
    assert.ok(unread.length, 'the mentor has unread notifications');
    await eve.api('/inbox/notifications/read', { method: 'POST', body: { ids: unread } });
    await eve.api('/inbox/notifications/read', { method: 'POST', body: {} });
    const after = (await ctx.mentor.api('/inbox/notifications')).notifications.filter((n) => unread.includes(n.id));
    assert.ok(after.every((n) => !n.read));
  });
});

describe('disputes, receipts and statements', () => {
  test('only the asker can report the answer', async () => {
    assert.ok(denied(await eve.api(`/bookings/${bookingId}/dispute`, { method: 'POST', body: { reason: 'not_an_answer', details: 'Not mine to report.' } })));
    assert.ok(denied(await ctx.mentor.api(`/bookings/${bookingId}/dispute`, { method: 'POST', body: { reason: 'not_an_answer' } })));
    assert.equal((await sql('SELECT count(*)::int AS n FROM disputes'))[0].n, 0);
  });

  test('a receipt opens only for whoever paid (not the mentor, not another account, not a visitor)', async () => {
    const [r] = await sql(`SELECT id FROM receipts WHERE booking_id = $1 AND kind = 'payment'`, [bookingId]);
    assert.ok(r, 'a payment receipt exists');
    const own = await ctx.seeker.raw(`/api/receipts/${r.id}.pdf`);
    assert.equal(own.status, 200);
    assert.match(own.headers.get('content-type'), /application\/pdf/);
    assert.equal((await eve.raw(`/api/receipts/${r.id}.pdf`)).status, 404);
    assert.equal((await ctx.mentor.raw(`/api/receipts/${r.id}.pdf`)).status, 404);
    assert.equal((await fetch(`${ctx.base}/api/receipts/${r.id}.pdf`)).status, 401);
  });

  test("a mentor's monthly statement is only theirs", async () => {
    const month = new Date().toISOString().slice(0, 7);
    assert.equal((await eve.raw(`/api/me/statements/${month}.csv`)).status, 404);
    const own = await ctx.mentor.raw(`/api/me/statements/${month}.csv`);
    assert.equal(own.status, 200);
    assert.doesNotMatch(await own.text(), /seeker@example\.com|Sam Seeker/, 'the asker is not named in it');
  });
});

describe('the data export', () => {
  test("has the person's own data and nobody else's email address", async () => {
    const asker = await ctx.seeker.raw('/api/me/export');
    assert.equal(asker.status, 200);
    const a = await asker.text();
    assert.match(a, /seeker@example\.com/);
    for (const other of ['mentor@example.com', 'qa-admin@example.com', 'eve@example.com']) assert.ok(!a.includes(other), `the asker's export names ${other}`);
    const m = await (await ctx.mentor.raw('/api/me/export')).text();
    for (const other of ['seeker@example.com', 'qa-admin@example.com', 'eve@example.com']) assert.ok(!m.includes(other), `the mentor's export names ${other}`);
    assert.equal((await fetch(`${ctx.base}/api/me/export`)).status, 401);
  });
});

describe('live sessions: tickets, room tokens and the question panel', () => {
  let s, ticketId, questionId;
  before(async () => {
    s = await published(ctx);
    ticketId = await buyAndPay(ctx, ctx.seeker, s.id, { questions: ['What should I learn in my first month?'] });
    await openRoom(s.id);
  });

  test('only a ticket holder (or the mentor) gets a token for the room', async () => {
    const j = await eve.api(`/live/${s.id}/join`, { method: 'POST', body: {} });
    assert.equal(j.status, 403, j.text);
    assert.equal(j.joinUrl, undefined);
    const mine = await ctx.seeker.api(`/live/${s.id}/join`, { method: 'POST', body: {} });
    assert.equal(mine.status, 200, mine.text);
    assert.equal(mine.role, 'participant');
    assert.equal(mine.canSpeak, false, 'a Q&A participant cannot send audio or video until allowed');
    assert.equal((await ctx.mentor.api(`/live/${s.id}/join`, { method: 'POST', body: {} })).role, 'mentor');
  });

  test('only people in the room can read, ask or vote; only the mentor moderates; nobody sees who asked', async () => {
    assert.equal((await eve.api(`/live/${s.id}/state`)).status, 403);
    assert.equal((await eve.api(`/live/${s.id}/questions`, { method: 'POST', body: { body: 'A question from outside the room' } })).status, 403);
    const st = await ctx.seeker.api(`/live/${s.id}/state`);
    assert.equal(st.status, 200, st.text);
    questionId = st.questions[0].id;
    assert.equal(st.questions[0].mine, true);
    assert.ok(!('authorId' in st.questions[0]) && !('author' in st.questions[0]));
    assert.equal((await eve.api(`/live/questions/${questionId}/vote`, { method: 'POST' })).status, 403);
    assert.equal((await eve.api(`/live/questions/${questionId}/state`, { method: 'POST', body: { state: 'hidden' } })).status, 403);
    assert.equal((await ctx.seeker.api(`/live/questions/${questionId}/state`, { method: 'POST', body: { state: 'hidden' } })).status, 403);
    const seekerId = (await ctx.seeker.api('/me')).user.id;
    assert.equal((await ctx.seeker.api(`/live/${s.id}/speakers/${seekerId}`, { method: 'POST', body: { allow: true } })).status, 403);
    const m = await ctx.mentor.api(`/live/${s.id}/state`);
    assert.ok(!JSON.stringify(m).includes('@'), 'no email addresses in the mentor\'s view of the room');
  });

  test("another account cannot cancel, report, sync, download or re-send someone else's ticket", async () => {
    assert.equal((await eve.api(`/live/tickets/${ticketId}/cancel`, { method: 'POST' })).status, 404);
    assert.equal((await eve.api(`/live/tickets/${ticketId}/dispute`, { method: 'POST', body: { reason: 'technical' } })).status, 404);
    assert.equal((await eve.api(`/live/tickets/${ticketId}/sync`, { method: 'POST' })).status, 404);
    assert.equal((await eve.raw(`/api/live/tickets/${ticketId}/calendar.ics`)).status, 404);
    assert.equal((await eve.api(`/live/tickets/${ticketId}/gift/resend`, { method: 'POST' })).status, 404);
    assert.equal((await sql('SELECT status FROM live_tickets WHERE id = $1', [ticketId]))[0].status, 'paid');
  });

  test('single tickets and a series bought at the same moment never take more seats than there are', async () => {
    const small = await published(ctx, { title: 'Small first evening of the review series', maxSeats: 2, date: day(4) });
    const big = await published(ctx, { title: 'Second evening of the review series', date: day(5) });
    const sr = await ctx.mentor.api('/live/series', { method: 'POST', body: { title: 'Two review evenings', description: 'Two sessions that build on each other, for the review tests.', price: 30, sessionIds: [small.id, big.id] } });
    assert.equal(sr.status, 201, sr.text);
    assert.equal((await ctx.mentor.api(`/live/series/${sr.series.id}/publish`, { method: 'POST' })).status, 200);
    const buyers = [];
    for (let i = 0; i < 6; i++) buyers.push(await signupVerified(ctx.base, `Racer ${i}`, `racer${i}@example.com`));
    const results = await Promise.all(buyers.map((b, i) => (i % 2
      ? b.api(`/live/series/${sr.series.id}/orders`, { method: 'POST', body: {} })
      : b.api(`/live/${small.id}/tickets`, { method: 'POST', body: {} }))));
    const won = results.filter((r) => r.status === 201);
    assert.equal(won.length, 2, results.map((r) => `${r.status} ${r.error || ''}`).join(', '));
    for (const r of won) await bankPays(ctx.base, r.checkoutUrl);
    const [{ n }] = await sql(`SELECT count(*)::int AS n FROM live_tickets WHERE session_id = $1 AND status IN ('held', 'paid', 'refund_pending')`, [small.id]);
    assert.ok(n <= 2, `${n} seats taken in a session of 2`);
  });
});

describe('CSRF: every new kind of write needs the site\'s own header', () => {
  test('a forged request (no X-Requested-With, or another site\'s Origin) is refused', async () => {
    const s = (await sql(`SELECT id FROM live_sessions WHERE status = 'published' LIMIT 1`))[0];
    const writes = [
      ['POST', `/api/inbox/threads/${threadId}/messages`, { body: 'forged' }], ['POST', `/api/bookings/${bookingId}/dispute`, { reason: 'other' }],
      ['DELETE', '/api/me', { password: 'test-pass-12345' }], ['POST', '/api/me/2fa/setup', {}], ['POST', '/api/me/2fa/disable', { password: 'x' }],
      ['POST', `/api/live/${s.id}/tickets`, {}], ['POST', `/api/live/${s.id}/questions`, { body: 'forged question' }], ['POST', '/api/live/gifts/claim', { token: 'x'.repeat(30) }],
      ['POST', '/api/inbox/unsubscribe', { token: 'x' }], ['POST', '/api/inbox/support', { subject: 'Forged', body: 'A forged support request.' }],
      ['PUT', '/api/inbox/email-settings', { off: [] }], ['POST', '/api/me/profile/items', { section: 'skills', data: {} }]
    ];
    for (const [method, path, body] of writes) {
      const r = await forged(ctx.base, ctx.seeker, path, { method, body });
      assert.equal(r.status, 403, `${method} ${path} without the header: ${r.status}`);
      const o = await forged(ctx.base, ctx.seeker, path, { method, body, headers: { 'X-Requested-With': 'wisecall', Origin: 'https://evil.example' } });
      assert.equal(o.status, 403, `${method} ${path} from another site: ${o.status}`);
    }
    assert.ok((await ctx.seeker.api('/me')).user, 'the account is still there');
  });
});

describe('pages built on the server', () => {
  test('a session title with markup is text on the page and inside its JSON-LD', async () => {
    const s = await published(ctx, { title: 'Careers </script><script>alert(1)</script> & "quotes"', date: day(6) });
    const html = await (await fetch(`${ctx.base}/live/${s.slug}`)).text();
    assert.ok(!html.includes('<script>alert(1)'), 'the markup is not code');
    assert.ok(!/<\/script><script>alert/.test(html));
    const ld = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    assert.ok(ld, 'the page has its JSON-LD');
    assert.equal(JSON.parse(ld[1]).name, s.title, 'the JSON-LD still says the real title');
  });

  test('the Content-Security-Policy is relaxed only on the live room page', async () => {
    const s = (await sql(`SELECT slug FROM live_sessions WHERE status = 'published' ORDER BY created_at LIMIT 1`))[0];
    const room = (await fetch(`${ctx.base}/live/${s.slug}/room`)).headers.get('content-security-policy');
    assert.match(room, /frame-src [^;]+/);
    const username = (await ctx.mentor.api('/me')).user.username;
    for (const p of ['/', `/live/${s.slug}`, '/inbox.html', '/dashboard.html', `/u/${username}`, '/help.html', '/ka/', `/ka/live/${s.slug}`]) {
      const csp = (await fetch(`${ctx.base}${p}`)).headers.get('content-security-policy') || '';
      assert.ok(csp.includes("default-src 'self'"), `${p} has the policy`);
      assert.ok(!/frame-src|media-src/.test(csp), `${p} allows frames or media: ${csp}`);
    }
  });
});

describe('malformed input is refused, not an error', () => {
  test('an unsubscribe or unfollow link with a non-ASCII signature', async () => {
    const payload = Buffer.from(`${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}.reminders`).toString('base64url');
    const u = await client(ctx.base).api('/inbox/unsubscribe', { method: 'POST', body: { token: `${payload}.${'é'.repeat(32)}` } });
    const f = await client(ctx.base).api('/live/follows/unfollow', { method: 'POST', body: { token: `a.b.${'é'.repeat(43)}` } });
    assert.deepEqual([u.status, f.status], [400, 404], `unsubscribe: ${u.status}, unfollow: ${f.status}`);
  });

  test('a ticket id that is not an id', async () => {
    assert.equal((await ctx.seeker.api('/live/tickets/not-an-id/sync', { method: 'POST' })).status, 404);
    assert.equal((await ctx.seeker.raw('/api/live/tickets/not-an-id/calendar.ics')).status, 404);
  });
});
