// /live/<slug> (written by the server): the time in the visitor's own time zone, and the ticket box: buy (with the rules shown before
// paying and up to 2 questions for the mentor), coming back from the bank (the server asks the bank), cancel, join, report.
(async function () {
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();
  const t = WisecallI18n.t;
  const page = document.querySelector('.live-page');
  if (!page) return;
  const slug = page.dataset.slug;
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (key, vars) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const money = (tetri) => WisecallAPI.formatAmount(tetri);
  if (window.WisecallCopy) WisecallCopy.wire(page);

  // The start in the visitor's own time zone, when it is not Tbilisi's.
  const local = page.querySelector('.live-local');
  const time = page.querySelector('.live-when time');
  if (local && time) {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && zone !== 'Asia/Tbilisi') {
      local.textContent = '· ' + fill('live.yourTime', { time: WisecallI18n.formatDate(time.dataset.local, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) });
      local.hidden = false;
    }
  }

  const box = document.getElementById('liveBuy');
  let data;
  async function load() {
    try { data = await WisecallAPI.apiFetch(`/live/s/${encodeURIComponent(slug)}`); } catch (e) { box.innerHTML = `<p class="muted">${esc(t('toast.error'))}</p>`; return; }
    draw();
  }

  function rules(s) {
    return `<ul class="live-rules small">
      <li>${esc(t('live.rule.refund'))}</li>
      <li>${esc(t('live.rule.noShow'))}</li>
      <li>${esc(t('live.rule.cameraOff'))}</li>
      ${s.regulated ? `<li><strong>${esc(t('live.regulatedLabel'))}</strong></li>` : ''}
      ${s.crisisNotice ? `<li>${esc(t('live.crisis'))}</li>` : ''}
    </ul>`;
  }

  function draw() {
    const s = data.session;
    const tk = data.ticket;
    const start = new Date(s.startsAt).getTime();
    if (data.isMentor) {
      box.innerHTML = `<p class="muted small">${esc(t('live.youHost'))}</p>
        ${['published', 'live'].includes(s.status) ? `<a class="btn btn-primary btn-block" href="/live/${encodeURIComponent(slug)}/room">${esc(t('live.openRoom'))}</a>` : ''}
        <a class="btn btn-outline btn-block" href="/dashboard.html?tab=live">${esc(t('live.manage'))}</a>`;
      return;
    }
    if (tk && tk.status === 'paid') {
      const canJoin = Date.now() >= start - 10 * 60000;
      box.innerHTML = `<p class="live-have"><strong>${esc(t('live.haveTicket'))}</strong></p>
        ${canJoin ? `<a class="btn btn-primary btn-block" href="/live/${encodeURIComponent(slug)}/room">${esc(t('live.join'))}</a>`
          : `<p class="muted small">${esc(t('live.joinOpens'))}</p>`}
        <a class="btn btn-outline btn-block" href="/api/live/tickets/${encodeURIComponent(tk.id)}/calendar.ics">${esc(t('live.addCalendar'))}</a>
        <p class="small"><a class="plain-link" href="/dashboard.html?tab=live">${esc(t('live.myTickets'))}</a></p>`;
      return;
    }
    if (tk && tk.status === 'held') {
      box.innerHTML = `<p class="muted">${esc(t('live.checkingPayment'))}</p>`;
      return;
    }
    if (!['published'].includes(s.status) || Date.now() >= start) {
      box.innerHTML = `<p class="muted">${esc(t(s.status === 'cancelled' ? 'live.cancelledNote' : 'live.notOnSale'))}</p>`;
      return;
    }
    if (s.seatsLeft <= 0) { box.innerHTML = `<p class="muted">${esc(t('live.label.soldOut'))}</p>`; return; }
    if (!user) {
      const back = encodeURIComponent(location.pathname);
      box.innerHTML = `${rules(s)}<a class="btn btn-primary btn-block" href="/login.html?redirect=${back}">${esc(t('live.loginToBuy'))}</a>`;
      return;
    }
    box.innerHTML = `<form id="buyForm" novalidate>
        ${rules(s)}
        <details class="live-ask"><summary>${esc(t('live.askAhead'))}</summary>
          <label for="q1"><span class="small">${esc(t('live.question'))} 1</span><textarea id="q1" rows="2" maxlength="300"></textarea></label>
          <label for="q2"><span class="small">${esc(t('live.question'))} 2</span><textarea id="q2" rows="2" maxlength="300"></textarea></label>
          <p class="hint">${esc(t('live.askAheadHint'))}</p>
        </details>
        <label class="checkbox-row" for="anon"><input type="checkbox" id="anon"> <span>${esc(t('live.joinAnonymous'))}</span></label>
        <label class="checkbox-row" for="agree"><input type="checkbox" id="agree" required> <span>${esc(t('live.agreeRules'))}</span></label>
        <p class="form-error" id="buyError" role="alert"></p>
        <button type="submit" class="btn btn-primary btn-block">${esc(fill('live.buy', { price: money(s.priceNow) }))}</button>
      </form>`;
    document.getElementById('buyForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = document.getElementById('buyError');
      err.textContent = '';
      if (!document.getElementById('agree').checked) { err.textContent = t('live.err.agree'); return; }
      const btn = ev.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const r = await WisecallAPI.apiFetch(`/live/${encodeURIComponent(s.id)}/tickets`, { method: 'POST', body: {
          questions: [document.getElementById('q1').value, document.getElementById('q2').value].filter((q) => q.trim()),
          anonymous: document.getElementById('anon').checked } });
        window.location.href = r.checkoutUrl;
      } catch (e) {
        err.textContent = t('live.err.' + e.code) !== 'live.err.' + e.code ? t('live.err.' + e.code) : t('toast.error');
        btn.disabled = false;
      }
    });
  }

  // Back from the bank: the server asks the bank; the box shows the result.
  const params = new URLSearchParams(location.search);
  const ticketId = params.get('ticket');
  if (ticketId) {
    box.innerHTML = `<p class="muted">${esc(t('live.checkingPayment'))}</p>`;
    let tries = 0;
    const check = async () => {
      tries += 1;
      try {
        const r = await WisecallAPI.apiFetch(`/live/tickets/${encodeURIComponent(ticketId)}/sync`, { method: 'POST' });
        if (r.ticket && r.ticket.status === 'paid') { WisecallNav.showToast(t('live.paid')); history.replaceState(null, '', location.pathname); return load(); }
        if (r.ticket && r.ticket.status === 'expired') {
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

  // Report (the same reasons for everyone; the mentor's payout waits until an admin has looked).
  const report = document.getElementById('liveReport');
  if (report) report.addEventListener('click', async () => {
    if (!user) { window.location.href = '/login.html?redirect=' + encodeURIComponent(location.pathname); return; }
    const ok = await WisecallDialog.confirm({ message: t('live.reportConfirm'), confirmText: t('live.report') });
    if (!ok) return;
    try { await WisecallAPI.apiFetch(`/live/${encodeURIComponent(page.dataset.session)}/report`, { method: 'POST', body: { reason: 'not_as_described' } }); WisecallNav.showToast(t('live.reported')); }
    catch (e) { WisecallNav.showToast(t(e.code === 'already_reported' ? 'live.alreadyReported' : 'toast.error')); }
  });
})();
