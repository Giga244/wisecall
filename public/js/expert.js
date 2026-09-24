(async function () {
  await WisecallI18n.initI18n();
  const user = await WisecallNav.initNav();

  const page = document.getElementById('expertPage');
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  const bookingParam = params.get('booking');
  const statusParam = params.get('status');

  if (!id) {
    page.innerHTML = `<p class="muted">${WisecallI18n.t('expert.notSpecified')}</p>`;
    return;
  }

  function initials(name) {
    return name.split(' ').map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  let expert;
  try {
    const data = await WisecallAPI.apiFetch(`/experts/${id}`);
    expert = data.expert;
  } catch (e) {
    page.innerHTML = `<p class="muted">${WisecallI18n.t('expert.notFound')}</p>`;
    return;
  }

  const t = WisecallI18n.t;

  const ratingLine = expert.ratingAvg
    ? `★ ${expert.ratingAvg} (${expert.reviewCount} ${t('expert.reviewsShort')})`
    : t('expert.noReviewsYet');

  page.innerHTML = `
    <div class="expert-hero">
      <div class="avatar avatar-lg" style="background:${expert.color || '#6d4de0'}">${initials(expert.name)}</div>
      <div>
        <h1>${escapeHtml(expert.name)}</h1>${(expert.reviewCount || 0) < 3 ? `<span class="badge badge-paid">${t('expert.newMentor')}</span>` : ''}
        <p class="muted">${escapeHtml(expert.roleTitle || '')}</p>
        <p class="rating">${ratingLine}</p>
        <p class="muted small">${t('expert.answeredCount').replace('{n}', expert.answeredCount || 0)}</p>
      </div>
    </div>
    <p class="expert-bio">${escapeHtml(expert.bio || '')}</p>

    <div class="ask-card" id="askCard">
      <div class="ask-card-head">
        <span>${t('expert.ask')}</span>
        <span class="price">${WisecallAPI.formatPrice(expert.price)}<span> ${t('expert.perQuestion')}</span></span>
      </div>
      <div id="askArea"></div>
    </div>

    <div class="reviews-section" id="reviewsSection"></div>
  `;

  loadReviews();

  async function loadReviews() {
    const section = document.getElementById('reviewsSection');
    try {
      const data = await WisecallAPI.apiFetch(`/experts/${id}/reviews`);
      if (data.reviews.length === 0) {
        section.innerHTML = '';
        return;
      }
      section.innerHTML = `
        <h2 class="reviews-title">${t('expert.reviewsTitle')}</h2>
        ${data.reviews.map(r => `
          <div class="review-card">
            <div class="review-top">
              <span class="review-stars">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</span>
              <span class="muted small">${escapeHtml(r.reviewerName)}</span>
            </div>
            ${r.review ? `<p class="review-text">${escapeHtml(r.review)}</p>` : ''}
          </div>
        `).join('')}
      `;
    } catch (e) { /* reviews are optional */ }
  }

  const askArea = document.getElementById('askArea');

  // The bank sends the buyer back with ?status=success|fail|return, but that is only a hint.
  const returnedFromBank = Boolean(bookingParam) && ['success', 'fail', 'return'].includes(statusParam);
  let checking = false;

  // Ask our server to check the payment with the bank; only its answer decides what we show.
  async function confirmPayment() {
    checking = true;
    askArea.innerHTML = `<div class="booking-result"><p class="muted">${t('expert.confirmingPayment')}</p></div>`;
    let last = null;
    for (let i = 0; i < 20; i++) {
      try {
        const { booking } = await WisecallAPI.apiFetch(`/bookings/${bookingParam}/sync`, { method: 'POST' });
        last = booking;
        if (booking.status === 'paid' || booking.status === 'answered') {
          askArea.innerHTML = `<div class="booking-result success"><div class="success-icon">✓</div><p>${t('toast.questionSent')}</p><p class="muted small"><a href="/dashboard.html">${t('nav.dashboard')}</a></p></div>`;
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
    askArea.innerHTML = `<div class="booking-result"><p class="muted">${t('expert.paymentPending')}</p><p class="muted small"><a href="/dashboard.html">${t('nav.dashboard')}</a></p></div>`;
  }

  if (returnedFromBank && user) {
    confirmPayment();
  } else {
    renderAskForm();
  }

  document.addEventListener('wisecall:lang-changed', () => {
    const headSpan = document.querySelector('.ask-card-head span');
    if (headSpan) headSpan.textContent = t('expert.ask');
    if (!checking && !returnedFromBank) renderAskForm();
  });
  function renderAskForm() {
    if (!user) {
      askArea.innerHTML = `
        <p class="muted">${t('expert.loginToAsk').replace('{name}', () => escapeHtml(expert.name))}</p>
        <a class="btn btn-primary btn-block" href="/login.html?redirect=${encodeURIComponent(location.pathname + location.search)}">${t('nav.login')}</a>
      `;
      return;
    }
    if (user.id === expert.id) {
      askArea.innerHTML = `<p class="muted">${t('expert.ownProfile')}</p>`;
      return;
    }
    askArea.innerHTML = `
      <form id="askForm">
        <label>
          <textarea id="question" rows="4" required minlength="5" placeholder="${t('expert.questionPlaceholder')}"></textarea>
        </label>
        <p class="form-error" id="askError"></p>
        <button type="submit" class="btn btn-primary btn-block">${t('expert.ask')} — ${WisecallAPI.formatPrice(expert.price)}</button>
      </form>
    `;
    document.getElementById('askForm').addEventListener('submit', onAsk);
  }

  async function onAsk(ev) {
    ev.preventDefault();
    const errorEl = document.getElementById('askError');
    errorEl.textContent = '';
    const question = document.getElementById('question').value.trim();
    const submitBtn = ev.target.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const res = await WisecallAPI.apiFetch('/bookings', {
        method: 'POST',
        body: { mentorId: expert.id, question }
      });
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
})();
