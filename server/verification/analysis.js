// Step 3 of an application: the automatic analysis, and what happens after it.
//   1 link checks on every evidence link (./linkCheck.js: safe against internal addresses), company codes format-checked for an admin
//   2 account signals (./signals.js) and our own check for text that tries to instruct the reviewer (./injection.js)
//   3 the AI review (./aiReview.js), when a key is set
//   4 the risk level and the decision (rules.riskFrom / rules.decide in ./rules.js): automatic approval only when EVERY condition holds
//     and AUTO_APPROVE=on; otherwise the application waits for a person ("Needs human"), sorted by risk, with the AI summary on top.
// The analysis runs when an application is submitted and the ID check has passed (or, before launch, when ID checks are not open yet).
// When the identity side changes later (ID approved, names corrected, an admin decides a step), the latest analysis is decided again
// without calling the AI again. One analysis per mentor runs at a time.
const { query } = require('../db');
const config = require('../config');
const rules = require('./rules');
const steps = require('./steps');
const linkCheck = require('./linkCheck');
const signals = require('./signals');
const { detectInjection } = require('./injection');
const aiReview = require('./aiReview');
const experience = require('./experience');
const { getUserById } = require('../models');

const isMentor = (u) => Boolean(u) && (u.role === 'mentor' || u.role === 'both');

// ---- One job per mentor at a time --------------------------------------------------------------------------------------------------------
const queues = new Map();
function enqueue(userId, job) {
  const prev = queues.get(userId) || Promise.resolve();
  const next = prev.then(job).catch((e) => console.error(`[analysis] ${userId}:`, e.message));
  queues.set(userId, next);
  next.then(() => { if (queues.get(userId) === next) queues.delete(userId); });
  return next;
}
// Waits for everything queued for this mentor (tests and admin re-runs use it).
const idle = (userId) => queues.get(userId) || Promise.resolve();

// ---- Facts for the decision ------------------------------------------------------------------------------------------------------------
function identityOf(stepMap) {
  const st = (s) => steps.effectiveStatus(stepMap[s]) || 'todo';
  return { kyc: st('id_kyc'), age: st('age'), names: st('name_match') };
}
const interviewRequested = (stepMap) => Boolean(stepMap.video_interview) && steps.effectiveStatus(stepMap.video_interview) !== 'passed';

async function latestReview(userId, submittedAt) {
  const { rows } = await query(
    `SELECT * FROM verification_reviews WHERE user_id = $1 AND ($2::timestamptz IS NULL OR submitted_at = $2) ORDER BY created_at DESC LIMIT 1`,
    [userId, submittedAt || null]);
  return rows[0] || null;
}

// ---- 1: evidence checks --------------------------------------------------------------------------------------------------------------------
async function checkEvidence(user) {
  const items = await experience.listEvidence(user.id);
  const person = { name: user.name, brands: [user.currentWork].filter((b) => b && b.length >= 3) };
  const summary = { total: 0, opened: 0, autoVerified: 0, dead: 0, shorteners: 0, newDomains: 0, adminCheck: 0 };
  const checked = [];
  for (const e of items) {
    let status = e.checkStatus;
    let auto = e.autoVerified;
    let result = e.checkResult || {};
    const decidedByAdmin = Boolean(e.decidedBy);
    if (!decidedByAdmin) {
      if (e.kind === 'work_email') { status = 'ok'; auto = true; }
      else if (e.kind === 'diploma') { status = 'admin_check'; auto = false; result = { document: Boolean(e.documentId) }; }
      else {
        result = {};
        if (e.registryId) {
          const f = linkCheck.companyIdFormat(e.registryId);
          result.companyType = f ? f.type : 'invalid';
          result.registry = rules.COMPANY_REGISTRY[0].url;
        }
        if (e.url) {
          const c = await linkCheck.checkLink(e.url, person);
          result = { ...result, ...c.result };
          status = c.checkStatus;
          auto = c.autoVerified;
        } else { status = 'admin_check'; auto = false; }
        if (e.registryId && status !== 'ok' && status !== 'failed') status = 'admin_check'; // (a company code is looked up by an admin)
      }
      await query(`UPDATE mentor_evidence SET check_status = $2, auto_verified = $3, check_result = $4, checked_at = now() WHERE id = $1`,
        [e.id, status, auto, JSON.stringify(result)]);
    }
    const flags = result.flags || [];
    if (e.url) {
      summary.total += 1;
      if (result.title !== undefined || result.description !== undefined) summary.opened += 1;
      if (flags.includes('dead_link') || flags.includes('refused_address')) summary.dead += 1;
      if (flags.includes('shortener')) summary.shorteners += 1;
      if (flags.includes('new_domain')) summary.newDomains += 1;
    }
    if (auto) summary.autoVerified += 1; // (an item an admin confirmed by hand does not count as checked automatically)
    if (status === 'admin_check') summary.adminCheck += 1;
    checked.push({ ...e, checkStatus: status, autoVerified: auto, checkResult: result });
  }
  return { items: checked, summary };
}

// ---- Spending limits for the AI part ------------------------------------------------------------------------------------------------------
// -> null when the AI may be asked, or the reason it is skipped ('monthly_budget_reached' | 'mentor_daily_limit').
let budgetWarned = null; // the month the admins were last told that the budget is used up
async function aiLimitReached(userId) {
  if (!config.AI_REVIEW_ENABLED) return null; // (aiReview says 'not_configured' itself)
  const { rows } = await query(
    `SELECT coalesce(sum(ai_cost_usd) FILTER (WHERE created_at >= date_trunc('month', now())), 0) AS month_cost,
            count(*) FILTER (WHERE user_id = $1 AND created_at > now() - interval '1 day' AND jsonb_array_length(ai_attempts) > 0)::int AS mentor_today
       FROM verification_reviews`, [userId]);
  if (Number(rows[0].month_cost) >= config.AI_MONTHLY_BUDGET_USD) {
    const month = new Date().toISOString().slice(0, 7);
    if (budgetWarned !== month) {
      budgetWarned = month;
      require('../notify').notifyAdmins('The AI review budget for this month is used up',
        `<p>The AI reviews of mentor applications have reached this month's budget ($${config.AI_MONTHLY_BUDGET_USD}, AI_MONTHLY_BUDGET_USD). Until next month, or until you raise it, applications are analysed without the AI part and wait for a person.</p>`);
    }
    return 'monthly_budget_reached';
  }
  if (rows[0].mentor_today >= config.AI_REVIEWS_PER_MENTOR_PER_DAY) return 'mentor_daily_limit';
  return null;
}

// ---- The whole analysis ---------------------------------------------------------------------------------------------------------------------
async function run(userId, trigger) {
  const user = await getUserById(userId);
  if (!isMentor(user) || user.verificationStatus !== 'pending') return null;
  if (!user.applicationSubmittedAt && trigger !== 'migrated') return null;
  // One analysis at a time per mentor, also across servers (a deploy can briefly run two): a recent one still running wins.
  const busy = await query(`SELECT 1 FROM verification_reviews WHERE user_id = $1 AND status = 'running' AND created_at > now() - interval '15 minutes'`, [user.id]);
  if (busy.rowCount) return null;
  const { rows } = await query(
    `INSERT INTO verification_reviews (user_id, rules_version, trigger, submitted_at) VALUES ($1, $2, $3, $4) RETURNING id`,
    [user.id, rules.VERSION, trigger, user.applicationSubmittedAt]);
  const reviewId = rows[0].id;
  try {
    const evidence = await checkEvidence(user);
    const sig = await signals.assess(user, evidence.items.filter((e) => e.url).map((e) => e.url), { domainCreated: linkCheck.domainCreated });
    const injection = detectInjection([
      { field: 'title', text: user.roleTitle }, { field: 'tags', text: (user.specialtyTags || []).join(', ') },
      { field: 'story', text: user.story }, { field: 'sample_answer', text: user.sampleAnswer },
      ...evidence.items.map((e) => ({ field: `evidence:${e.kind}`, text: [e.note, e.checkResult.title, e.checkResult.description].filter(Boolean).join(' \n') }))
    ]);
    const limit = await aiLimitReached(user.id);
    const ai = limit ? { result: null, model: null, error: limit, attempts: [] } : await aiReview.review(aiReview.buildApplication(user, evidence.items));
    const t = aiReview.totals(ai.attempts);
    await query(
      `UPDATE verification_reviews SET checks = $2, ai = $3, ai_model = $4, ai_error = $5, ai_attempts = $6, ai_input_tokens = $7, ai_output_tokens = $8, ai_cost_usd = $9
        WHERE id = $1`,
      [reviewId, JSON.stringify({ links: evidence.summary, signals: sig, injection }), ai.result ? JSON.stringify(ai.result) : null, ai.result ? ai.model : null,
        ai.error, JSON.stringify(ai.attempts), t.inputTokens, t.outputTokens, t.costUsd.toFixed(6)]);
    if (t.costUsd > 0) console.log(`[analysis] review ${reviewId}: ${t.inputTokens} in / ${t.outputTokens} out tokens, $${t.costUsd.toFixed(4)}`);
    return await decideAndApply(user.id, reviewId, { notify: true });
  } catch (e) {
    await query(`UPDATE verification_reviews SET status = 'failed', ai_error = coalesce(ai_error, $2), finished_at = now() WHERE id = $1`, [reviewId, `analysis_failed: ${e.message}`.slice(0, 300)]);
    console.error(`[analysis] review ${reviewId} failed:`, e.message);
    require('../notify').notifyAdmins('A mentor application needs a person (the automatic analysis failed)',
      `<p>The automatic analysis of an application failed (${String(e.message).slice(0, 200).replace(/[<>&]/g, '')}). Open the admin panel and review it by hand, or run the analysis again.</p>`);
    return null;
  }
}

// Decides (again) from a finished analysis and the mentor's current steps. Automatic approval happens here, and only here.
async function decideAndApply(userId, reviewId, { notify = false } = {}) {
  const user = await getUserById(userId);
  const review = (await query('SELECT * FROM verification_reviews WHERE id = $1', [reviewId])).rows[0];
  if (!user || !review) return null;
  const stepMap = await steps.loadSteps(user.id);
  const checks = review.checks || {};
  const identity = identityOf(stepMap);
  const facts = {
    identity,
    ai: review.ai,
    injection: Boolean(checks.injection && checks.injection.found),
    links: checks.links || {},
    signals: checks.signals || {}
  };
  const risk = rules.riskFrom(facts);
  const decision = rules.decide({
    autoApproveOn: config.AUTO_APPROVE,
    regulated: rules.isRegulated(user.niche),
    identity,
    interviewRequested: interviewRequested(stepMap),
    ai: review.ai,
    aiError: review.ai_error,
    injection: facts.injection,
    risk,
    autoVerifiedEvidence: (checks.links || {}).autoVerified || 0
  });
  // A migrated application that was never submitted under the new rules is never approved automatically.
  const canAuto = decision.outcome === 'auto_approved' && review.trigger !== 'migrated' && experience.submitted(user);
  const outcome = canAuto ? 'auto_approved' : 'needs_human';
  const reasons = canAuto || decision.outcome !== 'auto_approved' ? decision.reasons : [...decision.reasons, { code: 'not_submitted_under_v2' }];
  const firstTime = !review.outcome;
  await query(
    `UPDATE verification_reviews SET status = 'done', risk = $2, outcome = $3, reasons = $4, checks = checks || $5, finished_at = coalesce(finished_at, now()) WHERE id = $1`,
    [review.id, risk.level, outcome, JSON.stringify(reasons), JSON.stringify({ identity, risk, wouldAutoApprove: decision.wouldAutoApprove, decidedAt: new Date().toISOString() })]);

  if (outcome === 'auto_approved' && user.verificationStatus === 'pending') {
    const approved = await require('./review').autoApprove({ mentorId: user.id, reviewId: review.id });
    if (approved) return { outcome, risk: risk.level, approved: true };
  }
  if (notify && firstTime && review.trigger !== 'migrated') {
    const esc = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    require('../notify').notifyAdmins(`Mentor application to review (${risk.level} risk)`,
      `<p>${esc(user.name)} applied as a mentor (${esc(user.niche)}).${review.ai ? ` AI summary: ${esc(review.ai.admin_summary)}` : ' The AI review did not run.'}</p><p>Open the admin panel, Mentors, to decide.</p>`);
  }
  return { outcome, risk: risk.level, approved: false };
}

// ---- When to run --------------------------------------------------------------------------------------------------------------------------
const identityDone = (stepMap) => steps.effectiveStatus(stepMap.id_kyc) === 'passed';

// After "Submit for review": analyse now when the ID check has passed (or ID checks are not open on this site yet); otherwise the
// analysis starts as soon as the ID check passes.
function afterSubmit(userId, trigger) {
  return enqueue(userId, async () => {
    const stepMap = await steps.loadSteps(userId);
    if (identityDone(stepMap) || !config.ID_CHECKS_ENABLED) await run(userId, trigger);
  });
}

// The identity side changed (ID check result, age, names, an admin's decision on one of them).
function afterIdentityChange(userId) {
  return enqueue(userId, async () => {
    const user = await getUserById(userId);
    if (!isMentor(user) || user.verificationStatus !== 'pending' || !experience.submitted(user)) return;
    const latest = await latestReview(userId, user.applicationSubmittedAt);
    if (latest && latest.status === 'done') await decideAndApply(userId, latest.id);
    else if (!latest && (identityDone(await steps.loadSteps(userId)) || !config.ID_CHECKS_ENABLED)) await run(userId, 'identity');
  });
}

// The mentor corrected their profile name: evidence pages are looked at again for the new name (only when an analysis already ran).
function afterNameChange(userId) {
  return enqueue(userId, async () => {
    const user = await getUserById(userId);
    if (!isMentor(user) || user.verificationStatus !== 'pending' || !experience.submitted(user)) return;
    if (await latestReview(userId, user.applicationSubmittedAt)) await run(userId, 'identity');
  });
}

// An admin asks for a fresh analysis (for example after the mentor fixed a link, or once an AI key was added).
function rerun(userId) {
  return enqueue(userId, () => run(userId, 'admin_rerun'));
}

// Carried over from rules v1: analyse what the mentor already gave, for the admin (never approved automatically).
function runMigrated(userId) {
  return enqueue(userId, () => run(userId, 'migrated'));
}

// ---- For the admin panel ------------------------------------------------------------------------------------------------------------------
const reviewFromRow = (r) => r && ({
  id: r.id, trigger: r.trigger, status: r.status, rulesVersion: r.rules_version, submittedAt: r.submitted_at, createdAt: r.created_at, finishedAt: r.finished_at,
  risk: r.risk, outcome: r.outcome, reasons: r.reasons || [], checks: r.checks || {}, ai: r.ai, aiModel: r.ai_model, aiError: r.ai_error,
  aiAttempts: r.ai_attempts || [], usage: { inputTokens: r.ai_input_tokens, outputTokens: r.ai_output_tokens, costUsd: Number(r.ai_cost_usd) }
});

async function reviewsFor(userId, limit = 5) {
  const { rows } = await query('SELECT * FROM verification_reviews WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2', [userId, limit]);
  return rows.map(reviewFromRow);
}

// The latest analysis for each of these mentors (for the list).
async function latestFor(userIds) {
  if (!userIds.length) return {};
  const { rows } = await query(
    `SELECT DISTINCT ON (user_id) * FROM verification_reviews WHERE user_id = ANY($1::uuid[]) ORDER BY user_id, created_at DESC`, [userIds]);
  return Object.fromEntries(rows.map((r) => [r.user_id, reviewFromRow(r)]));
}

// What the AI reviews have cost: this month, the last 30 days and in total.
async function costs() {
  const { rows } = await query(
    `SELECT count(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS month_reviews,
            coalesce(sum(ai_cost_usd) FILTER (WHERE created_at >= date_trunc('month', now())), 0) AS month_cost,
            coalesce(sum(ai_input_tokens) FILTER (WHERE created_at >= date_trunc('month', now())), 0)::bigint AS month_in,
            coalesce(sum(ai_output_tokens) FILTER (WHERE created_at >= date_trunc('month', now())), 0)::bigint AS month_out,
            count(*)::int AS total_reviews, coalesce(sum(ai_cost_usd), 0) AS total_cost,
            count(*) FILTER (WHERE ai IS NOT NULL)::int AS with_ai
       FROM verification_reviews`);
  const r = rows[0];
  return {
    model: config.ANTHROPIC_MODEL, fallbackModel: config.ANTHROPIC_FALLBACK_MODEL || null, aiEnabled: config.AI_REVIEW_ENABLED, autoApprove: config.AUTO_APPROVE,
    budgetUsd: config.AI_MONTHLY_BUDGET_USD, perMentorPerDay: config.AI_REVIEWS_PER_MENTOR_PER_DAY,
    month: { reviews: r.month_reviews, costUsd: Number(r.month_cost), inputTokens: Number(r.month_in), outputTokens: Number(r.month_out) },
    total: { reviews: r.total_reviews, costUsd: Number(r.total_cost), withAi: r.with_ai },
    averageUsd: r.with_ai ? Number(r.total_cost) / r.with_ai : 0
  };
}

module.exports = { run, decideAndApply, afterSubmit, afterIdentityChange, afterNameChange, rerun, runMigrated, idle, reviewsFor, latestFor, latestReview, costs, reviewFromRow };
