// The live-session editor (/live-edit.html, ?id= to edit one): the form, a preview, the cover picture, save as draft, publish (a regulated
// field asks for the "educational talk, not a consultation" agreement first). The server decides everything; this page shows its answers.
(async function () {
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();
  const t = WisecallI18n.t;
  if (!user) { window.location.href = '/login.html?redirect=' + encodeURIComponent(location.pathname + location.search); return; }
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (key, vars) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const form = $('liveForm');
  const err = $('liveError');
  let id = new URLSearchParams(location.search).get('id');
  let session = null;

  // The fields (the server's limits are repeated as hints only).
  const niche = $('lvNiche');
  niche.innerHTML = WisecallI18n.niches().map((n) => `<option value="${esc(n.key)}">${esc(t('niche.' + n.key))}</option>`).join('') + `<option value="other">${esc(t('ap.f.niche.other'))}</option>`;
  niche.value = user.niche || 'other';
  const points = $('lvPoints');
  const addPoint = (value = '') => {
    if (points.querySelectorAll('input').length >= 5) return;
    const row = document.createElement('div');
    row.className = 'lv-point';
    row.innerHTML = `<input type="text" maxlength="120" aria-label="${esc(t('live.edit.point'))}"><button type="button" class="linklike lv-remove">${esc(t('live.edit.remove'))}</button>`;
    row.querySelector('input').value = value;
    row.querySelector('.lv-remove').addEventListener('click', () => row.remove());
    points.appendChild(row);
  };
  $('lvAddPoint').addEventListener('click', () => addPoint());
  const kind = $('lvKind');
  const seatsHint = () => { $('lvSeats').max = kind.value === 'circle' ? 8 : 30; if (kind.value === 'circle' && Number($('lvSeats').value) > 8) $('lvSeats').value = 8; };
  kind.addEventListener('change', seatsHint);
  $('lvEarly').addEventListener('change', () => { $('lvEarlyBox').hidden = !$('lvEarly').checked; });

  const body = () => ({
    title: $('lvTitle').value, description: $('lvDescription').value, learnPoints: Array.from(points.querySelectorAll('input')).map((i) => i.value).filter((v) => v.trim()),
    niche: niche.value, kind: kind.value, language: $('lvLanguage').value, date: $('lvDate').value, time: $('lvTime').value,
    durationMin: Number($('lvDuration').value), price: Number($('lvPrice').value), maxSeats: Number($('lvSeats').value), minSeats: Number($('lvMinSeats').value),
    earlyPrice: $('lvEarly').checked ? Number($('lvEarlyPrice').value) : null, earlyUntilDate: $('lvEarly').checked ? $('lvEarlyUntil').value : '',
    earlySeats: $('lvEarly').checked && $('lvEarlySeats').value ? Number($('lvEarlySeats').value) : null
  });
  const ERR = (e) => {
    const key = 'live.err.' + e.code;
    const d = e.data || {};
    return t(key) !== key ? fill(key, { min: d.min, max: d.max, hours: d.hours }) : t('toast.error');
  };

  function fillForm(s) {
    $('lvTitle').value = s.title;
    $('lvDescription').value = s.description;
    points.innerHTML = '';
    (s.learnPoints || []).forEach(addPoint);
    niche.value = s.niche;
    kind.value = s.kind;
    $('lvLanguage').value = s.language;
    $('lvDate').value = s.date;
    $('lvTime').value = s.time;
    $('lvDuration').value = s.durationMin;
    $('lvPrice').value = s.price / 100;
    $('lvSeats').value = s.maxSeats;
    $('lvMinSeats').value = s.minSeats;
    $('lvEarly').checked = s.earlyPrice !== null;
    $('lvEarlyBox').hidden = s.earlyPrice === null;
    if (s.earlyPrice !== null) { $('lvEarlyPrice').value = s.earlyPrice / 100; $('lvEarlyUntil').value = s.earlyUntilDate || ''; $('lvEarlySeats').value = s.earlySeats || ''; }
    // After the first ticket: only the description, the points, the cover and the time.
    const locked = s.sold > 0;
    ['lvTitle', 'lvNiche', 'lvKind', 'lvLanguage', 'lvDuration', 'lvPrice', 'lvSeats', 'lvMinSeats', 'lvEarly', 'lvEarlyPrice', 'lvEarlyUntil', 'lvEarlySeats']
      .forEach((f) => { $(f).disabled = locked; });
    $('lvLockedNote').hidden = !locked;
    $('lvStatus').textContent = t('live.status.' + s.status) + (s.reviewReason ? ' — ' + s.reviewReason : '');
    $('lvStatus').hidden = false;
    $('lvAgreeRow').hidden = !s.regulated;
    $('lvPublish').hidden = !['draft', 'rejected'].includes(s.status);
    $('lvCoverBox').hidden = false;
    if (s.hasCover) { $('lvCoverImg').src = `/api/live-covers/${s.id}.webp?v=${Date.now()}`; $('lvCoverImg').hidden = false; }
    seatsHint();
  }

  async function save() {
    err.textContent = '';
    const r = id ? await WisecallAPI.apiFetch(`/live/${encodeURIComponent(id)}`, { method: 'PUT', body: body() })
      : await WisecallAPI.apiFetch('/live', { method: 'POST', body: body() });
    session = r.session;
    if (!id) { id = session.id; history.replaceState(null, '', `?id=${encodeURIComponent(id)}`); }
    const full = await WisecallAPI.apiFetch(`/live/${encodeURIComponent(id)}/edit`);
    fillForm(full.session);
    return full.session;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { await save(); WisecallNav.showToast(t('toast.saved')); } catch (e) { err.textContent = ERR(e); }
  });

  $('lvPreview').addEventListener('click', async () => {
    try { const s = await save(); window.open(`/live/${encodeURIComponent(s.slug)}`, '_blank', 'noopener'); } catch (e) { err.textContent = ERR(e); }
  });

  $('lvPublish').addEventListener('click', async () => {
    try {
      const s = await save();
      if (s.regulated && !$('lvAgree').checked) { err.textContent = t('live.err.agreement_required'); return; }
      if (!(await WisecallDialog.confirm({ message: t('live.edit.publishConfirm'), confirmText: t('live.edit.publish') }))) return;
      const r = await WisecallAPI.apiFetch(`/live/${encodeURIComponent(id)}/publish`, { method: 'POST', body: { agree: $('lvAgree').checked } });
      WisecallNav.showToast(t(r.session.status === 'review' ? 'live.edit.sentForReview' : 'live.edit.published'));
      const full = await WisecallAPI.apiFetch(`/live/${encodeURIComponent(id)}/edit`);
      fillForm(full.session);
    } catch (e) { err.textContent = ERR(e); }
  });

  $('lvCoverFile').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file || !id) return;
    try {
      const res = await fetch(`/api/live/${encodeURIComponent(id)}/cover`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-Requested-With': 'wisecall' }, body: file, credentials: 'same-origin' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error), { code: data.error });
      $('lvCoverImg').src = data.coverUrl;
      $('lvCoverImg').hidden = false;
      WisecallNav.showToast(t('toast.saved'));
    } catch (e) { WisecallNav.showToast(t({ file_too_large: 'settings.photo.tooLarge', unsupported_image_type: 'settings.photo.badType' }[e.code] || 'toast.error')); }
    ev.target.value = '';
  });

  if (id) {
    try { fillForm((await WisecallAPI.apiFetch(`/live/${encodeURIComponent(id)}/edit`)).session); }
    catch (e) { err.textContent = t('toast.error'); }
  } else {
    // A new session: tomorrow + 2 days at 19:00 Tbilisi time, one hour, 20 ₾, up to 30 people.
    const d = new Date(Date.now() + 3 * 86400000);
    $('lvDate').value = new Date(d.getTime() + 4 * 3600000).toISOString().slice(0, 10);
    $('lvTime').value = '19:00';
    $('lvLanguage').value = WisecallI18n.getLang();
    addPoint();
    seatsHint();
  }
})();
