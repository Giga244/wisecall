// "Find me a mentor": the request form. A visitor who is signed in (with a confirmed email) sends it straight away; anybody else gets a
// link by email to confirm it. ?field= fills in the field (from a search in Browse); ?confirmed= and ?removed= come from the email links.
(async function () {
  // This page is "Find your mentor" first (public/js/match.js); the request form is for its own links: ?request=1, ?field= (from a search
  // in Browse that found nobody), ?niche=, and the confirm / remove links of its emails. Decided at once, before anything is waited for.
  const requestMode = ['request', 'field', 'niche', 'confirmed', 'removed'].some((k) => new URLSearchParams(location.search).has(k));
  document.getElementById('requestCard').hidden = !requestMode;
  document.getElementById('matchApp').hidden = requestMode;
  if (!requestMode) return;
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();
  const t = WisecallI18n.t;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const status = $('rqStatus');
  const say = (key) => { status.hidden = false; status.textContent = t(key); };
  if (params.get('confirmed') === '1') say('rq.confirmed');
  else if (params.get('confirmed') === '0') say('rq.confirmFailed');
  if (params.get('removed') === '1') say('rq.removed');
  else if (params.get('removed') === '0') say('rq.removeFailed');

  const niche = $('rqNiche');
  const draw = () => {
    const keep = niche.value;
    niche.innerHTML = `<option value="">${t('ap.f.niche.choose')}</option>` + WisecallI18n.niches().map((n) => `<option value="${n.key}">${t('niche.' + n.key).replace(/[<&]/g, '')}</option>`).join('')
      + `<option value="other">${t('ap.f.niche.other')}</option>`;
    niche.value = keep;
  };
  draw();
  document.addEventListener('wisecall:lang-changed', draw);
  if (params.get('field')) $('rqField').value = params.get('field').slice(0, 60);
  if (params.get('niche')) niche.value = params.get('niche');
  const signedIn = Boolean(user && user.emailVerified);
  $('rqEmailField').hidden = signedIn;

  const ERR = { invalid_email: 'rq.err.email', invalid_field: 'rq.err.field', invalid_niche: 'rq.err.niche', invalid_need: 'rq.err.need', offensive: 'pa.err.offensive',
    contact_details: 'rq.err.contact', invalid_budget: 'rq.err.budget', already_requested: 'rq.err.already', too_many_requests: 'rq.err.tooMany' };
  WisecallTurnstile.watch($('requestForm'));
  $('requestForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const err = $('rqError');
    err.textContent = '';
    const btn = ev.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      const r = await WisecallAPI.apiFetch('/requests', { method: 'POST', body: {
        field: $('rqField').value, niche: niche.value, need: $('rqNeed').value, language: $('rqLanguage').value,
        budgetMin: $('rqMin').value ? Number($('rqMin').value) : null, budgetMax: $('rqMax').value ? Number($('rqMax').value) : null,
        showPublic: $('rqPublic').checked, email: signedIn ? undefined : $('rqEmail').value, website: $('website').value, lang: WisecallI18n.getLang(), turnstileToken: await WisecallTurnstile.token(ev.target) } });
      ev.target.hidden = true;
      say(r.needsConfirmation ? 'rq.sentConfirm' : 'rq.sent');
    } catch (e) {
      err.textContent = WisecallTurnstile.errorText(e.code) || t(ERR[e.code] || 'toast.error');
      WisecallTurnstile.reset(ev.target);
      btn.disabled = false;
    }
  });
})();
