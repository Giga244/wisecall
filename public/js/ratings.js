// Two-way ratings in the pages: the "Rate your mentor" / "Rate this asker" panel on a question in the dashboard, and on a mentor's
// profile the summary, the written reviews with the mentor's reply, and the report link. The rules (double-blind, edit until
// revealed, 30 days to rate) are enforced by the server; this only draws what the server says a person may see.
window.WisecallRatings = (function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fill = (s, vars) => Object.keys(vars).reduce((out, k) => out.split('{' + k + '}').join(vars[k]), s);
  const TAGS = { asker: ['helpful', 'detailed', 'clear', 'fast'], mentor: ['clear_question', 'gave_context', 'respectful', 'thankful'] };
  const REPORT_REASONS = ['abusive', 'false', 'personal_info', 'spam', 'other'];
  const locale = () => (WisecallI18n.getLang() === 'ka' ? 'ka-GE' : 'en-GB');
  const dateOf = (d) => WisecallI18n.formatDate(d, { day: 'numeric', month: 'long', year: 'numeric' });

  const stars = (n) => `<span class="review-stars" role="img" aria-label="${esc(fill(t('expert.reviews.stars'), { n }))}">${'★'.repeat(n)}${'☆'.repeat(5 - n)}</span>`;
  const tagList = (tags) => (tags && tags.length ? `<ul class="tag-list">${tags.map((g) => `<li class="chip-tag">${esc(t('rate.tag.' + g))}</li>`).join('')}</ul>` : '');

  // ---- The rating form -------------------------------------------------------------------------------------------------
  function formHtml(b, v, editing) {
    const asker = v.role === 'asker';
    const mine = editing ? v.mine : null;
    const id = esc(b.id);
    return `
      <form class="rate-form" data-booking="${id}" data-role="${v.role}" data-stars="${mine ? mine.stars : 0}" novalidate>
        <p class="muted small rate-hint">${esc(fill(t(asker ? 'rate.mentor.hint' : 'rate.asker.hint'), { name: b.otherPartyName }))}</p>
        <fieldset class="rate-stars">
          <legend>${t(asker ? 'rate.mentor.stars' : 'rate.asker.stars')}</legend>
          <div class="star-picker" role="group">${[1, 2, 3, 4, 5].map((n) => `<button type="button" class="star-btn${mine && n <= mine.stars ? ' filled' : ''}" data-value="${n}" aria-label="${esc(fill(t('expert.reviews.stars'), { n }))}" aria-pressed="${mine ? mine.stars === n : false}">★</button>`).join('')}</div>
        </fieldset>
        <fieldset class="rate-tags">
          <legend>${t('rate.tags.label')}</legend>
          <div class="tag-checks">${TAGS[v.role].map((g) => `<label class="check-chip" for="rt-${id}-${g}"><input type="checkbox" id="rt-${id}-${g}" value="${g}"${mine && mine.tags.includes(g) ? ' checked' : ''}><span>${esc(t('rate.tag.' + g))}</span></label>`).join('')}</div>
        </fieldset>
        <label for="rate-text-${id}"><span>${t(asker ? 'rate.review.label' : 'rate.note.label')}</span>
          <textarea id="rate-text-${id}" rows="3" maxlength="1000" placeholder="${esc(t(asker ? 'rate.review.placeholder' : 'rate.note.placeholder'))}">${esc(mine ? (asker ? mine.review : mine.privateNote) : '')}</textarea>
          <span class="hint">${t(asker ? 'rate.review.hint' : 'rate.note.hint')}</span>
        </label>
        <p class="form-error rate-error" role="alert"></p>
        <div class="rate-actions">
          <button type="submit" class="btn btn-primary btn-sm">${t(mine ? 'rate.update' : 'rate.submit')}</button>
          ${editing ? `<button type="button" class="btn btn-ghost btn-sm rate-cancel">${t('rate.cancel')}</button>` : ''}
        </div>
      </form>`;
  }

  const mineHtml = (v) => `
    <div class="rate-mine">
      <p class="rate-label">${t('rate.yours')}</p>
      ${stars(v.mine.stars)} ${tagList(v.mine.tags)}
      ${v.role === 'asker' && v.mine.review ? `<p class="review-text">${esc(v.mine.review)}</p>` : ''}
      ${v.role === 'mentor' && v.mine.privateNote ? `<p class="muted small"><strong>${t('rate.note.label')}:</strong> ${esc(v.mine.privateNote)}</p>` : ''}
      ${v.mine.reply ? `<div class="review-reply"><strong>${esc(fill(t('rate.reply.from'), { name: v.otherName }))}</strong><p>${esc(v.mine.reply)}</p></div>` : ''}
    </div>`;

  function replyFormHtml(ratingId) {
    return `
      <details class="reply-box">
        <summary>${t('rate.reply.summary')}</summary>
        <form class="reply-form" data-rating="${esc(ratingId)}" novalidate>
          <p class="muted small">${t('rate.reply.hint')}</p>
          <label for="reply-${esc(ratingId)}"><span class="sr-only">${t('rate.reply.summary')}</span>
            <textarea id="reply-${esc(ratingId)}" rows="3" maxlength="1000" placeholder="${esc(t('rate.reply.placeholder'))}"></textarea>
          </label>
          <p class="form-error reply-error" role="alert"></p>
          <button type="submit" class="btn btn-outline btn-sm">${t('rate.reply.send')}</button>
        </form>
      </details>`;
  }

  function theirsHtml(b, v) {
    const th = v.theirs;
    return `
      <div class="rate-theirs">
        <p class="rate-label">${esc(fill(t('rate.theirs'), { name: b.otherPartyName }))}</p>
        ${stars(th.stars)} ${tagList(th.tags)}
        ${th.review ? `<p class="review-text">${esc(th.review)}</p>` : ''}
        ${th.review && th.reply ? `<div class="review-reply"><strong>${esc(fill(t('rate.reply.from'), { name: v.meName || '' }))}</strong><p>${esc(th.reply)}</p></div>` : ''}
        ${th.review && !th.reply && v.role === 'mentor' ? replyFormHtml(th.id) : ''}
        ${v.role === 'asker' || th.review ? reportHtml(th.id, true) : ''}
      </div>`;
  }

  // What a person sees of a question's ratings: the form, or "saved and private", or both ratings.
  function panel(b, me) {
    const v = b.rating;
    if (!v || !v.rateable) return '';
    v.otherName = b.otherPartyName;
    v.meName = me ? me.name : '';
    const asker = v.role === 'asker';
    let body = '';
    if (v.mine && v.mine.revealed) {
      body = v.theirs
        ? `<p class="muted small">${t('rate.revealed')}</p>${mineHtml(v)}${theirsHtml(b, v)}`
        : `<p class="muted small">${esc(fill(t('rate.revealedOne'), { name: b.otherPartyName }))}</p>${mineHtml(v)}`;
    } else if (v.mine) {
      body = `
        <p class="muted small">${esc(fill(t('rate.waiting'), { name: b.otherPartyName, date: dateOf(v.revealsAt) }))}</p>
        ${mineHtml(v)}
        ${v.canRate ? `<button type="button" class="btn btn-ghost btn-sm rate-change">${t('rate.change')}</button><div class="rate-edit" hidden>${formHtml(b, v, true)}</div>` : ''}`;
    } else if (v.canRate) {
      body = `<p class="muted small">${esc(fill(t('rate.blind'), { date: dateOf(v.revealsAt) }))}</p>${v.theirs ? theirsHtml(b, v) : ''}${formHtml(b, v, false)}`;
    } else {
      body = `<p class="muted small">${t('rate.closed')}</p>${v.theirs ? theirsHtml(b, v) : ''}`;
    }
    const prompt = v.canRate && !v.mine;
    return `<section class="rate-card${prompt ? ' rate-prompt' : ''}" aria-label="${esc(t(asker ? 'dash.rate.mentorTitle' : 'dash.rate.askerTitle'))}"><h2 class="rate-h">${t(asker ? 'dash.rate.mentorTitle' : 'dash.rate.askerTitle')}</h2>${body}</section>`;
  }

  // ---- Wiring (call after the HTML is on the page) -----------------------------------------------------------------------
  const RATE_ERRORS = { invalid_rating: 'rate.pickStars', already_revealed: 'rate.err.revealed', window_closed: 'rate.err.closed', review_too_long: 'rate.err.tooLong', note_too_long: 'rate.err.tooLong', not_rateable: 'rate.err.notRateable' };

  function wire(root, { reload } = {}) {
    root.querySelectorAll('.rate-form').forEach((form) => {
      if (form.dataset.wired) return;
      form.dataset.wired = '1';
      let value = Number(form.dataset.stars || 0);
      const buttons = form.querySelectorAll('.star-btn');
      const paint = () => buttons.forEach((s) => { const n = Number(s.dataset.value); s.classList.toggle('filled', n <= value); s.setAttribute('aria-pressed', String(n === value)); });
      buttons.forEach((s) => s.addEventListener('click', () => { value = Number(s.dataset.value); paint(); form.querySelector('.rate-error').textContent = ''; }));
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const error = form.querySelector('.rate-error');
        error.textContent = '';
        if (!value) { error.textContent = t('rate.pickStars'); return; }
        const asker = form.dataset.role === 'asker';
        const text = form.querySelector('textarea').value.trim();
        const body = { stars: value, tags: Array.from(form.querySelectorAll('.tag-checks input:checked')).map((i) => i.value), ...(asker ? { review: text } : { privateNote: text }) };
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
          await WisecallAPI.apiFetch(`/bookings/${form.dataset.booking}/ratings`, { method: 'POST', body });
          WisecallNav.showToast(t('rate.saved'));
          if (reload) reload();
        } catch (e) {
          error.textContent = t(RATE_ERRORS[e.code] || 'rate.err.generic');
          button.disabled = false;
          if ((e.code === 'already_revealed' || e.code === 'window_closed') && reload) setTimeout(reload, 1500);
        }
      });
      const cancel = form.querySelector('.rate-cancel');
      if (cancel) cancel.addEventListener('click', () => { const edit = form.closest('.rate-edit'); edit.hidden = true; edit.parentNode.querySelector('.rate-change').hidden = false; });
    });
    root.querySelectorAll('.rate-change').forEach((btn) => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', () => { btn.hidden = true; const edit = btn.parentNode.querySelector('.rate-edit'); edit.hidden = false; const first = edit.querySelector('.star-btn'); if (first) first.focus(); });
    });
    wireReplies(root, { reload });
    wireReports(root);
  }

  function wireReplies(root, { reload } = {}) {
    root.querySelectorAll('.reply-form').forEach((form) => {
      if (form.dataset.wired) return;
      form.dataset.wired = '1';
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const error = form.querySelector('.reply-error');
        error.textContent = '';
        const text = form.querySelector('textarea').value.trim();
        if (!text) { error.textContent = t('rate.reply.err.generic'); return; }
        const button = form.querySelector('button');
        button.disabled = true;
        try {
          await WisecallAPI.apiFetch(`/ratings/${form.dataset.rating}/reply`, { method: 'POST', body: { body: text } });
          WisecallNav.showToast(t('rate.reply.sent'));
          if (reload) reload();
        } catch (e) {
          error.textContent = t(e.code === 'already_replied' ? 'rate.reply.err.already' : 'rate.reply.err.generic');
          button.disabled = false;
        }
      });
    });
  }

  // ---- "Report this review" ----------------------------------------------------------------------------------------------
  function reportHtml(ratingId, loggedIn) {
    if (!loggedIn) {
      const back = encodeURIComponent(window.location.pathname + window.location.search);
      return `<p class="report-login"><a href="/login.html?redirect=${back}">${t('report.review.login')}</a></p>`;
    }
    const id = esc(ratingId);
    return `
      <details class="report-box rreport-box" data-rating="${id}">
        <summary>${t('report.review.link')}</summary>
        <form class="report-form" novalidate>
          <p class="muted small">${t('report.review.intro')}</p>
          <label for="rr-reason-${id}"><span>${t('report.review.reason')}</span>
            <select id="rr-reason-${id}" name="reason">${REPORT_REASONS.map((r) => `<option value="${r}">${t('report.review.reason.' + r)}</option>`).join('')}</select>
          </label>
          <label for="rr-details-${id}"><span>${t('report.review.details')}</span><textarea id="rr-details-${id}" name="details" rows="3" maxlength="1000"></textarea></label>
          <p class="form-error report-error" role="alert"></p>
          <button class="btn btn-outline btn-sm" type="submit">${t('report.review.send')}</button>
        </form>
      </details>`;
  }

  function wireReports(root) {
    root.querySelectorAll('.rreport-box').forEach((box) => {
      const form = box.querySelector('form');
      if (form.dataset.wired) return;
      form.dataset.wired = '1';
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const error = form.querySelector('.report-error');
        const button = form.querySelector('button');
        error.textContent = '';
        button.disabled = true;
        try {
          await WisecallAPI.apiFetch(`/ratings/${box.dataset.rating}/report`, { method: 'POST', body: { reason: form.reason.value, details: form.details.value.trim() } });
          box.innerHTML = `<p class="muted small" role="status">${t('report.review.sent')}</p>`;
        } catch (e) {
          error.textContent = t(e.code === 'already_reported' ? 'report.review.already' : 'report.review.error');
          button.disabled = false;
        }
      });
    });
  }

  // ---- A mentor's profile: summary and reviews ---------------------------------------------------------------------------
  function summaryHtml(s) {
    const counts = [5, 4, 3, 2, 1].map((n) => s.distribution[n] || 0);
    const tags = Object.entries(s.tags || {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])); // (the same order every time)
    return `
      <div class="review-summary">
        <div><strong>${s.avg}</strong><div class="review-stars" aria-hidden="true">${'★'.repeat(Math.round(s.avg))}${'☆'.repeat(5 - Math.round(s.avg))}</div><span class="muted small">${s.count === 1 ? t('rate.reviews.oneRating') : fill(t('rate.reviews.ratings'), { n: s.count })}</span></div>
        <div class="review-bars" aria-hidden="true">${counts.map((c, i) => `<div class="review-bar"><span>${5 - i}★</span><i><b style="width:${Math.round((c / s.count) * 100)}%"></b></i><span>${c}</span></div>`).join('')}</div>
      </div>
      ${tags.length ? `<div class="rate-tag-summary"><h3>${t('rate.reviews.tags')}</h3><ul class="tag-list">${tags.map(([g, n]) => `<li class="chip-tag">${esc(t('rate.tag.' + g))} <b>${n}</b></li>`).join('')}</ul></div>` : ''}`;
  }

  function reviewCardHtml(r, { owner, loggedIn, mentorName }) {
    const who = r.reviewer
      ? `<a class="reviewer" href="/u/${encodeURIComponent(r.reviewer.username)}">${WisecallAPI.avatar(r.reviewer, { cls: 'avatar-sm', size: 36 })}<span>${esc(r.reviewer.name)}</span></a>`
      : `<span class="reviewer"><span class="avatar avatar-sm avatar-anon" aria-hidden="true">?</span><span>${t('rate.reviews.anonymous')}</span></span>`;
    return `
      <article class="review-card" data-rating="${esc(r.id)}">
        <div class="review-top">${who}${stars(r.stars)}<span class="muted small">${dateOf(r.at)}</span></div>
        ${tagList(r.tags)}
        <p class="review-text">${esc(r.review)}</p>
        ${r.reply ? `<div class="review-reply"><strong>${esc(fill(t('rate.reply.from'), { name: mentorName }))}</strong><p>${esc(r.reply.body)}</p></div>` : ''}
        ${owner && !r.reply ? replyFormHtml(r.id) : ''}
        ${owner ? '' : reportHtml(r.id, loggedIn)}
      </article>`;
  }

  // ---- The friendly badge on an asker's profile, and the asker's rating on a question in the mentor's dashboard ----------------
  function askerBadgeHtml(a) {
    if (!a) return '';
    const label = t(a.great ? 'rate.asker.great' : 'rate.asker.label');
    const tags = a.topTags.map((x) => t('rate.tag.' + x.tag)).join(', ');
    return `<p class="asker-badge"><span class="asker-pill${a.great ? ' great' : ''}">${esc(fill(t('rate.asker.badge'), { label, avg: a.avg, n: a.count }))}</span></p>${tags ? `<p class="muted small asker-tags">${esc(fill(t('rate.asker.tags'), { tags }))}</p>` : ''}`;
  }
  function askerLineHtml(a) {
    if (!a) return `<p class="asker-line muted small">${t('dash.rate.newAsker')}</p>`;
    const tags = a.topTags.map((x) => t('rate.tag.' + x.tag)).join(', ');
    return `<p class="asker-line muted small">${esc(fill(t('dash.rate.askerRating'), { avg: a.avg, n: a.count }))}${tags ? ' · ' + esc(tags) : ''}</p>`;
  }

  return { panel, wire, wireReplies, wireReports, reportHtml, summaryHtml, reviewCardHtml, askerBadgeHtml, askerLineHtml, stars, tagList };
})();
