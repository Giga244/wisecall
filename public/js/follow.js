// The Follow button for a mentor (on their profile and on their live sessions' pages). Followers get an email when the mentor publishes
// a live session, at most one a week per mentor; every such email has a one-click "unfollow" link.
window.WisecallFollow = (function () {
  async function mount(el, mentorId, user) {
    const t = WisecallI18n.t;
    let st = { following: false, followers: 0 };
    try { st = await WisecallAPI.apiFetch(`/live/follows/${encodeURIComponent(mentorId)}`); } catch (e) { /* the button still works */ }
    const draw = () => {
      el.textContent = '';
      const b = document.createElement('button');
      b.type = 'button';
      b.className = st.following ? 'btn btn-outline btn-sm' : 'btn btn-primary btn-sm';
      b.setAttribute('aria-pressed', String(Boolean(st.following)));
      b.textContent = t(st.following ? 'follow.following' : 'follow.follow');
      b.addEventListener('click', async () => {
        if (!user) { window.location.href = '/login.html?redirect=' + encodeURIComponent(location.pathname); return; }
        b.disabled = true;
        try {
          st = await WisecallAPI.apiFetch(`/live/follows/${encodeURIComponent(mentorId)}`, { method: st.following ? 'DELETE' : 'POST' });
          draw();
          WisecallNav.showToast(t(st.following ? 'follow.done' : 'follow.undone'));
        } catch (e) { b.disabled = false; WisecallNav.showToast(t('toast.error')); }
      });
      const n = document.createElement('span');
      n.className = 'muted small follow-count';
      n.textContent = st.followers ? t('follow.count').replace('{n}', st.followers) : '';
      const hint = document.createElement('p');
      hint.className = 'hint';
      hint.textContent = t('follow.hint');
      el.append(b, ' ', n, hint);
    };
    draw();
  }
  return { mount };
})();
