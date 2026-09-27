// The Inbox (/inbox.html): conversations on the left (a list), the open one on the right; on a phone one at a time. A second tab is the
// notification centre. The server decides everything (who may see a conversation, whether a follow-up can still be asked); this page
// shows it and sends what the person writes. Every text from a person is shown as plain text (escaped), never as HTML.
(async function () {
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();
  const t = WisecallI18n.t;
  if (!user) { window.location.href = '/login.html?redirect=' + encodeURIComponent(location.pathname + location.search); return; }

  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (key, vars) => Object.entries(vars || {}).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const locale = () => (WisecallI18n.getLang() === 'ka' ? 'ka-GE' : 'en-GB');
  const when = (d) => new Date(d).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' });
  const day = (d) => new Date(d).toLocaleDateString(locale(), { dateStyle: 'medium' });
  const hasLink = (s) => /https?:\/\/|www\./i.test(String(s || ''));

  const layout = document.getElementById('inboxLayout');
  const listEl = document.getElementById('threadList');
  const view = document.getElementById('threadView');
  const notifList = document.getElementById('notifList');
  const notifCount = document.getElementById('notifCount');
  const tabs = Array.from(document.querySelectorAll('#inboxTabs .tab'));
  const panels = Array.from(document.querySelectorAll('.inbox-page .tab-panel'));

  let threads = [];
  let current = null; // the open thread's id
  let data = null;    // the open thread as the server sent it
  let limits = {};

  // ---- Tabs ------------------------------------------------------------------------------------------------------------------
  function selectTab(name, push) {
    const btn = tabs.find((b) => b.dataset.tab === name) || tabs[0];
    tabs.forEach((b) => { const on = b === btn; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
    panels.forEach((p) => { p.hidden = p.dataset.panel !== btn.dataset.tab; });
    if (push !== false) { const u = new URL(location.href); u.searchParams.set('tab', btn.dataset.tab); history.replaceState(null, '', u); }
    if (btn.dataset.tab === 'notifications') loadNotifications();
  }
  document.getElementById('inboxTabs').addEventListener('click', (ev) => { const b = ev.target.closest('.tab'); if (b) selectTab(b.dataset.tab); });

  // ---- Words for events (the server sends the event and its data; the words are in the reader's language) ---------------------
  function eventText(m) {
    const d = m.data || {};
    switch (m.event) {
      case 'verification_update': {
        const step = t('verify.step.' + d.step);
        let s = fill(d.status === 'passed' ? 'inbox.ev.stepPassed' : 'inbox.ev.stepFailed', { step: esc(step) });
        const reason = d.reasonKey && t('inbox.reason.' + d.reasonKey) !== 'inbox.reason.' + d.reasonKey ? t('inbox.reason.' + d.reasonKey) : d.reason;
        if (d.status !== 'passed' && reason) s += `<span class="ev-note">${esc(reason)}</span>`;
        if (d.delisted) s += `<span class="ev-note">${esc(t('inbox.ev.delisted'))}</span>`;
        return s;
      }
      case 'payout_sent': return esc(fill('inbox.ev.payout_sent', { amount: WisecallAPI.formatAmount(d.amount || 0), reference: d.reference || '—' }));
      case 'refunded': return esc(fill('inbox.ev.refunded', { amount: WisecallAPI.formatAmount(d.amount || 0) }));
      case 'dispute_resolved': {
        const s = esc(fill('inbox.ev.dispute.' + d.outcome, { amount: d.amount ? WisecallAPI.formatAmount(d.amount) : '' }));
        return s + (d.note ? `<span class="ev-note">${esc(d.note)}</span>` : '');
      }
      case 'declined': return esc(t('inbox.ev.declined')) + (d.reason ? `<span class="ev-note">${esc(t('inbox.declineReason.' + d.reason))}</span>` : '');
      case 'rejected': case 'suspended': case 'interview_requested': case 'approved': {
        const note = d.note || d.reason;
        return esc(t('inbox.ev.' + m.event)) + (note ? `<span class="ev-note">${esc(note)}</span>` : '');
      }
      default: return esc(t('inbox.ev.' + m.event));
    }
  }

  // ---- The list ----------------------------------------------------------------------------------------------------------------
  function titleOf(th) {
    if (th.kind === 'booking') return th.other ? th.other.name : t('inbox.someone');
    if (th.kind === 'support') return th.subject ? th.subject : t('inbox.support.title');
    return t('inbox.system.title');
  }
  function previewOf(th) {
    if (th.kind === 'booking') return th.question || '';
    if (th.last && th.last.kind === 'event') return eventText({ event: th.last.event, data: {} }).replace(/<[^>]+>/g, ' ');
    return th.last && th.last.body ? th.last.body : '';
  }
  function kindLabel(th) {
    if (th.kind === 'booking') return t(th.role === 'asker' ? 'inbox.kind.asked' : 'inbox.kind.received');
    return t(th.kind === 'support' ? 'inbox.kind.support' : 'inbox.kind.system');
  }
  function drawList() {
    if (!threads.length) {
      listEl.innerHTML = `<li class="inbox-empty"><p class="muted">${esc(t('inbox.empty'))}</p></li>`;
      return;
    }
    listEl.innerHTML = threads.map((th) => {
      const pic = th.kind === 'booking' && th.other ? WisecallAPI.avatar(th.other, { cls: 'avatar-sm', size: 40 }) : `<div class="avatar avatar-sm avatar-wisecall" aria-hidden="true">W</div>`;
      return `
      <li>
        <button type="button" class="thread-item${th.id === current ? ' active' : ''}${th.unread ? ' unread' : ''}" data-thread="${esc(th.id)}" aria-current="${th.id === current ? 'true' : 'false'}">
          ${pic}
          <span class="thread-text">
            <span class="thread-top"><strong>${esc(titleOf(th))}</strong><span class="thread-kind">${esc(kindLabel(th))}</span></span>
            <span class="thread-preview">${esc(previewOf(th))}</span>
          </span>
          ${th.unread ? `<span class="thread-dot" aria-label="${esc(t('inbox.unread'))}"></span>` : ''}
        </button>
      </li>`;
    }).join('');
  }
  listEl.addEventListener('click', (ev) => { const b = ev.target.closest('[data-thread]'); if (b) openThread(b.dataset.thread, { focus: true }); });

  async function loadThreads() {
    const r = await WisecallAPI.apiFetch('/inbox');
    threads = r.threads;
    limits = r.limits || {};
    WisecallNav.setUnread(r.unread);
    drawNotifCount(r.unread);
    drawList();
  }

  // ---- One conversation ----------------------------------------------------------------------------------------------------------
  function messageHtml(m) {
    if (m.kind === 'event') return `<li class="msg msg-event"><p>${eventText(m)}</p><time datetime="${esc(m.createdAt)}">${esc(when(m.createdAt))}</time></li>`;
    const who = m.mine ? t('inbox.you') : (m.senderRole === 'support' ? t('inbox.support.name') : (data.thread.other ? data.thread.other.name : ''));
    const label = m.kind === 'follow_up_question' ? t('inbox.fu.questionLabel') : (m.kind === 'follow_up_reply' ? t('inbox.fu.replyLabel') : '');
    return `
      <li class="msg${m.mine ? ' msg-mine' : ''}">
        <div class="msg-bubble">
          <p class="msg-meta"><strong>${esc(who)}</strong>${label ? ` · ${esc(label)}` : ''} · <time datetime="${esc(m.createdAt)}">${esc(when(m.createdAt))}</time></p>
          <p class="msg-body">${esc(m.body || t('inbox.deleted'))}</p>
          ${hasLink(m.body) ? `<p class="msg-warn small">${esc(t('inbox.linkWarning'))}</p>` : ''}
          ${m.mine ? '' : `<button type="button" class="linklike small msg-report" data-report="${esc(m.id)}">${esc(t('inbox.report.open'))}</button>`}
        </div>
      </li>`;
  }

  function composer(kind) {
    const fu = data.followUp;
    const max = kind === 'support' ? limits.supportMax : fu.limits.max;
    const min = kind === 'support' ? limits.supportMin : fu.limits.min;
    const note = kind === 'ask' ? fill('inbox.fu.askNote', { date: esc(day(fu.askUntil)) }) : (kind === 'reply' ? esc(t('inbox.fu.replyNote')) : esc(t('inbox.support.note')));
    const label = kind === 'ask' ? t('inbox.fu.askLabel') : (kind === 'reply' ? t('inbox.fu.replyLabelField') : t('inbox.support.replyLabel'));
    return `
      <form class="inbox-composer" data-composer="${kind}" novalidate>
        <label class="field-label" for="composerText">${esc(label)}</label>
        <textarea id="composerText" rows="4" maxlength="${max}" required></textarea>
        <p class="small muted composer-note">${note}</p>
        <p class="form-error" role="alert" id="composerError"></p>
        <div class="composer-actions">
          <span class="small muted" id="composerCount">0 / ${max}</span>
          <button type="submit" class="btn btn-primary btn-sm" data-min="${min}">${esc(t(kind === 'ask' ? 'inbox.fu.send' : (kind === 'reply' ? 'inbox.fu.sendReply' : 'inbox.support.send')))}</button>
        </div>
      </form>`;
  }

  function drawThread() {
    const th = data.thread;
    const back = `<button type="button" class="btn btn-ghost btn-sm inbox-back" data-back>← ${esc(t('inbox.back'))}</button>`;
    let head;
    if (th.kind === 'booking') {
      const o = th.other;
      head = `<div class="thread-head">${back}${o ? WisecallAPI.avatar(o, { cls: 'avatar-sm', size: 40 }) : ''}<div><h2>${o && o.username ? `<a href="/u/${encodeURIComponent(o.username)}">${esc(o.name)}</a>` : esc(o ? o.name : '')}</h2>
        <p class="small muted">${esc(t(th.role === 'asker' ? 'inbox.kind.asked' : 'inbox.kind.received'))}</p></div></div>`;
    } else {
      head = `<div class="thread-head">${back}<div class="avatar avatar-sm avatar-wisecall" aria-hidden="true">W</div><div><h2>${esc(th.kind === 'support' ? (th.subject || t('inbox.support.title')) : t('inbox.system.title'))}</h2>
        <p class="small muted">${esc(t(th.kind === 'support' ? 'inbox.support.sub' : 'inbox.system.sub'))}</p></div></div>`;
    }
    let body = '';
    if (th.kind === 'booking') {
      const b = data.booking;
      body += `<div class="qa-card"><h3 class="small">${esc(t(th.role === 'asker' ? 'inbox.yourQuestion' : 'inbox.theQuestion'))}</h3><p class="msg-body">${esc(b.question)}</p></div>`;
      if (b.answer) body += `<div class="qa-card qa-answer"><h3 class="small">${esc(t('inbox.theAnswer'))}</h3><p class="msg-body">${esc(b.answer)}</p>${b.answerHeld ? `<p class="small muted">${esc(t('inbox.answerHeld'))}</p>` : ''}</div>`;
      else if (b.status === 'paid') body += `<p class="muted small">${esc(fill('inbox.waitingAnswer', { date: b.answerDeadline ? day(b.answerDeadline) : '—' }))}</p>`;
    }
    body += `<ol class="msg-list">${data.messages.map(messageHtml).join('')}</ol>`;
    let foot = '';
    if (th.kind === 'booking') {
      const fu = data.followUp;
      if (fu.canAsk) foot = composer('ask');
      else if (fu.canReply) foot = composer('reply');
      else if (fu.closed) foot = `<p class="thread-closed">${esc(t('inbox.fu.closed'))}</p>`;
      else if (th.role === 'asker' && fu.asked) foot = `<p class="muted small">${esc(t('inbox.fu.waitingReply'))}</p>`;
      else if (th.role === 'asker' && data.booking.answer && fu.askUntil && new Date(fu.askUntil) < new Date()) foot = `<p class="muted small">${esc(t('inbox.fu.expired'))}</p>`;
      else if (th.role === 'mentor' && !fu.asked && data.booking.answer) foot = `<p class="muted small">${esc(t('inbox.fu.mentorWait'))}</p>`;
      foot += `<p class="small muted inbox-rules">${esc(t('inbox.rules'))}</p>`;
    } else if (th.kind === 'support') {
      foot = composer('support');
    } else {
      foot = `<p class="small muted">${esc(t('inbox.system.readOnly'))}</p>`;
    }
    view.innerHTML = `${head}<div class="thread-body">${body}</div><div class="thread-foot">${foot}</div>`;
    const list = view.querySelector('.thread-body');
    list.scrollTop = list.scrollHeight;
    wireComposer();
  }

  function newSupportForm() {
    current = null;
    data = null;
    layout.classList.add('has-thread');
    drawList();
    view.innerHTML = `
      <div class="thread-head"><button type="button" class="btn btn-ghost btn-sm inbox-back" data-back>← ${esc(t('inbox.back'))}</button><div class="avatar avatar-sm avatar-wisecall" aria-hidden="true">W</div>
        <div><h2>${esc(t('inbox.support.new'))}</h2><p class="small muted">${esc(t('inbox.support.sub'))}</p></div></div>
      <form class="inbox-composer" id="supportForm" novalidate>
        <label class="field-label" for="supportSubject">${esc(t('inbox.support.subject'))}</label>
        <input type="text" id="supportSubject" maxlength="${limits.supportSubjectMax || 120}">
        <label class="field-label" for="supportBody">${esc(t('inbox.support.message'))}</label>
        <textarea id="supportBody" rows="6" maxlength="${limits.supportMax || 3000}" required></textarea>
        <p class="form-error" role="alert" id="supportError"></p>
        <div class="composer-actions"><button type="submit" class="btn btn-primary btn-sm">${esc(t('inbox.support.send'))}</button></div>
      </form>`;
    const form = document.getElementById('supportForm');
    document.getElementById('supportSubject').focus();
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = document.getElementById('supportError');
      err.textContent = '';
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      try {
        const r = await WisecallAPI.apiFetch('/inbox/support', { method: 'POST', body: { subject: document.getElementById('supportSubject').value, body: document.getElementById('supportBody').value } });
        await loadThreads();
        await openThread(r.id);
        WisecallNav.showToast(t('inbox.support.sent'));
      } catch (e) {
        err.textContent = errorText(e);
        btn.disabled = false;
      }
    });
  }
  document.getElementById('newSupport').addEventListener('click', newSupportForm);

  function errorText(e) {
    if (e.code === 'contact_details') {
      const kinds = (e.data && e.data.reasons) || e.reasons || [];
      return t('inbox.err.contact') + (kinds.length ? ' ' + kinds.map((k) => t('inbox.err.contact.' + k)).join(', ') + '.' : '') + ' ' + t('inbox.err.contactFix');
    }
    if (e.code === 'too_short') return fill('inbox.err.tooShort', { min: (e.data && e.data.min) || e.min || '' });
    if (e.code === 'too_long') return fill('inbox.err.tooLong', { max: (e.data && e.data.max) || e.max || '' });
    const map = {
      offensive: 'inbox.err.offensive', follow_up_used: 'inbox.err.used', thread_closed: 'inbox.fu.closed', follow_up_not_open: 'inbox.err.notOpen',
      too_many_open: 'inbox.err.tooManyOpen', too_many_requests: 'inbox.err.rate', missing_fields: 'inbox.err.empty'
    };
    return t(map[e.code] || 'toast.error');
  }

  function wireComposer() {
    const form = view.querySelector('[data-composer]');
    if (!form) return;
    const text = form.querySelector('textarea');
    const count = form.querySelector('#composerCount');
    const max = Number(text.getAttribute('maxlength'));
    text.addEventListener('input', () => { count.textContent = `${WisecallAPI.textLength(text.value)} / ${max}`; });
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const err = form.querySelector('#composerError');
      err.textContent = '';
      const btn = form.querySelector('button[type="submit"]');
      if (WisecallAPI.textLength(text.value) < Number(btn.dataset.min)) { err.textContent = fill('inbox.err.tooShort', { min: btn.dataset.min }); return; }
      btn.disabled = true;
      try {
        await WisecallAPI.apiFetch(`/inbox/threads/${current}/messages`, { method: 'POST', body: { body: text.value } });
        WisecallNav.showToast(t(form.dataset.composer === 'support' ? 'inbox.support.sent' : 'inbox.fu.sent'));
        await openThread(current);
        loadThreads().catch(() => {});
      } catch (e) {
        err.textContent = errorText(e);
        btn.disabled = false;
      }
    });
  }

  // Report a message: a small form under it.
  view.addEventListener('click', async (ev) => {
    if (ev.target.closest('[data-back]')) { layout.classList.remove('has-thread'); current = null; drawList(); history.replaceState(null, '', '/inbox.html'); return; }
    const rep = ev.target.closest('[data-report]');
    if (rep) {
      const holder = rep.parentElement;
      if (holder.querySelector('.report-form')) return;
      const reasons = ['contact_details', 'abuse', 'spam', 'scam', 'other'];
      holder.insertAdjacentHTML('beforeend', `
        <form class="report-form">
          <label class="field-label small" for="rep-${esc(rep.dataset.report)}">${esc(t('inbox.report.why'))}</label>
          <select id="rep-${esc(rep.dataset.report)}">${reasons.map((r) => `<option value="${r}">${esc(t('inbox.report.reason.' + r))}</option>`).join('')}</select>
          <button type="submit" class="btn btn-outline btn-sm">${esc(t('inbox.report.send'))}</button>
        </form>`);
      holder.querySelector('.report-form').addEventListener('submit', async (e2) => {
        e2.preventDefault();
        const f = e2.target;
        try {
          await WisecallAPI.apiFetch(`/inbox/messages/${rep.dataset.report}/report`, { method: 'POST', body: { reason: f.querySelector('select').value } });
          f.outerHTML = `<p class="small muted">${esc(t('inbox.report.done'))}</p>`;
          rep.remove();
        } catch (e) { WisecallNav.showToast(t(e.code === 'already_reported' ? 'inbox.report.already' : 'toast.error')); }
      });
    }
  });

  async function openThread(id, opts) {
    try {
      data = await WisecallAPI.apiFetch(`/inbox/threads/${encodeURIComponent(id)}`);
    } catch (e) {
      view.innerHTML = `<p class="muted">${esc(t(e.code === 'not_found' ? 'inbox.notFound' : 'toast.error'))}</p>`;
      return;
    }
    current = data.thread.id;
    layout.classList.add('has-thread');
    const u = new URL(location.href);
    u.searchParams.set('thread', current);
    u.searchParams.delete('booking');
    history.replaceState(null, '', u);
    const th = threads.find((x) => x.id === current);
    if (th) th.unread = false;
    drawList();
    drawThread();
    if (opts && opts.focus) { const h = view.querySelector('h2'); if (h) { h.tabIndex = -1; h.focus(); } }
    WisecallAPI.apiFetch('/inbox/unread').then((r) => { WisecallNav.setUnread(r.count); drawNotifCount(r.count); }).catch(() => {});
  }

  // ---- Notifications -------------------------------------------------------------------------------------------------------------
  function drawNotifCount(n) {
    notifCount.hidden = !n;
    notifCount.textContent = n > 99 ? '99+' : String(n || '');
  }
  function notifText(n) {
    const d = n.data || {};
    const key = 'inbox.n.' + n.kind;
    if (n.kind === 'verification_update') return fill(d.status === 'passed' ? 'inbox.ev.stepPassed' : 'inbox.ev.stepFailed', { step: t('verify.step.' + d.step) });
    if (n.kind === 'payout_sent' || n.kind === 'refunded') return fill(key, { amount: WisecallAPI.formatAmount(d.amount || 0) });
    return t(key);
  }
  async function loadNotifications() {
    try {
      const r = await WisecallAPI.apiFetch('/inbox/notifications');
      if (!r.notifications.length) { notifList.innerHTML = `<li class="inbox-empty"><p class="muted">${esc(t('inbox.n.empty'))}</p></li>`; return; }
      notifList.innerHTML = r.notifications.map((n) => `
        <li><button type="button" class="notif-item${n.read ? '' : ' unread'}" data-notif="${esc(n.id)}" data-thread="${esc(n.threadId || '')}">
          <span>${esc(notifText(n))}</span><time class="small muted" datetime="${esc(n.createdAt)}">${esc(when(n.createdAt))}</time>
        </button></li>`).join('');
    } catch (e) { notifList.innerHTML = `<li><p class="muted">${esc(t('toast.error'))}</p></li>`; }
  }
  notifList.addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-notif]');
    if (!b) return;
    await WisecallAPI.apiFetch('/inbox/notifications/read', { method: 'POST', body: { ids: [b.dataset.notif] } }).then((r) => { WisecallNav.setUnread(r.count); drawNotifCount(r.count); }).catch(() => {});
    if (b.dataset.thread) { selectTab('messages'); await openThread(b.dataset.thread, { focus: true }); } else b.classList.remove('unread');
  });
  document.getElementById('markAllRead').addEventListener('click', async () => {
    const r = await WisecallAPI.apiFetch('/inbox/notifications/read', { method: 'POST', body: {} });
    WisecallNav.setUnread(r.count);
    drawNotifCount(r.count);
    loadNotifications();
  });

  // ---- Start, and keep it fresh (every 25 seconds while visible; never while the person is typing) -----------------------------
  const params = new URLSearchParams(location.search);
  selectTab(params.get('tab') === 'notifications' ? 'notifications' : 'messages', false);
  try { await loadThreads(); } catch (e) { listEl.innerHTML = `<li><p class="muted">${esc(t('toast.error'))}</p></li>`; }
  let start = params.get('thread');
  if (!start && params.get('booking')) {
    try { start = (await WisecallAPI.apiFetch(`/inbox/booking/${encodeURIComponent(params.get('booking'))}`)).threadId; } catch (e) { /* not theirs, or not paid yet */ }
  }
  if (start) await openThread(start);
  else if (threads.length && window.matchMedia('(min-width: 768px)').matches) await openThread(threads[0].id);
  else view.innerHTML = `<p class="muted inbox-pick">${esc(t(threads.length ? 'inbox.pick' : 'inbox.emptyThread'))}</p>`;

  setInterval(async () => {
    if (document.visibilityState === 'hidden') return;
    const typing = view.querySelector('textarea, input') && [...view.querySelectorAll('textarea, input')].some((x) => x.value.trim() || x === document.activeElement);
    try {
      await loadThreads();
      if (current && !typing) {
        const fresh = await WisecallAPI.apiFetch(`/inbox/threads/${current}`);
        if (JSON.stringify(fresh.messages) !== JSON.stringify(data.messages) || JSON.stringify(fresh.followUp) !== JSON.stringify(data.followUp)) { data = fresh; drawThread(); }
      }
    } catch (e) { /* offline for a moment: try again next time */ }
  }, 25000);
  document.addEventListener('wisecall:lang-changed', () => { drawList(); if (data) drawThread(); if (!document.getElementById('panel-notifications').hidden) loadNotifications(); });
})();
