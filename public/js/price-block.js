// The price, for a mentor: the current price, "I answer for free" and Save (docs/CLAUDE-CODE-MENTOR-EDIT.md). On the dashboard and in Settings ->
// My details, two taps either way: the switch, then Save. Turning free off brings back the last paid price. Questions already asked keep theirs.
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // box: an element; user: the signed-in mentor (updated in place); opts.history: the price history, when the page already has it
  async function mount(box, user, opts) {
    const o = opts || {};
    const t = WisecallI18n.t;
    let history = o.history;
    if (!history) { try { history = (await WisecallAPI.apiFetch('/me/details')).priceHistory || []; } catch (e) { history = []; } }
    let lastPaid = user.price > 0 ? user.price : ((history.find((h) => h.to > 0) || {}).to || '');
    const now = () => (user.price === 0 ? t('priceBlock.free') : `${user.price} ₾`);
    const id = (box.id || 'priceBlock') + '-';
    box.innerHTML = `
      <section class="settings-card price-block" aria-labelledby="${id}title">
        <h2 id="${id}title">${esc(t('priceBlock.title'))}</h2>
        <p class="price-block-now">${esc(t('priceBlock.now'))} <strong data-price-now>${esc(now())}</strong></p>
        <form data-price-form novalidate>
          <label class="checkbox-row price-free-toggle" for="${id}free"><input type="checkbox" role="switch" id="${id}free" data-price-free${user.price === 0 ? ' checked' : ''}> <span>${esc(t('priceBlock.freeToggle'))}</span></label>
          <label for="${id}amount" data-price-paid${user.price === 0 ? ' hidden' : ''}><span>${esc(t('priceBlock.label'))}</span>
            <input type="number" id="${id}amount" data-price-input min="5" max="2000" step="1" inputmode="numeric" value="${esc(user.price > 0 ? user.price : lastPaid)}">
          </label>
          <p class="hint">${esc(t('priceBlock.keep'))}</p>
          <p class="form-error" role="alert" data-price-error></p>
          <button type="submit" class="btn btn-primary" data-price-save>${esc(t('priceBlock.save'))}</button>
        </form>
      </section>`;
    const form = box.querySelector('[data-price-form]');
    const free = box.querySelector('[data-price-free]');
    const input = box.querySelector('[data-price-input]');
    const paidBox = box.querySelector('[data-price-paid]');
    const error = box.querySelector('[data-price-error]');
    free.addEventListener('change', () => {
      paidBox.hidden = free.checked;
      if (!free.checked && !input.value) input.value = lastPaid;
      error.textContent = '';
    });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      error.textContent = '';
      const price = free.checked ? 0 : Number(input.value);
      if (!free.checked && (!Number.isInteger(price) || price < 5 || price > 2000)) { error.textContent = t('settings.mentor.price.invalid'); input.focus(); return; }
      try {
        const data = await WisecallAPI.apiFetch('/me', { method: 'PATCH', body: { price } });
        Object.assign(user, data.user);
        if (user.price > 0) lastPaid = user.price;
        box.querySelector('[data-price-now]').textContent = now();
        // (from free to a price without payout details: they are needed to stay in Browse experts)
        if (data.payoutNeeded) { WisecallNav.showToast(t('settings.payouts.neededForPrice')); if (o.onPayoutNeeded) o.onPayoutNeeded(); else window.location.href = '/settings.html?tab=payouts'; return; }
        WisecallNav.showToast(t('priceBlock.saved'));
        if (o.onSaved) o.onSaved(user);
      } catch (e) {
        error.textContent = t(e.code === 'invalid_price' ? 'settings.mentor.price.invalid' : 'toast.error');
      }
    });
  }

  window.WisecallPriceBlock = { mount };
})();
