// Admin → Mentors: the one-off "profile update" email (server/profileUpdateEmail.js). The button opens a preview: each approved mentor
// whose profile lacks "ჩემი გზა", "შენ შესახებ" or a photo, what they lack, and the exact email they would get (subject and the email as
// it looks), in the language chosen next to them (ქართული / English; their site language to begin with): changing it changes the email
// shown, and it is the language sent. Every mentor starts ticked; any can be unticked. Nothing is sent until "გაგზავნა" (and its one question) is pressed; then
// only the ticked ones, each at most once. Who already got it, with the date, is listed under it and named on the button.
//   AdminProfileUpdate.mount(box)   the button (and, opened, the preview) in this element
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (key, vars) => Object.entries(vars || {}).reduce((s, [k, v]) => s.split(`{${k}}`).join(String(v)), t(key));
  const date = (d) => WisecallI18n.formatDate(d, { dateStyle: 'medium', timeStyle: 'short' });
  const part = (p) => `<span class="badge badge-muted pu-part">${esc(t('admin.pu.part.' + p))}</span>`;

  function mount(box) {
    let data = null;
    let open = false;
    const picked = new Set();
    const langs = new Map(); // (the language chosen for each mentor's email: their site language to begin with)

    async function load() {
      data = await WisecallAPI.apiFetch('/admin/profile-update');
      picked.clear();
      data.mentors.forEach((m) => { picked.add(m.id); if (!langs.has(m.id)) langs.set(m.id, m.language); });
    }
    const langOf = (m) => (m.messages[langs.get(m.id)] ? langs.get(m.id) : m.language);
    const messageOf = (m) => m.messages[langOf(m)];

    function buttonHtml() {
      const sent = data ? data.sent.length : 0;
      return `<div class="pu-bar">
        <button type="button" class="btn btn-outline" data-pu-open aria-expanded="${open}">${esc(t('admin.pu.button'))}</button>
        ${data ? `<span class="muted small" data-pu-count>${esc(fill('admin.pu.count', { n: data.mentors.length, sent }))}</span>` : ''}
      </div>`;
    }

    function itemHtml(m) {
      return `
        <li class="pu-item" data-pu-item="${esc(m.id)}">
          <div class="pu-head">
            <label class="pu-pick">
              <input type="checkbox" data-pu-id="${esc(m.id)}"${picked.has(m.id) ? ' checked' : ''}>
              <span><strong>${esc(m.name)}</strong> <span class="muted small">${esc(m.email)}</span></span>
            </label>
            <select class="pu-lang" data-pu-lang="${esc(m.id)}" aria-label="${esc(fill('admin.pu.langLabel', { name: m.name }))}">
              ${['ka', 'en'].map((l) => `<option value="${l}"${langOf(m) === l ? ' selected' : ''}>${esc(t('admin.pu.lang.' + l))}</option>`).join('')}
            </select>
          </div>
          <p class="pu-missing"><span class="muted small">${esc(t('admin.pu.missing'))}</span> ${m.missing.map(part).join(' ')}</p>
          <details class="pu-mail">
            <summary>${esc(t('admin.pu.see'))}</summary>
            <p class="small pu-subject"><strong>${esc(t('admin.pu.subject'))}</strong> <span data-pu-subject>${esc(messageOf(m).subject)}</span></p>
            <iframe class="pu-frame" sandbox="allow-same-origin" title="${esc(fill('admin.pu.frame', { name: m.name }))}" srcdoc="${esc(messageOf(m).html)}"></iframe>
          </details>
        </li>`;
    }

    function panelHtml() {
      const sent = data.sent.length ? `
        <h3 class="pu-sub">${esc(t('admin.pu.sentTitle'))}</h3>
        <ul class="pu-sent">${data.sent.map((s) => `<li><strong>${esc(s.name)}</strong> <span class="muted small">${esc(s.email)} · ${esc(date(s.sentAt))}</span></li>`).join('')}</ul>` : '';
      return `
        <section class="pu-panel" aria-labelledby="puTitle">
          <h2 id="puTitle" class="pu-title">${esc(t('admin.pu.title'))}</h2>
          <p class="muted small">${esc(t('admin.pu.intro'))}</p>
          ${data.mentors.length ? `
            <ul class="pu-list">${data.mentors.map(itemHtml).join('')}</ul>
            <div class="pu-actions">
              <button type="button" class="btn btn-primary" data-pu-send${picked.size ? '' : ' disabled'}>${esc(fill('admin.pu.send', { n: picked.size }))}</button>
              <button type="button" class="btn btn-ghost" data-pu-close>${esc(t('admin.pu.close'))}</button>
            </div>` : `<p class="muted">${esc(t('admin.pu.none'))}</p>`}
          ${sent}
        </section>`;
    }

    function draw() {
      box.innerHTML = buttonHtml() + (open && data ? panelHtml() : '');
      box.querySelector('[data-pu-open]').addEventListener('click', async () => {
        if (open) { open = false; draw(); return; }
        try { await load(); open = true; draw(); } catch (e) { WisecallNav.showToast(t('toast.error')); }
      });
      if (!open) return;
      const sendBtn = box.querySelector('[data-pu-send]');
      box.querySelectorAll('[data-pu-id]').forEach((c) => c.addEventListener('change', () => {
        if (c.checked) picked.add(c.dataset.puId); else picked.delete(c.dataset.puId);
        sendBtn.textContent = fill('admin.pu.send', { n: picked.size });
        sendBtn.disabled = !picked.size;
      }));
      const close = box.querySelector('[data-pu-close]');
      if (close) close.addEventListener('click', () => { open = false; draw(); });
      // (the email as it looks, as tall as it is)
      const fit = (f) => { if (f && f.offsetParent && f.contentDocument && f.contentDocument.documentElement) f.style.height = `${f.contentDocument.documentElement.scrollHeight + 4}px`; };
      box.querySelectorAll('.pu-mail').forEach((d) => {
        const f = d.querySelector('iframe');
        d.addEventListener('toggle', () => { if (d.open) fit(f); });
        f.addEventListener('load', () => fit(f));
      });
      // The language of each mentor's email: the subject and the email shown follow it at once, and it is the one sent.
      box.querySelectorAll('[data-pu-lang]').forEach((sel) => sel.addEventListener('change', () => {
        const m = data.mentors.find((x) => x.id === sel.dataset.puLang);
        if (!m || !m.messages[sel.value]) return;
        langs.set(m.id, sel.value);
        const li = sel.closest('[data-pu-item]');
        li.querySelector('[data-pu-subject]').textContent = messageOf(m).subject;
        li.querySelector('iframe').srcdoc = messageOf(m).html;
      }));
      if (sendBtn) sendBtn.addEventListener('click', async () => {
        const ids = data.mentors.map((m) => m.id).filter((id) => picked.has(id));
        if (!ids.length) return;
        if (!(await WisecallDialog.confirm({ message: fill('admin.pu.confirm', { n: ids.length }), confirmText: t('admin.pu.sendShort') }))) return;
        sendBtn.disabled = true;
        try {
          const r = await WisecallAPI.apiFetch('/admin/profile-update/send', { method: 'POST', body: { ids, langs: Object.fromEntries(ids.map((id) => [id, langs.get(id)])), confirm: true } });
          WisecallNav.showToast(fill(r.failed.length ? 'admin.pu.doneFailed' : 'admin.pu.done', { n: r.sent.length, failed: r.failed.length }));
          await load();
          draw();
        } catch (e) { WisecallNav.showToast(t('toast.error')); sendBtn.disabled = false; }
      });
    }

    // (the count of who already got it is on the button from the start)
    draw();
    load().then(draw).catch(() => {});
  }

  window.AdminProfileUpdate = { mount };
})();
