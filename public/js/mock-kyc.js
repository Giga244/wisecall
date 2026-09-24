// The FAKE ID-check page (development only; the server does not serve it in production).
(async function () {
  await WisecallI18n.initI18n();
  const t = WisecallI18n.t;
  const sessionId = new URLSearchParams(location.search).get('session') || '';
  const form = document.getElementById('mockKycForm');
  const errorEl = document.getElementById('mockError');

  try {
    await WisecallAPI.apiFetch(`/mock-kyc/sessions/${encodeURIComponent(sessionId)}`);
  } catch (e) {
    errorEl.textContent = t('mockkyc.notFound');
    form.querySelector('button').disabled = true;
    return;
  }

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    errorEl.textContent = '';
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      const { redirect } = await WisecallAPI.apiFetch(`/mock-kyc/sessions/${encodeURIComponent(sessionId)}/complete`, {
        method: 'POST',
        body: { outcome: document.getElementById('outcome').value, fullName: document.getElementById('fullName').value, dateOfBirth: document.getElementById('dob').value }
      });
      window.location.href = redirect;
    } catch (e) {
      errorEl.textContent = t(e.code === 'missing_fields' ? 'mockkyc.needName' : 'toast.error');
      btn.disabled = false;
    }
  });
})();
