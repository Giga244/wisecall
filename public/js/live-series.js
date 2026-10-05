// /live/series/<slug> (written by the server): the box that sells a whole series in one payment (a seat in every session), and coming
// back from the bank (the server asks the bank).
(async function () {
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();
  const t = WisecallI18n.t;
  const page = document.querySelector('.live-series-page');
  if (!page) return;
  const slug = page.dataset.slug;
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (key, vars) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const errText = (e) => (t('live.err.' + e.code) !== 'live.err.' + e.code ? t('live.err.' + e.code) : t('toast.error'));
  if (window.WisecallCopy) WisecallCopy.wire(page);
  const box = document.getElementById('seriesBuy');
  let data;

  async function load() {
    try { data = await WisecallAPI.apiFetch(`/live/series/s/${encodeURIComponent(slug)}`); } catch (e) { box.innerHTML = `<p class="muted">${esc(t('toast.error'))}</p>`; return; }
    draw();
  }

  function draw() {
    const s = data.series;
    if (data.isMentor) {
      box.innerHTML = `<p class="muted small">${esc(t('live.youHost'))}</p><a class="btn btn-outline btn-block" href="/dashboard.html?tab=live">${esc(t('live.manage'))}</a>`;
      return;
    }
    if (data.order && data.order.status === 'paid') {
      box.innerHTML = `<p class="live-have"><strong>${esc(t('live.series.have'))}</strong></p>
        <p class="small"><a class="plain-link" href="/dashboard.html?tab=live">${esc(t('live.myTickets'))}</a></p>`;
      return;
    }
    if (!s.onSale) {
      box.innerHTML = `<p class="muted">${esc(t('live.series.notOnSale.' + (s.notOnSaleReason || 'changed')))}</p>`;
      return;
    }
    const rules = `<ul class="live-rules small"><li>${esc(t('live.series.rule.seats'))}</li><li>${esc(t('live.series.rule.refund'))}</li><li>${esc(t('live.rule.cameraOff'))}</li></ul>`;
    if (!user) {
      box.innerHTML = `${rules}<a class="btn btn-primary btn-block" href="/login.html?redirect=${encodeURIComponent(location.pathname)}">${esc(t('live.loginToBuy'))}</a>`;
      return;
    }
    box.innerHTML = `<form id="seriesForm" novalidate>${rules}
        <label class="checkbox-row" for="agree"><input type="checkbox" id="agree" required> <span>${esc(t('live.agreeRules'))}</span></label>
        <p class="form-error" id="buyError" role="alert"></p>
        <button type="submit" class="btn btn-primary btn-block">${esc(fill('live.series.buy', { price: WisecallAPI.formatAmount(s.price) }))}</button>
      </form>`;
    document.getElementById('seriesForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = document.getElementById('buyError');
      err.textContent = '';
      if (!document.getElementById('agree').checked) { err.textContent = t('live.err.agree'); return; }
      const btn = ev.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const r = await WisecallAPI.apiFetch(`/live/series/${encodeURIComponent(s.id)}/orders`, { method: 'POST', body: {} });
        window.location.href = r.checkoutUrl;
      } catch (e) { err.textContent = errText(e); btn.disabled = false; }
    });
  }

  // Back from the bank.
  const params = new URLSearchParams(location.search);
  const orderId = params.get('order');
  if (orderId) {
    box.innerHTML = `<p class="muted">${esc(t('live.checkingPayment'))}</p>`;
    let tries = 0;
    const check = async () => {
      tries += 1;
      try {
        const r = await WisecallAPI.apiFetch(`/live/series/orders/${encodeURIComponent(orderId)}/sync`, { method: 'POST' });
        if (r.order && r.order.status === 'paid') { WisecallNav.showToast(t('live.series.paid')); history.replaceState(null, '', location.pathname); return load(); }
        if (r.order && r.order.status === 'expired') {
          history.replaceState(null, '', location.pathname);
          await load();
          const e = document.getElementById('buyError');
          if (e) e.textContent = t(params.get('status') === 'cancel' ? 'live.payCancelled' : 'live.payFailed');
          return;
        }
      } catch (e) { /* asked again below */ }
      if (tries < 10) setTimeout(check, 2000); else load();
    };
    check();
  } else load();
})();
