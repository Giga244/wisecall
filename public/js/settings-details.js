// Settings -> My details (docs/CLAUDE-CODE-MENTOR-EDIT.md): what a mentor can change after applying, sent or approved.
//   saved at once   the price, specializations, current role, university, country, years (and, in their own tabs, the photo, about text,
//                   languages, links and email settings)
//   checked first   the main field, extra fields and chips, new proof: an approved mentor's profile stays as it is until an admin approves
//                   (a licensed field asks for its licence first); before a decision, the application simply shows the change
//   only support    the name and birth date from the ID check, and its result
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let box, user, goto, cats;
  let dPick = null;
  let dPicker = null;

  const nameOf = (x) => (x ? WisecallI18n.nameIn(x) : '');
  const fillText = (key, vars) => Object.entries(vars || {}).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), WisecallI18n.t(key));
  const fieldName = (fid) => nameOf((cats.fields || []).find((f) => f.id === fid)) || fid;
  const chipName = (cid) => {
    for (const f of cats.fields || []) { const c = f.chips.find((x) => x.id === cid); if (c) return nameOf(c); }
    return cid;
  };
  const sent = () => Boolean(user.applicationSubmittedAt) || ['verified', 'suspended'].includes(user.verificationStatus);

  async function init(el, opts) {
    box = el; user = opts.user; goto = opts.goto;
    await draw();
    // (from the dashboard's "add your path" card: straight to that card)
    if (window.location.hash === '#story') { const el = box.querySelector('#story'); if (el) el.scrollIntoView({ block: 'start' }); }
  }

  async function draw() {
    const t = WisecallI18n.t;
    let d;
    try {
      [d, cats] = await Promise.all([WisecallAPI.apiFetch('/me/details'), cats ? Promise.resolve(cats) : WisecallAPI.apiFetch('/categories')]);
    } catch (e) { box.innerHTML = `<p class="muted">${esc(t('toast.error'))}</p>`; return; }
    const det = d.details;
    const f = d.fields;
    const pending = d.pendingChange;
    const opt = (list, value) => list.map((x) => `<option value="${esc(x.id)}"${x.id === value ? ' selected' : ''}>${esc(nameOf(x))}</option>`).join('');
    const chosenFields = [f.fieldId, ...(f.extraFields || [])].filter(Boolean);
    box.innerHTML = `
      <div id="detailsPrice"></div>

      <section class="settings-card details-story" id="story" aria-labelledby="detailsStoryTitle">
        <h2 id="detailsStoryTitle">${esc(t('details.story.title'))}</h2>
        <p class="muted small">${esc(t('details.story.intro'))}</p>
        <form id="storyForm" novalidate>
          ${WisecallStoryForm.html(d.story, { limits: d.story.limits, startTags: d.story.startTags, prefix: 'ds', oldStory: d.story.oldStory, open: true })}
          <p class="form-error" role="alert" id="storyError"></p>
          <button type="submit" class="btn btn-primary">${esc(t('details.story.save'))}</button>
        </form>
      </section>

      <section class="settings-card" aria-labelledby="detailsFreeTitle">
        <h2 id="detailsFreeTitle">${esc(t('details.free.title'))}</h2>
        <p class="muted small">${esc(t('details.free.intro'))}</p>
        <form id="detailsForm" novalidate>
          <label for="dSpecs"><span>${esc(t('details.specs'))}</span>
            <input type="text" id="dSpecs" maxlength="200" value="${esc((det.specialtyTags || []).join(', '))}" aria-describedby="dSpecsErr">
            <span class="hint">${esc(fillText('details.specs.hint', { max: (cats.limits || {}).specializations || 5, chars: (cats.limits || {}).specializationMax || 30 }))}</span></label>
          <p class="form-error details-field-error" id="dSpecsErr" role="alert" hidden></p>
          <label for="dRole"><span>${esc(t('details.role'))}</span><input type="text" id="dRole" maxlength="100" value="${esc(det.currentRole)}" aria-describedby="dRoleErr"></label>
          <p class="form-error details-field-error" id="dRoleErr" role="alert" hidden></p>
          <label for="dUni"><span>${esc(t('details.university'))}</span><input type="text" id="dUni" maxlength="100" value="${esc(det.university)}" aria-describedby="dUniErr"></label>
          <p class="form-error details-field-error" id="dUniErr" role="alert" hidden></p>
          <label for="dCountry"><span>${esc(t('details.country'))}</span>
            <select id="dCountry" aria-describedby="dCountryErr"><option value="">—</option>${opt(cats.countries || [], det.country)}</select></label>
          <p class="form-error details-field-error" id="dCountryErr" role="alert" hidden></p>
          <label for="dYears"><span>${esc(t('details.years'))}</span><input type="number" id="dYears" min="0" max="70" step="1" inputmode="numeric" value="${esc(det.yearsExperience == null ? '' : det.yearsExperience)}" aria-describedby="dYearsErr"></label>
          <p class="form-error details-field-error" id="dYearsErr" role="alert" hidden></p>
          <p class="form-error" role="alert" id="detailsError"></p>
          <button type="submit" class="btn btn-primary">${esc(t('details.save'))}</button>
        </form>
        <p class="muted small details-links">${esc(t('details.elsewhere'))}
          <button type="button" class="linklike" data-goto-tab="profile">${esc(t('settings.tab.profile'))}</button> ·
          <button type="button" class="linklike" data-goto-tab="notifications">${esc(t('settings.tab.notifications'))}</button></p>
      </section>

      <section class="settings-card" aria-labelledby="detailsFieldTitle">
        <h2 id="detailsFieldTitle">${esc(t('details.field.title'))}</h2>
        <p class="muted small">${esc(t(user.verificationStatus === 'verified' ? 'details.field.introApproved' : 'details.field.intro'))}</p>
        <p class="details-now">${esc(t('details.field.now'))} <strong>${esc(chosenFields.map(fieldName).join(', ') || '—')}</strong>${(f.directions || []).length ? ` · ${esc(f.directions.map(chipName).join(', '))}` : ''}</p>
        ${pending ? `<div class="note-box" role="status" id="detailsPending"><strong>${esc(t('details.pending.title'))}</strong>
          <p>${esc(t('details.pending.body'))} ${esc([pending.proposed.fieldId, ...(pending.proposed.extraFields || [])].filter(Boolean).map(fieldName).join(', '))}${(pending.proposed.directions || []).length ? ` · ${esc(pending.proposed.directions.map(chipName).join(', '))}` : ''}</p></div>` : ''}
        ${d.licenceNeeded && d.licenceNeeded.includes('license') ? licenceForm(t) : ''}
        <form id="fieldsForm" novalidate>
          <div data-fp-area></div>
          <p class="form-error" role="alert" id="fieldsError"></p>
          <button type="submit" class="btn btn-primary" id="fieldsSave">${esc(t(user.verificationStatus === 'verified' ? 'details.field.send' : 'details.save'))}</button>
        </form>
      </section>

      ${sent() ? `<section class="settings-card" aria-labelledby="detailsProofTitle">
        <h2 id="detailsProofTitle">${esc(t('details.proof.title'))}</h2>
        <p class="muted small">${esc(t('details.proof.intro'))}</p>
        <form id="proofForm" novalidate>
          <label for="dProof"><span>${esc(t('details.proof.link'))}</span><input type="url" id="dProof" inputmode="url" placeholder="https://"></label>
          <p class="form-error" role="alert" id="proofError"></p>
          <button type="submit" class="btn btn-outline">${esc(t('details.proof.add'))}</button>
        </form>
      </section>` : ''}

      <section class="settings-card" aria-labelledby="detailsIdTitle">
        <h2 id="detailsIdTitle">${esc(t('details.id.title'))}</h2>
        ${d.identity ? `<dl class="details-id">
          <dt>${esc(t('details.id.name'))}</dt><dd id="dIdName">${esc(d.identity.name || '—')}</dd>
          <dt>${esc(t('details.id.birth'))}</dt><dd>${esc(d.identity.dateOfBirth || '—')}</dd></dl>` : `<p class="muted small">${esc(t('details.id.none'))}</p>`}
        <p class="small">${esc(t('details.id.locked'))} <a href="/contact.html">${esc(t('details.id.write'))}</a></p>
      </section>`;

    WisecallPriceBlock.mount(box.querySelector('#detailsPrice'), user, { history: d.priceHistory, onPayoutNeeded: () => goto('payouts') });
    // The field and its directions: public/js/field-picker.js (1 to 5 directions; save stays faded until there is one).
    const from = pending ? pending.proposed : f;
    dPick = { main: from.fieldId || null, extras: [...(from.extraFields || [])], directions: [...(from.directions || [])], other: { ...(from.directionOther || {}) }, suggestion: d.story.fieldSuggestion || '' };
    const saveBtn = box.querySelector('#fieldsSave');
    const fieldsErr = box.querySelector('#fieldsError');
    const ready = () => { saveBtn.disabled = !dPicker.valid(); };
    dPicker = WisecallFieldPicker.create(box.querySelector('[data-fp-area]'), { catalog: cats, pick: dPick, t, fill: (k, v) => Object.entries(v).reduce((x, [a, b]) => x.split(`{${a}}`).join(b), t(k)),
      onChange: (kind) => {
        if (kind === 'too_many_fields') { fieldsErr.textContent = t('details.err.fields'); return; }
        if (kind === 'too_many_directions') { fieldsErr.textContent = t('details.err.chips'); return; }
        fieldsErr.textContent = '';
        ready();
      } });
    // (a mentor who has none yet: asked for one here, never blocked anywhere else)
    if (dPick.main && !dPick.directions.length) dPicker.showError(true);
    ready();
    wire();
  }

  function licenceForm(t) {
    return `<form id="licenceForm" class="note-box" novalidate>
      <strong>${esc(t('details.licence.title'))}</strong>
      <p class="small">${esc(t('details.licence.intro'))}</p>
      <label for="dLicNo"><span>${esc(t('details.licence.number'))}</span><input type="text" id="dLicNo" maxlength="40"></label>
      <label for="dLicBody"><span>${esc(t('details.licence.body'))}</span><input type="text" id="dLicBody" maxlength="120"></label>
      <label for="dLicUntil"><span>${esc(t('details.licence.until'))}</span><input type="date" id="dLicUntil"></label>
      <p class="form-error" role="alert" id="licenceError"></p>
      <button type="submit" class="btn btn-primary">${esc(t('details.licence.send'))}</button>
    </form>`;
  }

  function wire() {
    const t = WisecallI18n.t;
    const limits = (cats && cats.limits) || {};
    const errorText = (code) => fillText({ invalid_current_role: 'details.err.role', invalid_university: 'details.err.university', invalid_tags: 'details.err.tags', invalid_years: 'details.err.years', invalid_country: 'details.err.country',
      too_many_fields: 'details.err.fields', too_many_directions: 'details.err.chips', too_few_directions: 'fp.err.min', extra_regulated: 'details.err.extraRegulated', nothing_changed: 'details.err.same',
      application_locked: 'details.err.locked', invalid_url: 'details.err.url', duplicate_evidence: 'details.err.duplicate', too_much_evidence: 'details.err.tooMuch' }[code] || 'toast.error',
      { max: limits.specializations || 5, chars: limits.specializationMax || 30, role: limits.currentRoleMax || 100, university: limits.universityMax || 100 });
    box.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-goto-tab]');
      if (b) goto(b.dataset.gotoTab);
    });
    // My path, the starting-point tags, the sample answer, "I can help with" and the work links (public/js/story-form.js): saved at once.
    const storyForm = box.querySelector('#storyForm');
    WisecallStoryForm.wire(storyForm);
    storyForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = box.querySelector('#storyError');
      err.textContent = '';
      try {
        const data = await WisecallAPI.apiFetch('/me/details', { method: 'PUT', body: WisecallStoryForm.read(storyForm) });
        Object.assign(user, data.user);
        WisecallNav.showToast(t('story.saved'));
      } catch (e) {
        err.textContent = WisecallStoryForm.knows(e.code) ? WisecallStoryForm.errorText(e) : errorText(e.code);
        const el = WisecallStoryForm.fieldOf(storyForm, e);
        if (el) { const more = el.closest('details'); if (more) more.open = true; el.focus(); }
      }
    });
    // The box a save was refused for: marked and in focus, with a line right under it saying what is wrong (in sight on a phone); right
    // again once it is changed. A refusal that is about no box is said under the form.
    const detailsForm = box.querySelector('#detailsForm');
    const DETAILS_INPUT = { specialtyTags: '#dSpecs', currentRole: '#dRole', university: '#dUni', country: '#dCountry', yearsExperience: '#dYears' };
    const fieldLine = (input, text) => { const p = box.querySelector(`#${input.id}Err`); if (p) { p.textContent = text || ''; p.hidden = !text; } };
    const unmarkDetails = (ev) => {
      if (!ev.target.getAttribute || ev.target.getAttribute('aria-invalid') !== 'true') return;
      ev.target.removeAttribute('aria-invalid');
      fieldLine(ev.target, '');
    };
    detailsForm.addEventListener('input', unmarkDetails);
    detailsForm.addEventListener('change', unmarkDetails);
    detailsForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = box.querySelector('#detailsError');
      err.textContent = '';
      detailsForm.querySelectorAll('[aria-invalid]').forEach((el) => { el.removeAttribute('aria-invalid'); fieldLine(el, ''); });
      try {
        const data = await WisecallAPI.apiFetch('/me/details', { method: 'PUT', body: {
          specialtyTags: box.querySelector('#dSpecs').value, currentRole: box.querySelector('#dRole').value, university: box.querySelector('#dUni').value,
          country: box.querySelector('#dCountry').value || null, yearsExperience: box.querySelector('#dYears').value } });
        Object.assign(user, data.user);
        WisecallNav.showToast(t('toast.saved'));
      } catch (e) {
        const input = box.querySelector(DETAILS_INPUT[(e.data || {}).field] || '#none');
        if (input) { input.setAttribute('aria-invalid', 'true'); fieldLine(input, errorText(e.code)); input.focus(); } else err.textContent = errorText(e.code);
      }
    });
    box.querySelector('#fieldsForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = box.querySelector('#fieldsError');
      err.textContent = '';
      if (!dPicker.valid()) { dPicker.showError(true); err.textContent = t('fp.err.min'); return; }
      try {
        const data = await WisecallAPI.apiFetch('/me/fields', { method: 'PUT', body: {
          fieldId: dPick.main, extraFields: dPick.extras.filter((x) => x !== dPick.main), directions: dPick.directions, directionOther: dPick.other } });
        // ("my field isn't in the list": what they typed goes to the admins as a suggestion)
        await WisecallAPI.apiFetch('/me/details', { method: 'PUT', body: { fieldSuggestion: dPick.suggestion || '' } }).catch(() => {});
        Object.assign(user, data.user);
        WisecallNav.showToast(t(data.change ? 'details.pending.sent' : 'toast.saved'));
        await draw();
      } catch (e) { err.textContent = errorText(e.code); }
    });
    const lic = box.querySelector('#licenceForm');
    if (lic) lic.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = box.querySelector('#licenceError');
      err.textContent = '';
      try {
        await WisecallAPI.apiFetch('/verification/license', { method: 'POST', body: { number: box.querySelector('#dLicNo').value, issuingBody: box.querySelector('#dLicBody').value, validUntil: box.querySelector('#dLicUntil').value } });
        WisecallNav.showToast(t('details.licence.sent'));
        await draw();
      } catch (e) { err.textContent = t('details.err.licence'); }
    });
    const proof = box.querySelector('#proofForm');
    if (proof) proof.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = box.querySelector('#proofError');
      err.textContent = '';
      try {
        await WisecallAPI.apiFetch('/me/evidence', { method: 'POST', body: { url: box.querySelector('#dProof').value } });
        box.querySelector('#dProof').value = '';
        WisecallNav.showToast(t('details.proof.sent'));
      } catch (e) { err.textContent = errorText(e.code); }
    });
  }

  window.SettingsDetails = { init, reload: () => (box ? draw() : null) };
})();
