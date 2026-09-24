// The FAKE bank's payment page (development only; the server does not serve it in production).
(async function () {
  await WisecallI18n.initI18n();
  const t = WisecallI18n.t;
  const orderId = new URLSearchParams(location.search).get('order');
  const amountEl = document.getElementById('mockAmount');
  const errorEl = document.getElementById('mockError');
  const buttons = ['payBtn', 'failBtn', 'cancelBtn'].map((id) => document.getElementById(id));

  let order = null;
  try {
    order = (await WisecallAPI.apiFetch(`/mock-bank/orders/${encodeURIComponent(orderId || '')}`)).order;
    amountEl.textContent = WisecallAPI.formatAmount(order.amount);
  } catch (e) {
    errorEl.textContent = t('mockbank.notFound');
    buttons.forEach((b) => { b.disabled = true; });
    return;
  }

  async function finish(outcome) {
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const { redirect } = await WisecallAPI.apiFetch(`/mock-bank/orders/${encodeURIComponent(order.id)}/complete`, { method: 'POST', body: { outcome } });
      window.location.href = redirect;
    } catch (e) {
      errorEl.textContent = t('toast.error');
      buttons.forEach((b) => { b.disabled = false; });
    }
  }
  document.getElementById('payBtn').addEventListener('click', () => finish('success'));
  document.getElementById('failBtn').addEventListener('click', () => finish('fail'));
  document.getElementById('cancelBtn').addEventListener('click', () => finish('cancel'));
})();
