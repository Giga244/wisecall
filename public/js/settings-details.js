// Settings -> My details (docs/CLAUDE-CODE-MENTOR-EDIT.md): what a mentor can change after applying, sent or approved.
//   saved at once   the price, specializations, current role, university, country, years (and, in their own tabs, the photo, about text,
//                   languages, links and email settings)
//   checked first   the main field, extra fields and chips, new proof: an approved mentor's profile stays as it is until an admin approves
//                   (a licensed field asks for its licence first); before a decision, the application simply shows the change
//   only support    the name and birth date from the ID check, and its result
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let box, user, goto, cats;

  const nameOf = (x) => (x ? WisecallI18n.nameIn(x) : '');
  const fieldName = (fid) => nameOf((cats.fields || []).find((f) => f.id === fid)) || fid;
  const chipName = (cid) => {
    for (const f of cats.fields || []) { const c = f.chips.find((x) => x.id === cid); if (c) return nameOf(c); }
    return cid;
  };
  const sent = () => Boolean(user.applicationSubmittedAt) || ['verified', 'suspended'].includes(user.verificationStatus);

  async function init(el, opts) {
    box = el; user = opts.user; goto = opts.goto;
    await draw();
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

      <section class="settings-card" aria-labelledby="detailsFreeTitle">
        <h2 id="detailsFreeTitle">${esc(t('details.free.title'))}</h2>
        <p class="muted small">${esc(t('details.free.intro'))}</p>
        <form id="detailsForm" novalidate>
          <label for="dSpecs"><span>${esc(t('details.specs'))}</span>
            <input type="text" id="dSpecs" maxlength="200" value="${esc((det.specialtyTags || []).join(', '))}">
            <span class="hint">${esc(t('details.specs.hint'))}</span></label>
          <label for="dRole"><span>${esc(t('details.role'))}</span><input type="text" id="dRole" maxlength="100" value="${esc(det.currentRole)}"></label>
          <label for="dUni"><span>${esc(t('details.university'))}</span><input type="text" id="dUni" maxlength="100" value="${esc(det.university)}"></label>
          <label for="dCountry"><span>${esc(t('details.country'))}</span>
            <select id="dCountry"><option value="">—</option>${opt(cats.countries || [], det.country)}</select></label>
          <label for="dYears"><span>${esc(t('details.years'))}</span><input type="number" id="dYears" min="0" max="70" step="1" inputmode="numeric" value="${esc(det.yearsExperience == null ? '' : det.yearsExperience)}"></label>
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
          <label for="dMain"><span>${esc(t('details.field.main'))}</span><select id="dMain">${opt(cats.fields || [], (pending ? pending.proposed.fieldId : f.fieldId))}</select></label>
          <fieldset class="details-extra"><legend>${esc(t('details.field.extra'))}</legend>
            ${(cats.fields || []).map((x) => `<label class="checkbox-row"><input type="checkbox" name="dExtra" value="${esc(x.id)}"${((pending ? pending.proposed.extraFields : f.extraFields) || []).includes(x.id) ? ' checked' : ''}> <span>${esc(nameOf(x))}</span></label>`).join('')}
          </fieldset>
          <fieldset class="details-chips" id="dChipsBox"><legend>${esc(t('details.field.chips'))}</legend><div id="dChips"></div></fieldset>
          <p class="form-error" role="alert" id="fieldsError"></p>
          <button type="submit" class="btn btn-outline">${esc(t(user.verificationStatus === 'verified' ? 'details.field.send' : 'details.save'))}</button>
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
    drawChips(pending ? pending.proposed.directions : f.directions);
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

  // The chips of the fields ticked (up to five in all).
  function drawChips(selected) {
    const main = box.querySelector('#dMain').value;
    const extras = [...box.querySelectorAll('input[name="dExtra"]:checked')].map((x) => x.value).filter((x) => x !== main);
    const keep = new Set(selected || [...box.querySelectorAll('input[name="dChip"]:checked')].map((x) => x.value));
    box.querySelector('#dChips').innerHTML = [main, ...extras].map((fid) => {
      const fl = (cats.fields || []).find((x) => x.id === fid);
      if (!fl) return '';
      return `<p class="small"><strong>${esc(nameOf(fl))}</strong></p>` + fl.chips.filter((c) => !c.other).map((c) =>
        `<label class="checkbox-row"><input type="checkbox" name="dChip" value="${esc(c.id)}"${keep.has(c.id) ? ' checked' : ''}> <span>${esc(nameOf(c))}</span></label>`).join('');
    }).join('');
  }

  function wire() {
    const t = WisecallI18n.t;
    const errorText = (code) => t({ invalid_current_role: 'details.err.text', invalid_university: 'details.err.text', invalid_tags: 'details.err.tags', invalid_years: 'details.err.years',
      too_many_fields: 'details.err.fields', too_many_directions: 'details.err.chips', extra_regulated: 'details.err.extraRegulated', nothing_changed: 'details.err.same',
      application_locked: 'details.err.locked', invalid_url: 'details.err.url', duplicate_evidence: 'details.err.duplicate', too_much_evidence: 'details.err.tooMuch' }[code] || 'toast.error');
    box.addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-goto-tab]');
      if (b) goto(b.dataset.gotoTab);
    });
    box.querySelector('#detailsForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = box.querySelector('#detailsError');
      err.textContent = '';
      try {
        const data = await WisecallAPI.apiFetch('/me/details', { method: 'PUT', body: {
          specialtyTags: box.querySelector('#dSpecs').value, currentRole: box.querySelector('#dRole').value, university: box.querySelector('#dUni').value,
          country: box.querySelector('#dCountry').value || null, yearsExperience: box.querySelector('#dYears').value } });
        Object.assign(user, data.user);
        WisecallNav.showToast(t('toast.saved'));
      } catch (e) { err.textContent = errorText(e.code); }
    });
    box.querySelector('#dMain').addEventListener('change', () => drawChips());
    box.querySelectorAll('input[name="dExtra"]').forEach((x) => x.addEventListener('change', () => drawChips()));
    box.querySelector('#fieldsForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = box.querySelector('#fieldsError');
      err.textContent = '';
      const main = box.querySelector('#dMain').value;
      try {
        const data = await WisecallAPI.apiFetch('/me/fields', { method: 'PUT', body: {
          fieldId: main, extraFields: [...box.querySelectorAll('input[name="dExtra"]:checked')].map((x) => x.value).filter((x) => x !== main),
          directions: [...box.querySelectorAll('input[name="dChip"]:checked')].map((x) => x.value) } });
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
