// The Follow button for a mentor (on their profile and on their live sessions' pages). Followers get an email when the mentor publishes
// a live session, at most one a week per mentor; every such email has a one-click "unfollow" link.
window.WisecallFollow = (function () {
  async function mount(el, mentorId, user) {
    const t = WisecallI18n.t;
    let st = { following: false, followers: 0 };
    const b = document.createElement('button');
    b.type = 'button';
    const n = document.createElement('span');
    n.className = 'muted small follow-count';
    const hint = document.createElement('p');
    hint.className = 'muted small follow-hint';
    const draw = () => {
      b.className = st.following ? 'btn btn-outline btn-sm' : 'btn btn-primary btn-sm';
      b.setAttribute('aria-pressed', String(Boolean(st.following)));
      b.textContent = t(st.following ? 'follow.following' : 'follow.follow');
      n.textContent = st.followers ? t(st.followers === 1 ? 'follow.count.one' : 'follow.count').replace('{n}', st.followers) : '';
      hint.textContent = t('follow.hint');
    };
    // This person's state is asked for at once; the button is drawn before the answer (so nothing below it moves when it arrives),
    // and a click waits for it.
    const known = WisecallAPI.apiFetch(`/live/follows/${encodeURIComponent(mentorId)}`).then((s) => { st = s; draw(); }).catch(() => { /* the button still works */ });
    b.addEventListener('click', async () => {
      await known;
      if (!user) { window.location.href = '/login.html?redirect=' + encodeURIComponent(location.pathname); return; }
      b.disabled = true;
      try {
        st = await WisecallAPI.apiFetch(`/live/follows/${encodeURIComponent(mentorId)}`, { method: st.following ? 'DELETE' : 'POST' });
        draw();
        WisecallNav.showToast(t(st.following ? 'follow.done' : 'follow.undone'));
      } catch (e) { WisecallNav.showToast(t('toast.error')); }
      b.disabled = false;
    });
    el.textContent = '';
    el.append(b, ' ', n, hint);
    draw();
    await known;
  }
  return { mount };
})();
