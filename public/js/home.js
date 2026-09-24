// Pieces of the home page that are not the expert list: the field strip, the FAQ accordion and the
// "get notified when mentors join" form (which main.js shows when there is nobody to list yet).
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // One small line icon per field (24 x 24, drawn in the text colour).
  const NICHES = {
    business: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 13h18"/>',
    medicine: '<path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/>',
    teaching: '<path d="M3 8l9-4 9 4-9 4-9-4z"/><path d="M7 10.5V15c0 1.5 2.2 3 5 3s5-1.5 5-3v-4.5"/>',
    tech: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
    fitness: '<path d="M6 7v10M18 7v10M3 9v6M21 9v6M6 12h12"/>',
    creative: '<path d="M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.7 17 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
    law: '<path d="M12 3v18M6 21h12M5 7h14"/><path d="M5 7l-3 7a3 3 0 0 0 6 0L5 7zM19 7l-3 7a3 3 0 0 0 6 0l-3-7z"/>',
    finance: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    marketing: '<path d="M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M17 9a4 4 0 0 1 0 6"/>',
    design: '<path d="M12 19l7-7-4-4-7 7v4h4z"/><path d="M15 8l3-3 3 3-3 3"/>',
    writing: '<path d="M4 20h4L20 8l-4-4L4 16v4z"/><path d="M13 7l4 4"/>',
    parenting: '<circle cx="8" cy="7" r="3"/><circle cx="17" cy="9" r="2.2"/><path d="M2 20c0-3.5 2.7-6 6-6s6 2.5 6 6M14 20c0-2.3 1.5-4 3.5-4S21 17.7 21 20"/>',
    engineering: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
    science: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 15h9"/>'
  };
  const icon = (key, size) => `<svg viewBox="0 0 24 24" width="${size || 22}" height="${size || 22}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${NICHES[key] || ''}</svg>`;

  // The strip of fields under the hero. Each is a link to Browse experts filtered by that field.
  function drawStrip() {
    const list = document.getElementById('nicheStrip');
    if (!list) return;
    list.innerHTML = Object.keys(NICHES).map((key) => `
      <li><a class="niche-chip" href="/index.html?niche=${key}#experts" data-niche-link="${key}">${icon(key)}<span>${esc(t('niche.' + key))}</span></a></li>`).join('');
  }

  // ---- FAQ accordion: buttons with aria-expanded, arrow keys move between questions --------------------------
  function toggleFaq(btn, open) {
    const next = open === undefined ? btn.getAttribute('aria-expanded') !== 'true' : open;
    btn.setAttribute('aria-expanded', String(next));
    document.getElementById(btn.getAttribute('aria-controls')).hidden = !next;
    btn.closest('.faq-item').classList.toggle('open', next);
  }
  function initFaq() {
    const list = document.getElementById('faqList');
    if (!list) return;
    const buttons = Array.from(list.querySelectorAll('.faq-q'));
    buttons.forEach((b) => b.addEventListener('click', () => toggleFaq(b)));
    list.addEventListener('keydown', (ev) => {
      const i = buttons.indexOf(document.activeElement);
      if (i < 0) return;
      const move = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: buttons.length - 1 }[ev.key];
      if (move === undefined) return;
      ev.preventDefault();
      buttons[(move + buttons.length) % buttons.length].focus();
    });
  }

  // ---- "Get notified when mentors in your field join" ----------------------------------------------------------
  function waitlistHtml(niche) {
    const options = ['any', ...Object.keys(NICHES)].map((k) => `<option value="${k}"${k === (niche || 'any') ? ' selected' : ''}>${esc(k === 'any' ? t('wait.any') : t('niche.' + k))}</option>`).join('');
    return `
      <form class="waitlist-form" novalidate>
        <h3>${t('wait.title')}</h3>
        <div class="waitlist-row">
          <label><span>${t('wait.email')}</span><input type="email" name="email" maxlength="254" autocomplete="email" required></label>
          <label><span>${t('wait.niche')}</span><select name="niche">${options}</select></label>
          <button class="btn btn-primary" type="submit">${t('wait.submit')}</button>
        </div>
        <p class="hint">${t('wait.consent')} <a href="/privacy.html">${t('footer.privacy')}</a></p>
        <p class="form-error waitlist-error" role="alert"></p>
      </form>`;
  }
  function wireWaitlist(root) {
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

  // A soft illustration for the empty list: two speech bubbles and a spark. Decorative only.
  const EMPTY_ART = `
    <svg class="empty-art" viewBox="0 0 220 150" aria-hidden="true">
      <circle cx="46" cy="118" r="22" fill="#ffe3a3"/>
      <circle cx="188" cy="30" r="14" fill="#bdeedb"/>
      <rect x="18" y="20" width="120" height="70" rx="22" fill="#ff6f59"/>
      <path d="M44 88 Q40 108 26 116 Q56 114 66 90 Z" fill="#ff6f59"/>
      <circle cx="54" cy="55" r="7" fill="#fff"/><circle cx="78" cy="55" r="7" fill="#fff"/><circle cx="102" cy="55" r="7" fill="#fff"/>
      <rect x="96" y="66" width="106" height="62" rx="20" fill="#fff" stroke="#2b2440" stroke-width="4"/>
      <path d="M176 126 Q184 142 200 146 Q170 146 160 128 Z" fill="#fff" stroke="#2b2440" stroke-width="4" stroke-linejoin="round"/>
      <path d="M122 98l12 12 26-28" fill="none" stroke="#3db88e" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;

  initFaq();
  // The strip's labels need the dictionary, so main.js draws it after the language is loaded.
  document.addEventListener('wisecall:lang-changed', drawStrip);

  window.WisecallHome = { NICHES: Object.keys(NICHES), icon, drawStrip, waitlistHtml, wireWaitlist, emptyArt: EMPTY_ART };
})();
