// The dashboard: tabs for the questions you asked, the questions you received (mentors) and your earnings.
// Every question shows a progress line (Paid, Waiting, Answered, Reviewed) and, while it waits, a countdown.
(async function () {
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();
  const t = WisecallI18n.t;

  if (!user) {
    window.location.href = '/login.html?redirect=/dashboard.html';
    return;
  }
  const isMentor = user.role === 'mentor' || user.role === 'both';

  const askedList = document.getElementById('askedList');
  const receivedList = document.getElementById('receivedList');
  const earningsBox = document.getElementById('earnings');
  const tabList = document.getElementById('dashTabs');
  const tabButtons = Array.from(tabList.querySelectorAll('.tab'));
  const panels = Array.from(document.querySelectorAll('.tab-panel'));

  const escapeHtml = (str) => String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (cents) => WisecallAPI.formatAmount(cents);
  const locale = () => (WisecallI18n.getLang() === 'ka' ? 'ka-GE' : 'en-GB');
  const fmtDate = (d) => new Date(d).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
  const initials = (name) => (name || '?').split(' ').map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  const HOUR = 3600000;

  const skeleton = () => `<div class="skeleton-card"><span class="skeleton skeleton-title"></span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line w80"></span></div>`.repeat(2);
  const ART = `<svg class="empty-art" viewBox="0 0 220 150" aria-hidden="true"><circle cx="46" cy="118" r="22" fill="#ffe3a3"/><circle cx="188" cy="30" r="14" fill="#bdeedb"/><rect x="18" y="20" width="120" height="70" rx="22" fill="#ff6f59"/><path d="M44 88 Q40 108 26 116 Q56 114 66 90 Z" fill="#ff6f59"/><circle cx="54" cy="55" r="7" fill="#fff"/><circle cx="78" cy="55" r="7" fill="#fff"/><circle cx="102" cy="55" r="7" fill="#fff"/><rect x="96" y="66" width="106" height="62" rx="20" fill="#fff" stroke="#2b2440" stroke-width="4"/><path d="M122 98l12 12 26-28" fill="none" stroke="#3db88e" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  function emptyState(titleKey, bodyKey, action) {
    return `<div class="empty-state empty-rich">${ART}<h2>${t(titleKey)}</h2><p>${escapeHtml(bodyKey.startsWith('dash.') ? t(bodyKey) : bodyKey)}</p>${action || ''}</div>`;
  }

  // ---- Countdown and progress line ------------------------------------------------------------------------------
  function timeLeft(deadline) {
    const ms = new Date(deadline).getTime() - Date.now();
    if (ms <= 0) return { over: true, urgent: true, text: '' };
    const d = Math.floor(ms / (24 * HOUR));
    const h = Math.floor((ms % (24 * HOUR)) / HOUR);
    const m = Math.floor((ms % HOUR) / 60000);
    const unit = (k) => t('dash.unit.' + k);
    const text = d > 0 ? `${d}${unit('d')} ${h}${unit('h')}` : (h > 0 ? `${h}${unit('h')} ${m}${unit('m')}` : `${Math.max(m, 1)}${unit('m')}`);
    return { over: false, urgent: ms < 48 * HOUR, text };
  }
  function countdownHtml(b, role) {
    const left = timeLeft(b.answerDeadline);
    const label = left.over ? t(role === 'mentor' ? 'dash.count.overdueMentor' : 'dash.count.overdue')
      : t(role === 'mentor' ? 'dash.count.leftMentor' : 'dash.count.left').replace('{time}', left.text);
    return `<p class="countdown${left.urgent ? ' urgent' : ''}" data-deadline="${escapeHtml(b.answerDeadline)}" data-role="${role}">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 3h6"/></svg>
      <span><strong>${escapeHtml(label)}</strong> <span class="muted small">${t('dash.due').replace('{date}', fmtDate(b.answerDeadline))}</span></span></p>`;
  }
  let ticker = null;
  function startTicker() {
    clearInterval(ticker);
    ticker = setInterval(() => {
      document.querySelectorAll('.countdown[data-deadline]').forEach((el) => {
        const left = timeLeft(el.dataset.deadline);
        const role = el.dataset.role;
        el.classList.toggle('urgent', left.urgent);
        el.querySelector('strong').textContent = left.over ? t(role === 'mentor' ? 'dash.count.overdueMentor' : 'dash.count.overdue')
          : t(role === 'mentor' ? 'dash.count.leftMentor' : 'dash.count.left').replace('{time}', left.text);
      });
    }, 30000);
  }

  // Paid -> Waiting -> Answered -> Reviewed (for the buyer). The mentor's line has three steps.
  function timelineHtml(b, role) {
    const paid = ['paid', 'answered', 'refund_pending', 'refunded'].includes(b.status) || Boolean(b.paidAt);
    const answered = b.status === 'answered';
    const held = answered && b.answerHeld;
    const reviewed = Boolean(b.rating);
    const steps = role === 'mentor'
      ? [
        { key: 'paid', label: t('dash.tl.paid'), done: paid },
        { key: 'waiting', label: t('dash.tl.toAnswer'), done: answered, current: b.status === 'paid' },
        { key: 'answered', label: held ? t('dash.tl.checking') : t('dash.tl.answered'), done: answered && !held, current: held }
      ]
      : [
        { key: 'paid', label: t('dash.tl.paid'), done: paid },
        { key: 'waiting', label: t('dash.tl.waiting'), done: answered, current: b.status === 'paid' },
        { key: 'answered', label: held ? t('dash.tl.checking') : t('dash.tl.answered'), done: answered && !held, current: held },
        { key: 'reviewed', label: t('dash.tl.reviewed'), done: reviewed, current: answered && !held && !reviewed }
      ];
    return `<ol class="timeline" aria-label="${escapeHtml(t('dash.tl.label'))}">${steps.map((s) => `
      <li class="${s.done ? 'done' : (s.current ? 'current' : 'todo')}"${s.current ? ' aria-current="step"' : ''}>
        <span class="tl-dot" aria-hidden="true">${s.done ? '✓' : ''}</span><span class="tl-label">${escapeHtml(s.label)}</span></li>`).join('')}</ol>`;
  }

  // Refund and payment notes shown under a question.
  function bookingNote(b) {
    let text = '';
    if (b.status === 'refund_pending') text = t('dash.refund.pending');
    else if (b.status === 'refunded') {
      const known = ['no_answer_deadline', 'mentor_suspended', 'answer_rejected'];
      text = t(known.includes(b.refundReason) ? 'dash.refund.' + b.refundReason : 'dash.refund.other');
    } else if (b.status === 'answered' && b.answerHeld) {
      text = t(b.__role === 'mentor' ? 'dash.answer.held.mentor' : 'dash.answer.held.buyer');
    } else if (b.status === 'pending_payment') text = t('dash.pending.note');
    return text ? `<p class="booking-note">${escapeHtml(text)}</p>` : '';
  }
  const statusLabel = (status) => t('dash.status.' + status) || status;
  const showsTimeline = (b) => ['paid', 'answered'].includes(b.status);

  // ---- My questions ------------------------------------------------------------------------------------------------
  function renderAsked(list) {
    if (!list.length) {
      askedList.innerHTML = emptyState('dash.asked.empty.title', 'dash.asked.empty.body', `<a class="btn btn-primary" href="/index.html#experts">${t('nav.browse')}</a>`);
      return;
    }
    askedList.innerHTML = list.map((b) => {
      b.__role = 'seeker';
      return `
      <article class="booking-card" data-id="${b.id}">
        <div class="booking-top">
          <div class="avatar" style="${WisecallAPI.avatarStyle(b.otherPartyColor)}" aria-hidden="true">${escapeHtml(initials(b.otherPartyName))}</div>
          <div>
            <div class="card-name"><a class="plain-link" href="/expert.html?id=${b.mentorId}">${escapeHtml(b.otherPartyName)}</a></div>
            <span class="badge badge-${b.status}">${statusLabel(b.status)}</span>
          </div>
          <div class="booking-amount">${money(b.amount)}<span class="muted small block">${b.paidAt ? t('dash.paidOn').replace('{date}', fmtDate(b.paidAt)) : ''}</span></div>
        </div>
        ${showsTimeline(b) ? timelineHtml(b, 'seeker') : ''}
        <p class="booking-question">${escapeHtml(b.question)}</p>
        ${b.status === 'paid' && b.answerDeadline ? countdownHtml(b, 'seeker') : ''}
        ${bookingNote(b)}
        ${b.status === 'pending_payment' ? `<a class="btn btn-outline btn-sm" href="/expert.html?id=${b.mentorId}">${t('dash.retry')}</a>` : ''}
        ${b.answer ? `<div class="booking-answer"><strong>${t('dash.answer.label')}</strong> ${escapeHtml(b.answer)}</div>` : ''}
        ${b.status === 'answered' && !b.answerHeld ? renderReviewArea(b) : ''}
        ${b.status === 'answered' && !b.answerHeld ? WisecallReport.html(b.mentorId, b.id, true) : ''}
      </article>`;
    }).join('');
    WisecallReport.wire(askedList);

    askedList.querySelectorAll('.review-form').forEach((form) => {
      const stars = form.querySelectorAll('.star-btn');
      let selectedRating = 0;
      stars.forEach((star) => {
        star.addEventListener('click', () => {
          selectedRating = Number(star.dataset.value);
          stars.forEach((s) => {
            const on = Number(s.dataset.value) <= selectedRating;
            s.classList.toggle('filled', on);
            s.setAttribute('aria-pressed', String(Number(s.dataset.value) === selectedRating));
          });
        });
      });
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (!selectedRating) { WisecallNav.showToast(t('dash.review.pickStars')); return; }
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          await WisecallAPI.apiFetch(`/bookings/${form.dataset.id}/review`, { method: 'POST', body: { rating: selectedRating, review: form.querySelector('textarea').value.trim() } });
          WisecallNav.showToast(t('dash.review.sent'));
          load();
        } catch (e) { WisecallNav.showToast(t('toast.error')); btn.disabled = false; }
      });
    });
  }

  function renderReviewArea(b) {
    if (b.rating) {
      return `<div class="review-submitted"><span class="review-stars" role="img" aria-label="${escapeHtml(t('expert.reviews.stars').replace('{n}', b.rating))}">${'★'.repeat(b.rating)}${'☆'.repeat(5 - b.rating)}</span>${b.review ? `<p class="review-text">${escapeHtml(b.review)}</p>` : ''}</div>`;
    }
    return `
      <form class="review-form" data-id="${b.id}">
        <p class="muted small" style="margin: 10px 0 6px">${t('dash.review.prompt')}</p>
        <div class="star-picker" role="group" aria-label="${escapeHtml(t('dash.review.prompt'))}">
          ${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star-btn" data-value="${n}" aria-label="${escapeHtml(t('expert.reviews.stars').replace('{n}', n))}" aria-pressed="false">★</button>`).join('')}
        </div>
        <textarea rows="2" placeholder="${escapeHtml(t('dash.review.placeholder'))}" aria-label="${escapeHtml(t('dash.review.placeholder'))}"></textarea>
        <button type="submit" class="btn btn-outline btn-sm">${t('dash.review.submit')}</button>
      </form>`;
  }

  // ---- Questions for me (mentors) -----------------------------------------------------------------------------------
  function receivedEmpty() {
    const listed = user.verificationStatus === 'verified' && user.hasPayoutDetails;
    const prelaunch = WisecallI18n.launchMode() === 'prelaunch';
    return listed
      ? (prelaunch ? emptyState('dash.received.prelaunch.title', 'dash.received.prelaunch.body', '') : emptyState('dash.received.empty.title', 'dash.received.empty.body', ''))
      : emptyState('dash.received.notListed.title', 'dash.received.notListed.body', `<a class="btn btn-primary" href="/settings.html?tab=verification">${t('dash.received.notListed.cta')}</a>`);
  }

  function renderReceived(list) {
    const waiting = list.filter((b) => b.status === 'paid').length;
    const count = document.getElementById('receivedCount');
    count.hidden = waiting === 0;
    count.textContent = waiting;
    if (!list.length) { receivedList.innerHTML = receivedEmpty(); return; }
    receivedList.innerHTML = list.map((b) => {
      b.__role = 'mentor';
      return `
      <article class="booking-card" data-id="${b.id}">
        <div class="booking-top">
          <div class="avatar" style="${WisecallAPI.avatarStyle(b.otherPartyColor)}" aria-hidden="true">${escapeHtml(initials(b.otherPartyName))}</div>
          <div>
            <div class="card-name">${escapeHtml(b.otherPartyName)}</div>
            <span class="badge badge-${b.status}">${statusLabel(b.status)}</span>
          </div>
          <div class="booking-amount">${money(b.mentorNetAmount)}<span class="muted small block">${t('dash.fee.note')}: ${money(b.platformFeeAmount)}</span></div>
        </div>
        ${showsTimeline(b) ? timelineHtml(b, 'mentor') : ''}
        <p class="booking-question">${escapeHtml(b.question)}</p>
        ${b.status === 'paid' && b.answerDeadline ? countdownHtml(b, 'mentor') : ''}
        ${bookingNote(b)}
        ${b.answer
          ? `<div class="booking-answer"><strong>${t('dash.answer.label')}</strong> ${escapeHtml(b.answer)}</div>`
          : (b.status === 'paid' ? `
            <form class="answer-form" data-id="${b.id}">
              <label class="sr-only" for="answer-${b.id}">${t('dash.answer.placeholder')}</label>
              <textarea id="answer-${b.id}" rows="4" placeholder="${escapeHtml(t('dash.answer.placeholder'))}" required minlength="2"></textarea>
              <button type="submit" class="btn btn-primary btn-sm">${t('dash.answer.send')}</button>
            </form>` : '')}
      </article>`;
    }).join('');

    receivedList.querySelectorAll('.answer-form').forEach((form) => {
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const textarea = form.querySelector('textarea');
        const btn = form.querySelector('button');
        btn.disabled = true;
        try {
          await WisecallAPI.apiFetch(`/bookings/${form.dataset.id}/answer`, { method: 'POST', body: { answer: textarea.value.trim() } });
          WisecallNav.showToast(t('toast.answerSent'));
          load();
        } catch (e) { WisecallNav.showToast(t('toast.error')); btn.disabled = false; }
      });
    });
  }

  // ---- Earnings -------------------------------------------------------------------------------------------------------
  async function loadEarnings() {
    earningsBox.innerHTML = skeleton();
    try {
      const e = await WisecallAPI.apiFetch('/me/earnings');
      const b = e.balance;
      const itemNote = (i) => {
        if (i.status === 'void') return t('dash.earnings.void');
        if (i.status === 'paid') {
          const base = t('dash.earnings.paidOn').replace('{date}', i.paidAt ? fmtDate(i.paidAt) : '').replace('{ref}', i.reference || '');
          return i.owedBack ? `${base} · ${t(i.owedBackSettled ? 'dash.earnings.owedSettled' : 'dash.earnings.owedBack')}` : base;
        }
        return new Date(i.payableAt) <= new Date() ? t('dash.earnings.payableNow') : t('dash.earnings.payableFrom').replace('{date}', fmtDate(i.payableAt));
      };
      earningsBox.innerHTML = `
        <div class="earn-cards">
          <div class="earn-card"><span>${t('dash.earnings.available')}</span><strong>${money(Math.max(b.net, 0))}</strong></div>
          <div class="earn-card"><span>${t('dash.earnings.holding').replace('{days}', e.holdDays)}</span><strong>${money(b.holding)}</strong></div>
          <div class="earn-card"><span>${t('dash.earnings.paid')}</span><strong>${money(b.paid)}</strong></div>
          ${b.debt > 0 ? `<div class="earn-card warn"><span>${t('dash.earnings.debt')}</span><strong>${money(b.debt)}</strong></div>` : ''}
        </div>
        <p class="muted small">${t('dash.earnings.note').replace('{days}', e.holdDays)}</p>
        ${e.batches.length ? `
          <h2 class="earn-h">${t('dash.earnings.history')}</h2>
          <ul class="earn-list">${e.batches.map((x) => `<li><span>${fmtDate(x.paidAt)}</span><span>${escapeHtml(x.reference)}</span><strong>${money(x.amount)}</strong></li>`).join('')}</ul>` : ''}
        ${e.items.length ? `
          <h2 class="earn-h">${t('dash.earnings.items')}</h2>
          <ul class="earn-list">${e.items.map((i) => `<li><span>${escapeHtml(i.question)}</span><span class="muted small">${escapeHtml(itemNote(i))}</span><strong>${money(i.amount)}</strong></li>`).join('')}</ul>`
          : emptyState('dash.earnings.empty.title', 'dash.earnings.empty', '')}`;
    } catch (err) {
      earningsBox.innerHTML = `<p class="muted">${t('toast.error')}</p>`;
    }
  }

  // ---- Tabs and loading -------------------------------------------------------------------------------------------------
  let activeTab = null;
  function selectTab(name, opts) {
    const o = opts || {};
    const btn = tabButtons.find((b) => b.dataset.tab === name && !b.hidden) || tabButtons[0];
    activeTab = btn.dataset.tab;
    tabButtons.forEach((b) => {
      const on = b === btn;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
    });
    panels.forEach((p) => { p.hidden = p.dataset.panel !== activeTab; });
    if (o.push !== false) {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', activeTab);
      window.history.replaceState(null, '', url);
    }
    if (o.focus) btn.focus();
    if (activeTab === 'earnings') loadEarnings();
  }
  tabList.addEventListener('click', (ev) => { const btn = ev.target.closest('.tab'); if (btn) selectTab(btn.dataset.tab); });
  tabList.addEventListener('keydown', (ev) => {
    const visible = tabButtons.filter((b) => !b.hidden);
    const i = visible.indexOf(document.activeElement);
    if (i < 0) return;
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: visible.length - 1 }[ev.key];
    if (next === undefined) return;
    ev.preventDefault();
    selectTab(visible[(next + visible.length) % visible.length].dataset.tab, { focus: true });
  });

  async function load() {
    try {
      const data = await WisecallAPI.apiFetch('/bookings/mine');
      renderAsked(data.asked);
      if (isMentor) renderReceived(data.received);
      startTicker();
    } catch (e) {
      askedList.innerHTML = `<p class="muted">${t('toast.error')}</p>`;
    }
  }

  askedList.innerHTML = skeleton();
  if (isMentor) {
    receivedList.innerHTML = skeleton();
    document.getElementById('tab-received').hidden = false;
    document.getElementById('tab-earnings').hidden = false;
  }
  selectTab(new URLSearchParams(window.location.search).get('tab') || 'asked', { push: false });
  document.addEventListener('wisecall:lang-changed', () => { load(); if (activeTab === 'earnings') loadEarnings(); });
  load();
})();
