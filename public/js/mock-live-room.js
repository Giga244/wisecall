// The fake video room (development and tests): shows what a real video service would enforce from the token the server signed.
(async function () {
  const params = new URLSearchParams(location.search);
  const box = document.getElementById('fakeRoom');
  const row = (k, v) => { const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = v; dd.dataset.key = k; box.append(dt, dd); };
  let info;
  try {
    const res = await fetch(`/api/live-fake/check?room=${encodeURIComponent(params.get('room') || '')}&t=${encodeURIComponent(params.get('t') || '')}`);
    info = await res.json();
  } catch (e) { info = { ok: false, error: 'network' }; }
  if (!info.ok) { row('result', `refused: ${info.error}`); return; }
  row('result', 'joined');
  row('name', info.userName);
  row('role', info.owner ? 'owner' : 'participant');
  row('canSend', (info.canSend || []).join(',') || 'nothing (watch and listen)');
  row('room', info.room);
})();
