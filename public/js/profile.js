// A person's public profile, at /u/<username>: who they are (photo, headline, work or study, city, languages, bio, links) and,
// for a mentor, how they were checked, their reviews, and the box where a buyer writes a question and goes to pay at the bank.
(async function () {
  const params = new URLSearchParams(location.search);
  const username = (location.pathname.match(/^\/u\/([\w-]+)/) || [])[1] || '';
  // Everything the page needs is asked for at the same moment (texts, who is signed in, the profile), not one after the other.
  const profileRequest = username ? WisecallAPI.apiFetch('/users/' + encodeURIComponent(username)).catch((e) => ({ error: e.code || 'error' })) : Promise.resolve({ error: 'not_found' });
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();
  const t = WisecallI18n.t;

  const page = document.getElementById('expertPage');
  const crumbs = document.getElementById('crumbs');
  const bookingParam = params.get('booking');
  const statusParam = params.get('status');
  const MAX_QUESTION = 4000; // the server keeps at most this many characters
  const MIN_QUESTION = 5;

  const escapeHtml = (str) => String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function showMessage(key, extra) {
    page.setAttribute('aria-busy', 'false');
    page.innerHTML = `<div class="empty-state"><h1 style="font-size:1.4rem">${t(key)}</h1>${extra || ''}<a class="btn btn-primary" href="/index.html#experts">${t('nav.browse')}</a></div>`;
  }

  let answer = await profileRequest;
  if (answer.redirectTo) { // an old username: go to the new one (the server does this for pages; this covers a link followed from a script)
    history.replaceState(null, '', `/u/${answer.redirectTo}${location.search}`);
    answer = await WisecallAPI.apiFetch('/users/' + encodeURIComponent(answer.redirectTo)).catch((e) => ({ error: e.code || 'error' }));
  }
  if (answer.private) { document.title = `${t('profile.private.title')} — Wisecall`; showMessage('profile.private.title', `<p class="muted">${t('profile.private.body')}</p>`); return; }
  if (!answer.profile) { showMessage('profile.notFound'); return; }
  // One object for the page: the person, plus (for a mentor) what buyers need.
  const expert = { ...answer.profile, ...(answer.profile.mentor || {}) };
  const isMentor = Boolean(answer.profile.isMentor);
  const isSelf = Boolean(user && user.id === expert.id);
  // ---- Phones: the question box is a bottom sheet, opened from a bar fixed to the bottom of the screen ----------
  // One element holds the box (askArea); it sits in the side panel on tablets and desktops and in the sheet on phones.
  const phone = window.matchMedia('(max-width: 639px)');
  const askAreaEl = document.createElement('div');
  askAreaEl.id = 'askArea';
  const bar = document.createElement('div');
  bar.className = 'ask-bar';
  bar.hidden = true;
  const sheetEl = document.createElement('div');
  sheetEl.className = 'sheet';
  sheetEl.id = 'askSheet';
  sheetEl.hidden = true;
  sheetEl.innerHTML = `
    <div class="sheet-backdrop" data-sheet-close></div>
    <div class="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="askSheetTitle" tabindex="-1">
      <div class="sheet-grip" aria-hidden="true"></div>
      <div class="sheet-head">
        <h2 id="askSheetTitle"></h2>
        <button type="button" class="sheet-close" data-sheet-close data-i18n-aria="sheet.close" aria-label="Close"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <div class="sheet-body" id="askSheetBody"></div>
    </div>`;
  document.body.append(bar, sheetEl);
  const sheet = WisecallSheet.create(sheetEl);
  function mountAsk() {
    if (!isMentor) return;
    const target = phone.matches ? document.getElementById('askSheetBody') : document.getElementById('askCard');
    if (target && askAreaEl.parentNode !== target) target.appendChild(askAreaEl);
  }
  function updateBar() {
    if (!isMentor) { bar.hidden = true; return; }
    const own = isSelf;
    const prelaunch = WisecallI18n.launchMode() === 'prelaunch';
    const show = phone.matches && !own;
    bar.hidden = !show;
    document.body.classList.toggle('has-ask-bar', show);
    document.getElementById('askSheetTitle').textContent = prelaunch ? t('expert.prelaunch.title') : t('expert.askTitle').replace('{name}', expert.name);
    sheetEl.querySelector('.sheet-close').setAttribute('aria-label', t('sheet.close'));
    bar.innerHTML = `
      <div class="ask-bar-price"><strong>${WisecallAPI.formatPrice(expert.price)}</strong><span>${t('expert.priceLabel')}</span></div>
      <button type="button" class="btn btn-primary btn-lg" id="askOpen" aria-haspopup="dialog" aria-expanded="false" aria-controls="askSheet">${t(prelaunch ? 'wait.join' : 'expert.askCta')}</button>`;
    const open = bar.querySelector('#askOpen');
    open.addEventListener('click', () => sheet.open(open));
  }
  phone.addEventListener('change', () => { mountAsk(); if (!phone.matches) sheet.close(false); updateBar(); });

  // ---- Small formatters ----------------------------------------------------------------------------------
  function waitText(seconds) {
    if (seconds === null || seconds === undefined) return null;
    const hours = seconds / 3600;
    if (hours < 1) return t('expert.wait.minutes');
    if (hours < 48) return t('expert.wait.hours').replace('{n}', Math.max(1, Math.round(hours)));
    return t('expert.wait.days').replace('{n}', Math.round(hours / 24));
  }

  function crumbsHtml() {
    return `<ol>
      <li><a href="/index.html">${t('expert.crumb.home')}</a></li>
      ${isMentor ? `<li><a href="/index.html#experts">${t('nav.browse')}</a></li>
      ${expert.niche ? `<li><a href="/index.html?niche=${encodeURIComponent(expert.niche)}#experts">${escapeHtml(t('niche.' + expert.niche))}</a></li>` : ''}` : ''}
      <li><span aria-current="page">${escapeHtml(expert.name)}</span></li>
    </ol>`;
  }

  // ---- The details every profile has: work or study, city, languages, links, member since -----------------------------
  const LINK_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';
  const monthYear = (d) => new Date(d).toLocaleDateString(WisecallI18n.getLang() === 'ka' ? 'ka-GE' : 'en-GB', { month: 'long', year: 'numeric' });
  function detailsHtml() {
    const rows = [];
    if (expert.currentWork) rows.push(`<li><span class="muted small">${t('profile.currentWork')}</span><strong>${escapeHtml(expert.currentWork)}</strong></li>`);
    if (expert.city) rows.push(`<li><span class="muted small">${t('profile.city')}</span><strong>${escapeHtml(expert.city)}</strong></li>`);
    if ((expert.languages || []).length) rows.push(`<li><span class="muted small">${t('profile.languages')}</span><strong>${expert.languages.map((l) => escapeHtml(t('lang.' + l))).join(', ')}</strong></li>`);
    rows.push(`<li><span class="muted small">${t('profile.memberSince')}</span><strong>${escapeHtml(monthYear(expert.memberSince))}</strong></li>`);
    const links = [];
    if (expert.linkedinUrl) links.push(`<a class="profile-link" href="${escapeHtml(expert.linkedinUrl)}" target="_blank" rel="noopener noreferrer nofollow ugc">${LINK_ICON}LinkedIn</a>`);
    if (expert.websiteUrl) links.push(`<a class="profile-link" href="${escapeHtml(expert.websiteUrl)}" target="_blank" rel="noopener noreferrer nofollow ugc">${LINK_ICON}${escapeHtml(new URL(expert.websiteUrl).hostname.replace(/^www\./, ''))}</a>`);
    return `<ul class="profile-facts">${rows.join('')}</ul>${links.length ? `<p class="profile-links">${links.join('')}</p>` : ''}`;
  }

  const CHECK = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  const REVIEW_ART = `<svg viewBox="0 0 120 80" aria-hidden="true"><rect x="8" y="10" width="70" height="42" rx="14" fill="#ff6f59"/><path d="M24 50 Q20 64 10 68 Q34 66 40 50 Z" fill="#ff6f59"/><path d="M28 30l5 5 10-11" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><rect x="52" y="30" width="58" height="36" rx="12" fill="#fff" stroke="#2b2440" stroke-width="3.5"/><path d="M72 40l4 8 9 1-7 6 2 9-8-4-8 4 2-9-7-6 9-1z" fill="#f4a93b"/></svg>`;

  // ---- The page ------------------------------------------------------------------------------------------------
  function profileHtml() {
    const rating = expert.ratingAvg
      ? `<span class="rating">★ ${expert.ratingAvg}</span> <span class="muted">(${expert.reviewCount} ${t('expert.reviewsShort')})</span>`
      : `<span class="muted">${t('expert.noReviewsYet')}</span>`;
    const wait = waitText(expert.avgAnswerSeconds);
    const title = isMentor ? (expert.roleTitle || '') : (expert.headline || '');
    return `
      <div class="expert-layout${isMentor ? '' : ' profile-plain'}">
        <section class="profile-card" aria-labelledby="expertName">
          <div class="profile-head">
            ${WisecallAPI.avatar(expert, { cls: 'avatar-lg', size: 76 })}
            <div>
              <h1 id="expertName">${escapeHtml(expert.name)}</h1>
              ${title ? `<p class="profile-title">${escapeHtml(title)}</p>` : ''}
              ${isMentor && expert.headline ? `<p class="profile-headline">${escapeHtml(expert.headline)}</p>` : ''}
              <div class="profile-tags">
                ${isMentor && expert.niche ? `<a class="tag tag-niche" href="/index.html?niche=${encodeURIComponent(expert.niche)}#experts">${escapeHtml(t('niche.' + expert.niche))}</a>` : ''}
                ${isMentor ? `<span class="tag tag-verified">${CHECK}${t('expert.verified')}</span>` : ''}
                ${isMentor && (expert.reviewCount || 0) < 3 ? `<span class="tag tag-new">${t('expert.newMentor')}</span>` : ''}
              </div>
            </div>
          </div>
          ${isSelf ? `<p class="profile-self small"><a class="btn btn-outline btn-sm" href="/settings.html?tab=profile">${t('profile.edit')}</a> ${expert.visibility === 'contacts' ? `<span class="muted">${t('profile.visibleToContacts')}</span>` : ''}</p>` : ''}
          ${detailsHtml()}
          ${isMentor ? `<dl class="profile-stats">
            <div><dt>${t('expert.stat.price')}</dt><dd>${WisecallAPI.formatPrice(expert.price)}</dd></div>
            <div><dt>${t('expert.stat.rating')}</dt><dd>${rating}</dd></div>
            <div><dt>${t('expert.stat.answered')}</dt><dd>${expert.answeredCount || 0}</dd></div>
            <div><dt>${t('expert.stat.wait')}</dt><dd>${wait ? escapeHtml(wait) : `<span class="muted">${t('expert.wait.none')}</span>`}</dd></div>
          </dl>` : ''}
        </section>

        ${isMentor ? `<aside class="ask-side" aria-label="${escapeHtml(t('expert.askTitle').replace('{name}', expert.name))}">
          <div class="ask-panel" id="askCard"></div>
        </aside>` : ''}

        ${expert.bio ? `<section class="profile-section profile-about" aria-labelledby="aboutTitle"><h2 id="aboutTitle">${t('expert.about')}</h2><p>${escapeHtml(expert.bio)}</p></section>` : ''}

        ${isMentor && (expert.badges || []).length ? `<section class="profile-section profile-checks" aria-labelledby="checksTitle"><h2 id="checksTitle">${t('expert.checks')}</h2>${WisecallBadges.full(expert.badges)}<p class="muted small" style="margin:10px 0 0">${t('expert.checksNote')}</p></section>` : ''}

        ${isMentor ? `<section class="profile-section profile-reviews" aria-labelledby="reviewsTitle">
          <h2 id="reviewsTitle">${t('expert.reviewsTitle')}</h2>
          <div id="reviewsBody"><span class="skeleton skeleton-line w80"></span><span class="skeleton skeleton-line w60"></span></div>
        </section>

        <div class="report-section">${WisecallReport.html(expert.id, null, Boolean(user))}</div>` : ''}
      </div>`;
  }

  function draw() {
    const typed = document.getElementById('question');
    if (typed) draft = typed.value;
    document.title = isMentor ? `${expert.name}, ${expert.roleTitle || ''} — Wisecall`.replace(', —', ' —') : `${expert.name} — Wisecall`;
    crumbs.innerHTML = crumbsHtml();
    page.setAttribute('aria-busy', 'false');
    page.innerHTML = profileHtml();
    if (!isMentor) return;
    mountAsk();
    updateBar();
    WisecallReport.wire(page);
    loadReviews();
    if (!checking && !returnedFromBank) renderAskForm(); else if (askState) askArea().innerHTML = askState;
  }
  const askArea = () => document.getElementById('askArea');
  // ---- Reviews ------------------------------------------------------------------------------------------------
  async function loadReviews() {
    const body = document.getElementById('reviewsBody');
    if (!body) return;
    let reviews = [];
    try { reviews = (await WisecallAPI.apiFetch(`/experts/${expert.id}/reviews`)).reviews; } catch (e) { body.innerHTML = `<p class="muted">${t('toast.error')}</p>`; return; }
    if (!reviews.length) {
      body.innerHTML = `<div class="reviews-empty">${REVIEW_ART}<h3>${t('expert.reviews.empty.title')}</h3><p>${t('expert.reviews.empty.body')}</p></div>`;
      return;
    }
    const counts = [5, 4, 3, 2, 1].map((n) => reviews.filter((r) => r.rating === n).length);
    body.innerHTML = `
      <div class="review-summary">
        <div><strong>${expert.ratingAvg}</strong><div class="review-stars" aria-hidden="true">${'★'.repeat(Math.round(expert.ratingAvg))}${'☆'.repeat(5 - Math.round(expert.ratingAvg))}</div><span class="muted small">${t('expert.reviews.count').replace('{n}', reviews.length)}</span></div>
        <div class="review-bars" aria-hidden="true">${counts.map((c, i) => `<div class="review-bar"><span>${5 - i}★</span><i><b style="width:${Math.round((c / reviews.length) * 100)}%"></b></i><span>${c}</span></div>`).join('')}</div>
      </div>
      ${reviews.map((r) => `
        <article class="review-card">
          <div class="review-top">
            <span class="review-stars" role="img" aria-label="${escapeHtml(t('expert.reviews.stars').replace('{n}', r.rating))}">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
            <span class="muted small">${escapeHtml(r.reviewerName)}</span>
          </div>
          ${r.review ? `<p class="review-text">${escapeHtml(r.review)}</p>` : ''}
        </article>`).join('')}`;
  }

  // ---- Asking a question -----------------------------------------------------------------------------------------
  // The bank sends the buyer back with ?status=success|fail|return, but that is only a hint.
  const returnedFromBank = Boolean(bookingParam) && ['success', 'fail', 'return'].includes(statusParam);
  let checking = false;
  let askState = ''; // the message that replaces the form after a payment, kept when the language changes
  let draft = ''; // what the buyer has typed so far, kept when the page is redrawn
  const NOTE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/><path d="M9 12l2.2 2.2L15.5 10"/></svg>';

  const askHeader = () => `
    <h2>${escapeHtml(t('expert.askTitle').replace('{name}', expert.name))}</h2>
    <p class="ask-price"><strong>${WisecallAPI.formatPrice(expert.price)}</strong><span>${t('expert.priceLabel')}</span></p>`;
  const askNotes = () => `
    <ul class="ask-notes">
      <li>${NOTE_ICON}<span>${t('expert.refundNote')}</span></li>
      <li>${NOTE_ICON}<span>${t('expert.secureNote')}</span></li>
    </ul>`;

  // Ask our server to check the payment with the bank; only its answer decides what we show.
  async function confirmPayment() {
    checking = true;
    askArea().innerHTML = `<div class="booking-result"><p class="muted">${t('expert.confirmingPayment')}</p></div>`;
    let last = null;
    for (let i = 0; i < 20; i++) {
      try {
        const { booking } = await WisecallAPI.apiFetch(`/bookings/${bookingParam}/sync`, { method: 'POST' });
        last = booking;
        if (booking.status === 'paid' || booking.status === 'answered') {
          askState = `<div class="booking-result success"><div class="success-icon" aria-hidden="true">✓</div><p>${t('toast.questionSent')}</p><p class="muted small"><a href="/dashboard.html">${t('nav.dashboard')}</a></p></div>`;
          askArea().innerHTML = askState;
          return;
        }
        if (booking.status === 'expired' || booking.status === 'refunded') break;
        // The bank said the payment failed or was cancelled: no need to keep waiting.
        if (statusParam === 'fail' && i >= 2) break;
      } catch (e) { break; }
      await new Promise((r) => setTimeout(r, 1500));
    }
    checking = false;
    if (last && (last.status === 'expired' || statusParam === 'fail')) {
      renderAskForm();
      WisecallNav.showToast(t('expert.paymentFailed'));
      return;
    }
    askState = `<div class="booking-result"><p class="muted">${t('expert.paymentPending')}</p><p class="muted small"><a href="/dashboard.html">${t('nav.dashboard')}</a></p></div>`;
    askArea().innerHTML = askState;
  }

  function renderAskForm() {
    const area = askArea();
    if (!area) return;
    // Before launch nobody can pay, so the box offers the waiting list instead of the question form.
    if (WisecallI18n.launchMode() === 'prelaunch' && !(user && user.id === expert.id)) {
      area.innerHTML = `
        <h2>${t('expert.prelaunch.title')}</h2>
        <p class="ask-tip">${escapeHtml(t('expert.prelaunch.body').replace('{name}', expert.name))}</p>
        <div class="empty-wait">${WisecallWaitlist.html(expert.niche)}</div>`;
      WisecallWaitlist.wire(area);
      return;
    }
    if (!user) {
      const back = encodeURIComponent(location.pathname + location.search);
      area.innerHTML = `
        ${askHeader()}
        <p class="ask-tip">${t('expert.askTip')}</p>
        <div class="ask-login">
          <p class="muted" style="margin:0">${escapeHtml(t('expert.loginToAsk').replace('{name}', expert.name))}</p>
          <a class="btn btn-primary btn-block" href="/login.html?redirect=${back}">${t('nav.login')}</a>
          <a class="btn btn-outline btn-block" href="/signup.html?redirect=${back}">${t('nav.signup')}</a>
        </div>
        ${askNotes()}`;
      return;
    }
    if (user.id === expert.id) {
      area.innerHTML = `${askHeader()}<p class="muted">${t('expert.ownProfile')}</p>`;
      return;
    }
    area.innerHTML = `
      ${askHeader()}
      <p class="ask-tip">${t('expert.askTip')}</p>
      <form id="askForm" novalidate>
        <label for="question"><span>${t('expert.question.label')}</span>
          <textarea id="question" rows="5" maxlength="${MAX_QUESTION}" placeholder="${escapeHtml(t('expert.questionPlaceholder'))}" aria-describedby="qMeta askError" required></textarea>
        </label>
        <div class="q-meta" id="qMeta"><span>${t('expert.question.min').replace('{n}', MIN_QUESTION)}</span><span id="qCount"></span></div>
        <p class="form-error" id="askError" role="alert"></p>
        <button type="submit" class="btn btn-primary btn-block" id="askBtn">${t('expert.pay').replace('{price}', WisecallAPI.formatPrice(expert.price))}</button>
      </form>
      ${askNotes()}`;
    const box = document.getElementById('question');
    box.value = draft;
    box.addEventListener('input', () => { draft = box.value; });
    const count = () => {
      const n = box.value.length;
      const el = document.getElementById('qCount');
      el.textContent = `${n} / ${MAX_QUESTION}`;
      el.classList.toggle('over', n > MAX_QUESTION - 200);
    };
    box.addEventListener('input', count);
    count();
    document.getElementById('askForm').addEventListener('submit', onAsk);
  }

  async function onAsk(ev) {
    ev.preventDefault();
    const errorEl = document.getElementById('askError');
    errorEl.textContent = '';
    const question = document.getElementById('question').value.trim();
    if (question.length < MIN_QUESTION) { errorEl.textContent = t('expert.question.tooShort').replace('{n}', MIN_QUESTION); document.getElementById('question').focus(); return; }
    const submitBtn = document.getElementById('askBtn');
    submitBtn.disabled = true;
    try {
      const res = await WisecallAPI.apiFetch('/bookings', { method: 'POST', body: { mentorId: expert.id, question } });
      if (res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
        return;
      }
      // The server always answers with the bank's payment page; if it did not, something is wrong.
      throw new Error('no_checkout_url');
    } catch (e) {
      errorEl.textContent = e.message2 || t('expert.sendError');
      submitBtn.disabled = false;
    }
  }

  draw();
  if (returnedFromBank && user) confirmPayment();
  // Back from the bank, or a link to #ask: show the box straight away on a phone.
  if (phone.matches && (returnedFromBank || location.hash === '#ask') && !bar.hidden) sheet.open(bar.querySelector('#askOpen'));
  document.addEventListener('wisecall:lang-changed', draw);
})();
