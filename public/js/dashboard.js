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
  const { answerMin, answerMax } = await WisecallI18n.getConfig(); // how long an answer must be (the server decides)

  const askedList = document.getElementById('askedList');
  const receivedList = document.getElementById('receivedList');
  const earningsBox = document.getElementById('earnings');
  const tabList = document.getElementById('dashTabs');
  const tabButtons = Array.from(tabList.querySelectorAll('.tab'));
  const panels = Array.from(document.querySelectorAll('.tab-panel'));

  const escapeHtml = (str) => String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (cents) => WisecallAPI.formatAmount(cents);
  const locale = () => (WisecallI18n.getLang() === 'ka' ? 'ka-GE' : 'en-GB');
  const fmtDate = (d) => WisecallI18n.formatDate(d, { day: 'numeric', month: 'short', year: 'numeric' });
  const HOUR = 3600000;

  // (while something loads: the question cards' skeleton the page arrives with, or for the earnings two plain cards; each with one
  // "Loading…" for screen readers)
  const loadingHtml = document.getElementById('askedList').innerHTML;
  const loadingText = () => `<p class="sr-only" role="status">${escapeHtml(t('experts.loading'))}</p>`;
  const skeleton = () => loadingText() + '<div class="skeleton-card" aria-hidden="true"><span class="skeleton skeleton-title"></span><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-line w80"></span></div>'.repeat(2);
  const ART = `<svg class="empty-art" viewBox="0 0 220 150" aria-hidden="true"><circle cx="46" cy="118" r="22" style="fill:var(--c-sun)"/><circle cx="188" cy="30" r="14" style="fill:var(--c-mint)"/><rect x="18" y="20" width="120" height="70" rx="22" style="fill:var(--accent)"/><path d="M44 88 Q40 108 26 116 Q56 114 66 90 Z" style="fill:var(--accent)"/><circle cx="54" cy="55" r="7" style="fill:var(--on-accent)"/><circle cx="78" cy="55" r="7" style="fill:var(--on-accent)"/><circle cx="102" cy="55" r="7" style="fill:var(--on-accent)"/><rect x="96" y="66" width="106" height="62" rx="20" stroke-width="4" style="fill:var(--card);stroke:var(--ink)"/><path d="M122 98l12 12 26-28" fill="none" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--accent2)"/></svg>`;

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
    const reviewed = Boolean(b.rating && b.rating.mine);
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
      const known = ['no_answer_deadline', 'mentor_suspended', 'answer_rejected', 'declined_not_qualified', 'declined_against_rules', 'dispute'];
      text = t(known.includes(b.refundReason) ? 'dash.refund.' + b.refundReason : 'dash.refund.other');
    } else if (b.status === 'answered' && b.refundedAmount) {
      text = t('dash.refund.partial').replace('{amount}', money(b.refundedAmount));
    } else if (b.status === 'answered' && b.answerHeld) {
      text = t(b.__role === 'mentor' ? 'dash.answer.held.mentor' : 'dash.answer.held.buyer');
    } else if (b.status === 'pending_payment') text = t('dash.pending.note');
    return text ? `<p class="booking-note">${escapeHtml(text)}</p>` : '';
  }
  const statusLabel = (status) => t('dash.status.' + status) || status;
  const showsTimeline = (b) => ['paid', 'answered'].includes(b.status);

  // ---- My questions ------------------------------------------------------------------------------------------------
  // Attempts that were never paid ("Payment not completed") are not questions: they are hidden behind a small toggle, and the server
  // deletes them after a week. Nothing was charged for them.
  let showUnfinished = false;
  function renderAsked(list) {
    const unfinished = list.filter((b) => b.status === 'expired');
    const real = list.filter((b) => b.status !== 'expired');
    const toggleText = (open) => t(open ? 'dash.unfinished.hide' : 'dash.unfinished.show').replace('{n}', unfinished.length);
    const unfinishedHtml = unfinished.length ? `
      <div class="unfinished">
        <button type="button" class="btn btn-ghost btn-sm unfinished-toggle" aria-expanded="${showUnfinished}" aria-controls="unfinishedList">${escapeHtml(toggleText(showUnfinished))}</button>
        <div id="unfinishedList"${showUnfinished ? '' : ' hidden'}>
          <p class="muted small">${escapeHtml(t('dash.unfinished.note'))}</p>
          ${unfinished.map(askedCard).join('')}
        </div>
      </div>` : '';
    askedList.innerHTML = (real.length
      ? real.map(askedCard).join('')
      : emptyState('dash.asked.empty.title', 'dash.asked.empty.body', `<a class="btn btn-primary" href="/index.html#experts">${t('nav.browse')}</a>`)) + unfinishedHtml;
    const toggle = askedList.querySelector('.unfinished-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        showUnfinished = !showUnfinished;
        toggle.setAttribute('aria-expanded', String(showUnfinished));
        toggle.textContent = toggleText(showUnfinished);
        document.getElementById('unfinishedList').hidden = !showUnfinished;
      });
    }
    WisecallReport.wire(askedList);

    WisecallRatings.wire(askedList, { reload: load });
    WisecallPublicAnswers.wire(askedList, { reload: load });
    askedList.querySelectorAll('.dispute-form').forEach((form) => form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = form.querySelector('.form-error');
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        await WisecallAPI.apiFetch(`/bookings/${form.dataset.id}/dispute`, { method: 'POST', body: { reason: form.querySelector('select').value, details: form.querySelector('textarea').value } });
        WisecallNav.showToast(t('dash.dispute.sent'));
        load();
      } catch (e) {
        err.textContent = t({ already_reported: 'dash.dispute.already', window_closed: 'dash.dispute.closed' }[e.code] || 'toast.error');
        btn.disabled = false;
      }
    }));
  }

  function askedCard(b) {
      b.__role = 'seeker';
      return `
      <article class="booking-card" data-id="${b.id}">
        <div class="booking-top">
          ${WisecallAPI.avatar({ name: b.otherPartyName, color: b.otherPartyColor, photoUrl: b.otherPartyPhotoUrl })}
          <div>
            <div class="card-name"><a class="plain-link" href="/u/${encodeURIComponent(b.otherPartyUsername)}">${escapeHtml(b.otherPartyName)}</a></div>
            <span class="badge badge-${b.status}">${statusLabel(b.status)}</span>
          </div>
          <div class="booking-amount">${money(b.amount)}<span class="muted small block">${b.paidAt ? t('dash.paidOn').replace('{date}', fmtDate(b.paidAt)) : ''}</span></div>
        </div>
        ${showsTimeline(b) ? timelineHtml(b, 'seeker') : ''}
        <p class="booking-question">${escapeHtml(b.question)}</p>
        ${b.status === 'paid' && b.answerDeadline ? countdownHtml(b, 'seeker') : ''}
        ${bookingNote(b)}
        ${b.status === 'pending_payment' || b.status === 'expired' ? `<a class="btn btn-outline btn-sm" href="/u/${encodeURIComponent(b.otherPartyUsername)}">${t('dash.retry')}</a>` : ''}
        ${b.answer ? `<div class="booking-answer"><strong>${t('dash.answer.label')}</strong> ${escapeHtml(b.answer)}</div>` : ''}
        ${b.status === 'answered' && !b.answerHeld ? WisecallRatings.panel(b, user) : ''}
        ${b.status === 'answered' && !b.answerHeld ? WisecallReport.html(b.mentorId, b.id, true) : ''}
        ${WisecallPublicAnswers.html(b, 'asker')}
        ${disputeHtml(b, 'asker')}
        ${receiptLinks(b)}
        ${conversationLink(b)}
      </article>`;
  }

  // "Report a problem with this answer" (the asker, within the report window), and where a report stands (both people).
  function disputeHtml(b, role) {
    const d = b.dispute;
    if (d) {
      const text = d.status === 'open'
        ? t(role === 'asker' ? 'dash.dispute.openAsker' : 'dash.dispute.openMentor')
        : t('dash.dispute.outcome.' + d.outcome).replace('{amount}', d.refundAmount ? money(d.refundAmount) : '');
      return `<div class="dispute-note"><p>${escapeHtml(text)}</p>${d.status === 'resolved' && d.note ? `<p class="small muted">${escapeHtml(t('dash.dispute.why'))} ${escapeHtml(d.note)}</p>` : ''}</div>`;
    }
    if (role !== 'asker' || !b.disputeUntil) return '';
    // (the server says which reasons are open: after a follow-up the mentor did not reply to in time, that one can be reported for longer)
    const reasons = b.disputeReasons || ['not_an_answer', 'wrong_or_harmful', 'off_topic', 'rude', 'other'];
    const onlyFollowUp = reasons.length === 1 && reasons[0] === 'mentor_ignored_follow_up';
    return `
      <details class="decline-box dispute-box">
        <summary>${t('dash.dispute.open')}</summary>
        <form class="dispute-form" data-id="${b.id}" novalidate>
          <p class="small muted">${escapeHtml(t(onlyFollowUp ? 'dash.dispute.helpFollowUp' : 'dash.dispute.help').replace('{date}', WisecallI18n.formatDate(b.disputeUntil, { dateStyle: 'medium' })))}</p>
          <label class="field-label small" for="dispute-reason-${b.id}">${t('dash.dispute.reason')}</label>
          <select id="dispute-reason-${b.id}">${reasons.map((r) => `<option value="${r}">${t('dash.dispute.r.' + r)}</option>`).join('')}</select>
          <label class="field-label small" for="dispute-details-${b.id}">${t('dash.dispute.details')}</label>
          <textarea id="dispute-details-${b.id}" rows="3" maxlength="1500"></textarea>
          <p class="form-error" role="alert"></p>
          <button type="submit" class="btn btn-outline btn-sm">${t('dash.dispute.send')}</button>
        </form>
      </details>`;
  }

  // "Can't answer this?": decline with a reason (not qualified / against the rules); the asker is refunded in full.
  const declineHtml = (b) => `
    <details class="decline-box">
      <summary>${t('dash.decline.open')}</summary>
      <form class="decline-form" data-id="${b.id}" data-amount="${b.amount}" novalidate>
        <fieldset>
          <legend class="small">${t('dash.decline.why')}</legend>
          <label class="checkbox-row"><input type="radio" name="reason" value="not_qualified"> <span>${t('dash.decline.not_qualified')}</span></label>
          <label class="checkbox-row"><input type="radio" name="reason" value="against_rules"> <span>${t('dash.decline.against_rules')}</span></label>
        </fieldset>
        <label class="field-label small" for="decline-note-${b.id}">${t('dash.decline.note')}</label>
        <textarea id="decline-note-${b.id}" rows="2" maxlength="500"></textarea>
        <p class="small muted">${t('dash.decline.help')}</p>
        <p class="form-error" role="alert"></p>
        <button type="submit" class="btn btn-outline btn-sm">${t('dash.decline.send')}</button>
      </form>
    </details>`;

  // The asker's receipts (payment, refunds) as PDFs, in the page's language.
  const receiptLinks = (b) => ((b.receipts || []).length
    ? `<p class="booking-receipts small">${b.receipts.map((r) => `<a class="plain-link" href="/api/receipts/${encodeURIComponent(r.id)}.pdf?lang=${WisecallI18n.getLang()}">${t('dash.receipt.' + r.kind)} ${escapeHtml(r.number)}</a>`).join(' · ')}</p>` : '');

  // The booking's conversation in the Inbox (the follow-up question and its reply, what happened), once it is paid.
  const conversationLink = (b) => (['paid', 'answered', 'refund_pending', 'refunded'].includes(b.status)
    ? `<p class="booking-conversation"><a class="plain-link" href="/inbox.html?booking=${encodeURIComponent(b.id)}">${t('dash.conversation')} →</a></p>` : '');

  // ---- A listed mentor's profile link, to share -------------------------------------------------------------------------
  function drawShareCard() {
    const box = document.getElementById('shareCard');
    const listed = isMentor && user.isListedMentor && user.username;
    if (!box || !listed) return;
    const url = `${location.origin}${WisecallI18n.getLang() === 'ka' ? '/ka' : ''}/u/${encodeURIComponent(user.username)}`;
    box.className = 'share-card';
    box.innerHTML = `<div><h2 class="share-card-title">${t('share.title')}</h2><p class="muted small">${t('share.body')}</p>
      <p class="share-url"><a class="plain-link" href="${escapeHtml(url)}">${escapeHtml(url.replace(/^https?:\/\//, ''))}</a></p></div>
      ${WisecallCopy.button(url)}`;
    box.hidden = false;
    WisecallCopy.wire(box);
  }
  drawShareCard();
  document.addEventListener('wisecall:lang-changed', drawShareCard);

  // ---- Questions for me (mentors) -----------------------------------------------------------------------------------
  function receivedEmpty() {
    const listed = user.verificationStatus === 'verified' && user.hasPayoutDetails;
    const prelaunch = WisecallI18n.launchMode() === 'prelaunch';
    return listed
      ? (prelaunch ? emptyState('dash.received.prelaunch.title', 'dash.received.prelaunch.body', '') : emptyState('dash.received.empty.title', 'dash.received.empty.body', ''))
      : emptyState('dash.received.notListed.title', 'dash.received.notListed.body', `<a class="btn btn-primary" href="${['none', 'pending'].includes(user.verificationState) ? '/apply.html' : '/settings.html?tab=verification'}">${t('dash.received.notListed.cta')}</a>`);
  }

  // A short reminder above the answer box (not something to tick: nothing is required), with a link to the guide. Open for a mentor's first
  // 5 answers, folded after that.
  const greatAnswerHref = () => `${WisecallI18n.getLang() === 'ka' ? '/ka' : ''}/help/write-a-great-answer`;
  const checklistHtml = (open) => `
    <details class="answer-checklist"${open ? ' open' : ''}>
      <summary>${t('dash.answer.checklist.title')}</summary>
      <ul>${['exact', 'concrete', 'limits', 'contact'].map((k) => `<li>${t('dash.answer.checklist.' + k)}</li>`).join('')}</ul>
      <a class="plain-link small" href="${greatAnswerHref()}">${t('help.greatAnswer')}</a>
    </details>`;

  function renderReceived(list) {
    const answeredSoFar = list.filter((b) => b.answeredAt).length;
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
          ${WisecallAPI.avatar({ name: b.otherPartyName, color: b.otherPartyColor, photoUrl: b.otherPartyPhotoUrl })}
          <div>
            <div class="card-name"><a class="plain-link" href="/u/${encodeURIComponent(b.otherPartyUsername)}">${escapeHtml(b.otherPartyName)}</a></div>
            <span class="badge badge-${b.status}">${statusLabel(b.status)}</span>
          </div>
          <div class="booking-amount">${money(b.mentorNetAmount)}<span class="muted small block">${t('dash.fee.note')}: ${money(b.platformFeeAmount)}</span></div>
        </div>
        ${['paid', 'answered'].includes(b.status) ? WisecallRatings.askerLineHtml(b.askerRating) : ''}
        ${showsTimeline(b) ? timelineHtml(b, 'mentor') : ''}
        <p class="booking-question">${escapeHtml(b.question)}</p>
        ${b.status === 'paid' && b.answerDeadline ? countdownHtml(b, 'mentor') : ''}
        ${bookingNote(b)}
        ${b.answer
          ? `<div class="booking-answer"><strong>${t('dash.answer.label')}</strong> ${escapeHtml(b.answer)}</div>`
          : (b.status === 'paid' ? `
            <form class="answer-form" data-id="${b.id}" novalidate>
              <div class="answer-edit">
                ${checklistHtml(answeredSoFar < 5)}
                <label class="sr-only" for="answer-${b.id}">${t('dash.answer.placeholder')}</label>
                <textarea id="answer-${b.id}" rows="7" maxlength="${answerMax}" placeholder="${escapeHtml(t('dash.answer.placeholder'))}" aria-describedby="answer-meta-${b.id} answer-error-${b.id}" required></textarea>
                <div class="q-meta" id="answer-meta-${b.id}"><span class="a-help"></span><span class="a-count"></span></div>
                <p class="form-error" id="answer-error-${b.id}" role="alert"></p>
                <button type="submit" class="btn btn-primary btn-sm">${t('dash.answer.check')}</button>
              </div>
              <div class="answer-review" hidden>
                <h3 class="answer-review-title" tabindex="-1">${t('dash.answer.reviewTitle')}</h3>
                <p class="answer-warn">${t('dash.answer.reviewWarn')}</p>
                <blockquote class="answer-preview"></blockquote>
                <p class="form-error answer-send-error" role="alert"></p>
                <div class="answer-actions">
                  <button type="button" class="btn btn-outline btn-sm answer-back">${t('dash.answer.back')}</button>
                  <button type="button" class="btn btn-primary btn-sm answer-send">${t('dash.answer.send')}</button>
                </div>
              </div>
            </form>` : '')}
        ${b.status === 'answered' && !b.answerHeld ? WisecallRatings.panel(b, user) : ''}
        ${b.status === 'paid' && !b.answer ? declineHtml(b) : ''}
        ${WisecallPublicAnswers.html(b, 'mentor')}
        ${disputeHtml(b, 'mentor')}
        ${conversationLink(b)}
      </article>`;
    }).join('');
    WisecallRatings.wire(receivedList, { reload: load });
    WisecallPublicAnswers.wire(receivedList, { reload: load });

    // Declining a question: the asker is refunded in full at once and sees the reason.
    receivedList.querySelectorAll('.decline-form').forEach((form) => form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const reason = (form.querySelector('input[name="reason"]:checked') || {}).value;
      const err = form.querySelector('.form-error');
      if (!reason) { err.textContent = t('dash.decline.pick'); return; }
      if (!(await WisecallDialog.confirm({ message: t('dash.decline.confirm'), confirmText: t('dash.decline.button').replace('{amount}', WisecallAPI.formatAmount(Number(form.dataset.amount))), danger: true }))) return;
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        await WisecallAPI.apiFetch(`/bookings/${form.dataset.id}/decline`, { method: 'POST', body: { reason, note: form.querySelector('textarea').value } });
        WisecallNav.showToast(t('dash.decline.done'));
        load();
      } catch (e) {
        err.textContent = t(e.code === 'already_answered' ? 'dash.answer.err.already' : 'toast.error');
        btn.disabled = false;
      }
    }));

    // The answer form: a live count, then a check step ("you can't change it after sending"), then send. The server has the last word
    // (at least answerMin characters, real writing, and one answer only).
    receivedList.querySelectorAll('.answer-form').forEach((form) => {
      const textarea = form.querySelector('textarea');
      const edit = form.querySelector('.answer-edit');
      const review = form.querySelector('.answer-review');
      const errorEl = form.querySelector('.answer-edit .form-error');
      const sendError = form.querySelector('.answer-send-error');
      const help = form.querySelector('.a-help');
      const counter = form.querySelector('.a-count');
      const count = () => {
        const n = WisecallAPI.textLength(textarea.value);
        help.textContent = n >= answerMin ? t('dash.answer.longEnough') : t('dash.answer.needMore').replace('{left}', answerMin - n);
        help.classList.toggle('ok', n >= answerMin);
        counter.textContent = `${n} / ${answerMax}`;
        counter.classList.toggle('over', n > answerMax - 500);
      };
      textarea.addEventListener('input', () => { errorEl.textContent = ''; count(); });
      count();

      form.addEventListener('submit', (ev) => {
        ev.preventDefault();
        errorEl.textContent = '';
        if (WisecallAPI.textLength(textarea.value) < answerMin) { errorEl.textContent = t('dash.answer.tooShort'); textarea.focus(); return; }
        form.querySelector('.answer-preview').textContent = textarea.value.trim();
        edit.hidden = true; review.hidden = false;
        form.querySelector('.answer-review-title').focus();
      });
      form.querySelector('.answer-back').addEventListener('click', () => { review.hidden = true; edit.hidden = false; sendError.textContent = ''; textarea.focus(); });
      form.querySelector('.answer-send').addEventListener('click', async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true;
        sendError.textContent = '';
        try {
          await WisecallAPI.apiFetch(`/bookings/${form.dataset.id}/answer`, { method: 'POST', body: { answer: textarea.value.trim() } });
          WisecallNav.showToast(t('toast.answerSent'));
          load();
        } catch (e) {
          const map = { answer_too_short: 'dash.answer.tooShort', answer_repetitive: 'dash.answer.err.repetitive', answer_too_long: 'dash.answer.err.long', already_answered: 'dash.answer.err.already', deadline_passed: 'dash.answer.err.deadline', declined: 'dash.answer.err.declined' };
          sendError.textContent = t(map[e.code] || 'toast.error');
          btn.disabled = false;
          if (e.code === 'already_answered' || e.code === 'declined') load();
        }
      });
    });
  }

  // ---- Earnings -------------------------------------------------------------------------------------------------------
  async function loadEarnings() {
    earningsBox.innerHTML = skeleton();
    try {
      const e = await WisecallAPI.apiFetch('/me/earnings');
      const itemNote = (i) => {
        if (i.status === 'void') return t('dash.earnings.void');
        if (i.status === 'paid') {
          const base = t('dash.earnings.paidOn').replace('{date}', i.paidAt ? fmtDate(i.paidAt) : '').replace('{ref}', i.reference || '');
          return i.owedBack ? `${base} · ${t(i.owedBackSettled ? 'dash.earnings.owedSettled' : 'dash.earnings.owedBack')}` : base;
        }
        return new Date(i.payableAt) <= new Date() ? t('dash.earnings.payableNow') : t('dash.earnings.payableFrom').replace('{date}', fmtDate(i.payableAt));
      };
      // (the Balance card: available, on hold, requested, paid out, owed back, "Withdraw" and the withdrawals: public/js/balance.js)
      earningsBox.innerHTML = `
        <div class="settings-card bal-card" id="balanceCard">${loadingText()}<div aria-hidden="true"><span class="skeleton skeleton-title"></span><span class="skeleton skeleton-line w60"></span><span class="skeleton skeleton-btn"></span></div></div>
        <p class="muted small">${t('dash.earnings.note').replace('{days}', e.holdDays)}</p>
        ${e.items.length ? `
          <h2 class="earn-h">${t('dash.earnings.items')}</h2>
          <ul class="earn-list">${e.items.map((i) => `<li><span>${escapeHtml(i.question)}</span><span class="muted small">${escapeHtml(itemNote(i))}</span><strong>${money(i.amount)}</strong></li>`).join('')}</ul>`
          : emptyState('dash.earnings.empty.title', 'dash.earnings.empty', '')}
        <div id="statements"></div>`;
      WisecallBalance.render(document.getElementById('balanceCard'));
      // Monthly statements (PDF / CSV) for the months with earnings or payouts.
      const st = await WisecallAPI.apiFetch('/me/statements').catch(() => ({ months: [] }));
      if (st.months.length) {
        const lang = WisecallI18n.getLang();
        document.getElementById('statements').innerHTML = `
          <h2 class="earn-h">${t('dash.statements.title')}</h2>
          <ul class="earn-list">${st.months.map((m) => `<li><span>${escapeHtml(m)}</span>
            <span><a class="plain-link" href="/api/me/statements/${m}.pdf?lang=${lang}">PDF</a> · <a class="plain-link" href="/api/me/statements/${m}.csv?lang=${lang}">CSV</a></span></li>`).join('')}</ul>`;
      }
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
    btn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'auto' }); // on a phone the tab row scrolls: keep the chosen tab in view
    panels.forEach((p) => { p.hidden = p.dataset.panel !== activeTab; });
    if (o.push !== false) {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', activeTab);
      window.history.replaceState(null, '', url);
    }
    if (o.focus) btn.focus();
    if (activeTab === 'earnings') loadEarnings();
    if (activeTab === 'live' && window.WisecallLiveDashboard) WisecallLiveDashboard.load(document.getElementById('liveBox'), user);
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
      if (isMentor) receivedList.innerHTML = `<p class="muted">${t('toast.error')}</p>`;
    }
    askedList.setAttribute('aria-busy', 'false');
    receivedList.setAttribute('aria-busy', 'false');
  }

  // ---- The way to becoming a mentor, at the top (docs/CLAUDE-CODE-MENTOR-BUTTON-SIGNED-IN.md): "Want to share your experience?" for an
  // asker (right after signing up too), "Continue your application – step 2 of 5" for an application started, its status once it is
  // sent; nothing for a mentor or an admin.
  function drawMentorCard() {
    const box = document.getElementById('mentorCard');
    const m = WisecallNav.mentorPath() || { state: 'none' };
    if (!box) return;
    const fill = (key, vars) => Object.entries(vars || {}).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
    const card = (state, title, body, button) => `
      <section class="mentor-card mentor-card-${state}" aria-labelledby="mentorCardTitle">
        <div class="mentor-card-text">
          <h2 id="mentorCardTitle">${escapeHtml(title)}</h2>
          <p>${escapeHtml(body)}</p>
        </div>
        ${button}
      </section>`;
    const B = window.WisecallMentorButton;
    if (m.state === 'asker') {
      box.innerHTML = card('asker', t('dash.mentor.asker.title'), t('dash.mentor.asker.body'),
        `<a class="btn btn-primary btn-lg btn-arrow" href="/apply.html">${escapeHtml(t('nav.becomeMentor'))}</a>`);
    } else if (m.state === 'draft') {
      box.innerHTML = card('draft', m.step ? fill('dash.mentor.draft.title', { n: m.step }) : t('nav.continueApp'), t('dash.mentor.draft.body'),
        `<a class="btn btn-primary btn-lg btn-arrow" href="${B.href(m)}">${escapeHtml(t('dash.mentor.draft.cta'))}</a>`);
    } else if (m.state === 'sent') {
      box.innerHTML = card('sent', t('dash.mentor.sent.title'), t('dash.mentor.sent.body'),
        `<a class="btn btn-outline btn-lg" href="/apply.html">${escapeHtml(t('settings.progress.status'))}</a>`);
    } else box.innerHTML = '';
  }
  drawMentorCard();
  document.addEventListener('wisecall:lang-changed', drawMentorCard);

  askedList.innerHTML = loadingHtml;
  if (isMentor) {
    receivedList.setAttribute('aria-busy', 'true');
    receivedList.innerHTML = loadingHtml;
    document.getElementById('tab-received').hidden = false;
    document.getElementById('tab-earnings').hidden = false;
  }
  selectTab(new URLSearchParams(window.location.search).get('tab') || 'asked', { push: false });
  document.addEventListener('wisecall:lang-changed', () => { load(); if (activeTab === 'earnings') loadEarnings(); });
  load();
})();
