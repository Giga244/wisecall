// Admin: reported problems with answers ("disputes"). Each open one shows the question, the answer, the asker's reason, and a decision
// form: full refund, partial refund (the amount in lari; the mentor's part is taken in proportion to their share), or no refund, with
// a note both people see. Loaded by admin.html before admin.js.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (key, vars) => Object.entries(vars || {}).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const money = (tetri) => WisecallAPI.formatAmount(tetri);
  const when = (d) => WisecallI18n.formatDate(d, { dateStyle: 'medium', timeStyle: 'short' });
  let status = 'open';

  async function render(container) {
    container.innerHTML = `
      <div class="filters">${['open', 'resolved'].map((s) => `<button type="button" class="chip${s === status ? ' active' : ''}" data-dis-status="${s}">${esc(t('admin.dis.' + s))}</button>`).join('')}</div>
      <p class="muted small">${esc(t('admin.dis.help'))}</p>
      <div id="disList"><p class="muted">${esc(t('admin.loading'))}</p></div>`;
    container.querySelector('.filters').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-dis-status]');
      if (b) { status = b.dataset.disStatus; render(container); }
    });
    const box = container.querySelector('#disList');
    let data;
    try { data = await WisecallAPI.apiFetch(`/admin/disputes?status=${status}`); } catch (e) { box.innerHTML = `<p class="muted">${esc(t('toast.error'))}</p>`; return; }
    if (!data.disputes.length) { box.innerHTML = `<p class="muted">${esc(t('admin.dis.none'))}</p>`; return; }
    box.innerHTML = data.disputes.map((d) => `
      <article class="settings-card dis-card" data-dispute="${esc(d.id)}">
        <p class="small muted">${esc(fill('admin.dis.people', { asker: `${d.asker.name} (${d.asker.email})`, mentor: `${d.mentor.name} (${d.mentor.email})` }))} · ${esc(when(d.createdAt))}</p>
        <p><strong>${esc(t('admin.dis.reason'))}</strong> ${esc(t('dash.dispute.r.' + d.reason))}</p>
        ${d.details ? `<p class="msg-body">${esc(d.details)}</p>` : ''}
        <details><summary>${esc(t('admin.dis.qa'))}</summary>
          <h4 class="small">${esc(t('inbox.theQuestion'))}</h4><p class="msg-body">${esc(d.question)}</p>
          <h4 class="small">${esc(t('inbox.theAnswer'))}</h4><p class="msg-body">${esc(d.answer || '')}</p>
        </details>
        <p class="small">${esc(fill('admin.dis.amounts', { price: money(d.amount), fee: money(d.fee), mentor: money(d.mentorNet) }))}</p>
        ${d.status === 'resolved' ? `<p><strong>${esc(t('admin.dis.outcome.' + d.outcome))}</strong>${d.refundAmount ? ` · ${esc(money(d.refundAmount))}` : ''} · ${esc(d.resolvedBy || '')}</p><p class="small">${esc(d.note || '')}</p>` : `
        <form class="dis-form" novalidate>
          <fieldset>
            <legend class="small">${esc(t('admin.dis.decide'))}</legend>
            ${['full_refund', 'partial_refund', 'rejected'].map((o) => `<label class="checkbox-row"><input type="radio" name="outcome-${esc(d.id)}" value="${o}"> <span>${esc(t('admin.dis.outcome.' + o))}</span></label>`).join('')}
          </fieldset>
          <label class="field-label small" for="dis-amount-${esc(d.id)}">${esc(t('admin.dis.amount'))}</label>
          <input type="number" id="dis-amount-${esc(d.id)}" min="0.01" step="0.01" max="${(d.amount / 100 - 0.01).toFixed(2)}" inputmode="decimal">
          <p class="small muted dis-split"></p>
          <label class="field-label small" for="dis-note-${esc(d.id)}">${esc(t('admin.dis.note'))}</label>
          <textarea id="dis-note-${esc(d.id)}" rows="2" maxlength="1000"></textarea>
          <p class="form-error" role="alert"></p>
          <button type="submit" class="btn btn-primary btn-sm">${esc(t('admin.dis.save'))}</button>
        </form>`}
      </article>`).join('');
    box.querySelectorAll('.dis-card').forEach((card) => {
      const form = card.querySelector('.dis-form');
      if (!form) return;
      const d = data.disputes.find((x) => x.id === card.dataset.dispute);
      const amountInput = form.querySelector('input[type="number"]');
      const split = form.querySelector('.dis-split');
      const tetri = () => Math.round(Number(amountInput.value || 0) * 100);
      amountInput.addEventListener('input', () => {
        const a = tetri();
        split.textContent = a > 0 && a < d.amount ? fill('admin.dis.split', { mentor: money(Math.round(a * d.mentorNet / d.amount)), fee: money(a - Math.round(a * d.mentorNet / d.amount)) }) : '';
      });
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const err = form.querySelector('.form-error');
        err.textContent = '';
        const outcome = (form.querySelector('input[type="radio"]:checked') || {}).value;
        const note = form.querySelector('textarea').value.trim();
        if (!outcome) { err.textContent = t('admin.dis.pick'); return; }
        if (note.length < 5) { err.textContent = t('admin.mv.reasonRequired'); return; }
        if (outcome === 'partial_refund' && !(tetri() >= 1 && tetri() < d.amount)) { err.textContent = t('admin.dis.badAmount'); return; }
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          await WisecallAPI.apiFetch(`/admin/disputes/${d.id}/resolve`, { method: 'POST', body: { outcome, note, amount: outcome === 'partial_refund' ? tetri() : undefined } });
          WisecallNav.showToast(t('toast.saved'));
          render(container);
        } catch (e) {
          err.textContent = e.code === 'refund_failed' ? `${t('admin.dis.bankError')} ${e.message2 || ''}` : t('toast.error');
          btn.disabled = false;
        }
      });
    });
  }

  window.AdminDisputes = { render };
})();
