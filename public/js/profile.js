// A person's public profile, at /u/<username>: who they are (photo, headline, work or study, city, languages, bio, links) and,
// for a mentor, how they were checked, their reviews, and the box where a buyer writes a question and goes to pay at the bank.
(async function () {
  const params = new URLSearchParams(location.search);
  const username = (location.pathname.match(/^(?:\/ka)?\/u\/([\w-]+)/) || [])[1] || '';
  // Everything the page needs is asked for at the same moment (texts, who is signed in, the profile), not one after the other.
  const profileRequest = username ? WisecallAPI.apiFetch('/users/' + encodeURIComponent(username)).catch((e) => ({ error: e.code || 'error' })) : Promise.resolve({ error: 'not_found' });
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();
  const t = WisecallI18n.t;

  const page = document.getElementById('expertPage');
  const crumbs = document.getElementById('crumbs');
  const bookingParam = params.get('booking');
  const statusParam = params.get('status');
  const { questionMin: MIN_QUESTION, questionMax: MAX_QUESTION } = await WisecallI18n.getConfig(); // how long a question must be (the server decides)

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
  if (!answer.profile) {
    // Nobody by that name, or the request failed (then say so, with a way to try again: it is not "not found").
    if (answer.error && answer.error !== 'not_found') {
      // The server already wrote the profile into the page (name, role, bio: what search engines read, since robots.txt keeps them
      // away from /api/). Keep it, and offer to load the rest again.
      if (page.querySelector('.profile-ssr')) {
        page.setAttribute('aria-busy', 'false');
        page.querySelectorAll('[data-skeleton]').forEach((el) => el.remove()); // (what was on its way is not coming)
        page.insertAdjacentHTML('beforeend', `<p class="muted profile-retry">${t('profile.loadError')} <button type="button" class="linklike" data-retry>${t('common.retry')}</button></p>`);
        page.querySelector('[data-retry]').addEventListener('click', () => location.reload());
        return;
      }
      showMessage('profile.loadError', `<p><button type="button" class="btn btn-outline" data-retry>${t('common.retry')}</button></p>`);
      page.querySelector('[data-retry]').addEventListener('click', () => location.reload());
      return;
    }
    showMessage('profile.notFound');
    return;
  }
  // One object for the page: the person, plus (for a mentor) what buyers need.
  const expert = { ...answer.profile, ...(answer.profile.mentor || {}) };
  const isMentor = Boolean(answer.profile.isMentor);
  const isSelf = Boolean(user && user.id === expert.id);
  const liveOn = WisecallI18n.liveSessions(); // (live sessions switched on: their section and the Follow button)
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
      <div class="ask-bar-price"><strong>${WisecallAPI.formatPrice(expert.price)}</strong>${expert.price === 0 ? '' : `<span>${t('expert.priceLabel')}</span>`}</div>
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
      ${expert.niche ? (expert.niche === 'other' ? `<li><span>${escapeHtml(WisecallI18n.nicheName('other', expert.customNiche))}</span></li>` : `<li><a href="/advice/${encodeURIComponent(expert.niche)}">${escapeHtml(t('niche.' + expert.niche))}</a></li>`) : ''}` : ''}
      <li><span aria-current="page">${escapeHtml(expert.name)}</span></li>
    </ol>`;
  }
  // The main category first, then the extra ones; and "Lecturer" / "Practitioner" when they said how they mainly work.
  function fieldsHtml() {
    if (!isMentor) return '';
    const extra = (expert.extraNiches || []).filter((k) => k !== expert.niche);
    if (!extra.length && !expert.practiceKind) return '';
    return `<p class="profile-fields">${expert.practiceKind ? `<span class="chip-tag kind-tag">${escapeHtml(t('profile.kind.' + expert.practiceKind))}</span> ` : ''}${extra.length ? `<span class="muted small">${escapeHtml(t('profile.alsoIn'))}</span> ${extra.map((k) => `<a class="tag" href="/advice/${encodeURIComponent(k)}">${escapeHtml(t('niche.' + k))}</a>`).join(' ')}` : ''}</p>`;
  }

  // ---- The details every profile has: work or study, city, languages, links, member since -----------------------------
  const LINK_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';
  const monthYear = (d) => WisecallI18n.formatDate(d, { month: 'long', year: 'numeric' });
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
  const REVIEW_ART = `<svg viewBox="0 0 120 80" aria-hidden="true"><rect x="8" y="10" width="70" height="42" rx="14" style="fill:var(--accent)"/><path d="M24 50 Q20 64 10 68 Q34 66 40 50 Z" style="fill:var(--accent)"/><path d="M28 30l5 5 10-11" fill="none" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--on-accent)"/><rect x="52" y="30" width="58" height="36" rx="12" stroke-width="3.5" style="fill:var(--card);stroke:var(--ink)"/><path d="M72 40l4 8 9 1-7 6 2 9-8-4-8 4 2-9-7-6 9-1z" style="fill:var(--gold)"/></svg>`;

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
              ${WisecallRatings.askerBadgeHtml(expert.asker)}
              ${window.WisecallProfileView ? WisecallProfileView.topSkills(expert.sections) : ''}
              <div class="profile-tags">
                ${isMentor && expert.niche ? (expert.niche === 'other' ? `<span class="tag tag-niche">${escapeHtml(WisecallI18n.fieldName(expert))}</span>` : `<a class="tag tag-niche" href="/advice/${encodeURIComponent(expert.niche)}" title="${escapeHtml(t('niche.' + expert.niche))}">${escapeHtml(WisecallI18n.fieldName(expert))}</a>`) : ''}
                ${isMentor ? `<span class="tag tag-verified">${CHECK}${t('expert.verified')}</span>` : ''}
                ${isMentor && (expert.reviewCount || 0) < 3 ? `<span class="tag tag-new">${t('expert.newMentor')}</span>` : ''}
              </div>
              ${fieldsHtml()}
            </div>
          </div>
          ${isMentor && expert.username ? `<p class="profile-share">${WisecallCopy.button(location.origin + location.pathname)}</p>` : ''}
          ${isMentor && !isSelf && liveOn ? '<div class="profile-follow" id="profileFollow"></div>' : ''}
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

        ${window.WisecallProfileView ? WisecallProfileView.html(expert.sections) : ''}

        ${isMentor && (expert.badges || []).length ? `<section class="profile-section profile-checks" aria-labelledby="checksTitle"><h2 id="checksTitle">${t('expert.checks')}</h2>${WisecallBadges.full(expert.badges)}<p class="muted small" style="margin:10px 0 0">${t('expert.checksNote')} <a href="/how-we-verify.html">${t('hv.title')}</a></p></section>` : ''}

        ${isMentor && liveOn ? `<section class="profile-section profile-live" aria-labelledby="liveTitle" id="profileLive" hidden>
          <h2 id="liveTitle">${t('live.title')}</h2>
          <div id="profileLiveBody"></div>
        </section>` : ''}

        ${isMentor ? `<section class="profile-section profile-answers" aria-labelledby="answersTitle" id="publicAnswers" hidden>
          <h2 id="answersTitle">${t('pa.profile.title')}</h2>
          <div id="publicAnswersBody"></div>
        </section>` : ''}

        ${isMentor ? `<section class="profile-section profile-reviews" aria-labelledby="reviewsTitle">
          <h2 id="reviewsTitle">${t('expert.reviewsTitle')}</h2>
          <div id="reviewsBody"><span class="skeleton skeleton-line w80"></span><span class="skeleton skeleton-line w60"></span></div>
        </section>

        <div class="report-section">${WisecallReport.html(expert.id, null, Boolean(user))}</div>` : ''}
        ${user && !isSelf ? profileReportHtml() : ''}
      </div>`;
  }

  function draw() {
    const typed = document.getElementById('question');
    if (typed) draft = typed.value;
    document.title = isMentor ? `${expert.name}, ${expert.roleTitle || ''} — Wisecall`.replace(', —', ' —') : `${expert.name} — Wisecall`;
    crumbs.innerHTML = crumbsHtml();
    page.setAttribute('aria-busy', 'false');
    page.innerHTML = profileHtml();
    wireProfileReport();
    if (!isMentor) return;
    mountAsk();
    updateBar();
    WisecallReport.wire(page);
    WisecallCopy.wire(page);
    loadReviews();
    loadPublicAnswers();
    loadLive();
    const follow = document.getElementById('profileFollow');
    if (follow && window.WisecallFollow) WisecallFollow.mount(follow, expert.id, user);
    if (!checking && (!returnedFromBank || formBack)) renderAskForm(); else if (askState) askArea().innerHTML = askState + `<p class="need-help small"><a class="plain-link" href="/contact.html">${t('help.need')}</a></p>`;
  }
  const askArea = () => document.getElementById('askArea');
  // "Report this profile" (everyone signed in, any profile): a reason and a few words; an admin looks at it (server/profileSections.js).
  const REPORT_REASONS = ['fake', 'offensive', 'personal_info', 'spam', 'other'];
  const profileReportHtml = () => `<details class="ps-report small"><summary>${escapeHtml(t('profile.report.title'))}</summary>
    <form id="profileReportForm" novalidate>
      <label><span>${escapeHtml(t('live.dash.reportReason'))}</span><select name="reason">${REPORT_REASONS.map((r) => `<option value="${r}">${escapeHtml(t('profile.report.reason.' + r))}</option>`).join('')}</select></label>
      <label><span>${escapeHtml(t('live.dash.reportDetails'))}</span><textarea name="details" rows="2" maxlength="1000"></textarea></label>
      <button type="submit" class="btn btn-outline btn-sm">${escapeHtml(t('live.dash.reportSend'))}</button>
    </form></details>`;
  function wireProfileReport() {
    const f = document.getElementById('profileReportForm');
    if (!f) return;
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await WisecallAPI.apiFetch(`/users/${encodeURIComponent(expert.username)}/report`, { method: 'POST', body: { reason: f.reason.value, details: f.details.value } });
        WisecallNav.showToast(t('profile.report.sent'));
        f.closest('details').open = false;
      } catch (e) { WisecallNav.showToast(t(e.code === 'already_reported' ? 'profile.report.already' : 'toast.error')); }
    });
  }
  // ---- Reviews ------------------------------------------------------------------------------------------------
  // This mentor's upcoming live sessions (shown only when there are some).
  async function loadLive() {
    if (!liveOn) return; // (live sessions switched off)
    let d;
    let r = null;
    try {
      [d, r] = await Promise.all([WisecallAPI.apiFetch(`/live?mentor=${encodeURIComponent(expert.id)}&limit=6`), WisecallAPI.apiFetch(`/live/ratings/${encodeURIComponent(expert.id)}`).catch(() => null)]);
    } catch (e) { return; }
    const has = d.sessions && d.sessions.length;
    if (!has && !(r && r.count)) return;
    const prefix = WisecallI18n.getLang() === 'ka' ? '/ka' : '';
    document.getElementById('profileLiveBody').innerHTML = `${r && r.count ? `<p class="small"><strong>${escapeHtml(t('live.ratings.live').replace('{avg}', r.average).replace('{n}', r.count))}</strong></p>` : ''}
      ${has ? `<ul class="earn-list">${d.sessions.map((s) => `<li><span>${escapeHtml(WisecallI18n.formatDate(s.startsAt, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}</span>
      <span><a class="plain-link" href="${prefix}/live/${encodeURIComponent(s.slug)}">${escapeHtml(s.title)}</a><br><span class="muted small">${escapeHtml(t('live.kind.' + s.kind))}</span></span>
      <strong>${escapeHtml(WisecallAPI.formatAmount(s.priceNow))}</strong></li>`).join('')}</ul>` : ''}`;
    document.getElementById('profileLive').hidden = false;
  }
  // Answers this mentor and their askers agreed to publish (shown only when there are some).
  async function loadPublicAnswers() {
    let d;
    try { d = await WisecallAPI.apiFetch(`/answers?mentor=${encodeURIComponent(expert.id)}&limit=10`); } catch (e) { return; }
    if (!d.answers.length) return;
    const prefix = WisecallI18n.getLang() === 'ka' ? '/ka' : '';
    document.getElementById('publicAnswersBody').innerHTML = `<ul class="earn-list">${d.answers.map((a) => `<li>${a.sample ? `<span class="chip-tag answer-sample">${escapeHtml(t('pa.sample'))}</span> ` : ''}<a class="plain-link" href="${prefix}/answers/${encodeURIComponent(a.slug)}">${escapeHtml(a.question.length > 140 ? a.question.slice(0, 139) + '…' : a.question)}</a></li>`).join('')}</ul>`;
    document.getElementById('publicAnswers').hidden = false;
  }

  async function loadReviews() {
    const body = document.getElementById('reviewsBody');
    if (!body) return;
    let data;
    try { data = await WisecallAPI.apiFetch(`/experts/${expert.id}/reviews`); } catch (e) { body.innerHTML = `<p class="muted">${t('toast.error')}</p>`; return; }
    const { summary, reviews } = data;
    if (!summary.count) {
      body.innerHTML = `<div class="reviews-empty">${REVIEW_ART}<h3>${t('expert.reviews.empty.title')}</h3><p>${t('expert.reviews.empty.body')}</p></div>`;
      return;
    }
    // (the numbers count every revealed rating; the cards are the ones that came with a written review)
    body.innerHTML = `${WisecallRatings.summaryHtml(summary)}${reviews.map((r) => WisecallRatings.reviewCardHtml(r, { owner: isSelf, loggedIn: Boolean(user), mentorName: expert.name })).join('')}`;
    WisecallRatings.wireReplies(body, { reload: loadReviews });
    WisecallRatings.wireReports(body);
  }
  // ---- Asking a question -----------------------------------------------------------------------------------------
  // The bank sends the buyer back with ?status=success|fail|cancel|return, but that is only a hint (the server asks the bank).
  const returnedFromBank = Boolean(bookingParam) && ['success', 'fail', 'cancel', 'return'].includes(statusParam);
  let checking = false;
  let askState = ''; // the message that replaces the form after a payment, kept when the language changes
  let noticeKey = ''; // "Payment cancelled" / "Payment failed", shown above the form that comes back
  let formBack = false; // the payment did not happen: the form is shown again (also after the language changes)
  // What the buyer has typed so far, kept when the page is redrawn and (per mentor, for this visit) while they are at the bank, so a
  // cancelled or failed payment does not cost them their question.
  const draftKey = `wisecall_question_${expert.id}`;
  const stored = {
    get() { try { return sessionStorage.getItem(draftKey) || ''; } catch (e) { return ''; } },
    set(v) { try { if (v) sessionStorage.setItem(draftKey, v); else sessionStorage.removeItem(draftKey); } catch (e) { /* storage not available */ } }
  };
  let draft = stored.get();
  // A discount code from a live session (the link in its email or the dashboard adds ?code=...).
  const codeParam = /^WC-[A-Z0-9]{4}-[A-Z0-9]{4}$/i.test(params.get('code') || '') ? params.get('code').toUpperCase() : '';
  let appliedCode = null;
  let codeTried = false;
  const NOTE_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3z"/><path d="M9 12l2.2 2.2L15.5 10"/></svg>';

  const free = expert.price === 0;
  const askHeader = () => `
    <h2>${escapeHtml(t('expert.askTitle').replace('{name}', expert.name))}</h2>
    <p class="ask-price${free ? ' is-free' : ''}"><strong>${WisecallAPI.formatPrice(expert.price)}</strong>${free ? '' : `<span>${t('expert.priceLabel')}</span>`}</p>`;
  // (a free question has no bank and nothing to refund: docs/CLAUDE-CODE-FREE-ANSWERS.md)
  const askNotes = () => `
    <ul class="ask-notes">
      ${free ? `<li>${NOTE_ICON}<span>${t('expert.freeNote')}</span></li>` : `<li>${NOTE_ICON}<span>${t('expert.refundNote')}</span></li>
      <li>${NOTE_ICON}<span>${t('expert.secureNote')}</span></li>`}
    </ul>
    <p class="need-help small"><a class="plain-link" href="/contact.html">${t('help.need')}</a></p>`;

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
          stored.set(''); draft = ''; // it was sent: nothing to keep
          askState = `<div class="booking-result success"><div class="success-icon" aria-hidden="true">✓</div><p>${t('toast.questionSent')}</p><p class="muted small"><a href="/dashboard.html">${t('nav.dashboard')}</a></p></div>`;
          askArea().innerHTML = askState + `<p class="need-help small"><a class="plain-link" href="/contact.html">${t('help.need')}</a></p>`;
          return;
        }
        if (booking.status === 'expired' || booking.status === 'refunded') break;
        // The bank said the payment failed or was cancelled: no need to keep waiting.
        if ((statusParam === 'fail' || statusParam === 'cancel') && i >= 2) break;
      } catch (e) { break; }
      await new Promise((r) => setTimeout(r, 1500));
    }
    checking = false;
    if (last && (last.status === 'expired' || statusParam === 'fail' || statusParam === 'cancel')) {
      // Cancelled and failed are different things to the buyer: "you cancelled" vs "it did not go through". Either way nothing was charged,
      // and the question comes back in the form.
      noticeKey = statusParam === 'cancel' ? 'expert.paymentCancelled' : 'expert.paymentFailed';
      if (!draft) draft = stored.get() || (last.question || '');
      formBack = true;
      renderAskForm();
      WisecallNav.showToast(t(noticeKey));
      return;
    }
    askState = `<div class="booking-result"><p class="muted">${t('expert.paymentPending')}</p><p class="muted small"><a href="/dashboard.html">${t('nav.dashboard')}</a></p></div>`;
    askArea().innerHTML = askState + `<p class="need-help small"><a class="plain-link" href="/contact.html">${t('help.need')}</a></p>`;
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
    // An account from before the age rule answers it once, before a first question (the draft stays in this browser).
    if (user.needsAge) {
      const back = encodeURIComponent(location.pathname + location.search);
      area.innerHTML = `${askHeader()}<p class="muted">${escapeHtml(t('age.beforeAsking'))}</p><a class="btn btn-primary btn-block" href="/age-check.html?redirect=${back}">${escapeHtml(t('age.answerNow'))}</a>${askNotes()}`;
      return;
    }
    // This week's free questions are taken: back on Monday.
    if (free && expert.freeFull) {
      area.innerHTML = `${askHeader()}<p class="ask-full" role="status">${escapeHtml(t('expert.freeFull'))}</p>${askNotes()}`;
      return;
    }
    area.innerHTML = `
      ${askHeader()}
      ${noticeKey ? `<p class="pay-notice ${noticeKey === 'expert.paymentCancelled' ? 'cancelled' : 'failed'}" id="payNotice" role="status" tabindex="-1">${escapeHtml(t(noticeKey))}</p>` : ''}
      <p class="ask-tip">${t('expert.askTip')}</p>
      <form id="askForm" novalidate>
        <label for="question"><span>${t('expert.question.label')}</span>
          <textarea id="question" rows="5" maxlength="${MAX_QUESTION}" placeholder="${escapeHtml(t('expert.questionPlaceholder'))}" aria-describedby="qMeta askError" required></textarea>
        </label>
        <div class="q-meta" id="qMeta"><span id="qHelp"></span><span id="qCount"></span></div>
        ${free ? '' : `<details class="ask-code" id="askCodeBox"${codeParam ? ' open' : ''}><summary class="small">${t('expert.code.label')}</summary>
          <div class="ask-code-row"><label for="askCode" class="sr-only">${t('expert.code.label')}</label>
            <input type="text" id="askCode" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" value="${escapeHtml(appliedCode ? appliedCode.code : codeParam)}">
            <button type="button" class="btn btn-outline btn-sm" id="askCodeApply">${t('expert.code.apply')}</button></div>
          <p class="small" id="askCodeNote" role="status"></p>
        </details>`}
        ${!free && user.ageGroup === 'minor_16_17' ? `<label class="checkbox-row ask-payer" for="adultPayer"><input type="checkbox" id="adultPayer"> <span>${escapeHtml(t('expert.adultPayer'))}</span></label>` : ''}
        <p class="form-error" id="askError" role="alert"></p>
        <button type="submit" class="btn btn-primary btn-block" id="askBtn">${free ? t('expert.sendFree') : t('expert.pay').replace('{price}', WisecallAPI.formatPrice(expert.price))}</button>
      </form>
      ${askNotes()}`;
    if (!free) wireCode(); else WisecallTurnstile.watch(document.getElementById('askForm'));
    const box = document.getElementById('question');
    box.value = draft;
    box.addEventListener('input', () => { draft = box.value; stored.set(draft); });
    const count = () => {
      const n = WisecallAPI.textLength(box.value);
      const el = document.getElementById('qCount');
      el.textContent = `${n} / ${MAX_QUESTION}`;
      el.classList.toggle('over', n > MAX_QUESTION - 200);
      const help = document.getElementById('qHelp');
      help.textContent = n >= MIN_QUESTION ? t('expert.question.enough') : t('expert.question.needMore').replace('{left}', MIN_QUESTION - n);
      help.classList.toggle('ok', n >= MIN_QUESTION);
    };
    box.addEventListener('input', () => { document.getElementById('askError').textContent = ''; count(); });
    count();
    document.getElementById('askForm').addEventListener('submit', onAsk);
    const notice = document.getElementById('payNotice');
    if (notice && !checking) notice.focus({ preventScroll: false });
  }

  // A one-time code from a live session (15 % off a question to this mentor): checked by the server, which also sets the price paid.
  function wireCode() {
    const input = document.getElementById('askCode');
    const note = document.getElementById('askCodeNote');
    const btn = document.getElementById('askBtn');
    const show = () => {
      btn.textContent = t('expert.pay').replace('{price}', appliedCode ? WisecallAPI.formatAmount(appliedCode.amount) : WisecallAPI.formatPrice(expert.price));
      note.textContent = appliedCode ? t('expert.code.applied').replace('{percent}', appliedCode.percent).replace('{price}', WisecallAPI.formatAmount(appliedCode.amount)) : note.textContent;
    };
    const apply = async () => {
      const code = input.value.trim().toUpperCase();
      appliedCode = null;
      note.textContent = '';
      if (!code) { show(); return; }
      try {
        appliedCode = await WisecallAPI.apiFetch(`/live/discounts/check?code=${encodeURIComponent(code)}&mentor=${encodeURIComponent(expert.id)}`);
      } catch (e) {
        note.textContent = t('live.err.' + e.code) !== 'live.err.' + e.code ? t('live.err.' + e.code) : t('live.err.invalid_code');
      }
      show();
    };
    document.getElementById('askCodeApply').addEventListener('click', apply);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
    if (appliedCode) show(); else if (codeParam && !codeTried) { codeTried = true; apply(); }
  }

  async function onAsk(ev) {
    ev.preventDefault();
    const errorEl = document.getElementById('askError');
    errorEl.textContent = '';
    const question = document.getElementById('question').value.trim();
    if (WisecallAPI.textLength(question) < MIN_QUESTION) { errorEl.textContent = t('expert.question.tooShort').replace('{n}', MIN_QUESTION); document.getElementById('question').focus(); return; }
    const payer = document.getElementById('adultPayer');
    if (payer && !payer.checked) { errorEl.textContent = t('expert.adultPayerRequired'); payer.focus(); return; }
    const submitBtn = document.getElementById('askBtn');
    submitBtn.disabled = true;
    try {
      stored.set(question); // (kept while the buyer is at the bank)
      const form = document.getElementById('askForm');
      const res = await WisecallAPI.apiFetch('/bookings', { method: 'POST', body: { mentorId: expert.id, question, ...(payer ? { adultPayer: true } : {}), ...(appliedCode ? { discountCode: appliedCode.code } : {}), ...(free ? { turnstileToken: await WisecallTurnstile.token(form) } : {}) } });
      // A free question is sent at once: no bank.
      if (res.free) {
        stored.set(''); draft = '';
        askState = `<div class="booking-result success"><div class="success-icon" aria-hidden="true">✓</div><p>${t('toast.questionSent')}</p><p class="muted small"><a href="/dashboard.html">${t('nav.dashboard')}</a></p></div>`;
        askArea().innerHTML = askState + `<p class="need-help small"><a class="plain-link" href="/contact.html">${t('help.need')}</a></p>`;
        return;
      }
      if (res.checkoutUrl) {
        window.location.href = res.checkoutUrl;
        return;
      }
      // The server always answers with the bank's payment page; if it did not, something is wrong.
      throw new Error('no_checkout_url');
    } catch (e) {
      submitBtn.disabled = false;
      if (e.code === 'emergency') { showEmergencyHelp(); return; }
      if (e.code === 'adult_payer_required') { errorEl.textContent = t('expert.adultPayerRequired'); return; }
      if (e.code === 'age_required') { location.href = `/age-check.html?redirect=${encodeURIComponent(location.pathname + location.search)}`; return; }
      const limits = { too_many_unpaid: 'expert.err.tooManyUnpaid', too_many_bookings: 'expert.err.tooManyBookings', email_not_verified: 'expert.err.freeVerify', free_limit_mentor: 'expert.err.freeMentor', free_limit_total: 'expert.err.freeTotal', free_full: 'expert.freeFull' };
      if (free) { WisecallTurnstile.reset(document.getElementById('askForm')); const human = WisecallTurnstile.errorText(e.code); if (human) { errorEl.textContent = human; return; } }
      if (/^(invalid_code|code_)/.test(e.code || '')) { errorEl.textContent = t('live.err.' + e.code); appliedCode = null; return; }
      errorEl.textContent = e.code === 'question_too_short' ? t('expert.question.tooShort').replace('{n}', MIN_QUESTION)
        : (limits[e.code] ? t(limits[e.code]).replace('{n}', (e.data && e.data.max) || '') : (e.message2 || t('expert.sendError')));
    }
  }

  // The question sounded like an emergency: nothing was paid, and calm help is shown instead (the server decided; see server/safety.js).
  function showEmergencyHelp() {
    let box = document.getElementById('emergencyHelp');
    if (!box) {
      box = document.createElement('div');
      box.id = 'emergencyHelp';
      box.className = 'emergency-help';
      box.setAttribute('role', 'alert');
      box.tabIndex = -1;
      document.getElementById('askForm').insertAdjacentElement('beforebegin', box);
    }
    box.innerHTML = `
      <h3>${escapeHtml(t('safety.title'))}</h3>
      <p>${escapeHtml(t('safety.body'))}</p>
      <ul>
        <li><strong>112</strong> — ${escapeHtml(t('safety.112'))}</li>
        <li><strong>116 006</strong> — ${escapeHtml(t('safety.violence'))}</li>
      </ul>
      <p>${escapeHtml(t('safety.notAlone'))}</p>
      <p class="small muted">${escapeHtml(t('safety.notPaid'))}</p>`;
    box.focus();
  }

  draw();
  if (returnedFromBank && user) confirmPayment();
  // Back from the bank, or a link to #ask: show the box straight away on a phone.
  if (phone.matches && (returnedFromBank || location.hash === '#ask') && !bar.hidden) sheet.open(bar.querySelector('#askOpen'));
  document.addEventListener('wisecall:lang-changed', draw);
})();
