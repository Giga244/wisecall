(async function () {
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();
  const t = WisecallI18n.t;

  if (!user) {
    window.location.href = '/login.html?redirect=/dashboard.html';
    return;
  }

  const askedList = document.getElementById('askedList');
  const receivedList = document.getElementById('receivedList');
  const mentorSection = document.getElementById('mentorSection');

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function money(cents, currency) {
    return WisecallAPI.formatAmount(cents);
  }

  function fmtDate(d) {
    return new Date(d).toLocaleDateString(WisecallI18n.getLang() === 'ka' ? 'ka-GE' : 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Deadline, refund and payout information shown under a booking's question.
  function bookingNote(b, role) {
    let text = '';
    if (b.status === 'paid' && b.answerDeadline) {
      text = role === 'mentor'
        ? t('dash.deadline.mentor').replace('{date}', fmtDate(b.answerDeadline))
        : t('dash.deadline.seeker').replace('{name}', b.otherPartyName).replace('{date}', fmtDate(b.answerDeadline));
    } else if (b.status === 'refund_pending') {
      text = t('dash.refund.pending');
    } else if (b.status === 'refunded') {
      text = t(b.refundReason === 'no_answer_deadline' ? 'dash.refund.no_answer_deadline' : 'dash.refund.other');
    }
    return text ? `<p class="booking-note">${escapeHtml(text)}</p>` : '';
  }
  function statusLabel(status) {
    return t('dash.status.' + status) || status;
  }

  function renderAsked(list) {
    if (list.length === 0) {
      askedList.innerHTML = `<p class="muted">${t('dash.asked.empty')}</p>`;
      return;
    }
    askedList.innerHTML = list.map(b => `
      <div class="booking-card">
        <div class="booking-top">
          <div class="avatar" style="background:${b.otherPartyColor || '#6d4de0'}">${initials(b.otherPartyName)}</div>
          <div>
            <div class="card-name">${escapeHtml(b.otherPartyName)}</div>
            <span class="badge badge-${b.status}">${statusLabel(b.status)}</span>
          </div>
          <div class="booking-amount">${money(b.amount, b.currency)}</div>
        </div>
        <p class="booking-question">${escapeHtml(b.question)}</p>
        ${bookingNote(b, 'seeker')}
        ${b.answer ? `<div class="booking-answer"><strong>${t('dash.answer.label')}</strong> ${escapeHtml(b.answer)}</div>` : ''}
        ${b.status === 'answered' ? renderReviewArea(b) : ''}
      </div>
    `).join('');

    askedList.querySelectorAll('.review-form').forEach(form => {
      const stars = form.querySelectorAll('.star-btn');
      let selectedRating = 0;
      stars.forEach(star => {
        star.addEventListener('click', () => {
          selectedRating = Number(star.dataset.value);
          stars.forEach(s => s.classList.toggle('filled', Number(s.dataset.value) <= selectedRating));
        });
      });
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        if (!selectedRating) {
          WisecallNav.showToast(t('dash.review.pickStars'));
          return;
        }
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          await WisecallAPI.apiFetch(`/bookings/${form.dataset.id}/review`, {
            method: 'POST',
            body: { rating: selectedRating, review: form.querySelector('textarea').value.trim() }
          });
          WisecallNav.showToast(t('dash.review.sent'));
          load();
        } catch (e) {
          WisecallNav.showToast(t('toast.error'));
          btn.disabled = false;
        }
      });
    });
  }

  function renderReviewArea(b) {
    if (b.rating) {
      return `
        <div class="review-submitted">
          <span class="review-stars">${'★'.repeat(b.rating)}${'☆'.repeat(5 - b.rating)}</span>
          ${b.review ? `<p class="review-text">${escapeHtml(b.review)}</p>` : ''}
        </div>
      `;
    }
    return `
      <form class="review-form" data-id="${b.id}">
        <p class="muted small" style="margin: 10px 0 6px">${t('dash.review.prompt')}</p>
        <div class="star-picker">
          ${[1, 2, 3, 4, 5].map(n => `<button type="button" class="star-btn" data-value="${n}">★</button>`).join('')}
        </div>
        <textarea rows="2" placeholder="${t('dash.review.placeholder')}"></textarea>
        <button type="submit" class="btn btn-outline btn-sm">${t('dash.review.submit')}</button>
      </form>
    `;
  }

  function renderReceived(list) {
    if (list.length === 0) {
      receivedList.innerHTML = `<p class="muted">${t('dash.received.empty')}</p>`;
      return;
    }
    receivedList.innerHTML = list.map(b => `
      <div class="booking-card">
        <div class="booking-top">
          <div class="avatar" style="background:${b.otherPartyColor || '#6d4de0'}">${initials(b.otherPartyName)}</div>
          <div>
            <div class="card-name">${escapeHtml(b.otherPartyName)}</div>
            <span class="badge badge-${b.status}">${statusLabel(b.status)}</span>
          </div>
          <div class="booking-amount">
            ${money(b.mentorNetAmount, b.currency)}
            <span class="muted small">(${t('dash.fee.note')}: ${money(b.platformFeeAmount, b.currency)})</span>
          </div>
        </div>
        <p class="booking-question">${escapeHtml(b.question)}</p>
        ${bookingNote(b, 'mentor')}
        ${b.answer
          ? `<div class="booking-answer"><strong>${t('dash.answer.label')}</strong> ${escapeHtml(b.answer)}</div>`
          : (b.status === 'paid' ? `
            <form class="answer-form" data-id="${b.id}">
              <textarea rows="3" placeholder="${t('dash.answer.placeholder')}" required minlength="2"></textarea>
              <button type="submit" class="btn btn-primary btn-sm">${t('dash.answer.send')}</button>
            </form>
          ` : '')}
      </div>
    `).join('');

    receivedList.querySelectorAll('.answer-form').forEach(form => {
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const textarea = form.querySelector('textarea');
        const btn = form.querySelector('button');
        btn.disabled = true;
        try {
          await WisecallAPI.apiFetch(`/bookings/${form.dataset.id}/answer`, {
            method: 'POST',
            body: { answer: textarea.value.trim() }
          });
          WisecallNav.showToast(t('toast.answerSent'));
          load();
        } catch (e) {
          WisecallNav.showToast(t('toast.error'));
          btn.disabled = false;
        }
      });
    });
  }

  function initials(name) {
    return (name || '?').split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  }

  // What the mentor has earned, what is payable, and the bank transfers already made.
  async function loadEarnings() {
    const box = document.getElementById('earnings');
    try {
      const e = await WisecallAPI.apiFetch('/me/earnings');
      const b = e.balance;
      const day = (d) => fmtDate(d);
      const itemNote = (i) => {
        if (i.status === 'void') return t('dash.earnings.void');
        if (i.status === 'paid') {
          const base = t('dash.earnings.paidOn').replace('{date}', i.paidAt ? day(i.paidAt) : '').replace('{ref}', i.reference || '');
          return i.owedBack ? `${base} · ${t(i.owedBackSettled ? 'dash.earnings.owedSettled' : 'dash.earnings.owedBack')}` : base;
        }
        return new Date(i.payableAt) <= new Date() ? t('dash.earnings.payableNow') : t('dash.earnings.payableFrom').replace('{date}', day(i.payableAt));
      };
      box.innerHTML = `
        <div class="earn-cards">
          <div class="earn-card"><span>${t('dash.earnings.available')}</span><strong>${money(Math.max(b.net, 0))}</strong></div>
          <div class="earn-card"><span>${t('dash.earnings.holding').replace('{days}', e.holdDays)}</span><strong>${money(b.holding)}</strong></div>
          <div class="earn-card"><span>${t('dash.earnings.paid')}</span><strong>${money(b.paid)}</strong></div>
          ${b.debt > 0 ? `<div class="earn-card warn"><span>${t('dash.earnings.debt')}</span><strong>${money(b.debt)}</strong></div>` : ''}
        </div>
        <p class="muted small">${t('dash.earnings.note').replace('{days}', e.holdDays)}</p>
        ${e.batches.length ? `
          <h3 class="earn-h">${t('dash.earnings.history')}</h3>
          <ul class="earn-list">${e.batches.map(x => `<li><span>${day(x.paidAt)}</span><span>${escapeHtml(x.reference)}</span><strong>${money(x.amount)}</strong></li>`).join('')}</ul>` : ''}
        ${e.items.length ? `
          <h3 class="earn-h">${t('dash.earnings.items')}</h3>
          <ul class="earn-list">${e.items.map(i => `<li><span>${escapeHtml(i.question)}</span><span class="muted small">${escapeHtml(itemNote(i))}</span><strong>${money(i.amount)}</strong></li>`).join('')}</ul>` : `<p class="muted">${t('dash.earnings.empty')}</p>`}
      `;
    } catch (err) {
      box.innerHTML = `<p class="muted">${t('toast.error')}</p>`;
    }
  }

  async function load() {
    try {
      const data = await WisecallAPI.apiFetch('/bookings/mine');
      renderAsked(data.asked);
      if (user.role === 'mentor' || user.role === 'both') {
        mentorSection.style.display = 'block';
        renderReceived(data.received);
        loadEarnings();
      }
    } catch (e) {
      askedList.innerHTML = `<p class="muted">${t('toast.error')}</p>`;
    }
  }

  document.addEventListener('wisecall:lang-changed', load);
  load();
})();
