// A mentor with a failed required verification step must never be listed or bookable (docs/AUDIT.md #8).
// Tests marked { todo: 'AUDIT #n' } show a problem that exists today: they are expected to fail until the finding is fixed.
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const { client, signupVerified, addPayoutDetails, longQuestion, SAMPLE } = require('../helpers');
const rules = require('../../server/verification/rules');
const { pool, marketplace } = require('./_shared');

after(async () => { await pool.end(); });

const listed = async (base, id) => {
  const one = await client(base).api(`/experts/${id}`);
  const all = await client(base).api('/experts');
  return { profile: one.status === 200, inList: all.experts.some((e) => e.id === id) };
};

describe('failed required steps', () => {
  let ctx;
  before(async () => { ctx = await marketplace(4821); });
  after(() => ctx && ctx.srv.proc.kill());

  // A mentor with every step passed except one, then submitted, ready for the admin (written straight into the test database, like
  // tests/helpers.js approveMentor does).
  async function applicant(email, failedStep) {
    const m = await signupVerified(ctx.base, 'Tamar Applicant', email);
    await m.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Engineer', niche: 'tech', price: 30, sampleAnswer: SAMPLE } });
    await addPayoutDetails(m, undefined, 'Tamar Applicant');
    const me = (await m.api('/me')).user;
    await pool.query(`UPDATE users SET verification_status = 'pending', application_submitted_at = now() WHERE id = $1`, [me.id]);
    for (const step of rules.requiredFor('tech')) {
      const status = step === failedStep ? 'failed' : 'passed';
      await pool.query(
        `INSERT INTO verification_steps (user_id, step, status, reason, decided_at) VALUES ($1, $2, $3, 'test setup', now())
         ON CONFLICT (user_id, step) DO UPDATE SET status = EXCLUDED.status, reason = EXCLUDED.reason, decided_at = now()`, [me.id, step, status]);
    }
    return { client: m, id: me.id };
  }

  test('the required steps for a standard niche include the identity steps (age, name, ID check)', () => {
    const req = rules.requiredFor('tech');
    for (const s of ['email', 'id_kyc', 'age', 'name_match']) assert.ok(req.includes(s), s);
  });

  for (const step of ['age', 'name_match', 'id_kyc']) {
    test(`an admin cannot approve a mentor whose "${step}" step failed, and they are not listed`, async () => {
      const a = await applicant(`fail-${step}@example.com`, step);
      const r = await ctx.admin.api(`/admin/mentors/${a.id}/approve`, { method: 'POST' });
      assert.equal(r.status, 409);
      assert.equal(r.error, 'steps_incomplete');
      assert.deepEqual(await listed(ctx.base, a.id), { profile: false, inList: false });
    });
  }

  test('an admin failing the age step of a LISTED mentor takes them off the site at once', async () => {
    assert.deepEqual(await listed(ctx.base, ctx.mentorId), { profile: true, inList: true });
    const r = await ctx.admin.api(`/admin/mentors/${ctx.mentorId}/steps/age`, { method: 'POST', body: { decision: 'failed', reason: 'The ID shows the person is under 18' } });
    assert.equal(r.status, 200, r.text);
    assert.deepEqual(await listed(ctx.base, ctx.mentorId), { profile: false, inList: false });
    const b = await ctx.seeker.api('/bookings', { method: 'POST', body: { mentorId: ctx.mentorId, question: longQuestion('Can I still book this mentor?') } });
    assert.equal(b.status, 404);
  });

  test('a required step failed by the SYSTEM (ID check / age from the provider) also takes a listed mentor off the site', async () => {
    const m = await signupVerified(ctx.base, 'Levan Listed', 'levan@example.com');
    await m.api('/me', { method: 'PATCH', body: { becomeMentor: true, roleTitle: 'Engineer', niche: 'tech', price: 40, sampleAnswer: SAMPLE } });
    const id = await require('../helpers').approveMentor(ctx.admin, m);
    await addPayoutDetails(m, undefined, 'Levan Listed');
    assert.deepEqual(await listed(ctx.base, id), { profile: true, inList: true });
    // What server/verification/kyc.js updateAge() writes when a later ID result says "under 18" (actor: the provider, no admin).
    await pool.query(`UPDATE verification_steps SET status = 'failed', reason = 'Under 18 according to the ID', decided_by = NULL, decided_at = now()
                       WHERE user_id = $1 AND step = 'age'`, [id]);
    assert.deepEqual(await listed(ctx.base, id), { profile: false, inList: false });
    const b = await ctx.seeker.api('/bookings', { method: 'POST', body: { mentorId: id, question: longQuestion('Is this mentor still bookable?') } });
    assert.equal(b.status, 404);
  });
});
