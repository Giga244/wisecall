// live-series-edit.html: a mentor groups 2-6 of their upcoming published sessions into a series with one price (lower than the sessions
// together). Draft, publish, cancel. After the first sale only the title and the description can change. The server checks everything.
(async function () {
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();
  const t = WisecallI18n.t;
  if (!user) { window.location.href = '/login.html?redirect=' + encodeURIComponent(location.pathname + location.search); return; }
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (key, vars) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const when = (d) => WisecallI18n.formatDate(d, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const err = $('seriesError');
  const errText = (e) => {
    const k = 'live.err.' + e.code;
    return t(k) !== k ? fill(k, { min: (e.data && e.data.min) || '', max: (e.data && e.data.max) || '' }) : t('toast.error');
  };
  let id = new URLSearchParams(location.search).get('id');
  let series = null;
  let sessions = [];

  async function load() {
    const [mine, list] = await Promise.all([WisecallAPI.apiFetch('/live/mine'), WisecallAPI.apiFetch('/live/series/mine')]);
    series = id ? list.series.find((x) => x.id === id) || null : null;
    const inThis = new Set(series ? series.sessions.map((s) => s.id) : []);
    // (sessions that can go in: published, not started, and not in another series)
    sessions = mine.sessions.filter((s) => inThis.has(s.id) || (s.status === 'published' && new Date(s.startsAt).getTime() > Date.now() && !s.seriesId));
    draw(inThis);
  }

  function priceHint() {
    const picked = sessions.filter((s) => $('ls-' + s.id) && $('ls-' + s.id).checked);
    const sum = picked.reduce((a, s) => a + s.price, 0);
    $('lsPriceHint').textContent = picked.length ? fill('live.sedit.priceHint', { sum: WisecallAPI.formatAmount(sum), n: picked.length }) : '';
  }

  function draw(inThis) {
    const sold = series && series.sold > 0;
    $('lsSessions').innerHTML = sessions.length ? sessions.map((s) => `<label class="checkbox-row" for="ls-${esc(s.id)}">
        <input type="checkbox" id="ls-${esc(s.id)}" value="${esc(s.id)}"${inThis.has(s.id) ? ' checked' : ''}${sold ? ' disabled' : ''}>
        <span>${esc(s.title)} <span class="muted small">· ${esc(when(s.startsAt))} · ${esc(WisecallAPI.formatAmount(s.price))}</span></span></label>`).join('')
      : `<p class="muted small">${esc(t('live.sedit.noSessions'))}</p>`;
    $('lsSessions').querySelectorAll('input').forEach((i) => i.addEventListener('change', priceHint));
    if (series) {
      $('lsTitle').value = series.title;
      $('lsDescription').value = series.description;
      $('lsPrice').value = series.price / 100;
      $('lsStatus').textContent = t('live.series.status.' + series.status);
      $('lsStatus').hidden = false;
    }
    $('lsPrice').disabled = Boolean(sold);
    $('lsLockedNote').hidden = !sold;
    $('lsPublish').hidden = Boolean(series && series.status !== 'draft');
    $('lsCancel').hidden = !series || series.status === 'cancelled';
    priceHint();
  }

  const body = () => ({
    title: $('lsTitle').value, description: $('lsDescription').value, price: Number($('lsPrice').value),
    sessionIds: sessions.filter((s) => $('ls-' + s.id) && $('ls-' + s.id).checked).map((s) => s.id)
  });
  async function save() {
    err.textContent = '';
    const b = body();
    if (series && series.sold > 0) { delete b.sessionIds; delete b.price; }
    const r = id ? await WisecallAPI.apiFetch(`/live/series/${encodeURIComponent(id)}`, { method: 'PUT', body: b })
      : await WisecallAPI.apiFetch('/live/series', { method: 'POST', body: b });
    if (!id) { id = r.series.id; history.replaceState(null, '', `?id=${encodeURIComponent(id)}`); }
    await load();
  }

  $('seriesForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try { await save(); WisecallNav.showToast(t('toast.saved')); } catch (e) { err.textContent = errText(e); }
  });
  $('lsPublish').addEventListener('click', async () => {
    try {
      await save();
      await WisecallAPI.apiFetch(`/live/series/${encodeURIComponent(id)}/publish`, { method: 'POST' });
      WisecallNav.showToast(t('live.sedit.published'));
      await load();
    } catch (e) { err.textContent = errText(e); }
  });
  $('lsCancel').addEventListener('click', async () => {
    if (!(await WisecallDialog.confirm({ message: t('live.sedit.cancelConfirm'), confirmText: t('live.sedit.cancel'), danger: true }))) return;
    try { await WisecallAPI.apiFetch(`/live/series/${encodeURIComponent(id)}/cancel`, { method: 'POST' }); WisecallNav.showToast(t('live.sedit.cancelled')); await load(); }
    catch (e) { err.textContent = errText(e); }
  });

  try { await load(); } catch (e) { err.textContent = t('toast.error'); }
})();
