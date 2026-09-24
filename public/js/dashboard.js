(async function () {
  await SagelyI18n.initI18n();
  const user = await SagelyNav.initNav();
  const t = SagelyI18n.t;

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
    return `$${(cents / 100).toFixed(2)} ${(currency || 'usd').toUpperCase()}`;
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
          SagelyNav.showToast(t('dash.review.pickStars'));
          return;
        }
        const btn = form.querySelector('button[type="submit"]');
        btn.disabled = true;
        try {
          await SagelyAPI.apiFetch(`/bookings/${form.dataset.id}/review`, {
            method: 'POST',
            body: { rating: selectedRating, review: form.querySelector('textarea').value.trim() }
          });
          SagelyNav.showToast(t('dash.review.sent'));
          load();
        } catch (e) {
          SagelyNav.showToast(t('toast.error'));
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
          await SagelyAPI.apiFetch(`/bookings/${form.dataset.id}/answer`, {
            method: 'POST',
            body: { answer: textarea.value.trim() }
          });
          SagelyNav.showToast(t('toast.answerSent'));
          load();
        } catch (e) {
          SagelyNav.showToast(t('toast.error'));
          btn.disabled = false;
        }
      });
    });
  }

  function initials(name) {
    return (name || '?').split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  }

  async function load() {
    try {
      const data = await SagelyAPI.apiFetch('/bookings/mine');
      renderAsked(data.asked);
      if (user.role === 'mentor' || user.role === 'both') {
        mentorSection.style.display = 'block';
        renderReceived(data.received);
      }
    } catch (e) {
      askedList.innerHTML = `<p class="muted">${t('toast.error')}</p>`;
    }
  }

  document.addEventListener('sagely:lang-changed', load);
  load();
})();
