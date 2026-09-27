// Admin: the support inbox (conversations people started with Wisecall, and contact-form messages from signed-in people) and the
// messages people reported. Loaded by admin.html before admin.js. Everything a person wrote is shown as plain text (escaped).
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (key, vars) => Object.entries(vars || {}).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const when = (d) => new Date(d).toLocaleString(WisecallI18n.getLang() === 'ka' ? 'ka-GE' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' });

  let status = 'open';
  let openId = null;

  async function render(container) {
    container.innerHTML = `
      <div class="filters" id="supFilters">${['open', 'closed', ''].map((s) => `<button type="button" class="chip${s === status ? ' active' : ''}" data-sup-status="${s}">${esc(t('admin.sup.' + (s || 'all')))}</button>`).join('')}</div>
      <div class="sup-layout">
        <ul class="earn-list sup-list" id="supList"><li class="muted">${esc(t('admin.loading'))}</li></ul>
        <div id="supThread"></div>
      </div>
      <h2 class="sup-reports-title">${esc(t('admin.sup.reports'))}</h2>
      <div id="supReports"></div>`;
    container.querySelector('#supFilters').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-sup-status]');
      if (!b) return;
      status = b.dataset.supStatus;
      render(container);
    });
    await Promise.all([drawList(container), drawReports(container)]);
    if (openId) await openThread(container, openId);
  }

  async function drawList(container) {
    const box = container.querySelector('#supList');
    let data;
    try { data = await WisecallAPI.apiFetch(`/admin/support${status ? `?status=${status}` : ''}`); } catch (e) { box.innerHTML = `<li class="muted">${esc(t('toast.error'))}</li>`; return; }
    if (!data.threads.length) { box.innerHTML = `<li class="muted">${esc(t('admin.sup.empty'))}</li>`; return; }
    box.innerHTML = data.threads.map((th) => `
      <li class="sup-item">
        <div>
          <strong>${esc(th.subject || '—')}</strong>
          <span class="muted small block">${esc(fill('admin.sup.person', { name: th.user.name, email: th.user.email }))} · ${esc(when(th.lastMessageAt))}</span>
          <span class="small block">${esc(th.lastBody || '')}</span>
        </div>
        <div class="sup-item-side">
          ${th.waitingForUs && th.status === 'open' ? `<span class="badge badge-pending_payment">${esc(t('admin.sup.waiting'))}</span>` : ''}
          <span class="muted small">${esc(th.assignedTo ? fill('admin.sup.assigned', { email: th.assignedTo }) : t('admin.sup.unassigned'))}</span>
          <button type="button" class="btn btn-outline btn-sm" data-sup-open="${esc(th.id)}">${esc(t('admin.sup.open.btn'))}</button>
        </div>
      </li>`).join('');
    box.onclick = (ev) => { const b = ev.target.closest('[data-sup-open]'); if (b) openThread(container, b.dataset.supOpen); };
  }

  async function openThread(container, id) {
    const box = container.querySelector('#supThread');
    let d;
    try { d = await WisecallAPI.apiFetch(`/admin/support/${encodeURIComponent(id)}`); } catch (e) { box.innerHTML = `<p class="muted">${esc(t('toast.error'))}</p>`; return; }
    openId = id;
    const th = d.thread;
    box.innerHTML = `
      <div class="settings-card sup-thread">
        <h3>${esc(th.subject || '—')}</h3>
        <p class="muted small">${d.user ? esc(fill('admin.sup.person', { name: d.user.name, email: d.user.email })) : ''} · ${esc(th.assignedTo ? fill('admin.sup.assigned', { email: th.assignedTo }) : t('admin.sup.unassigned'))}</p>
        <ol class="msg-list">${d.messages.map((m) => m.kind === 'event' ? '' : `
          <li class="msg${m.senderRole === 'support' || m.kind === 'internal_note' ? ' msg-mine' : ''}">
            <div class="msg-bubble${m.kind === 'internal_note' ? ' sup-note' : ''}">
              <p class="msg-meta"><strong>${esc(m.kind === 'internal_note' ? t('admin.sup.internal') : (m.senderRole === 'support' ? (m.by || 'Wisecall') : (d.user ? d.user.name : '')))}</strong> · ${esc(when(m.createdAt))}${m.data && m.data.source === 'contact' ? ` · ${esc(t('admin.sup.fromContact'))}` : ''}</p>
              <p class="msg-body">${esc(m.body)}</p>
            </div>
          </li>`).join('')}</ol>
        <form class="inbox-composer" id="supReply" novalidate>
          <label class="field-label" for="supReplyText">${esc(t('admin.sup.replyLabel'))}</label>
          <textarea id="supReplyText" rows="4" maxlength="3000"></textarea>
          <label class="checkbox-row small"><input type="checkbox" id="supInternal"> <span>${esc(t('admin.sup.noteLabel'))}</span></label>
          <div class="composer-actions">
            <span>
              <button type="button" class="btn btn-ghost btn-sm" data-sup-assign="${th.assignedTo ? 'none' : 'me'}">${esc(t(th.assignedTo ? 'admin.sup.unassign' : 'admin.sup.assignMe'))}</button>
              <button type="button" class="btn btn-ghost btn-sm" data-sup-state="${th.status === 'open' ? 'closed' : 'open'}">${esc(t(th.status === 'open' ? 'admin.sup.close' : 'admin.sup.reopen'))}</button>
            </span>
            <button type="submit" class="btn btn-primary btn-sm">${esc(t('admin.sup.send'))}</button>
          </div>
        </form>
      </div>`;
    const form = box.querySelector('#supReply');
    const internal = box.querySelector('#supInternal');
    internal.addEventListener('change', () => { form.querySelector('button[type="submit"]').textContent = t(internal.checked ? 'admin.sup.addNote' : 'admin.sup.send'); });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const text = box.querySelector('#supReplyText').value;
      if (!text.trim()) return;
      try {
        await WisecallAPI.apiFetch(`/admin/support/${id}/messages`, { method: 'POST', body: { body: text, internal: internal.checked } });
        WisecallNav.showToast(t('toast.saved'));
        await render(container);
      } catch (e) { WisecallNav.showToast(t('toast.error')); }
    });
    box.querySelectorAll('[data-sup-assign], [data-sup-state]').forEach((b) => b.addEventListener('click', async () => {
      const body = b.dataset.supAssign ? { assign: b.dataset.supAssign } : { status: b.dataset.supState };
      try { await WisecallAPI.apiFetch(`/admin/support/${id}`, { method: 'PATCH', body }); await render(container); } catch (e) { WisecallNav.showToast(t('toast.error')); }
    }));
  }

  async function drawReports(container) {
    const box = container.querySelector('#supReports');
    let data;
    try { data = await WisecallAPI.apiFetch('/admin/support/reports'); } catch (e) { box.innerHTML = `<p class="muted">${esc(t('toast.error'))}</p>`; return; }
    if (!data.reports.length) { box.innerHTML = `<p class="muted">${esc(t('admin.sup.noReports'))}</p>`; return; }
    box.innerHTML = `<ul class="earn-list">${data.reports.map((r) => `
      <li class="sup-report">
        <div>
          <p class="small muted">${esc(fill('admin.sup.reportBy', { name: r.reporter.name || '—', email: r.reporter.email || '—', reason: t('inbox.report.reason.' + r.reason) }))} · ${esc(when(r.createdAt))}</p>
          <p class="msg-body">${esc(r.message.body)}</p>
          <p class="small muted">${esc(fill('admin.sup.sender', { name: r.sender.name || '—', email: r.sender.email || '—', kind: t('admin.sup.kind.' + r.message.threadKind) }))}</p>
          ${r.details ? `<p class="small">${esc(r.details)}</p>` : ''}
        </div>
        <form class="sup-resolve" data-report="${esc(r.id)}">
          <label class="sr-only" for="res-${esc(r.id)}">${esc(t('admin.sup.resolution'))}</label>
          <input type="text" id="res-${esc(r.id)}" maxlength="500" placeholder="${esc(t('admin.sup.resolution'))}">
          <button type="submit" class="btn btn-outline btn-sm">${esc(t('admin.sup.resolve'))}</button>
        </form>
      </li>`).join('')}</ul>`;
    box.querySelectorAll('.sup-resolve').forEach((f) => f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const resolution = f.querySelector('input').value.trim();
      if (resolution.length < 3) { WisecallNav.showToast(t('admin.mv.reasonRequired')); return; }
      try { await WisecallAPI.apiFetch(`/admin/support/reports/${f.dataset.report}/resolve`, { method: 'POST', body: { resolution } }); await drawReports(container); }
      catch (e) { WisecallNav.showToast(t('toast.error')); }
    }));
  }

  window.AdminSupport = { render };
})();
