// /live/<slug>/room: the call (the video provider's page in a frame, with a personal token from our server) and, next to it, the question
// panel. Participants join with camera and mic off; in Live Q&A and Workshop they raise a hand and the mentor lets them speak (the page
// then fetches a new token and reloads the call). Every 30 seconds a heartbeat records who is here (the mentor's presence decides the
// payout). Every text from people is shown as text.
(async function () {
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();
  const t = WisecallI18n.t;
  const root = document.getElementById('liveRoom');
  const id = root.dataset.session;
  const kind = root.dataset.kind;
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (key, vars) => Object.entries(vars).reduce((s, [k, v]) => s.split(`{${k}}`).join(v), t(key));
  const frameBox = document.getElementById('liveFrame');
  const panel = document.getElementById('liveQuestions');
  const status = document.getElementById('liveStatus');
  const say = (key, vars) => { status.textContent = vars ? fill(key, vars) : t(key); status.hidden = false; };
  if (!user) { window.location.href = '/login.html?redirect=' + encodeURIComponent(location.pathname); return; }

  let role = null;
  let canSpeak = false;
  let joined = false;
  // A recorded session (a replay): everybody sees REC while it records; nobody but the mentor can speak.
  let replay = false;
  let recording = false;
  const rec = document.createElement('span');
  rec.className = 'badge badge-rejected live-rec';
  rec.hidden = true;
  rec.setAttribute('role', 'status');
  document.getElementById('liveControls').before(rec);
  const drawRec = () => { rec.hidden = !recording; rec.textContent = '● ' + t('live.room.rec'); };

  async function join(anonymous) {
    try {
      const r = await WisecallAPI.apiFetch(`/live/${encodeURIComponent(id)}/join`, { method: 'POST', body: anonymous === undefined ? {} : { anonymous } });
      role = r.role;
      canSpeak = Boolean(r.canSpeak);
      replay = Boolean(r.replay);
      // (only a frame from the address the server gave, which is also the only frame this page's security policy allows)
      if (!r.joinUrl.startsWith(r.frameOrigin + '/')) throw new Error('unexpected room address');
      frameBox.innerHTML = '';
      const f = document.createElement('iframe');
      f.src = r.joinUrl;
      f.title = t('live.room.callTitle');
      f.allow = 'camera; microphone; fullscreen; display-capture; autoplay';
      f.className = 'live-call';
      frameBox.appendChild(f);
      status.hidden = true;
      joined = true;
      drawControls();
      return true;
    } catch (e) {
      const key = { not_open_yet: 'live.room.notOpenYet', closed: 'live.room.closed', no_ticket: 'live.room.noTicket', not_found: 'live.room.notFound',
        video_unavailable: 'live.room.videoDown' }[e.code] || 'live.room.videoDown';
      say(key);
      return false;
    }
  }

  // Before joining: the participant's choice of name (first name, or "Guest N") and, for health topics, the crisis line.
  function prejoin() {
    frameBox.innerHTML = `<div class="live-prejoin settings-card">
      <h2>${esc(t('live.room.ready'))}</h2>
      <p class="muted">${esc(t('live.room.muted'))}</p>
      ${replay ? `<p class="pay-notice" role="note">${esc(t('live.room.recordedNotice'))}</p>` : ''}
      <label class="checkbox-row" for="joinAnon"><input type="checkbox" id="joinAnon"> <span>${esc(t('live.joinAnonymous'))}</span></label>
      <button type="button" class="btn btn-primary" id="joinBtn">${esc(t('live.join'))}</button>
    </div>`;
    document.getElementById('joinBtn').addEventListener('click', () => join(document.getElementById('joinAnon').checked));
  }

  function drawControls() {
    const box = document.getElementById('liveControls');
    if (role === 'mentor') {
      box.innerHTML = `${replay ? `<button type="button" class="btn btn-outline btn-sm" id="recBtn" aria-pressed="${recording}">${esc(t(recording ? 'live.room.stopRec' : 'live.room.startRec'))}</button>` : ''}
        <button type="button" class="btn btn-outline btn-sm" id="restartBtn">${esc(t('live.room.restart'))}</button>
        <button type="button" class="btn btn-danger btn-sm" id="endBtn">${esc(t('live.room.end'))}</button>`;
      document.getElementById('endBtn').addEventListener('click', async () => {
        if (!(await WisecallDialog.confirm({ message: t('live.room.endConfirm'), confirmText: t('live.room.end'), danger: true }))) return;
        try { await WisecallAPI.apiFetch(`/live/${encodeURIComponent(id)}/end`, { method: 'POST' }); say('live.room.ended'); frameBox.innerHTML = ''; }
        catch (e) { WisecallNav.showToast(t('toast.error')); }
      });
      document.getElementById('restartBtn').addEventListener('click', async () => {
        try { await WisecallAPI.apiFetch(`/live/${encodeURIComponent(id)}/restart`, { method: 'POST' }); await join(); WisecallNav.showToast(t('live.room.restarted')); }
        catch (e) { WisecallNav.showToast(t('live.room.videoDown')); }
      });
      const recBtn = document.getElementById('recBtn');
      if (recBtn) recBtn.addEventListener('click', async () => {
        try {
          const r = await WisecallAPI.apiFetch(`/live/${encodeURIComponent(id)}/recording`, { method: 'POST', body: { start: !recording } });
          recording = r.recording; drawRec(); drawControls();
        } catch (e) { WisecallNav.showToast(t(e.code === 'not_live' ? 'live.room.recNotLive' : 'live.room.recFailed')); }
      });
      return;
    }
    if (kind === 'circle') { box.innerHTML = ''; return; }
    if (replay) { box.innerHTML = `<span class="muted small">${esc(t('live.room.noMicRecorded'))}</span>`; return; }
    box.innerHTML = `<button type="button" class="btn btn-outline btn-sm" id="handBtn" aria-pressed="false">${esc(t('live.room.raise'))}</button>`;
    document.getElementById('handBtn').addEventListener('click', async (ev) => {
      const raise = ev.currentTarget.getAttribute('aria-pressed') !== 'true';
      try { apply(await WisecallAPI.apiFetch(`/live/${encodeURIComponent(id)}/hand`, { method: 'POST', body: { raise } })); }
      catch (e) { WisecallNav.showToast(t('toast.error')); }
    });
  }

  // ---- What the server says (every 5 seconds, and the heartbeat every 30) --------------------------------------------------------------
  function drawQuestions(list) {
    if (!list.length) { panel.innerHTML = `<p class="muted small">${esc(t('live.room.noQuestions'))}</p>`; return; }
    panel.innerHTML = `<ol class="live-qlist">${list.map((q) => `<li class="live-q live-q-${esc(q.state)}" data-id="${esc(q.id)}">
        <p>${esc(q.body)}</p>
        <p class="live-q-foot small">
          ${q.source === 'checkout' ? `<span class="badge badge-muted">${esc(t('live.room.fromCheckout'))}</span>` : ''}
          ${q.state === 'answering' ? `<span class="badge badge-paid">${esc(t('live.room.answering'))}</span>` : ''}
          ${q.state === 'answered' ? `<span class="badge badge-answered">${esc(t('live.room.answered'))}</span>` : ''}
          ${q.mine || role === 'mentor' ? `<span class="muted">▲ ${q.votes}</span>`
            : `<button type="button" class="linklike q-vote" aria-pressed="${q.voted}">▲ ${q.votes} ${esc(t('live.room.upvote'))}</button>`}
          ${role === 'mentor' ? `<span class="live-q-actions">
            <button type="button" class="linklike q-state" data-state="answering">${esc(t('live.room.markAnswering'))}</button>
            <button type="button" class="linklike q-state" data-state="answered">${esc(t('live.room.markAnswered'))}</button>
            <button type="button" class="linklike q-state" data-state="hidden">${esc(t('live.room.hide'))}</button></span>` : ''}
        </p></li>`).join('')}</ol>`;
  }
  panel.addEventListener('click', async (ev) => {
    const li = ev.target.closest('.live-q');
    if (!li) return;
    try {
      if (ev.target.closest('.q-vote')) drawQuestions((await WisecallAPI.apiFetch(`/live/questions/${encodeURIComponent(li.dataset.id)}/vote`, { method: 'POST' })).questions);
      const st = ev.target.closest('.q-state');
      if (st) drawQuestions((await WisecallAPI.apiFetch(`/live/questions/${encodeURIComponent(li.dataset.id)}/state`, { method: 'POST', body: { state: st.dataset.state } })).questions);
    } catch (e) { WisecallNav.showToast(t('toast.error')); }
  });

  function drawPeople(st) {
    const box = document.getElementById('livePeople');
    if (role !== 'mentor' || !st.people) { box.hidden = true; return; }
    box.hidden = false;
    box.innerHTML = `<h2 class="small">${esc(fill('live.room.people', { here: st.count.here, tickets: st.count.tickets }))}</h2>
      <ul class="live-people">${st.people.map((p) => `<li data-id="${esc(p.id)}"><span>${esc(p.name)}</span>${p.here ? '' : ` <span class="muted small">${esc(t('live.room.away'))}</span>`}
        ${p.hand === 'raised' ? `<span class="badge badge-pending_payment">✋ ${esc(t('live.room.handUp'))}</span> <button type="button" class="linklike sp-allow">${esc(t('live.room.allow'))}</button>` : ''}
        ${p.hand === 'allowed' ? `<span class="badge badge-paid">${esc(t('live.room.speaking'))}</span> <button type="button" class="linklike sp-lower">${esc(t('live.room.stopSpeaking'))}</button>` : ''}</li>`).join('')}</ul>`;
  }
  document.getElementById('livePeople').addEventListener('click', async (ev) => {
    const li = ev.target.closest('li[data-id]');
    if (!li) return;
    const allow = Boolean(ev.target.closest('.sp-allow'));
    if (!allow && !ev.target.closest('.sp-lower')) return;
    try { apply(await WisecallAPI.apiFetch(`/live/${encodeURIComponent(id)}/speakers/${encodeURIComponent(li.dataset.id)}`, { method: 'POST', body: { allow } })); }
    catch (e) { WisecallNav.showToast(t('toast.error')); }
  });

  function apply(st) {
    if (!st) return;
    if (st.replay !== undefined) replay = Boolean(st.replay);
    if (st.recording !== undefined && Boolean(st.recording) !== recording) { recording = Boolean(st.recording); drawRec(); if (role === 'mentor' && joined) drawControls(); }
    drawQuestions(st.questions || []);
    drawPeople(st);
    if (st.sessionStatus === 'ended' || st.sessionStatus === 'cancelled') { frameBox.innerHTML = ''; say(st.sessionStatus === 'ended' ? 'live.room.ended' : 'live.room.cancelled'); return; }
    if (role === 'participant') {
      const btn = document.getElementById('handBtn');
      if (btn) {
        btn.setAttribute('aria-pressed', String(st.hand === 'raised'));
        btn.textContent = t(st.hand === 'raised' ? 'live.room.lower' : (st.hand === 'allowed' ? 'live.room.speaking' : 'live.room.raise'));
        btn.disabled = st.hand === 'allowed';
      }
      // The mentor let me speak (or stopped it): a new token with the new rights, and the call again.
      if (joined && kind !== 'circle' && (st.hand === 'allowed') !== canSpeak) { join(); WisecallNav.showToast(t(st.hand === 'allowed' ? 'live.room.youMaySpeak' : 'live.room.speakingStopped')); }
    }
  }

  document.getElementById('askForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const input = document.getElementById('askInput');
    const err = document.getElementById('askError');
    err.textContent = '';
    const body = input.value.trim();
    if (body.length < 3) { err.textContent = t('live.room.askShort'); return; }
    try { drawQuestions((await WisecallAPI.apiFetch(`/live/${encodeURIComponent(id)}/questions`, { method: 'POST', body: { body } })).questions); input.value = ''; }
    catch (e) { err.textContent = t({ offensive: 'pa.err.offensive', contact_details: 'rq.err.contact', too_many_questions: 'live.room.tooMany', too_many_requests: 'live.room.tooMany' }[e.code] || 'toast.error'); }
  });

  const poll = async () => {
    if (document.hidden) return;
    try { apply(await WisecallAPI.apiFetch(`/live/${encodeURIComponent(id)}/state`)); } catch (e) { /* next time */ }
  };
  const beat = async () => {
    if (!joined) return;
    try { apply(await WisecallAPI.apiFetch(`/live/${encodeURIComponent(id)}/heartbeat`, { method: 'POST' })); } catch (e) { /* next time */ }
  };
  setInterval(poll, 5000);
  setInterval(beat, 30000);

  // The mentor goes straight in; a participant chooses how to appear first.
  try {
    const st = await WisecallAPI.apiFetch(`/live/${encodeURIComponent(id)}/state`);
    role = st.role;
    apply(st);
    if (role === 'mentor') { await join(); beat(); } else prejoin();
  } catch (e) {
    say({ no_ticket: 'live.room.noTicket', not_found: 'live.room.notFound' }[e.code] || 'live.room.notFound');
  }
})();
