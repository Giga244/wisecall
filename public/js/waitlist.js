// The "tell me when Wisecall opens / when a mentor in my field joins" form, shared by the home page (Browse
// experts) and the expert profile. Before launch it says "opens"; afterwards "joins".
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // The fields, in the order shown. (Each needs a "niche.<key>" text in both languages.)
  const FIELDS = ['business', 'medicine', 'teaching', 'tech', 'fitness', 'creative', 'law', 'finance', 'marketing', 'design', 'writing', 'parenting', 'engineering', 'science'];
  const prelaunch = () => WisecallI18n.launchMode() === 'prelaunch';

  function html(niche) {
    const options = ['any', ...FIELDS].map((k) => `<option value="${k}"${k === (niche || 'any') ? ' selected' : ''}>${esc(k === 'any' ? t('wait.any') : t('niche.' + k))}</option>`).join('');
    return `
      <form class="waitlist-form" novalidate>
        <h3>${t(prelaunch() ? 'wait.prelaunch.title' : 'wait.title')}</h3>
        <div class="waitlist-row">
          <label><span>${t('wait.email')}</span><input type="email" name="email" maxlength="254" autocomplete="email" inputmode="email" required></label>
          <label><span>${t('wait.niche')}</span><select name="niche">${options}</select></label>
          <button class="btn btn-primary" type="submit">${t('wait.submit')}</button>
        </div>
        <p class="hint">${t('wait.consent')} <a href="/privacy.html">${t('footer.privacy')}</a></p>
        <p class="form-error waitlist-error" role="alert"></p>
      </form>`;
  }

  function wire(root) {
    root.querySelectorAll('.waitlist-form').forEach((form) => {
      if (form.dataset.wired) return;
      form.dataset.wired = '1';
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const error = form.querySelector('.waitlist-error');
        error.textContent = '';
        const email = form.email.value.trim();
        if (!form.email.checkValidity() || !email) { error.textContent = t('wait.error'); form.email.focus(); return; }
        const button = form.querySelector('button');
        button.disabled = true;
        try {
          await WisecallAPI.apiFetch('/waitlist', { method: 'POST', body: { email, niche: form.niche.value, language: WisecallI18n.getLang() } });
          form.outerHTML = `<p class="waitlist-done" role="status">${esc(t('wait.done'))}</p>`;
        } catch (e) {
          error.textContent = t(e.code === 'invalid_email' ? 'wait.error' : 'toast.error');
          button.disabled = false;
        }
      });
    });
  }

  window.WisecallWaitlist = { FIELDS, html, wire };
})();
