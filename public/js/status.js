// The /status page: asks /api/status (every minute while the page is open) and shows each part in plain words.
(async function () {
  await WisecallI18n.initI18n();
  await WisecallNav.initNav();
  const t = WisecallI18n.t;
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ORDER = ['website', 'database', 'jobs', 'payments', 'idChecks', 'email'];
  const TONE = { ok: 'answered', starting: 'pending_payment', delayed: 'pending_payment', not_open: 'badge-muted', off: 'badge-muted', down: 'rejected' };
  let data = null;
  function draw() {
    if (!data) return;
    document.getElementById('statusSummary').textContent = t('status.overall.' + data.status);
    document.getElementById('statusList').innerHTML = ORDER.filter((k) => data.components[k]).map((k) => {
      const c = data.components[k];
      return `<li><span>${esc(t('status.c.' + k))}</span><span class="badge badge-${TONE[c.status] || 'badge-muted'}">${esc(t('status.s.' + c.status))}</span></li>`;
    }).join('');
    document.getElementById('statusChecked').textContent = t('status.checked').replace('{time}', new Date(data.checkedAt).toLocaleTimeString(WisecallI18n.getLang() === 'ka' ? 'ka-GE' : 'en-GB'));
  }
  async function load() {
    try { data = await fetch('/api/status', { cache: 'no-store' }).then((r) => r.json()); } catch (e) { data = { status: 'down', checkedAt: new Date().toISOString(), components: { website: { status: 'down' } } }; }
    draw();
  }
  await load();
  setInterval(load, 60000);
  document.addEventListener('wisecall:lang-changed', draw);
})();
