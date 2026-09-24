// Admin: video interview slots. Publish times, add the meeting link when a mentor books, record the result.
// Loaded by admin.html before admin.js.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const locale = () => (WisecallI18n.getLang() === 'ka' ? 'ka-GE' : 'en-GB');
  const fmt = (d) => new Date(d).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });

  const errorKey = { invalid_slot: 'admin.iv.invalidSlot', invalid_link: 'admin.iv.invalidLink', reason_required: 'admin.mv.reasonRequired', not_started: 'admin.iv.notStarted' };
  const fail = (e) => WisecallNav.showToast(t(errorKey[e.code] || 'toast.error'));

  function bookedCard(s) {
    const started = new Date(s.startsAt).getTime() <= Date.now();
    return `
      <div class="booking-card iv-card" data-id="${esc(s.id)}">
        <div class="booking-top">
          <div>
            <div class="card-name">${esc(s.mentor ? s.mentor.name : '')}</div>
            <span class="muted small">${esc(s.mentor ? s.mentor.email : '')}${s.mentor && s.mentor.niche ? ' · ' + esc(t('niche.' + s.mentor.niche)) : ''}</span>
          </div>
          <div class="booking-amount">${fmt(s.startsAt)}</div>
        </div>
        <div class="mv-decide">
          <input type="url" class="iv-link" maxlength="500" placeholder="${esc(t('admin.iv.linkPlaceholder'))}" aria-label="${esc(t('admin.iv.linkPlaceholder'))}" value="${esc(s.meetingLink || '')}">
          <button class="btn btn-outline btn-sm iv-send">${t('admin.iv.sendLink')}</button>
        </div>
        ${s.linkSentAt ? `<p class="muted small">${t('admin.iv.linkSent').replace('{date}', fmt(s.linkSentAt))}</p>` : ''}
        <div class="mv-decide">
          <input type="text" class="iv-cancel-reason" maxlength="300" placeholder="${esc(t('admin.iv.cancelReason'))}" aria-label="${esc(t('admin.iv.cancelReason'))}">
          <button class="btn btn-ghost btn-sm iv-cancel">${t('admin.iv.cancel')}</button>
        </div>
        <div class="iv-result">
          ${started ? `
            <div class="mv-decide">
              <input type="text" class="iv-reason" maxlength="300" placeholder="${esc(t('admin.iv.resultReason'))}" aria-label="${esc(t('admin.iv.resultReason'))}">
              <input type="text" class="iv-notes" maxlength="1000" placeholder="${esc(t('admin.iv.notes'))}" aria-label="${esc(t('admin.iv.notes'))}">
              <button class="btn btn-primary btn-sm iv-pass">${t('admin.mv.pass')}</button>
              <button class="btn btn-outline btn-sm iv-fail">${t('admin.mv.fail')}</button>
            </div>` : `<p class="muted small">${t('admin.iv.notStarted')}</p>`}
        </div>
      </div>`;
  }

  function render(container) {
    container.innerHTML = `<p class="muted">${t('admin.loading')}</p>`;
    return load(container);
  }

  async function load(container) {
    const reload = () => load(container);
    let data;
    try { data = await WisecallAPI.apiFetch('/admin/interviews'); } catch (e) { container.innerHTML = `<p class="muted">${t('toast.error')}</p>`; return; }
    const booked = data.slots.filter((s) => s.status === 'booked');
    const open = data.slots.filter((s) => s.status === 'open');
    const done = data.slots.filter((s) => s.status === 'completed' || s.status === 'cancelled').reverse();

    container.innerHTML = `
      <form class="iv-add" novalidate>
        <h2 class="reviews-title">${t('admin.iv.addTitle')}</h2>
        <div class="mv-decide">
          <label class="muted small" for="ivWhen">${t('admin.iv.when')}</label>
          <input type="datetime-local" id="ivWhen" required>
          <label class="muted small" for="ivMinutes">${t('admin.iv.minutes')}</label>
          <input type="number" id="ivMinutes" min="5" max="120" value="20" style="width:90px">
          <button class="btn btn-primary btn-sm" type="submit">${t('admin.iv.add')}</button>
        </div>
      </form>
      <h2 class="reviews-title" style="margin-top:28px">${t('admin.iv.booked')} (${booked.length})</h2>
      ${booked.length ? booked.map(bookedCard).join('') : `<p class="muted">${t('admin.iv.none')}</p>`}
      <h2 class="reviews-title" style="margin-top:28px">${t('admin.iv.open')} (${open.length})</h2>
      ${open.length ? `<ul class="earn-list">${open.map((s) => `<li data-id="${esc(s.id)}"><span>${fmt(s.startsAt)}</span><span>${s.minutes} min</span><button class="btn btn-ghost btn-sm iv-delete">${t('admin.iv.delete')}</button></li>`).join('')}</ul>` : `<p class="muted">${t('admin.iv.none')}</p>`}
      ${done.length ? `
        <h2 class="reviews-title" style="margin-top:28px">${t('admin.iv.recent')}</h2>
        <ul class="earn-list">${done.map((s) => `<li><span>${fmt(s.startsAt)}</span><span>${esc(s.mentor ? s.mentor.name : '')}</span><span class="badge badge-${s.result === 'passed' ? 'answered' : 'rejected'}">${s.result ? t('verify.status.' + s.result) : t('admin.iv.cancelled')}</span></li>`).join('')}</ul>` : ''}`;

    container.querySelector('.iv-add').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const when = container.querySelector('#ivWhen').value;
      const minutes = Number(container.querySelector('#ivMinutes').value);
      if (!when) { WisecallNav.showToast(t('admin.iv.invalidSlot')); return; }
      try {
        await WisecallAPI.apiFetch('/admin/interviews', { method: 'POST', body: { startsAt: new Date(when).toISOString(), minutes } });
        WisecallNav.showToast(t('admin.iv.added'));
        reload();
      } catch (e) { fail(e); }
    });

    container.querySelectorAll('.iv-delete').forEach((btn) => btn.addEventListener('click', async () => {
      try { await WisecallAPI.apiFetch(`/admin/interviews/${btn.closest('li').dataset.id}`, { method: 'DELETE' }); reload(); } catch (e) { fail(e); }
    }));

    container.querySelectorAll('.iv-card').forEach((card) => {
      const id = card.dataset.id;
      const act = async (path, body, done) => {
        try { await WisecallAPI.apiFetch(`/admin/interviews/${id}${path}`, { method: 'POST', body }); WisecallNav.showToast(t('toast.saved')); if (done) done(); reload(); } catch (e) { fail(e); }
      };
      card.querySelector('.iv-send').addEventListener('click', () => act('/link', { link: card.querySelector('.iv-link').value.trim() }));
      card.querySelector('.iv-cancel').addEventListener('click', () => act('/cancel', { reason: card.querySelector('.iv-cancel-reason').value.trim() }));
      const decide = (result) => () => {
        const reason = card.querySelector('.iv-reason').value.trim();
        if (reason.length < 5) { WisecallNav.showToast(t('admin.mv.reasonRequired')); return; }
        act('/result', { result, reason, notes: card.querySelector('.iv-notes').value.trim() });
      };
      const pass = card.querySelector('.iv-pass');
      const failBtn = card.querySelector('.iv-fail');
      if (pass) pass.addEventListener('click', decide('passed'));
      if (failBtn) failBtn.addEventListener('click', decide('failed'));
    });
  }

  window.AdminInterviews = { render };
})();
