// The "tell me when Wisecall opens / when a mentor in my field joins" form, shared by the home page (Browse experts: the "Wisecall
// opens soon" card before launch, the empty list after it), a field's page and the expert profile. It has no heading of its own: the
// card or panel around it says what it is for. A sign-up turns it into a "you're on the list" note of the same height, so nothing around
// it moves.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // The fields, in the order shown (the niche list from the server).
  const fields = () => WisecallI18n.niches().map((n) => n.key);
  const prelaunch = () => WisecallI18n.launchMode() === 'prelaunch';

  const CHECK = '<svg class="waitlist-check" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><circle cx="24" cy="24" r="22" stroke-width="2.5"/><path d="M14 25l7 7 13-15" fill="none" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // The question the visitor typed in the home page's search before launch (docs/CLAUDE-CODE-UX-WALKTHROUGH.md E): it stays in sight in
  // the form, its field is chosen from it, and it is kept with the sign-up (wanted_question: shown to our team without the email).
  let question = '';
  let questionField = null;

  let counter = 0;
  function html(niche) {
    const n = ++counter;
    const chosen = questionField || niche || 'any';
    const opt = (k) => `<option value="${k}"${k === chosen ? ' selected' : ''}>${esc(k === 'any' ? t('wait.any') : t('niche.' + k))}</option>`;
    // (the 6 fields people wait for most first, then the rest under "Other fields")
    const top = WisecallI18n.popularFields().filter((k) => fields().includes(k)).slice(0, 6);
    const rest = fields().filter((k) => !top.includes(k));
    const options = opt('any') + (top.length ? top.map(opt).join('') + `<optgroup label="${esc(t('wait.otherFields'))}">${rest.map(opt).join('')}</optgroup>` : fields().map(opt).join(''));
    return `
      <form class="waitlist-form" novalidate>
        <p class="waitlist-question"${question ? '' : ' hidden'}><span>${esc(t('wait.question'))}</span> <q>${esc(question)}</q><small>${esc(t('wait.questionNote'))}</small></p>
        <div class="waitlist-row">
          <label for="wl${n}-email"><span>${t('wait.email')}</span><input id="wl${n}-email" type="email" name="email" maxlength="254" autocomplete="email" inputmode="email" required></label>
          <label for="wl${n}-niche"><span>${t('wait.niche')}</span><select id="wl${n}-niche" name="niche">${options}</select></label>
        </div>
        <button class="btn btn-primary waitlist-submit" type="submit">${t('wait.submit')}</button>
        <p class="hint waitlist-hint">${t('wait.consent')} <a href="/privacy.html">${t('footer.privacy')}</a></p>
        <p class="form-error waitlist-error" role="alert"></p>
      </form>`;
  }

  function wire(root) {
    root.querySelectorAll('.waitlist-form').forEach((form) => {
      if (form.dataset.wired) return;
      form.dataset.wired = '1';
      const human = window.WisecallTurnstile;
      if (human) human.watch(form);
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const error = form.querySelector('.waitlist-error');
        error.textContent = '';
        const email = form.email.value.trim();
        if (!form.email.checkValidity() || !email) { error.textContent = t('wait.error'); form.email.focus(); return; }
        const button = form.querySelector('button');
        button.disabled = true;
        try {
          const joined = await WisecallAPI.apiFetch('/waitlist', { method: 'POST', body: { email, niche: form.niche.value, language: WisecallI18n.getLang(), wantedQuestion: question || undefined, turnstileToken: human ? await human.token(form) : undefined } });
          // (the note keeps the form's height: the card around it does not jump)
          const done = document.createElement('div');
          done.className = 'waitlist-done';
          done.setAttribute('role', 'status');
          // ("You're #N on the list" and a link to pass on: docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 5)
          const place = joined && joined.position ? `<strong class="waitlist-place">${esc(t('wait.position').replace('{n}', joined.position))}.</strong> ` : '';
          const share = joined && joined.share ? ` <button type="button" class="linklike waitlist-share" data-share="${esc(joined.share)}">${esc(t('wait.share'))}</button>` : '';
          done.innerHTML = `${CHECK}<p>${place}${esc(t(prelaunch() ? 'wait.prelaunch.done' : 'wait.done'))}${share}</p>`;
          done.style.minHeight = `${form.offsetHeight}px`;
          form.replaceWith(done);
          const sb = done.querySelector('[data-share]');
          if (sb) sb.addEventListener('click', async () => {
            const url = sb.dataset.share;
            try {
              if (navigator.share) await navigator.share({ title: 'Wisecall', text: t('wait.shareText'), url });
              else { await navigator.clipboard.writeText(url); WisecallNav.showToast(t('wait.copied')); }
            } catch (e) { /* (closed, or no clipboard) */ }
          });
        } catch (e) {
          error.textContent = (human && human.errorText(e.code)) || t(e.code === 'invalid_email' ? 'wait.error' : 'toast.error');
          if (human) human.reset(form);
          button.disabled = false;
        }
      });
    });
  }

  // The home page's search, before launch: keep the words, pick the closest field, and show both in every waiting-list form on the page.
  async function ask(text) {
    question = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    questionField = null;
    const draw = () => document.querySelectorAll('.waitlist-form').forEach((form) => {
      const box = form.querySelector('.waitlist-question');
      if (box) { box.hidden = !question; box.querySelector('q').textContent = question; }
      if (questionField && form.niche) form.niche.value = questionField;
    });
    draw();
    if (!question) return;
    try {
      const r = await WisecallAPI.apiFetch('/niches/suggest?q=' + encodeURIComponent(question));
      if (r.niche && fields().includes(r.niche)) { questionField = r.niche; draw(); }
    } catch (e) { /* the visitor chooses the field */ }
  }

  // On a phone before launch, the form is in the hero too, above the fold (the "Wisecall opens soon" card is far below on a small screen).
  function hero() {
    const box = document.getElementById('heroWait');
    if (!box || !prelaunch() || box.dataset.ready) return;
    box.dataset.ready = '1';
    box.innerHTML = `<p class="hero-wait-lead">${esc(t('wait.hero'))}</p>${html()}`;
    wire(box);
    box.hidden = false;
  }
  WisecallI18n.ready.then(hero).catch(() => {});

  window.WisecallWaitlist = { fields, html, wire, ask };
})();
