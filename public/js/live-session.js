// /live/<slug> (written by the server): the time in the visitor's own time zone, and the ticket box: buy (with the rules shown before
// paying and up to 2 questions for the mentor), buy as a gift, the waiting list when sold out, coming back from the bank (the server asks
// the bank), join, report; and the Follow button for the mentor.
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
  const errText = (e) => (t('live.err.' + e.code) !== 'live.err.' + e.code ? t('live.err.' + e.code) : t('toast.error'));
  const when = (d) => WisecallI18n.formatDate(d, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  if (window.WisecallCopy) WisecallCopy.wire(page);

  // The start in the visitor's own time zone, when it is not Tbilisi's.
  const local = page.querySelector('.live-local');
  const time = page.querySelector('.live-when time');
  if (local && time) {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && zone !== 'Asia/Tbilisi') {
      local.textContent = '· ' + fill('live.yourTime', { time: when(time.dataset.local) });
      local.hidden = false;
    }
  }

  const box = document.getElementById('liveBuy');
  let data;
  async function load() {
    try { data = await WisecallAPI.apiFetch(`/live/s/${encodeURIComponent(slug)}`); } catch (e) { box.innerHTML = `<p class="muted">${esc(t('toast.error'))}</p>`; return; }
    draw();
    drawFollow();
  }

  function rules(s) {
    return `<ul class="live-rules small">
      <li>${esc(t('live.rule.refund'))}</li>
      <li>${esc(t('live.rule.noShow'))}</li>
      <li>${esc(t('live.rule.cameraOff'))}</li>
      ${s.regulated ? `<li><strong>${esc(t('live.regulatedLabel'))}</strong></li>` : ''}
      ${s.crisisNotice ? `<li>${esc(t('live.crisis'))}</li>` : ''}
      ${s.replay ? `<li><strong>${esc(t('live.rule.recorded'))}</strong></li>` : ''}
    </ul>`;
  }

  // Sold out: one click to wait; the first person waiting gets a freed seat for 2 hours.
  function drawWaitlist(s) {
    const w = data.waitlist || { waiting: false };
    if (!user) {
      box.innerHTML = `<p class="muted">${esc(t('live.label.soldOut'))}</p>
        <a class="btn btn-outline btn-block" href="/login.html?redirect=${encodeURIComponent(location.pathname)}">${esc(t('live.wait.loginToJoin'))}</a>`;
      return;
    }
    box.innerHTML = `<p class="muted">${esc(t('live.label.soldOut'))}</p>
      ${w.waiting ? `<p class="live-have">${esc(fill('live.wait.position', { n: w.position }))}</p>
        <button type="button" class="btn btn-outline btn-block" id="waitLeave">${esc(t('live.wait.leave'))}</button>`
        : `<p class="small">${esc(t('live.wait.explain'))}</p><button type="button" class="btn btn-primary btn-block" id="waitJoin">${esc(t('live.wait.join'))}</button>`}
      <p class="form-error" id="buyError" role="alert"></p>`;
    const act = async (method) => {
      try { await WisecallAPI.apiFetch(`/live/${encodeURIComponent(s.id)}/waitlist`, { method }); await load(); }
      catch (e) { document.getElementById('buyError').textContent = errText(e); }
    };
    const j = document.getElementById('waitJoin');
    if (j) j.addEventListener('click', () => act('POST'));
    const l = document.getElementById('waitLeave');
    if (l) l.addEventListener('click', () => act('DELETE'));
  }

  function draw() {
    drawSeries();
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
    if (!['published', 'live'].includes(s.status) || Date.now() >= start) {
      box.innerHTML = `<p class="muted">${esc(t(s.status === 'cancelled' ? 'live.cancelledNote' : 'live.notOnSale'))}</p>`
        + (data.replayReady ? `<a class="btn btn-primary btn-block" href="/live/${encodeURIComponent(slug)}/replay">${esc(t('live.replay.watch'))}</a>` : '');
      return;
    }
    const offer = data.waitlist && data.waitlist.offered;
    if (s.seatsLeft <= 0 && !offer) return drawWaitlist(s);
    if (!user) {
      const back = encodeURIComponent(location.pathname);
      box.innerHTML = `${rules(s)}<a class="btn btn-primary btn-block" href="/login.html?redirect=${back}">${esc(t('live.loginToBuy'))}</a>`;
      return;
    }
    box.innerHTML = `<form id="buyForm" novalidate>
        ${offer ? `<p class="pay-notice">${esc(fill('live.wait.kept', { until: when(data.waitlist.offerExpiresAt) }))}</p>` : ''}
        ${rules(s)}
        <details class="live-ask" id="askAhead"><summary>${esc(t('live.askAhead'))}</summary>
          <label for="q1"><span class="small">${esc(t('live.question'))} 1</span><textarea id="q1" rows="2" maxlength="300"></textarea></label>
          <label for="q2"><span class="small">${esc(t('live.question'))} 2</span><textarea id="q2" rows="2" maxlength="300"></textarea></label>
          <p class="hint">${esc(t('live.askAheadHint'))}</p>
        </details>
        <label class="checkbox-row" for="anon"><input type="checkbox" id="anon"> <span>${esc(t('live.joinAnonymous'))}</span></label>
        <label class="checkbox-row" for="isGift"><input type="checkbox" id="isGift"> <span>${esc(t('live.gift.toggle'))}</span></label>
        <div id="giftFields" hidden>
          <label for="giftEmail"><span class="small">${esc(t('live.gift.email'))}</span>
            <input type="email" id="giftEmail" maxlength="254" autocomplete="off" inputmode="email"></label>
          <p class="hint">${esc(t('live.gift.hint'))}</p>
        </div>
        <label class="checkbox-row" for="agree"><input type="checkbox" id="agree" required> <span>${esc(t('live.agreeRules'))}</span></label>
        <p class="form-error" id="buyError" role="alert"></p>
        <button type="submit" class="btn btn-primary btn-block">${esc(fill('live.buy', { price: money(s.priceNow) }))}</button>
      </form>`;
    const giftBox = document.getElementById('isGift');
    giftBox.addEventListener('change', () => {
      document.getElementById('giftFields').hidden = !giftBox.checked;
      // (the person who attends asks their own questions in the room)
      document.getElementById('askAhead').hidden = giftBox.checked;
      document.getElementById('anon').closest('label').hidden = giftBox.checked;
    });
    document.getElementById('buyForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = document.getElementById('buyError');
      err.textContent = '';
      if (!document.getElementById('agree').checked) { err.textContent = t('live.err.agree'); return; }
      const gift = giftBox.checked ? document.getElementById('giftEmail').value.trim() : '';
      if (giftBox.checked && !gift) { err.textContent = t('live.err.invalid_gift_email'); return; }
      const btn = ev.target.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const r = await WisecallAPI.apiFetch(`/live/${encodeURIComponent(s.id)}/tickets`, { method: 'POST', body: gift ? { giftEmail: gift } : {
          questions: [document.getElementById('q1').value, document.getElementById('q2').value].filter((q) => q.trim()),
          anonymous: document.getElementById('anon').checked } });
        window.location.href = r.checkoutUrl;
      } catch (e) {
        err.textContent = errText(e);
        btn.disabled = false;
      }
    });
  }

  // Part of a series: a link to buy all its sessions together.
  function drawSeries() {
    let el = document.getElementById('liveSeriesNote');
    if (!data.series) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('p'); el.id = 'liveSeriesNote'; el.className = 'pay-notice live-series-note'; box.before(el); }
    el.innerHTML = `${esc(t('live.series.partOf'))} <a class="plain-link" href="/live/series/${encodeURIComponent(data.series.slug)}">${esc(data.series.title)}</a> (${esc(WisecallAPI.formatAmount(data.series.price))})`;
  }

  // Follow the mentor: an email when they publish a session, at most one a week.
  function drawFollow() {
    const el = document.getElementById('liveFollow');
    if (!el || !data.session.mentor || data.isMentor) return;
    window.WisecallFollow && WisecallFollow.mount(el, data.session.mentor.id, user);
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
        if (r.ticket && r.ticket.status === 'paid') {
          WisecallNav.showToast(t(r.ticket.gift ? 'live.gift.paid' : 'live.paid'));
          history.replaceState(null, '', location.pathname);
          return load();
        }
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
