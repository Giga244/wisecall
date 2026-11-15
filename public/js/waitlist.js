// The "tell me when Wisecall opens / when a mentor in my field joins" form, shared by the home page (before launch, the hero: the page's
// one waiting list; after it, the empty list in Browse experts), a field's page and the expert profile. It has no heading of its own: the
// card or panel around it says what it is for. A sign-up turns it into a "you're on the list" note of the same height, so nothing around
// it moves.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // The fields, in the order shown (the niche list from the server).
  const fields = () => WisecallI18n.fields().map((f) => f.id);
  const fieldLabel = (id) => WisecallI18n.nameIn(WisecallI18n.fields().find((f) => f.id === id));
  const prelaunch = () => WisecallI18n.launchMode() === 'prelaunch';

  const CHECK = '<svg class="waitlist-check" viewBox="0 0 48 48" width="48" height="48" aria-hidden="true"><circle cx="24" cy="24" r="22" stroke-width="2.5"/><path d="M14 25l7 7 13-15" fill="none" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // The question the visitor typed in the home page's search before launch (docs/CLAUDE-CODE-UX-WALKTHROUGH.md E): it stays in sight in
  // the form, its field is chosen from it, and it is kept with the sign-up (wanted_question: shown to our team without the email).
  let question = '';
  let questionField = null;

  // (drawn, not an emoji: the emoji envelope is a white rectangle on the coral button)
  const ICONS = { mail: '<svg class="waitlist-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m3.5 7.5 8.5 6 8.5-6"/></svg>' };

  let counter = 0;
  // opts.submit: another word for the button (an empty field: "notify me when a mentor appears"). opts.icon: 'mail' draws an envelope after it.
  // opts.compact: the home page's hero before launch (docs/CLAUDE-CODE-NEW-HOME.md 4): the email and "ჩაეწერე სიაში" on one line; the field is
  // chosen with the hero's chips (a hidden field, "any field" until one is tapped), and the "16 or older" box under them.
  function html(niche, opts = {}) {
    const n = ++counter;
    const chosen = questionField || WisecallI18n.fieldOfNiche(niche) || 'any';
    if (opts.compact) {
      return `
      <form class="waitlist-form waitlist-compact" novalidate>
        <div class="wlc-row">
          <label for="wl${n}-email" class="wlc-email"><span class="sr-only">${t('wait.email')}</span><input id="wl${n}-email" type="email" name="email" maxlength="254" autocomplete="email" inputmode="email" placeholder="${esc(t('home2.wait.placeholder'))}" required></label>
          <button class="btn btn-primary waitlist-submit" type="submit">${esc(t('home2.wait.button'))}</button>
        </div>
        <div class="turnstile-slot"></div>
        <input type="hidden" name="niche" value="${esc(chosen)}">
        <p class="form-error waitlist-error" role="alert"></p>
        <div class="wlc-consent">
          <label class="checkbox-row waitlist-age" for="wl${n}-age"><input id="wl${n}-age" type="checkbox" name="over16" required> <span>${esc(t('wait.over16'))}</span></label>
          <span class="wlc-sep" aria-hidden="true">·</span>
          <a class="wlc-privacy" href="/privacy.html">${t('footer.privacy')}</a>
          <details class="wlc-why"><summary aria-label="${esc(t('wait.consentMore'))}">?</summary><p class="hint waitlist-hint">${t('wait.consent')}</p></details>
        </div>
      </form>`;
    }
    const opt = (k) => `<option value="${k}"${k === chosen ? ' selected' : ''}>${esc(k === 'any' ? t('wait.any') : fieldLabel(k))}</option>`;
    // (the fields people wait for most first, then the rest under "Other fields")
    const top = [...new Set(WisecallI18n.popularFields().map(WisecallI18n.fieldOfNiche).filter(Boolean))].slice(0, 6);
    const rest = fields().filter((k) => !top.includes(k));
    const options = opt('any') + (top.length ? top.map(opt).join('') + `<optgroup label="${esc(t('wait.otherFields'))}">${rest.map(opt).join('')}</optgroup>` : fields().map(opt).join(''));
    return `
      <form class="waitlist-form" novalidate>
        <p class="waitlist-question"${question ? '' : ' hidden'}><span>${esc(t('wait.question'))}</span> <q>${esc(question)}</q><small>${esc(t('wait.questionNote'))}</small></p>
        <div class="waitlist-row">
          <label for="wl${n}-email"><span>${t('wait.email')}</span><input id="wl${n}-email" type="email" name="email" maxlength="254" autocomplete="email" inputmode="email" required></label>
          <label for="wl${n}-niche"><span>${t('wait.niche')}</span><select id="wl${n}-niche" name="niche">${options}</select></label>
        </div>
        <div class="turnstile-slot"></div>
        <label class="checkbox-row waitlist-age" for="wl${n}-age"><input id="wl${n}-age" type="checkbox" name="over16" required> <span>${esc(t('wait.over16'))}</span></label>
        <button class="btn btn-primary waitlist-submit" type="submit">${esc(opts.submit || t('wait.submit'))}${ICONS[opts.icon] || ''}</button>
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
        if (!form.over16.checked) { error.textContent = t('wait.over16Required'); form.over16.focus(); return; }
        const button = form.querySelector('button');
        button.disabled = true;
        try {
          const joined = await WisecallAPI.apiFetch('/waitlist', { method: 'POST', body: { email, niche: form.niche.value, language: WisecallI18n.getLang(), wantedQuestion: question || undefined, over16: true, turnstileToken: human ? await human.token(form) : undefined } });
          // (the note keeps the form's height: the card around it does not jump)
          const done = document.createElement('div');
          done.className = 'waitlist-done';
          done.setAttribute('role', 'status');
          // ("You're #N on the list" and a link to pass on: docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md part 5)
          const place = joined && joined.position ? `<strong class="waitlist-place">${esc(t('wait.position').replace('{n}', joined.position))}.</strong> ` : '';
          const share = joined && joined.share ? ` <button type="button" class="linklike waitlist-share" data-share="${esc(joined.share)}">${esc(t('wait.share'))}</button>` : '';
          done.innerHTML = `${CHECK}<p>${place}${esc(t(prelaunch() ? 'wait.thanks' : 'wait.done'))}${share}</p>`;
          done.style.minHeight = `${form.offsetHeight}px`;
          form.replaceWith(done);
          // (the home page's live counter shows one more at once: public/js/landing.js)
          document.dispatchEvent(new CustomEvent('wisecall:waitlist-joined'));
          // (follow us meanwhile: Instagram, TikTok, Facebook, as set on the server; docs/CLAUDE-CODE-NEW-HOME.md 4)
          if (window.WisecallSocial && WisecallI18n.getConfig) WisecallI18n.getConfig().then((cfg) => {
            const icons = WisecallSocial.html(cfg && cfg.social);
            if (icons) done.insertAdjacentHTML('beforeend', `<div class="waitlist-follow"><span>${esc(t('wait.follow'))}</span><ul class="footer-social social-inline">${icons}</ul></div>`);
          }).catch(() => {});
          const sb = done.querySelector('[data-share]');
          if (sb) sb.addEventListener('click', async () => {
            const url = sb.dataset.share;
            try {
              if (navigator.share) await navigator.share({ title: 'Wisecall', text: t('wait.shareText'), url });
              else { await navigator.clipboard.writeText(url); WisecallNav.showToast(t('wait.copied')); }
            } catch (e) { /* (closed, or no clipboard) */ }
          });
        } catch (e) {
          error.textContent = (human && human.errorText(e.code)) || t({ invalid_email: 'wait.error', age_required: 'wait.over16Required' }[e.code] || 'toast.error');
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
      const field = WisecallI18n.fieldOfNiche(r.niche);
      if (field) { questionField = field; draw(); }
    } catch (e) { /* the visitor chooses the field */ }
  }

  // Before launch the form is in the hero, above the fold at every width: the home page's one waiting list
  // (docs/CLAUDE-CODE-HOME-ONE-WAITLIST.md, docs/CLAUDE-CODE-NEW-HOME.md 4; it takes the place of the skeleton the page arrives with).
  function hero() {
    const box = document.getElementById('heroWait');
    if (!box || !prelaunch() || box.dataset.ready) return;
    box.dataset.ready = '1';
    box.innerHTML = html(undefined, { compact: true });
    wire(box);
  }
  const ready = WisecallI18n.ready.then(hero);
  ready.catch(() => {});

  // A field chosen somewhere else on the page (the home page's tiles) becomes the hero form's field; what the visitor typed stays.
  function chooseField(niche) {
    ready.then(() => {
      const form = document.querySelector('#heroWait .waitlist-form');
      const field = niche === 'any' ? 'any' : WisecallI18n.fieldOfNiche(niche);
      if (form && field) form.niche.value = field;
    }).catch(() => {});
  }

  // Scroll to the hero's form and (unless told not to) put the cursor in its email; after a sign-up, to the "you're on the list" note.
  function goToHero(opts) {
    ready.then(() => {
      const box = document.getElementById('heroWait');
      if (!box) return;
      box.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      const email = box.querySelector('input[type=email]');
      if (email && !(opts && opts.focus === false)) email.focus({ preventScroll: true });
    }).catch(() => {});
  }

  window.WisecallWaitlist = { fields, html, wire, ask, chooseField, goToHero };
})();
