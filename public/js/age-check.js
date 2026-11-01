// The one question about age, for whoever has not answered it on the sign-up form: a new person from Google (no account exists until they answer:
// server/routes/google.js) and an account from before the age rule (at its next login, or before a first question).
(async function () {
  await WisecallI18n.initI18n();
  const t = WisecallI18n.t;
  const params = new URLSearchParams(location.search);
  const fromGoogle = params.get('google') === '1';
  const next = WisecallAPI.safeRedirect(params.get('redirect'), '/dashboard.html');
  const box = document.getElementById('ageBox');
  const home = (WisecallI18n.getLang() === 'ka' ? '/ka' : '');

  if (fromGoogle) {
    // (the details from Google last half an hour: after that, sign in again)
    try { await WisecallAPI.apiFetch('/auth/google/new'); }
    catch (e) { location.href = `${home}/signup.html?google=bad_state`; return; }
  } else {
    const user = await WisecallNav.initNav();
    if (!user) { location.href = `${home}/login.html`; return; }
    if (!user.needsAge) { location.href = next; return; }
  }

  document.getElementById('ageFieldsSlot').innerHTML = WisecallAgeFields.html();
  const form = document.getElementById('ageForm');
  WisecallAgeFields.wire(form);
  const errorEl = document.getElementById('formError');
  const TEXT = { birth_required: 'age.required', parent_permission_required: 'age.parent.required', mentor_18: 'auth.mentor18', sign_in_again: 'auth.google.err.bad_state' };

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errorEl.textContent = '';
    const birthYm = WisecallAgeFields.value(form);
    if (!birthYm) { errorEl.textContent = t('age.required'); return; }
    if (WisecallAgeFields.needsPermission(form)) { errorEl.textContent = t('age.parent.required'); form.querySelector('#parentPermission').focus(); return; }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const r = await WisecallAPI.apiFetch(fromGoogle ? '/auth/google/new' : '/me/age', { method: 'POST', body: WisecallAgeFields.answer(form) });
      location.href = fromGoogle ? r.to : next;
    } catch (e) {
      if (e.code === 'under_16') { WisecallAgeFields.under16(box); return; }
      if (e.code === 'age_already_set') { location.href = next; return; }
      errorEl.textContent = t(TEXT[e.code] || 'toast.error');
      button.disabled = false;
    }
  });
})();
