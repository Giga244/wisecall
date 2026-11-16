// /apply.html: the mentor application, one step at a time (docs/CLAUDE-CODE-MENTOR-SIGNUP.md #3, docs/CLAUDE-CODE-UX-WALKTHROUGH.md A).
//   1 About you (what I do, my field in my own words with the closest category, years)  2 My path (three short blocks)  3 Your price
//   4 Proof of experience (one link or document; the licence in a regulated field)       5 ID check, then send
// The ID check comes before "send" (docs/CLAUDE-CODE-ID-CHECK-VISIBLE.md): until it has passed or is with the partner, step 5's one button
// starts it, and with steps 1-4 done "One step left: confirm your identity" is at the top of every step and of the "sent" screen.
// Each step is saved when the mentor moves on (or leaves with "Save and finish later"), so they can come back to it. The server decides
// every rule (what is required, what a link is, the category of a licensed profession); this page asks, saves and explains. The Settings
// tabs stay for later changes.
(async function () {
  await WisecallI18n.initI18n();
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (key, vars) => Object.entries(vars || {}).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const root = document.getElementById('applyRoot');
  const head = document.getElementById('applyHead');
  const STEPS = ['about', 'story', 'price', 'proof', 'submit'];
  const MAX_BYTES = 10 * 1024 * 1024;

  let user = await WisecallNav.initNav();
  if (!user) { window.location.href = (WisecallI18n.getLang() === 'ka' ? '/ka' : '') + '/signup.html?as=mentor'; return; }
  const config = await WisecallI18n.getConfig();

  // (the email code does not come first any more: docs/CLAUDE-CODE-EMAIL-CODE-FIX.md. A company mail server can hold the code for hours, so
  // the 5 steps start at once and the code box waits on step 5, before sending, and on the "sent" screen; see emailBox below.)
  // Somebody who came straight here (an invite, the dashboard, Google) becomes a mentor applicant now: the same as "Become a mentor".
  // (under 18 the server refuses: being a mentor is from 18)
  const notYet = () => { head.hidden = true; root.innerHTML = `<div class="apply-step"><p class="apply-lead" role="status">${esc(t('auth.mentor18'))}</p></div>`; };
  if (user.role !== 'mentor' && user.role !== 'both') {
    try { user = (await WisecallAPI.apiFetch('/me', { method: 'PATCH', body: { becomeMentor: true } })).user; }
    catch (e) {
      if (e.code === 'mentor_18') { notYet(); return; }
      root.innerHTML = `<p class="form-error">${esc(t('toast.error'))}</p>`; return;
    }
  }

  let v = null; // GET /verification
  // The 16 fields and their chips (/api/categories), and what the mentor has chosen so far on step 1.
  let catalog = null;
  let pick = { main: null, extras: [], directions: [], other: {} };
  let fieldPicker = null; // (public/js/field-picker.js, on step 1)
  const setPick = () => {
    const f = v.application.form;
    pick = { main: f.fieldId || null, extras: [...(f.extraFields || [])], directions: [...(f.directions || [])], other: { ...(f.directionOther || {}) }, suggestion: f.fieldSuggestion || '' };
  };
  let iv = null; // GET /verification/interview (a video call, only when an admin asked for one)
  async function load() {
    const [ver, me, interview, list] = await Promise.all([WisecallAPI.apiFetch('/verification'), WisecallAPI.apiFetch('/me'), WisecallAPI.apiFetch('/verification/interview').catch(() => null), catalog ? null : WisecallAPI.apiFetch('/categories')]);
    if (list) catalog = list;
    v = ver;
    user = me.user;
    iv = interview;
    // (the header's "2/5" follows a saved step at once)
    if (window.WisecallNav && WisecallNav.setUser) WisecallNav.setUser(user);
  }

  // ---- Which step ---------------------------------------------------------------------------------------------------------------------
  const missing = () => v.application.missing;
  const has = (...codes) => codes.some((c) => missing().includes(c));
  // Which steps are done, how many, and the first one that is not: the server's one count (experience.applicationProgress), the same
  // the header's "2/5" and the Settings card show (docs/CLAUDE-CODE-APPLY-PROGRESS.md). Step 5 is done when the ID check has passed.
  const progress = () => v.application.progress;
  const stepDone = (i) => Boolean(progress().done[i]);
  const STEP_OF = { headline: 0, years: 0, field: 0, niche: 0, story: 1, price: 2, evidence: 3, license: 3, license_document: 3 };
  const firstOpenStep = () => progress().next - 1;
  // A step 1-4 the mentor started or moved past, but that the server still finds incomplete, is never left silently unchecked: its dot
  // shows "!" and, opened, one line says what is missing (docs/CLAUDE-CODE-STORY-STEP-CHECK.md).
  let furthest = 0;
  const missingIn = (i) => missing().filter((c) => STEP_OF[c] === i);
  function started(i) {
    const f = v.application.form;
    return [Boolean(user.headline || f.customNiche || (f.yearsExperience !== null && f.yearsExperience !== undefined)),
      Boolean((f.story && f.story.trim()) || f.pathStart || f.pathHow || f.pathNow), user.price !== null && user.price !== undefined, v.application.evidence.length > 0 || Boolean(v.inputs.license)][i];
  }
  const flagged = (i) => i < 4 && !stepDone(i) && missingIn(i).length > 0 && (i < furthest || started(i));
  // The line under the step's title: for the story, why it does not count; otherwise what is missing.
  function gapLine(i) {
    if (i === 1 && v.application.storyReason === 'repeated') return t('apply.err.storyRepeated');
    return fill('apply.gap', { list: missingIn(i).map(missingText).join(', ') });
  }
  function stepFromUrl() {
    const n = Number(new URLSearchParams(window.location.search).get('step'));
    return Number.isInteger(n) && n >= 1 && n <= 5 ? n - 1 : null;
  }
  let current = 0;

  function go(i, { push = true } = {}) {
    current = Math.max(0, Math.min(4, i));
    furthest = Math.max(furthest, current);
    if (push) {
      const url = new URL(window.location.href);
      url.searchParams.set('step', String(current + 1));
      url.searchParams.delete('kyc');
      window.history.pushState({ step: current }, '', url.pathname + url.search);
    }
    render();
    const h = root.querySelector('h1');
    if (h) h.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  window.addEventListener('popstate', () => { const s = stepFromUrl(); if (s !== null && v && !v.application.locked) { current = s; render(); } });

  // ---- The ID check: where it stands ------------------------------------------------------------------------------------------------------
  // (the server's one word: todo | started | checking | passed | failed | blocked | closed; idLeft: steps 1-4 done and the check is what is left)
  const idState = () => v.application.id;
  const idWaits = () => WisecallI18n.idChecksOpen() && ['todo', 'started', 'failed'].includes(idState());
  const idFailedText = () => t(v.kycState === 'expired' ? 'vt.kyc.expired' : 'apply.id.failed');
  const returned = () => new URLSearchParams(window.location.search).get('kyc') === 'returned';
  function drawIdTop() {
    const top = document.getElementById('applyIdTop');
    // (on step 5 and on the "sent" screen the card is the page itself, not a second one on top)
    // (not while the email is unconfirmed: the ID check waits for it, and step 5 has the code box)
    const show = idWaits() && v.application.idLeft && !v.application.locked && current !== 4 && user.emailVerified;
    top.innerHTML = show ? WisecallIdCard.html(idState(), { failedText: idFailedText() }) : '';
    if (show) WisecallIdCard.wire(top);
  }

  // ---- The progress bar ---------------------------------------------------------------------------------------------------------------
  function drawHead() {
    head.hidden = false;
    // Where you are ("Step 2: Story") is one thing; how much is done ("2 of 5 done", the bar) is another.
    document.getElementById('applyProgressText').textContent = fill('apply.stepTitle', { n: current + 1, name: t('apply.step.' + STEPS[current]) });
    const done = fill('apply.doneCount', { n: progress().count, total: 5 });
    document.getElementById('applyDoneText').textContent = done;
    const bar = document.getElementById('applyBar');
    bar.setAttribute('aria-valuenow', String(progress().count));
    bar.setAttribute('aria-label', done);
    bar.querySelector('span').style.width = `${(progress().count / 5) * 100}%`;
    document.getElementById('applySteps').innerHTML = STEPS.map((s, i) => `
      <li class="${i === current ? 'is-current' : ''}${stepDone(i) ? ' is-done' : ''}${flagged(i) ? ' has-gap' : ''}">
        <button type="button" class="apply-step-link" data-goto="${i}"${i === current ? ' aria-current="step"' : ''}>
          <span class="apply-step-num" aria-hidden="true">${stepDone(i) && (i !== current || i === 4) ? '✓' : (flagged(i) && i !== current ? '!' : (i === 4 ? WisecallIdCard.ICON : i + 1))}</span>${flagged(i) ? `<span class="sr-only">${esc(t('apply.stepIncomplete'))}</span>` : ''}
          <span class="apply-step-name">${esc(t('apply.step.' + s))}</span>
        </button>
      </li>`).join('');
    // (wired here: the dots are drawn again on their own after a step is saved)
    document.getElementById('applySteps').querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => saveAndGo(Number(b.dataset.goto), false)));
  }

  // ---- The steps ----------------------------------------------------------------------------------------------------------------------
  const nav = (i, { nextLabel } = {}) => `
    <p class="form-error apply-error" role="alert"></p>
    <div class="apply-nav">
      ${i > 0 ? `<button type="button" class="btn btn-outline btn-lg apply-back" data-back>${esc(t('apply.back'))}</button>` : ''}
      <button type="submit" class="btn btn-primary btn-lg btn-arrow apply-next">${esc(t(nextLabel || 'apply.next'))}</button>
    </div>
    <p class="apply-later"><button type="button" class="linklike" data-later>${esc(t('apply.later'))}</button></p>`;

  const nicheName = (key) => (key === 'other' ? t('ap.f.niche.other') : t('niche.' + key));
  // Examples that fit the field (a headline, a lecturer's and a practitioner's story): one set for each family of fields
  // (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 2).
  const GROUP_OF = {
    medicine: 'health', dentistry: 'health', pharmacy: 'health', nursing: 'health', psychology: 'health', fitness: 'life',
    law: 'law',
    finance: 'money', accounting_tax: 'money', business: 'money', ecommerce: 'money', real_estate: 'money',
    tech: 'tech', data_ai: 'tech', cybersecurity: 'tech', gaming: 'tech', engineering: 'tech', architecture: 'tech',
    design: 'creative', creative: 'creative', film_photo: 'creative', music: 'creative', writing: 'creative', content_creation: 'creative', marketing: 'creative',
    teaching: 'education', study_abroad: 'education', languages: 'education', science: 'education', careers_hr: 'education',
    parenting: 'life', sports_coaching: 'life', cooking: 'life', tourism: 'life', wine_agriculture: 'life', freelancing: 'life',
    // (docs/CLAUDE-CODE-NEW-CATEGORIES.md)
    allied_health: 'health', economics: 'money', logistics: 'money', social_sciences: 'education', humanities: 'education',
    aviation: 'tech', maritime: 'tech', public_service: 'education', security_defense: 'life', beauty: 'creative', fashion: 'creative', performing_arts: 'creative'
  };
  const groupOf = (key) => GROUP_OF[key] || 'education';
  const isRegulated = (key) => Boolean((WisecallI18n.niches().find((n) => n.key === key) || {}).regulated);
  // A regulated field with no licence at all (psychology, nursing): a diploma or certificate counts, and the words say so, never "licence"
  // (server/verification/registries.js credential; docs/CLAUDE-CODE-APPLY-STEP1-MOBILE.md).
  const isDiploma = (key) => (WisecallI18n.niches().find((n) => n.key === key) || {}).credential === 'diploma';
  const dip = () => Boolean(v.licence && v.licence.credential === 'diploma');
  const lic = (key) => (dip() ? t(key + '.dip') : t(key));
  const missingText = (code) => ((code === 'license' || code === 'license_document') && dip() ? t(`ap.missing.${code}.dip`) : t('ap.missing.' + code));
  // The years, as typed: the first whole number in it ("25", "25 წელი", "25+"), or why there is none. A text box, not type="number",
  // which leaves the value empty for anything else (a word, a Georgian keyboard) and so looked like nothing was typed.
  function yearsOf(raw) {
    const s = String(raw || '').trim();
    if (!s) return { empty: true };
    const m = s.match(/\d+/);
    if (!m) return { error: 'nan' };
    const n = Number(m[0]);
    return n > v.limits.yearsMax ? { error: 'max' } : { n };
  }

  // An application that was sent before (v.application.optional, from the server): what step 1 has asked for since then is still asked of
  // its mentor, but never required, and never marked red: the label says "optional".
  const optional = (code) => (v.application.optional || []).includes(code);
  const optMark = (code) => (optional(code) ? ` <span class="apply-optional-mark">${esc(t('apply.optional'))}</span>` : '');
  function aboutStep() {
    const f = v.application.form;
    setPick();
    const niche = f.niche || '';
    const kind = f.practiceKind || '';
    const kindRadio = (k) => `<label class="apply-kind-option"><input type="radio" name="practiceKind" value="${k}"${kind === k ? ' checked' : ''}> <span>${esc(t('apply.f.kind.' + k))}</span></label>`;
    return `
      <form class="apply-step" data-step="0" novalidate>
        <h1 tabindex="-1">${esc(t('apply.about.title'))}</h1>
        <p class="apply-lead">${esc(t('apply.about.lead'))}</p>
        <div class="apply-field">
          <label for="apHeadline">${esc(t('apply.f.headline'))}${optMark('headline')}</label>
          <input id="apHeadline" name="headline" type="text" maxlength="100" value="${esc(user.headline || '')}" placeholder="${esc(t(`apply.ex.${groupOf(niche)}.headline`))}" autocomplete="organization-title" aria-describedby="apHeadlineHint apHeadlineErr"${optional('headline') ? '' : ' required'}>
          <span class="hint" id="apHeadlineHint">${esc(t('apply.f.headline.hint'))}</span>
          <p class="apply-field-error" id="apHeadlineErr" data-error-for="headline" hidden></p>
        </div>
        <div class="apply-field">
          <label for="apField">${esc(t('apply.f.field'))}${optMark('field')}</label>
          <input id="apField" name="customNiche" type="text" maxlength="60" value="${esc(f.customNiche || '')}" autocomplete="off" aria-describedby="apFieldHint apCategory apFieldErr"${optional('field') ? '' : ' required'}>
          <span class="hint" id="apFieldHint">${esc(t('apply.f.field.hint'))}</span>
          <p class="apply-field-error" id="apFieldErr" data-error-for="field" hidden></p>
        </div>
        <fieldset class="apply-field apply-picker" id="apPicker" tabindex="-1">
          <legend>${esc(t('pick.title'))}</legend>
          <span class="hint">${esc(t('pick.hint'))}</span>
          <p class="apply-field-error" id="apNicheErr" data-error-for="niche" hidden></p>
          <p class="apply-field-error" id="apExtraErr" data-error-for="extra" hidden></p>
          <div data-pick-area></div>
          <p class="mv-note apply-licence-note" data-licence-note${isRegulated(niche) ? '' : ' hidden'}>${esc(t(isDiploma(niche) ? 'apply.f.licenceNote.dip' : 'apply.f.licenceNote'))}</p>
          <p class="hint apply-psych-note" data-psych-note${niche === 'psychology' ? '' : ' hidden'}>${esc(t('apply.f.psychAcademic'))}</p>
        </fieldset>
        <div class="apply-field">
          <label for="apTags">${esc(t('pick.spec'))}</label>
          <input id="apTags" name="specialtyTags" type="text" maxlength="200" value="${esc((f.specialtyTags || []).join(', '))}" aria-describedby="apTagsHint apTagsErr">
          <span class="hint" id="apTagsHint">${esc(fill('pick.spec.hint', { max: v.limits.tagsMax, chars: v.limits.tagMax }))}</span>
          <p class="apply-field-error" id="apTagsErr" data-error-for="tags" hidden></p>
        </div>
        <div class="apply-field">
          <label for="apUniversity">${esc(t('pick.university'))}</label>
          <input id="apUniversity" name="university" type="text" maxlength="100" list="apUniversities" value="${esc(f.university || '')}" autocomplete="off" aria-describedby="apUniversityHint apUniversityErr">
          <span class="hint" id="apUniversityHint">${esc(t('pick.university.hint'))}</span>
          <p class="apply-field-error" id="apUniversityErr" data-error-for="university" hidden></p>
          <datalist id="apUniversities"></datalist>
        </div>
        <div class="apply-field">
          <label for="apCountry">${esc(t('pick.country'))}</label>
          <select id="apCountry" name="country"><option value="">${esc(t('pick.chooseCountry'))}</option>${(catalog ? catalog.countries : []).map((c) => `<option value="${esc(c.id)}"${f.country === c.id ? ' selected' : ''}>${esc(WisecallI18n.nameIn(c))}</option>`).join('')}</select>
        </div>
        <div class="apply-field">
          <label for="apCurrentRole">${esc(t('pick.currentRole'))}</label>
          <input id="apCurrentRole" name="currentRole" type="text" maxlength="100" value="${esc(f.currentRole || '')}" aria-describedby="apCurrentRoleHint apCurrentRoleErr">
          <span class="hint" id="apCurrentRoleHint">${esc(t('pick.currentRole.hint'))}</span>
          <p class="apply-field-error" id="apCurrentRoleErr" data-error-for="currentRole" hidden></p>
        </div>
        <p class="pick-preview" data-pick-preview aria-live="polite"></p>
        <fieldset class="apply-field apply-kind">
          <legend>${esc(t('apply.f.kind'))}</legend>
          ${['academic', 'practitioner', 'both'].map(kindRadio).join('')}
          <p class="mv-note" data-academic-limit hidden>${esc(t('apply.f.academicLimit'))}</p>
        </fieldset>
        <div class="apply-field apply-years">
          <label for="apYears">${esc(t('apply.f.years'))}${optMark('years')}</label>
          <select id="apYears" name="yearsExperience" aria-describedby="apYearsErr"${optional('years') ? '' : ' required'}>
            <option value="">${esc(t('apply.f.years.choose'))}</option>
            ${Array.from({ length: v.limits.yearsMax + 1 }, (x, n) => `<option value="${n}"${f.yearsExperience === n ? ' selected' : ''}>${esc(n === 0 ? t('apply.f.years.lessThanOne') : String(n))}</option>`).join('')}
          </select>
          <p class="apply-field-error" id="apYearsErr" data-error-for="years" hidden></p>
        </div>
        <!-- (optional: a title and specialty tags; open when something is already there, from the old Settings form for example) -->
        <details class="apply-more apply-optional"${f.roleTitle ? ' open' : ''}>
          <summary>${esc(t('apply.about.more'))}</summary>
          <div class="apply-field">
            <label for="apTitle">${esc(t('ap.f.title'))}</label>
            <input id="apTitle" name="roleTitle" type="text" maxlength="${v.limits.titleMax}" value="${esc(f.roleTitle || '')}" autocomplete="organization-title" aria-describedby="apTitleHint apTitleErr">
            <span class="hint" id="apTitleHint">${esc(t('ap.f.title.hint'))}</span>
            <p class="apply-field-error" id="apTitleErr" data-error-for="title" hidden></p>
          </div>
        </details>
        ${nav(0)}
      </form>`;
  }

  // Step 2, "My path" (docs/CLAUDE-CODE-MENTOR-STORY.md): three short blocks in place of the free-text story (public/js/story-form.js). A
  // story written before stays, and is shown on the profile, until the three blocks are filled in.
  const oldStoryOk = () => WisecallTextRules.storyVerdict(v.application.form.story, v.limits.storyMin).ok;
  function storyStep() {
    const f = v.application.form;
    const pathDone = !WisecallStoryForm.pathProblem(f, v.limits.story);
    return `
      <form class="apply-step" data-step="1" novalidate>
        <h1 tabindex="-1">${esc(t('story.title'))}</h1>
        <p class="apply-lead">${esc(t('story.lead'))}</p>
        ${WisecallStoryForm.html(f, { limits: v.limits.story, startTags: v.startTags || [], prefix: 'ap', oldStory: pathDone ? '' : (f.story || '') })}
        ${nav(1)}
      </form>`;
  }

  function priceStep() {
    return `
      <form class="apply-step" data-step="2" novalidate>
        <h1 tabindex="-1">${esc(t('apply.price.title'))}</h1>
        <p class="apply-lead">${esc(fill('apply.price.lead', { min: config.priceMin, max: config.priceMax }))}</p>
        <fieldset class="apply-field price-mode">
          <legend>${esc(t('price.mode.legend'))}</legend>
          <label class="checkbox-row"><input type="radio" name="priceMode" value="free"${user.price === 0 ? ' checked' : ''}> <span>${esc(t('price.mode.free'))}</span></label>
          <label class="checkbox-row"><input type="radio" name="priceMode" value="paid"${user.price === 0 ? '' : ' checked'}> <span>${esc(t('price.mode.paid'))}</span></label>
        </fieldset>
        <div class="apply-field" id="apPaidBox"${user.price === 0 ? ' hidden' : ''}>
          <label for="apPrice">${esc(t('apply.f.price'))}</label>
          <div class="apply-money"><input id="apPrice" name="price" type="number" min="${config.priceMin}" max="${config.priceMax}" step="1" inputmode="numeric" value="${esc(user.price || '')}" aria-describedby="apPriceSuggest apPriceYou" required><span aria-hidden="true">₾</span></div>
          <p class="hint" id="apPriceSuggest">${esc(fill(v.priceRange && v.priceRange.fromData ? 'apply.price.range' : 'apply.price.suggest', { from: (v.priceRange || {}).from || 20, to: (v.priceRange || {}).to || 50, field: nicheName(v.niche) }))}</p>
        </div>
        <p class="apply-you" id="apPriceYou" aria-live="polite"></p>
        ${nav(2)}
      </form>`;
  }

  const EV_STATE_BADGE = { verified: 'answered', team: 'paid', unchecked: 'badge-muted', unclear: 'pending_payment', problem: 'rejected' };
  function evidenceList() {
    const list = v.application.evidence;
    if (!list.length) return '';
    return `<ul class="ap-evidence apply-evidence">${list.map((e) => `
      <li>
        <div class="ap-evidence-main">
          <span class="ap-evidence-kind">${esc(t('ap.ev.kind.' + e.kind))}</span>
          <span class="ap-evidence-what">${e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer nofollow">${esc(e.url)}</a>` : esc(e.registryId || e.filename || '')}</span>
        </div>
        <span class="badge badge-${EV_STATE_BADGE[e.state] || 'badge-muted'}">${esc(t('ap.ev.state.' + e.state))}</span>
        ${e.kind !== 'work_email' ? `<button type="button" class="btn btn-ghost btn-sm" data-ev-remove="${esc(e.id)}">${esc(t('ap.ev.remove'))}</button>` : ''}
      </li>`).join('')}</ul>`;
  }

  // A field whose register is public (law, accounting): the number and who issued it are enough. An admin looks the number up, so
  // nothing has to be uploaded or linked, and the end date is optional ("No expiry" is ticked to begin with).
  const publicRegister = () => Boolean(v.regulated && v.licence && v.licence.publicRegister);
  // The words of a licence that was sent: its end date only when it has one, and the second licence when one was named.
  const licenceLine = (l) => esc(fill(dip() || !l.validUntil ? 'vt.lic.submitted.dip' : 'vt.lic.submitted', { last4: l.numberEnding, body: l.issuingBody, date: l.validUntil }))
    + (l.second ? ` ${esc(fill('vt.lic.second.line', { body: l.second.issuingBody }))}` : '');
  const bodyHint = () => { const own = t('vt.lic.bodyHint.' + v.niche); return dip() || own === 'vt.lic.bodyHint.' + v.niche ? lic('vt.lic.bodyHint') : own; };
  function licenceBlock() {
    if (!v.regulated) return '';
    const l = v.inputs.license;
    const r = (v.requirements.find((x) => x.step === 'license') || { status: 'todo' });
    const needsDoc = v.requirements.some((x) => x.step === 'license_document');
    const docs = v.inputs.documents.filter((d) => d.step === 'license_document');
    return `
      <div class="apply-block apply-licence">
        <h2>${esc(lic('ap.lic.title'))}</h2>
        ${publicRegister() ? `<p class="hint apply-register-note">${esc(t('ap.lic.register'))}</p>`
    : `<p class="hint">${esc(fill(dip() ? 'ap.lic.help.dip' : 'ap.lic.help', { niche: t('niche.' + v.niche) }))}</p>`}
        ${l && r.status !== 'failed' ? `<p class="ap-line ap-ok">✓ ${licenceLine(l)}</p>` : `
        <div class="apply-sub" data-sub="license">
          ${r.status === 'failed' && r.reason ? `<p class="form-error"><strong>${esc(t('vt.reason'))}</strong> ${esc(r.reason)}</p>` : ''}
          <div class="apply-field"><label for="apLicNumber">${esc(lic('vt.lic.number'))}</label><input id="apLicNumber" name="number" type="text" maxlength="40" autocomplete="off"></div>
          <div class="apply-field"><label for="apLicBody">${esc(lic('vt.lic.body'))}</label><input id="apLicBody" name="issuingBody" type="text" maxlength="120" placeholder="${esc(bodyHint())}"></div>
          <div class="apply-field"><label for="apLicHolder">${esc(lic('vt.lic.holder'))}</label><input id="apLicHolder" name="holderName" type="text" maxlength="100" value="${esc(l ? l.holderName : user.name)}"></div>
          <!-- (a licence may have no end date at all: "No expiry" instead of a date; a diploma never has one) -->
          <div class="apply-field apply-until">
            <label for="apLicUntil">${esc(lic('vt.lic.until'))}</label>
            <input id="apLicUntil" name="validUntil" type="date" value="${esc(l && l.validUntil ? l.validUntil : '')}"${!dip() && publicRegister() && !(l && l.validUntil) ? ' disabled' : ''}>
            ${dip() ? '' : `<label class="checkbox-row apply-noexpiry" for="apLicNoExpiry"><input id="apLicNoExpiry" name="noExpiry" type="checkbox"${publicRegister() && !(l && l.validUntil) ? ' checked' : ''}> <span>${esc(t('vt.lic.noExpiry'))}</span></label>`}
          </div>
          ${dip() ? '' : `<details class="apply-more apply-second">
            <summary>${esc(t('vt.lic.second'))}</summary>
            <div class="apply-field"><label for="apLic2Body">${esc(t('vt.lic.second.body'))}</label><input id="apLic2Body" name="secondBody" type="text" maxlength="120" placeholder="${esc(t('vt.lic.second.bodyHint'))}" autocomplete="off"></div>
            <div class="apply-field"><label for="apLic2Number">${esc(t('vt.lic.second.number'))}</label><input id="apLic2Number" name="secondNumber" type="text" maxlength="40" autocomplete="off"></div>
          </details>`}
          <p class="form-error apply-sub-error" role="alert"></p>
          <button type="button" class="btn btn-outline btn-lg" data-save-licence>${esc(lic('vt.lic.save'))}</button>
        </div>`}
        ${needsDoc ? `
          <p class="hint">${esc(lic('ap.lic.docHelp'))} ${esc(t('vt.doc.private'))}</p>
          ${docs.length ? `<ul class="vt-files">${docs.map((f) => `<li><span>${esc(f.filename)}</span> <button type="button" class="btn btn-ghost btn-sm" data-doc-remove="${esc(f.id)}">${esc(t('vt.doc.remove'))}</button></li>`).join('')}</ul>` : `
          <div class="apply-sub" data-sub="licenceDoc">
            <div class="apply-field"><label for="apLicDoc">${esc(t('vt.doc.choose'))}</label><input id="apLicDoc" type="file" accept="application/pdf,image/jpeg,.pdf,.jpg,.jpeg"></div>
            <p class="form-error apply-sub-error" role="alert"></p>
            <button type="button" class="btn btn-outline btn-lg" data-upload="license_document" data-input="apLicDoc">${esc(t('vt.doc.upload'))}</button>
          </div>`}` : ''}
      </div>`;
  }

  function proofStep() {
    const kinds = v.evidenceKinds.filter((k) => k !== 'diploma');
    const count = v.application.evidence.length;
    return `
      <form class="apply-step" data-step="3" novalidate>
        <h1 tabindex="-1">${esc(t('apply.proof.title'))}</h1>
        <p class="apply-lead">${esc(t(publicRegister() ? 'apply.proof.leadRegister' : 'apply.proof.lead'))}</p>
        ${publicRegister() ? `${licenceBlock()}<p class="hint apply-proof-optional">${esc(t('apply.proof.optional'))}</p>` : ''}
        ${evidenceList()}
        <div class="apply-sub" data-sub="evidence">
          <div class="apply-field">
            <label for="apUrl">${esc(t(count ? 'apply.f.urlMore' : 'apply.f.url'))}</label>
            <input id="apUrl" name="url" type="url" maxlength="500" placeholder="https://" inputmode="url" autocapitalize="none" autocorrect="off" spellcheck="false" aria-describedby="apUrlHint">
            <span class="hint" id="apUrlHint">${esc(t('apply.f.url.hint'))}</span>
            <p class="hint apply-uni" id="apUniHint" aria-live="polite" hidden></p>
          </div>
          <details class="apply-more">
            <summary>${esc(t('apply.f.moreOptions'))}</summary>
            <div class="apply-field">
              <label for="apKind">${esc(t('ap.ev.kind'))}</label>
              <select id="apKind" name="kind"><option value="auto">${esc(t('apply.f.kindAuto'))}</option>${kinds.map((k) => `<option value="${k}">${esc(t('ap.ev.kind.' + k))}</option>`).join('')}</select>
            </div>
            <div class="apply-field apply-registry" hidden>
              <label for="apRegistry">${esc(t('ap.ev.registry'))}</label>
              <input id="apRegistry" name="registryId" type="text" maxlength="13" inputmode="numeric" autocomplete="off">
              <span class="hint">${esc(t('ap.ev.registry.hint'))}</span>
            </div>
            <div class="apply-field">
              <label for="apNote">${esc(t('ap.ev.note'))}</label>
              <input id="apNote" name="note" type="text" maxlength="${v.limits.evidenceNoteMax}">
            </div>
          </details>
          <p class="form-error apply-sub-error" role="alert"></p>
          <button type="button" class="btn btn-outline btn-lg" data-add-link>${esc(t('apply.f.addLink'))}</button>
        </div>
        <div class="apply-sub apply-doc" data-sub="diploma">
          <p class="apply-or">${esc(t('apply.proof.or'))}</p>
          <div class="apply-field">
            <label for="apDoc">${esc(t('apply.f.document'))}</label>
            <input id="apDoc" type="file" accept="application/pdf,image/jpeg,.pdf,.jpg,.jpeg" aria-describedby="apDocHint">
            <span class="hint" id="apDocHint">${esc(t('apply.f.document.hint'))}</span>
          </div>
          <p class="form-error apply-sub-error" role="alert"></p>
          <button type="button" class="btn btn-outline btn-lg" data-upload="diploma" data-input="apDoc">${esc(t('vt.doc.upload'))}</button>
        </div>
        ${publicRegister() ? '' : licenceBlock()}
        ${nav(3)}
      </form>`;
  }

  // What the ID check is, why we ask, and what stays private: before the button, in a few lines.
  const idExplainer = () => `
      <div class="apply-idbox">
        <p><strong>${esc(t('apply.id.whatTitle'))}</strong> ${esc(t('apply.id.what'))}</p>
        <p><strong>${esc(t('apply.id.whyTitle'))}</strong> ${esc(t('apply.id.why'))}</p>
        <p><strong>${esc(t('apply.id.privacyTitle'))}</strong> ${esc(t('apply.id.privacy'))}</p>
      </div>`;
  // A university from a link (the known Georgian ones by name; any .edu or ac. address as "a university page").
  function universityOf(value) {
    let host = '';
    try { host = new URL(String(value).trim()).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return null; }
    const known = (v.universities || []).find((u) => host === u.domain || host.endsWith('.' + u.domain));
    if (known) return { name: WisecallI18n.getLang() === 'ka' ? known.ka : known.en };
    return /(^|\.)(edu\.ge|edu|ac\.[a-z]{2}|edu\.[a-z]{2})$/i.test(host) ? { name: null } : null;
  }

  // Step 5: the ID check, what is done and what is missing (each with a link to its step), and "Submit for review".
  function kycBlock() {
    const r = v.requirements.find((x) => x.step === 'id_kyc') || { status: 'todo' };
    const state = v.kycState;
    const returned = new URLSearchParams(window.location.search).get('kyc') === 'returned';
    if (r.status === 'passed') return `<p class="apply-check is-done"><span aria-hidden="true">✓</span> ${esc(t('ap.id.passed'))}</p>`;
    if (!WisecallI18n.idChecksOpen()) return `<p class="vt-soon" role="status"><strong>${esc(t('vt.kyc.soon'))}</strong> ${esc(t('apply.id.soon'))}</p>`;
    let note = '';
    let label = 'vt.kyc.start';
    if (r.status === 'failed') { note = `<p class="apply-failed" role="alert">${esc(t(state === 'expired' ? 'vt.kyc.expired' : 'apply.id.failed'))}</p>`; label = 'vt.kyc.retry'; }
    else if (state === 'in_review') note = `<p class="apply-id-checking" role="status">${esc(t('idcard.checking'))}</p>`;
    else if (state === 'started') { note = `<p class="hint">${esc(t(returned ? 'vt.kyc.returned' : 'vt.kyc.started'))}</p>`; label = 'vt.kyc.continue'; }
    // (on a computer: the same check on a phone, by its camera, from a QR code of the partner's link)
    const desktop = WisecallIdCard.showsQr();
    return `
      ${idExplainer()}
      ${note}
      <div class="apply-actions">
        ${state === 'in_review' ? '' : `<button type="button" class="btn btn-outline btn-lg" data-kyc-start>${esc(t(label))}</button>`}
        ${state === 'in_review' || !desktop ? '' : `<button type="button" class="btn btn-ghost btn-lg" data-kyc-qr>${esc(t('apply.id.qr'))}</button>`}
        ${r.status === 'pending' ? `<button type="button" class="btn btn-ghost btn-lg" data-reload>${esc(t('vt.kyc.refresh'))}</button>` : ''}
      </div>
      <div class="apply-qr" data-kyc-qr-box hidden></div>
      <p class="form-error apply-kyc-error" role="alert"></p>`;
  }

  // The checklist: one line per thing a reviewer needs, done or not, with the step to go back to.
  function checklist() {
    const rows = [
      ['email', Boolean(user.emailVerified), null],
      ['about', stepDone(0), 0],
      ['story', stepDone(1), 1],
      ['price', stepDone(2), 2],
      ['proof', !has('evidence'), 3]
    ];
    if (v.regulated) rows.push(['licence', !has('license', 'license_document'), 3]);
    const id = (v.requirements.find((x) => x.step === 'id_kyc') || {}).status;
    return `
      <ul class="apply-checklist">
        ${rows.map(([key, done, step]) => `
          <li class="${done ? 'is-done' : 'is-missing'}">
            <span class="apply-check-mark" aria-hidden="true">${done ? '✓' : '○'}</span>
            <span><span class="sr-only">${esc(t(done ? 'apply.check.doneSr' : 'apply.check.missingSr'))}</span>${esc(key === 'licence' ? lic('apply.check.licence') : t('apply.check.' + key))}</span>
            ${!done && step !== null ? `<button type="button" class="linklike" data-goto="${step}">${esc(fill('apply.check.goto', { n: step + 1 }))}</button>` : ''}
          </li>`).join('')}
        <li class="${id === 'passed' ? 'is-done' : 'is-later'}">
          <span class="apply-check-mark" aria-hidden="true">${id === 'passed' ? '✓' : '○'}</span>
          <span>${esc(t('apply.check.id'))}${id === 'passed' ? '' : ` <span class="hint">${esc(t(idWaits() ? 'apply.check.idFirst' : (idState() === 'checking' ? 'idcard.checking' : 'apply.check.idLater')))}</span>`}</span>
        </li>
      </ul>`;
  }

  function submitStep() {
    const ready = !missing().length;
    const lacking = missing().filter((m) => STEP_OF[m] !== undefined || m === 'email');
    // The ID check first: until it has passed (or is with the partner) its button is the step's one button, and there is no "send" yet.
    if (idWaits()) {
      return `
      <form class="apply-step apply-step-id" data-step="4" novalidate>
        ${user.emailVerified ? WisecallIdCard.html(idState(), { heading: 'h1', failedText: idFailedText(), returned: returned(), title: v.application.idLeft ? null : 'apply.id.title' })
          : `<h1 tabindex="-1">${esc(t('apply.id.title'))}</h1><p class="apply-lead apply-id-wait">${esc(t('apply.email.idWaits'))}</p>`}
        <div class="apply-block">
          <h2>${esc(t('apply.check.title'))}</h2>
          ${checklist()}
        </div>
        <p class="hint apply-send-after">${esc(t(ready ? 'apply.id.sendAfter' : 'apply.id.sendAfterSteps'))}</p>
        <p class="form-error apply-error" role="alert"></p>
        <div class="apply-nav">
          <button type="button" class="btn btn-outline btn-lg apply-back" data-back>${esc(t('apply.back'))}</button>
        </div>
        <p class="apply-later"><button type="button" class="linklike" data-later>${esc(t('apply.later'))}</button></p>
      </form>`;
    }
    return `
      <form class="apply-step" data-step="4" novalidate>
        <h1 tabindex="-1">${esc(t('apply.submit.title'))}</h1>
        <div class="apply-block">
          <h2>${esc(t('apply.id.title'))}</h2>
          ${kycBlock()}
        </div>
        <div class="apply-block">
          <h2>${esc(t('apply.check.title'))}</h2>
          ${checklist()}
        </div>
        ${ready ? '' : `
          <div class="ap-missing apply-missing" role="note" id="apMissing">
            <p><strong>${esc(t('apply.missing.head'))}</strong></p>
            <ul>${lacking.map((m) => `<li>${esc(missingText(m))}${STEP_OF[m] !== undefined ? ` <button type="button" class="linklike" data-goto="${STEP_OF[m]}">${esc(fill('apply.check.goto', { n: STEP_OF[m] + 1 }))}</button>` : ''}</li>`).join('')}</ul>
          </div>`}
        <p class="hint apply-ai">${esc(t('ap.submit.ai'))} <a href="/privacy.html#automated-review">${esc(t('ap.submit.privacy'))}</a></p>
        <p class="form-error apply-error" role="alert"></p>
        <div class="apply-nav">
          <button type="button" class="btn btn-outline btn-lg apply-back" data-back>${esc(t('apply.back'))}</button>
          <button type="submit" class="btn btn-primary btn-lg apply-submit" data-submit${ready ? '' : ' disabled aria-describedby="apMissing"'}>${esc(t('ap.submit'))}</button>
        </div>
        <p class="apply-later"><button type="button" class="linklike" data-later>${esc(t('apply.later'))}</button></p>
      </form>`;
  }

  // ---- After "Submit": where it stands, and everything still to do until the decision ---------------------------------------------------
  // The ID check (and what it found), a licence to give again, a video call an admin asked for, a step that failed, and "Edit my
  // application": all here. Settings only says where the application stands (docs/CLAUDE-CODE-ONE-APPLY-PATH.md).
  const statusOf = (step) => (v.requirements.find((x) => x.step === step) || {}).status || 'todo';
  function identityDone() {
    if (statusOf('id_kyc') !== 'passed') return kycBlock();
    const lines = [`<p class="apply-check is-done"><span aria-hidden="true">✓</span> ${esc(t('ap.id.passed'))}</p>`];
    const age = statusOf('age');
    const names = statusOf('name_match');
    if (age === 'passed') lines.push(`<p class="apply-check is-done"><span aria-hidden="true">✓</span> ${esc(t('ap.age.passed'))}</p>`);
    else if (age === 'failed') lines.push(`<p class="apply-failed">${esc(t('ap.age.failed'))}</p>`);
    else lines.push(`<p class="hint">${esc(t('ap.age.pending'))}</p>`);
    if (names === 'passed') lines.push(`<p class="apply-check is-done"><span aria-hidden="true">✓</span> ${esc(t('ap.name.passed'))}</p>`);
    else if (names === 'todo') lines.push(`<p class="hint">${esc(t('ap.name.checking'))}</p>`);
    else lines.push(`<p class="hint">${esc(t('ap.name.pending'))} <a href="/settings.html?tab=profile">${esc(t('ap.name.fix'))}</a></p>`);
    return lines.join('');
  }
  function interviewBlock() {
    if (!iv || !iv.required) return '';
    if (statusOf('video_interview') === 'passed') return `<p class="apply-check is-done"><span aria-hidden="true">✓</span> ${esc(t('ap.rev.interviewDone'))}</p>`;
    const when = (d) => WisecallI18n.formatDate(d, { dateStyle: 'full', timeStyle: 'short' });
    let body;
    if (iv.booking) {
      body = `
        <p><strong>${esc(fill('vt.iv.booked', { date: when(iv.booking.startsAt) }))}</strong></p>
        ${iv.booking.meetingLink ? `<p><a class="btn btn-primary btn-lg" href="${esc(iv.booking.meetingLink)}" target="_blank" rel="noopener noreferrer">${esc(t('vt.iv.link'))}</a></p>` : `<p class="hint">${esc(t('vt.iv.linkPending'))}</p>`}
        <button type="button" class="btn btn-outline btn-lg" data-iv-cancel>${esc(t('vt.iv.cancel'))}</button>`;
    } else if (iv.blocked) body = `<p class="hint">${esc(t('vt.iv.blocked'))}</p>`;
    else {
      const failed = iv.result && iv.result.result === 'failed';
      body = `
        ${failed ? `<p class="apply-failed">${esc(t('vt.iv.failed'))}${iv.result.reason ? ' ' + esc(iv.result.reason) : ''}</p>` : ''}
        ${iv.slots.length ? `
          <p class="hint">${esc(fill('vt.iv.pick', { minutes: iv.slots[0].minutes }))}</p>
          <ul class="vt-slots apply-slots">${iv.slots.map((s) => `<li><span>${esc(when(s.startsAt))}</span><button type="button" class="btn btn-outline btn-lg" data-book="${esc(s.id)}">${esc(t('vt.iv.book'))}</button></li>`).join('')}</ul>`
          : `<p class="hint">${esc(t('vt.iv.none'))}</p>`}`;
    }
    const r = v.requirements.find((x) => x.step === 'video_interview') || {};
    return `
      <div class="apply-block apply-interview">
        <h2>${esc(t('verify.step.video_interview'))}</h2>
        <p class="hint">${esc(t('ap.rev.interview'))}</p>
        ${r.reason ? `<p class="hint">${esc(r.reason)}</p>` : ''}
        ${body}
        <p class="form-error apply-iv-error" role="alert"></p>
      </div>`;
  }
  function doneScreen() {
    const stage = v.application.stage;
    // Sent, but the ID check is still to do: not "we're reviewing", but the one step left (docs/CLAUDE-CODE-ID-CHECK-VISIBLE.md 5).
    if (idWaits() && stage !== 'suspended' && stage !== 'rejected') {
      return `
      <div class="apply-step apply-done apply-done-id">
        ${WisecallIdCard.html(idState(), { heading: 'h1', failedText: idFailedText(), returned: returned() })}
        <p class="apply-status"><strong>${esc(t('apply.done.status'))}</strong> ${esc(t('apply.id.sentWaiting'))}</p>
        <div class="apply-actions">
          <a class="btn btn-outline btn-lg" href="/dashboard.html">${esc(t('apply.done.dashboard'))}</a>
          <button type="button" class="btn btn-ghost btn-lg" data-edit>${esc(t('ap.edit'))}</button>
        </div>
        <p class="form-error apply-error" role="alert"></p>
      </div>`;
    }
    const checkingId = idState() === 'checking' && stage === 'waiting_identity';
    const days = config.mentorReviewDays || 2;
    const approved = stage === 'approved';
    const closed = stage === 'suspended';
    const failed = v.requirements.find((r) => r.status === 'failed');
    const licenceToFix = v.regulated && ['license', 'license_document'].some((s) => v.requirements.some((x) => x.step === s) && statusOf(s) !== 'passed' && statusOf(s) !== 'pending');
    return `
      <div class="apply-step apply-done">
        <h1 tabindex="-1">${esc(t(approved ? 'apply.done.approvedTitle' : 'apply.done.title'))}</h1>
        ${approved ? `<p class="apply-lead">${esc(t('ap.rev.approved'))}</p>` : (closed ? '' : checkingId ? `<p class="apply-lead apply-id-checking" role="status">${esc(t('idcard.checking'))}</p>` : `<p class="apply-lead">${esc(fill(days === 1 ? 'apply.done.body1' : 'apply.done.body', { days }))}</p>
          <div class="apply-block apply-next-steps">
            <h2>${esc(t('apply.done.next.title'))}</h2>
            <ol>
              <li>${esc(fill('apply.done.next.1', { days }))}</li>
              <li>${esc(t('apply.done.next.2'))}</li>
              <li>${esc(t(WisecallI18n.launchMode() === 'prelaunch' ? 'apply.done.next.3' : 'apply.done.next.3live'))}</li>
            </ol>
          </div>`)}
        ${failed && !closed ? `<p class="apply-failed" role="alert">${esc(t('settings.failed.' + failed.step))}${failed.reason ? ` <span>${esc(failed.reason)}</span>` : ''}</p>` : ''}
        ${closed ? '' : `
          <div class="apply-block">
            <h2>${esc(t(statusOf('id_kyc') === 'passed' ? 'apply.id.title' : 'apply.done.idTitle'))}</h2>
            ${identityDone()}
          </div>`}
        ${licenceToFix ? licenceBlock() : ''}
        ${closed ? '' : interviewBlock()}
        <p class="apply-status"><strong>${esc(t('apply.done.status'))}</strong> ${esc(t('ap.rev.' + stage))}</p>
        <div class="apply-actions">
          ${approved && user.needsPayout ? `<a class="btn btn-primary btn-lg" href="/settings.html?tab=payouts">${esc(t('vt.addPayout'))}</a>` : ''}
          <a class="btn btn-outline btn-lg" href="/dashboard.html">${esc(t('apply.done.dashboard'))}</a>
          ${approved ? `<a class="btn btn-ghost btn-lg" href="/settings.html?tab=verification">${esc(t('apply.done.settings'))}</a>` : ''}
          ${closed ? '' : `<button type="button" class="btn btn-ghost btn-lg" data-edit${approved ? ' data-confirm="1"' : ''}>${esc(t('ap.edit'))}</button>`}
        </div>
        <p class="form-error apply-error" role="alert"></p>
      </div>`;
  }

  // ---- Drawing and wiring -------------------------------------------------------------------------------------------------------------
  // The email code box while the email is not confirmed (public/js/email-code.js): on step 5 above "send" (sending does not wait for it:
  // the application is then "Email not confirmed yet", and it cannot be approved until the code is entered) and on the "sent" screen.
  // Outside the step's form (it has forms of its own).
  function emailBox(sent) {
    if (user.emailVerified) return;
    root.insertAdjacentHTML('afterbegin', `<div class="apply-email${sent ? ' is-sent' : ''}">${WisecallEmailCode.html(user, { title: sent ? 'email.code.title' : (idWaits() ? 'apply.email.beforeIdTitle' : 'apply.email.boxTitle'), note: sent ? 'dash.email.body' : (idWaits() ? null : 'apply.email.sendAnyway') })}</div>`);
    WisecallEmailCode.wire(root.querySelector('.apply-email'), user, {
      onVerified: async (u) => { user = u; await load(); render(); },
      onSwitched: (u) => { user = u; }
    });
  }
  function render() {
    drawIdTop();
    if (v.application.locked) {
      head.hidden = true;
      root.innerHTML = doneScreen();
      emailBox(true);
      WisecallIdCard.wire(root);
      wireCommon();
      wireLicence(root);
      wireDone();
      return;
    }
    drawHead();
    root.innerHTML = [aboutStep, storyStep, priceStep, proofStep, submitStep][current]();
    if (current === 4) emailBox(false);
    WisecallIdCard.wire(root);
    const h1 = root.querySelector('form.apply-step h1');
    if (h1 && flagged(current)) h1.insertAdjacentHTML('afterend', `<p class="apply-gap" role="status"><span aria-hidden="true">!</span> ${esc(gapLine(current))}</p>`);
    wireCommon();
    wireStep();
  }

  // (brought into view: on a phone the line under the buttons can be below the screen)
  const stepError = (text) => { const el = root.querySelector('.apply-error'); if (!el) return; el.textContent = text || ''; if (text && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); };
  const subError = (sub, text) => { const el = sub && sub.querySelector('.apply-sub-error'); if (el) el.textContent = text || ''; };
  // (the numbers in a message are the server's own limits, so a message can never name a limit that is no longer the rule)
  const errText = (map, e) => fill(map[e.code] || 'toast.error', { max: v.limits.tagsMax, chars: v.limits.tagMax,
    role: ((catalog || {}).limits || {}).currentRoleMax || 100, university: ((catalog || {}).limits || {}).universityMax || 100 });

  const ERR = {
    invalid_field: 'toast.error', invalid_years: 'ap.err.invalid_years', story_too_long: 'ap.err.story_too_long', invalid_niche: 'ap.err.invalid_niche',
    invalid_custom_niche: 'ap.err.invalid_custom_niche', application_locked: 'ap.err.application_locked', email_not_verified: 'settings.mentor.emailNotVerified',
    invalid_price: 'apply.err.price', extra_regulated: 'apply.err.extraRegulated', too_many_niches: 'apply.err.extraRegulated', too_many_directions: 'ap.err.too_many_directions', too_many_fields: 'ap.err.too_many_fields', invalid_university: 'ap.err.invalid_university', invalid_current_role: 'ap.err.invalid_current_role', bio_too_long: 'toast.error', invalid_tags: 'ap.err.invalid_tags', title_too_long: 'ap.err.title_too_long', sample_too_long: 'ap.err.sample_too_long'
  };
  const EV_ERR = {
    invalid_url: 'ap.ev.err.invalid_url', invalid_kind: 'ap.ev.err.invalid_url', not_linkedin: 'ap.ev.err.not_linkedin', duplicate_evidence: 'ap.ev.err.duplicate_evidence', too_much_evidence: 'ap.ev.err.too_much_evidence',
    invalid_company_id: 'ap.ev.err.invalid_company_id', company_needs_id_or_url: 'ap.ev.err.company_needs_id_or_url', application_locked: 'ap.err.application_locked',
    unsupported_file_type: 'vt.doc.err.type', file_too_large: 'vt.doc.err.size', too_many_files: 'vt.doc.err.many', empty_file: 'vt.doc.err.empty'
  };
  const LIC_ERR = { invalid_second_body: 'vt.lic.err.secondBody', invalid_second_number: 'vt.lic.err.secondNumber', invalid_license_number: 'vt.lic.err.number', invalid_issuing_body: 'vt.lic.err.body', invalid_holder_name: 'vt.lic.err.holder', invalid_valid_until: 'vt.lic.err.until' };

  // ---- Step 1 (about you): an error under each field, the years read from what was typed, and a draft saved as the mentor goes
  // (docs/CLAUDE-CODE-APPLY-STEP1-MOBILE.md)
  let aboutDraftTimer = null;
  const ERROR_INPUT = { headline: 'apHeadline', field: 'apField', niche: 'apPicker', years: 'apYears', tags: 'apTags', university: 'apUniversity', currentRole: 'apCurrentRole', title: 'apTitle' };
  function fieldError(form, name, text) {
    const el = form.querySelector(`[data-error-for="${name}"]`);
    const input = form.querySelector('#' + ERROR_INPUT[name]);
    if (el) { el.textContent = text || ''; el.hidden = !text; }
    if (input) input.setAttribute('aria-invalid', text ? 'true' : 'false');
  }
  function clearFieldErrors(form) { Object.keys(ERROR_INPUT).forEach((n) => fieldError(form, n, '')); }
  // The field in view (on a phone it may be off screen) and in focus, so the message under it is seen and read out.
  function focusField(form, name) {
    const input = form.querySelector('#' + ERROR_INPUT[name]);
    if (!input) return;
    // (the field choice is long on a phone: its message is what is brought into view)
    const target = name === 'niche' ? form.querySelector('[data-error-for="niche"]') : input;
    // (the title is under "More": opened, so the box and its message are in sight)
    const more = input.closest('details');
    if (more) more.open = true;
    if (target.scrollIntoView) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
    input.focus({ preventScroll: true });
  }
  // [field, message] for each thing step 1 still needs, in the order of the page.
  function aboutProblems(form) {
    const out = [];
    if (!optional('headline') && !form.headline.value.trim()) out.push(['headline', t('apply.err.headline')]);
    if (!optional('field') && !form.customNiche.value.trim()) out.push(['field', t('apply.err.field')]);
    // (1 to 5 directions: docs/CLAUDE-CODE-NEW-CATEGORIES.md; the server refuses to send an application without one)
    if (!optional('directions') && pick.main && !pick.directions.length) { out.push(['niche', t('fp.err.min')]); if (fieldPicker) fieldPicker.showError(true); }
    const y = yearsOf(form.yearsExperience.value);
    if (y.empty) { if (!optional('years')) out.push(['years', t('apply.err.yearsEmpty')]); }
    else if (y.error === 'nan') out.push(['years', t('apply.err.years')]);
    else if (y.error === 'max') out.push(['years', fill('apply.err.yearsMax', { max: v.limits.yearsMax })]);
    return out;
  }
  // Saves what step 1 holds that can be saved (years only as a number; left as it was when what was typed has none).
  async function saveAbout(form) {
    const headline = form.headline.value.trim();
    if (headline !== (user.headline || '')) { await WisecallAPI.apiFetch('/me', { method: 'PATCH', body: { headline } }); user.headline = headline; }
    const y = yearsOf(form.yearsExperience.value);
    await WisecallAPI.apiFetch('/verification/experience', {
      method: 'PUT',
      body: { customNiche: form.customNiche.value.trim(), roleTitle: form.roleTitle.value, specialtyTags: form.specialtyTags.value,
        ...(pick.main ? { fieldId: pick.main, extraFields: pick.extras, directions: pick.directions, directionOther: pick.other } : {}),
        fieldSuggestion: pick.suggestion || '', // ("my field isn't in the list": what they typed, for the admins)
        university: form.university.value, country: form.country.value || null, currentRole: form.currentRole.value, practiceKind: (form.querySelector('input[name="practiceKind"]:checked') || {}).value || null,
        ...(y.empty ? { yearsExperience: null } : (y.n !== undefined ? { yearsExperience: y.n } : {})) }
    });
  }
  // A field left: saved a moment later, quietly (a failure here is said again on "Next", where it matters).
  function draftAbout(form) {
    clearTimeout(aboutDraftTimer);
    aboutDraftTimer = setTimeout(() => { if (form.isConnected) saveAbout(form).catch(() => {}); }, 600);
  }

  // Saves what the current step holds. check: also refuse to move on while something this step needs is missing.
  async function saveStep(check) {
    const form = root.querySelector('form.apply-step');
    if (!form) return true;
    const step = Number(form.dataset.step);
    stepError('');
    if (step === 0) {
      clearTimeout(aboutDraftTimer);
      clearFieldErrors(form);
      // Each field says what it needs, under itself; what is right is saved either way, so nothing typed is lost.
      const problems = check ? aboutProblems(form) : [];
      await saveAbout(form);
      if (problems.length) { problems.forEach(([name, text]) => fieldError(form, name, text)); focusField(form, problems[0][0]); return false; }
    } else if (step === 1) {
      const story = WisecallStoryForm.read(form);
      // (saved first, so nothing is lost; a field the server refuses says why, under the step, with the field in view)
      try {
        await WisecallAPI.apiFetch('/verification/experience', { method: 'PUT', body: story });
      } catch (e) {
        if (!e.code || !WisecallStoryForm.knows(e.code)) throw e;
        // (a link the server refuses never costs the rest of the step: the path and everything else are saved without the links)
        if (e.data && e.data.field === 'workLinks') {
          const rest = { ...story };
          delete rest.workLinks;
          await WisecallAPI.apiFetch('/verification/experience', { method: 'PUT', body: rest }).catch(() => {});
        }
        stepError(WisecallStoryForm.errorText(e, v.limits.story));
        const el = WisecallStoryForm.fieldOf(form, e);
        if (el) { const more = el.closest('details'); if (more) more.open = true; el.focus(); }
        return false;
      }
      // (all three blocks, each long enough; or none of them while a story written before still counts)
      const problem = WisecallStoryForm.pathProblem(story, v.limits.story, { oldStoryOk: oldStoryOk() });
      if (check && problem) {
        await load(); drawHead();
        stepError(WisecallStoryForm.errorText({ code: problem.code }, v.limits.story));
        const el = form.querySelector(`[name="${problem.field}"]`);
        if (el) el.focus();
        return false;
      }
    } else if (step === 2) {
      // "Answer for free" is price 0 (docs/CLAUDE-CODE-FREE-ANSWERS.md).
      if (form.priceMode.value === 'free') { if (user.price !== 0) await WisecallAPI.apiFetch('/me', { method: 'PATCH', body: { price: 0 } }); return true; }
      const raw = form.price.value.trim();
      const price = Number(raw);
      if (raw === '' && !check) return true;
      if (!Number.isInteger(price) || price < config.priceMin || price > config.priceMax) { stepError(t('apply.err.price')); form.price.focus(); return false; }
      if (price !== user.price) await WisecallAPI.apiFetch('/me', { method: 'PATCH', body: { price } });
    } else if (step === 3) {
      // A link typed in but not added yet is added now ("Next" with the link in the box does what they meant).
      if (form.url.value.trim()) { const ok = await addLink(form); if (!ok) return false; }
      // (the server says what is missing: in a field with a public register the licence number is the proof, and nothing else is asked)
      const licenceMissing = v.regulated && v.application.missing.some((m) => m === 'license' || m === 'license_document');
      if (check && publicRegister() && licenceMissing) { stepError(t('apply.err.licenceAbove')); const first = form.querySelector('#apLicNumber'); if (first) first.focus(); return false; }
      if (check && v.application.missing.includes('evidence')) { stepError(t('apply.err.proof')); form.url.focus(); return false; }
      if (check && licenceMissing) { stepError(lic('apply.err.licence')); return false; }
    }
    return true;
  }

  async function saveAndGo(target, check) {
    const btns = root.querySelectorAll('button');
    btns.forEach((b) => { b.disabled = true; });
    try {
      if (!(await saveStep(check))) { btns.forEach((b) => { b.disabled = false; }); restoreSubmit(); return; }
      await load();
      if (target === 'later') { WisecallNav.showToast(t('apply.saved')); window.location.href = '/dashboard.html'; return; }
      // (the server is the judge: a step it still finds incomplete is not left behind silently)
      if (check && target === current + 1 && current < 4 && !stepDone(current)) {
        drawHead();
        btns.forEach((b) => { b.disabled = false; });
        const form = root.querySelector('form.apply-step');
        const gaps = current === 0 && form ? missingIn(0).map((c) => [{ headline: 'headline', field: 'field', niche: 'niche', years: 'years' }[c], missingText(c)]).filter(([n]) => n) : [];
        if (gaps.length) { gaps.forEach(([n, text]) => fieldError(form, n, text)); focusField(form, gaps[0][0]); } else stepError(gapLine(current));
        return;
      }
      // ("Saved ✓" after every step: nothing waits for the end of the form)
      if (check && typeof target === 'number' && target > current) WisecallNav.showToast(t('apply.savedStep'));
      go(target);
    } catch (e) {
      showSaveError(e);
      btns.forEach((b) => { b.disabled = false; });
      restoreSubmit();
    }
  }
  // A refused or failed save: under the field the server named (step 1), otherwise one line in view. A request that never reached the
  // server (no connection, a dropped network in an in-app browser) says so, and what was typed stays on the page.
  const FIELD_OF = { headline: 'headline', customNiche: 'field', niche: 'niche', yearsExperience: 'years', extraNiches: 'extra', extraFields: 'extra', directions: 'niche', directionOther: 'niche', fieldId: 'niche',
    specialtyTags: 'tags', university: 'university', currentRole: 'currentRole', roleTitle: 'title' };
  function showSaveError(e) {
    const form = root.querySelector('form.apply-step');
    if (!e || !e.code) { stepError(t('apply.err.network')); return; }
    const field = form && form.dataset.step === '0' && FIELD_OF[(e.data || {}).field || (e.code === 'invalid_niche' ? 'niche' : (e.code === 'invalid_years' ? 'yearsExperience' : (e.code === 'invalid_custom_niche' ? 'customNiche' : '')))];
    if (field) { fieldError(form, field, errText(ERR, e)); focusField(form, field); return; }
    stepError(errText(ERR, e));
  }
  // (the submit button stays disabled while something is missing)
  function restoreSubmit() { const s = root.querySelector('[data-submit]'); if (s && missing().length) s.disabled = true; }

  async function addLink(form) {
    const sub = form.querySelector('[data-sub="evidence"]');
    subError(sub, '');
    const kind = form.kind.value;
    try {
      await WisecallAPI.apiFetch('/verification/evidence', {
        method: 'POST',
        body: { kind, url: form.url.value.trim() || undefined, registryId: kind === 'company' ? form.registryId.value.trim() || undefined : undefined, note: form.note.value.trim() || undefined }
      });
      form.url.value = '';
      await load();
      return true;
    } catch (e) {
      subError(sub, errText(EV_ERR, e));
      form.url.focus();
      return false;
    }
  }

  async function upload(btn) {
    const sub = btn.closest('.apply-sub');
    const input = document.getElementById(btn.dataset.input);
    const file = input && input.files[0];
    subError(sub, '');
    const fail = (code) => subError(sub, errText(EV_ERR, { code }));
    if (!file) return fail('empty_file');
    if (file.size > MAX_BYTES) return fail('file_too_large');
    if (!/\.(pdf|jpe?g)$/i.test(file.name)) return fail('unsupported_file_type');
    btn.disabled = true;
    try {
      await WisecallAPI.uploadFile(`/verification/documents/${btn.dataset.upload}`, file);
      WisecallNav.showToast(t('toast.saved'));
      await load();
      render();
    } catch (e) { fail(e.code); btn.disabled = false; }
  }

  function wireCommon() {
    root.querySelectorAll('[data-kyc-start]').forEach((start) => start.addEventListener('click', async () => {
      start.disabled = true;
      try {
        const r = await WisecallAPI.apiFetch('/verification/kyc/start', { method: 'POST' });
        window.location.href = r.url; // (the identity partner's own page, which sends them back to step 5)
      } catch (e) {
        const el = root.querySelector('.apply-kyc-error');
        if (el) el.textContent = errText({ kyc_unavailable: 'vt.kyc.unavailable', kyc_no_credit: 'idcard.err.noCredit', already_verified: 'vt.kyc.already', age_final: 'ap.age.failed', email_not_verified: 'settings.mentor.emailNotVerified' }, e);
        start.disabled = false;
      }
    }));
    root.querySelectorAll('[data-kyc-qr]').forEach((b) => b.addEventListener('click', () => WisecallIdCard.openQr({
      button: b, box: root.querySelector('[data-kyc-qr-box]'), error: root.querySelector('.apply-kyc-error'), reload: async () => { await load(); render(); }
    })));
    root.querySelectorAll('[data-reload]').forEach((b) => b.addEventListener('click', async () => { await load(); render(); }));
  }

  // The licence (a regulated field): saved, its copy uploaded or removed. On step 4, and after "Submit" when it has to be given again.
  function wireLicence(scope) {
    scope.querySelectorAll('[data-upload]').forEach((b) => b.addEventListener('click', () => upload(b)));
    scope.querySelectorAll('[data-doc-remove]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await WisecallAPI.apiFetch(`/verification/documents/${b.dataset.docRemove}`, { method: 'DELETE' }); await load(); render(); }
      catch (e) { WisecallNav.showToast(t('toast.error')); b.disabled = false; }
    }));
    // "No expiry": the date box is put away (and emptied) while it is ticked.
    const noExpiry = scope.querySelector('[name="noExpiry"]');
    if (noExpiry) noExpiry.addEventListener('change', () => {
      const date = noExpiry.closest('.apply-until').querySelector('[name="validUntil"]');
      date.disabled = noExpiry.checked;
      if (noExpiry.checked) date.value = '';
      subError(noExpiry.closest('.apply-sub'), ''); // (what was asked about the date no longer stands)
    });
    const lic = scope.querySelector('[data-save-licence]');
    if (lic) lic.addEventListener('click', async () => {
      const sub = lic.closest('.apply-sub');
      const val = (n) => { const el = sub.querySelector(`[name="${n}"]`); return el ? el.value.trim() : ''; };
      const none = Boolean((sub.querySelector('[name="noExpiry"]') || {}).checked);
      subError(sub, '');
      if (!val('number') || !val('issuingBody') || !val('holderName')) { subError(sub, t('vt.fillIn')); return; }
      // (the end date: a date, or "No expiry"; a diploma needs neither)
      if (!dip() && !none && !val('validUntil')) { subError(sub, t('vt.lic.err.until')); sub.querySelector('[name="validUntil"]').focus(); return; }
      lic.disabled = true;
      try {
        await WisecallAPI.apiFetch('/verification/license', { method: 'POST', body: { number: val('number'), issuingBody: val('issuingBody'), holderName: val('holderName'),
          validUntil: none ? '' : val('validUntil'), noExpiry: none, second: { issuingBody: val('secondBody'), number: val('secondNumber') } } });
        WisecallNav.showToast(t('toast.saved'));
        await load();
        render();
      } catch (e) { subError(sub, errText(LIC_ERR, e)); lic.disabled = false; }
    });
  }

  // After "Submit": book or cancel the video call, and "Edit my application" (an approved mentor leaves Browse experts until it is
  // approved again, so they are asked first).
  function wireDone() {
    const ivError = (e, map) => { const el = root.querySelector('.apply-iv-error'); if (el) el.textContent = errText(map, e); };
    root.querySelectorAll('[data-book]').forEach((btn) => btn.addEventListener('click', async () => {
      btn.disabled = true;
      try { await WisecallAPI.apiFetch('/verification/interview/book', { method: 'POST', body: { slotId: btn.dataset.book } }); WisecallNav.showToast(t('toast.saved')); await load(); render(); }
      catch (e) { ivError(e, { slot_unavailable: 'vt.iv.taken', id_check_first: 'vt.iv.blocked', already_booked: 'vt.iv.err.already' }); if (e.code === 'slot_unavailable') { await load(); render(); } else btn.disabled = false; }
    }));
    const cancel = root.querySelector('[data-iv-cancel]');
    if (cancel) cancel.addEventListener('click', async () => {
      cancel.disabled = true;
      try { await WisecallAPI.apiFetch('/verification/interview/cancel', { method: 'POST' }); await load(); render(); }
      catch (e) { ivError(e, { too_late: 'vt.iv.tooLate' }); cancel.disabled = false; }
    });
    const editBtn = root.querySelector('[data-edit]');
    if (editBtn) editBtn.addEventListener('click', async () => {
      if (editBtn.dataset.confirm && !(await WisecallDialog.confirm({ message: t('ap.edit.confirm'), confirmText: t('ap.edit.button') }))) return;
      editBtn.disabled = true;
      try {
        await WisecallAPI.apiFetch('/verification/edit', { method: 'POST' });
        await load();
        current = firstOpenStep();
        go(current);
      } catch (e) { stepError(t('toast.error')); editBtn.disabled = false; }
    });
  }

  function wireStep() {
    const form = root.querySelector('form.apply-step');
    root.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => saveAndGo(Number(b.dataset.goto), false))); // (the dots: drawHead)
    form.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => saveAndGo(current - 1, false)));
    form.querySelectorAll('[data-later]').forEach((b) => b.addEventListener('click', () => saveAndGo('later', false)));

    if (current === 4) {
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const btn = form.querySelector('[data-submit]');
        if (!btn || missing().length) return; // (no "send" while the ID check comes first)
        btn.disabled = true;
        stepError('');
        try {
          await WisecallAPI.apiFetch('/verification/submit', { method: 'POST' });
          await load();
          const url = new URL(window.location.href);
          url.searchParams.delete('step');
          window.history.replaceState(null, '', url.pathname + url.search);
          render();
          const h = root.querySelector('h1');
          if (h) h.focus();
          window.scrollTo({ top: 0, behavior: 'auto' });
        } catch (e) {
          // (no direction yet: an application started before the 1-5 rule; step 1 asks for one)
          const noDirection = e.code === 'incomplete' && ((e.data && e.data.missing) || []).includes('directions');
          if (noDirection) { await load(); render(); stepError(t('ap.err.directions')); return; }
          stepError(t(e.code === 'incomplete' ? 'ap.err.incomplete' : (ERR[e.code] || 'toast.error')));
          if (e.code === 'incomplete') { await load(); render(); } else btn.disabled = false;
        }
      });
      return;
    }
    form.addEventListener('submit', (ev) => { ev.preventDefault(); saveAndGo(current + 1, true); });

    if (current === 0) {
      // The field follows the words until the mentor chooses one themselves.
      const field = form.customNiche;
      const note = form.querySelector('[data-licence-note]');
      let chosen = Boolean(pick.main);
      let timer = null;
      let seq = 0;
      const area = form.querySelector('[data-pick-area]');
      const fieldById = (id) => catalog.fields.find((x) => x.id === id);
      const chipById = (id) => { for (const x of catalog.fields) { const c = x.chips.find((y) => y.id === id); if (c) return c; } return null; };
      // The same choice as server/categories.js nicheFor (the server decides): a regulated chip wins, then the first chip, then the field's own.
      const nicheOf = (fieldId) => {
        const chips = pick.directions.filter((d) => d.startsWith(fieldId + '.') && !d.endsWith('.other')).map((d) => chipById(d).niche);
        const own = (fieldById(fieldId).chips.find((c) => c.other) || {}).niche;
        return chips.find(isRegulated) || chips[0] || own;
      };
      // The picker itself: public/js/field-picker.js (two cards: the main field and up to two more, then 1 to 5 directions).
      const drawPick = () => {
        pick.directions = pick.directions.filter((d) => [pick.main, ...pick.extras].includes(d.split('.')[0]));
        if (!fieldPicker || !area.contains(area.querySelector('.fp'))) {
          fieldPicker = WisecallFieldPicker.create(area, { catalog, pick, t, fill, onChange: (kind) => {
            if (kind === 'too_many_fields') { fieldError(form, 'extra', t('ap.err.too_many_fields')); return; }
            if (kind === 'too_many_directions') { fieldError(form, 'niche', t('ap.err.too_many_directions')); return; }
            if (kind === 'other') { preview(); return; }
            if (kind === 'suggestion') { draftAbout(form); return; } // ("my field isn't in the list": saved with the step)
            chosen = true; // (a field or a direction tapped: the choice is theirs now, the words no longer change it)
            fieldError(form, 'niche', '');
            fieldError(form, 'extra', '');
            show();
            draftAbout(form);
          } });
        } else fieldPicker.draw();
        show();
      };
      // "Students will find you like this: …"
      const preview = () => {
        const words = [...pick.directions.map((d) => (d.endsWith('.other') ? pick.other[d.split('.')[0]] : WisecallI18n.nameIn(chipById(d)))),
          ...[pick.main, ...pick.extras].filter(Boolean).filter((id) => !pick.directions.some((d) => d.startsWith(id + '.'))).map((id) => WisecallI18n.nameIn(fieldById(id))),
          ...form.specialtyTags.value.split(',').map((x) => x.trim()), form.university.value.trim(),
          form.country.value ? WisecallI18n.nameIn(catalog.countries.find((c) => c.id === form.country.value)) : ''].filter(Boolean);
        form.querySelector('[data-pick-preview]').textContent = words.length ? fill('pick.preview', { list: [...new Set(words)].join(', ') }) : t('pick.previewEmpty');
      };

      area.addEventListener('focusout', (ev) => { if (ev.target.dataset.other) draftAbout(form); });
      ['specialtyTags', 'university'].forEach((n) => form[n].addEventListener('input', preview));
      form.country.addEventListener('change', () => { preview(); draftAbout(form); });
      ['university', 'currentRole'].forEach((n) => form[n].addEventListener('blur', () => draftAbout(form)));
      WisecallAPI.apiFetch('/categories/universities').then((r) => {
        const list = form.querySelector('#apUniversities');
        if (list) list.innerHTML = r.universities.map((u) => `<option value="${esc(u)}"></option>`).join('');
      }).catch(() => { /* (the box works without suggestions) */ });
      const limit = form.querySelector('[data-academic-limit]');
      const showLimit = () => {
        const kindNow = (form.querySelector('input[name="practiceKind"]:checked') || {}).value;
        limit.hidden = !(kindNow === 'academic' && [pick.main, ...pick.extras].filter(Boolean).map(nicheOf).some(isRegulated));
      };
      const show = () => {
        const key = pick.main ? nicheOf(pick.main) : '';
        showLimit();
        note.hidden = !isRegulated(key);
        note.textContent = t(isDiploma(key) ? 'apply.f.licenceNote.dip' : 'apply.f.licenceNote');
        form.headline.placeholder = t(`apply.ex.${groupOf(key)}.headline`);
        form.querySelector('[data-psych-note]').hidden = key !== 'psychology';
        preview();
      };
      field.addEventListener('input', () => {
        clearTimeout(timer);
        if (chosen) return;
        timer = setTimeout(async () => {
          const words = field.value.trim();
          const mine = ++seq;
          if (!words) { pick.main = null; pick.directions = []; drawPick(); return; }
          try {
            const r = await WisecallAPI.apiFetch('/niches/suggest?q=' + encodeURIComponent(words));
            if (mine !== seq || chosen) return;
            pick.main = WisecallI18n.fieldOfNiche(r.niche);
            drawPick();
          } catch (e) {
            // (not answered: no guess is kept, an earlier one for fewer words included; the server suggests one on saving, or they choose)
            if (mine !== seq || chosen) return;
            pick.main = null;
            drawPick();
          }
        }, 300);
      });
      form.querySelectorAll('input[name="practiceKind"]').forEach((r) => r.addEventListener('change', () => { fieldError(form, 'extra', ''); showLimit(); draftAbout(form); }));
      drawPick();
      ['headline', 'customNiche', 'roleTitle', 'specialtyTags'].forEach((n) => form[n].addEventListener('blur', () => draftAbout(form)));
      // the years: what is wrong is said as soon as the field is left, and a typed field clears its own message
      form.yearsExperience.addEventListener('change', () => { fieldError(form, 'years', ''); draftAbout(form); });
      form.yearsExperience.addEventListener('blur', () => {
        const p = aboutProblems(form).find(([n]) => n === 'years');
        if (p && form.yearsExperience.value.trim()) fieldError(form, 'years', p[1]);
        draftAbout(form);
      });
      Object.entries(ERROR_INPUT).forEach(([n, id]) => { const el = form.querySelector('#' + id); if (el) el.addEventListener('input', () => fieldError(form, n, '')); });
    }
    if (current === 1) WisecallStoryForm.wire(form); // (the counters, and "at most 3" for the starting-point tags)
    if (current === 2) {
      const input = form.price;
      const out = form.querySelector('#apPriceYou') || root.querySelector('#apPriceYou');
      const share = config.mentorSharePercent || 80;
      const box = form.querySelector('#apPaidBox');
      const draw = () => {
        const free = form.priceMode.value === 'free';
        box.hidden = free;
        const p = Number(input.value);
        const valid = Number.isInteger(p) && p >= config.priceMin && p <= config.priceMax;
        out.textContent = free ? t('price.mode.freeNote') : valid ? fill('apply.price.you', { price: p, you: (Math.round(p * share) / 100).toFixed(2).replace(/\.00$/, ''), share }) : fill('apply.price.share', { share });
      };
      input.addEventListener('input', draw);
      form.querySelectorAll('input[name="priceMode"]').forEach((r) => r.addEventListener('change', () => { draw(); if (r.value === 'paid' && r.checked) input.focus(); }));
      draw();
    }
    if (current === 3) {
      const kind = form.kind;
      const syncKind = () => { form.querySelector('.apply-registry').hidden = kind.value !== 'company'; };
      kind.addEventListener('change', syncKind);
      syncKind();
      form.querySelector('[data-add-link]').addEventListener('click', async (ev) => {
        ev.currentTarget.disabled = true;
        if (await addLink(form)) { WisecallNav.showToast(t('toast.saved')); render(); }
        else { const b = root.querySelector('[data-add-link]'); if (b) b.disabled = false; }
      });
      form.url.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); root.querySelector('[data-add-link]').click(); } });
      // "University page: Tbilisi State University": a lecturer's page on the university's own site is all that is needed.
      const uniHint = form.querySelector('#apUniHint');
      form.url.addEventListener('input', () => {
        const u = universityOf(form.url.value);
        uniHint.hidden = !u;
        uniHint.textContent = u ? (u.name ? fill('apply.uni.named', { name: u.name }) : t('apply.uni.page')) : '';
      });
      wireLicence(form);
      form.querySelectorAll('[data-ev-remove]').forEach((b) => b.addEventListener('click', async () => {
        b.disabled = true;
        try { await WisecallAPI.apiFetch(`/verification/evidence/${b.dataset.evRemove}`, { method: 'DELETE' }); await load(); render(); }
        catch (e) { WisecallNav.showToast(t('toast.error')); b.disabled = false; }
      }));
    }
  }

  document.addEventListener('wisecall:lang-changed', () => { if (v) render(); });

  try { await load(); } catch (e) { root.innerHTML = `<p class="form-error">${esc(t('toast.error'))}</p>`; return; }
  const asked = stepFromUrl();
  current = asked !== null ? asked : firstOpenStep();
  furthest = current;
  if (!v.application.locked) window.history.replaceState({ step: current }, '', (() => { const u = new URL(window.location.href); u.searchParams.set('step', String(current + 1)); return u.pathname + u.search; })());
  render();
  // Back from the partner's page (…&kyc=returned): the result arrives a moment later, so the page asks again every 2 seconds for a minute
  // and shows it as soon as it is there (passed: the application is sent by itself, and the "sent" screen follows). The ID can show as passed a
  // moment before the server has sent the application (the age and name checks run first), so a passed ID with nothing missing waits too.
  const waiting = () => ['started', 'checking'].includes(idState())
    || (idState() === 'passed' && !v.application.locked && !(v.application.missing || []).length);
  if (returned() && waiting()) {
    let tries = 0;
    const before = () => `${idState()}|${v.application.locked}`;
    let was = before();
    const again = async () => {
      tries += 1;
      try { await load(); } catch (e) { /* the next try */ }
      if (before() !== was) { was = before(); render(); }
      if (tries < 30 && waiting()) setTimeout(again, 2000);
    };
    setTimeout(again, 2000);
  }
  // The emails' "Do the ID check" (…&start=id): straight to the partner, as the card's button would (once: the address loses it).
  const params = new URLSearchParams(window.location.search);
  if (params.get('start') === 'id') {
    const u = new URL(window.location.href);
    u.searchParams.delete('start');
    window.history.replaceState(window.history.state, '', u.pathname + u.search);
    const start = idWaits() && root.querySelector('[data-id-start]');
    if (start) start.click();
  }
})();
