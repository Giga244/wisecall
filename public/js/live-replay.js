// /live/<slug>/replay (written by the server): the player is in the page for whoever may watch; anybody else sees here what a 30-day pass
// costs and buys it (the same bank and rules as tickets), then comes back here and the server asks the bank.
(async function () {
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();
  const t = WisecallI18n.t;
  const page = document.querySelector('.live-replay-page');
  if (!page) return;
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const errText = (e) => (t('live.err.' + e.code) !== 'live.err.' + e.code ? t('live.err.' + e.code) : t('toast.error'));
  const box = document.getElementById('replayBuy');
  if (!box) return; // (this person is watching)

  function draw() {
    if (!box.dataset.ready) { box.innerHTML = `<p class="muted">${esc(t('live.replay.notReady'))}</p>`; return; }
    if (!box.dataset.canBuy) { box.innerHTML = `<p class="muted">${esc(t('live.replay.notOnSale'))}</p>`; return; }
    const price = WisecallAPI.formatAmount(Number(box.dataset.price));
    if (!user) {
      box.innerHTML = `<p>${esc(t('live.replay.pass'))}</p><a class="btn btn-primary" href="/login.html?redirect=${encodeURIComponent(location.pathname)}">${esc(t('live.loginToBuy'))}</a>`;
      return;
    }
    box.innerHTML = `<p>${esc(t('live.replay.pass'))}</p><p class="form-error" id="buyError" role="alert"></p>
      <button type="button" class="btn btn-primary" id="replayBuyBtn">${esc(t('live.replay.buy').replace('{price}', price))}</button>`;
    document.getElementById('replayBuyBtn').addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      try {
        const r = await WisecallAPI.apiFetch(`/live/${encodeURIComponent(page.dataset.session)}/replay/purchases`, { method: 'POST', body: {} });
        window.location.href = r.checkoutUrl;
      } catch (e) { document.getElementById('buyError').textContent = errText(e); ev.target.disabled = false; }
    });
  }

  const params = new URLSearchParams(location.search);
  const purchaseId = params.get('purchase');
  if (purchaseId) {
    box.innerHTML = `<p class="muted">${esc(t('live.checkingPayment'))}</p>`;
    let tries = 0;
    const check = async () => {
      tries += 1;
      try {
        const r = await WisecallAPI.apiFetch(`/live/replay/purchases/${encodeURIComponent(purchaseId)}/sync`, { method: 'POST' });
        if (r.purchase && r.purchase.status === 'paid') { window.location.replace(location.pathname); return; }
        if (r.purchase && r.purchase.status === 'expired') {
          history.replaceState(null, '', location.pathname);
          draw();
          document.getElementById('buyError').textContent = t(params.get('status') === 'cancel' ? 'live.payCancelled' : 'live.payFailed');
          return;
        }
      } catch (e) { /* asked again below */ }
      if (tries < 10) setTimeout(check, 2000); else draw();
    };
    check();
  } else draw();
})();
