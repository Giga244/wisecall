// Pieces of the home page that are not the expert list: the field tiles, the FAQ accordion and the
// empty-list art (main.js shows it when there is nobody to list yet; the waiting-list form is in waitlist.js).
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // The fields under the hero: a grid of tiles, each a link to Browse experts filtered by that field (the niches come from the server; an
  // admin can add more). Every tile is drawn; the stylesheet shows only full rows until "See all" is pressed: 6 on phones (2 columns),
  // 9 on tablets (3), 8 on small laptops (4) and 10 on desktops (5). Opening and closing animate the grid's height (not with reduced motion).
  // A name never breaks inside a word: a tile whose longest word is wider than one column (a long Georgian word such as
  // სტუმარმასპინძლობა), or whose name would need more than three lines, takes two columns, and the grid fills the gap with the next
  // tile. Measured after drawing, on resize, once the fonts have loaded and when the grid opens.
  let stripOpen = false;
  const iconOf = (key) => { const n = WisecallI18n.niches().find((x) => x.key === key); return n ? n.icon : 'spark'; };
  const icon = (key, size) => WisecallNicheIcons.svg(iconOf(key), size);
  const ROWS = [['(min-width: 1280px)', 10], ['(min-width: 1024px)', 8], ['(min-width: 640px)', 9]];
  const firstShown = () => { for (const [q, n] of ROWS) if (window.matchMedia(q).matches) return n; return 6; };
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function drawStrip() {
    const list = document.getElementById('nicheStrip');
    if (!list) return;
    const all = WisecallI18n.niches();
    list.classList.toggle('is-open', stripOpen);
    list.innerHTML = all.map((n) => `
      <li><a class="field-tile" href="/index.html?niche=${encodeURIComponent(n.key)}#experts" data-niche-link="${esc(n.key)}">${icon(n.key, 22)}<span>${esc(t('niche.' + n.key))}</span></a></li>`).join('');
    const more = document.getElementById('fieldsMore');
    if (more) {
      more.hidden = all.length <= firstShown();
      more.textContent = stripOpen ? t('home.fields.less') : t('home.fields.more').replace('{n}', all.length);
      more.setAttribute('aria-expanded', String(stripOpen));
      more.classList.toggle('btn-arrow', !stripOpen);
    }
    fitTiles();
    drawHero();
  }
  function fitTiles() {
    const list = document.getElementById('nicheStrip');
    if (!list) return;
    const items = [...list.children];
    items.forEach((li) => li.classList.remove('is-wide'));
    const wide = items.filter((li) => {
      const node = li.querySelector('.field-tile span');
      const text = node && node.firstChild;
      if (!text || !li.offsetWidth) return false; // (hidden until "See all")
      const lines = (range) => new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
      const whole = document.createRange();
      whole.selectNodeContents(text);
      if (lines(whole) > 3) return true;
      let at = 0;
      return text.textContent.split(' ').some((word) => {
        const range = document.createRange();
        range.setStart(text, at);
        range.setEnd(text, at + word.length);
        at += word.length + 1;
        return lines(range) > 1;
      });
    });
    wide.forEach((li) => li.classList.add('is-wide'));
  }
  function toggleStrip() {
    const list = document.getElementById('nicheStrip');
    const more = document.getElementById('fieldsMore');
    const from = list.offsetHeight;
    stripOpen = !stripOpen;
    more.textContent = stripOpen ? t('home.fields.less') : t('home.fields.more').replace('{n}', WisecallI18n.niches().length);
    more.setAttribute('aria-expanded', String(stripOpen));
    more.classList.toggle('btn-arrow', !stripOpen);
    // (closing: the tiles stay until the grid has shrunk; opening: they appear, and the grid grows to show them)
    if (stripOpen) { list.classList.add('is-open'); fitTiles(); }
    const to = stripOpen ? list.offsetHeight : (() => { list.classList.remove('is-open'); const h = list.offsetHeight; list.classList.add('is-open'); return h; })();
    const done = () => {
      list.classList.toggle('is-open', stripOpen);
      list.style.height = '';
      list.style.overflow = '';
      list.style.transition = '';
      if (!stripOpen && more.getBoundingClientRect().top < 0) more.scrollIntoView({ block: 'center' });
    };
    if (reduceMotion() || from === to) { done(); return; }
    list.style.overflow = 'hidden';
    list.style.height = `${from}px`;
    list.getBoundingClientRect(); // (the starting height, before the transition)
    list.style.transition = 'height 0.35s var(--ease-out)';
    list.style.height = `${to}px`;
    let finished = false;
    const finish = () => { if (!finished) { finished = true; done(); } };
    list.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 600);
  }
  document.addEventListener('click', (ev) => { if (ev.target.closest('#fieldsMore')) toggleStrip(); });
  let fitting = false;
  window.addEventListener('resize', () => {
    const more = document.getElementById('fieldsMore');
    if (more) more.hidden = WisecallI18n.niches().length <= firstShown();
    if (!fitting) { fitting = true; requestAnimationFrame(() => { fitting = false; fitTiles(); }); }
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTiles);

  // The hero: the first few fields as chips, and the band of field names that scrolls by (the list twice, so the loop has no seam;
  // the band is decoration, hidden from screen readers: the same fields are links in the strip and in Browse experts).
  const HERO_CHIPS = 5;
  function drawHero() {
    const all = WisecallI18n.niches();
    const chips = document.getElementById('heroChips');
    if (chips) chips.innerHTML = all.slice(0, HERO_CHIPS).map((n) => `<li><a class="chip" href="/index.html?niche=${encodeURIComponent(n.key)}#experts" data-niche-link="${esc(n.key)}">${esc(t('niche.' + n.key))}</a></li>`).join('');
    const track = document.getElementById('marqueeTrack');
    if (track && all.length) {
      const one = `<span class="marquee-set">${all.map((n) => `<span>${esc(t('niche.' + n.key))}</span><span class="marquee-star">✳</span>`).join('')}</span>`;
      track.innerHTML = one + one;
    }
  }

  // The hero's search: the words go into Browse experts' own search, and the page scrolls there (before launch, to the waiting list).
  function initHeroSearch() {
    const form = document.getElementById('heroSearch');
    if (!form) return;
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const q = form.q.value.trim();
      const box = document.getElementById('searchInput');
      if (box && q && WisecallI18n.launchMode() !== 'prelaunch') { box.value = q; box.dispatchEvent(new Event('input', { bubbles: true })); }
      document.getElementById('experts').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  }
  initHeroSearch();

  // ---- FAQ accordion: buttons with aria-expanded, arrow keys move between questions --------------------------
  function toggleFaq(btn, open) {
    const next = open === undefined ? btn.getAttribute('aria-expanded') !== 'true' : open;
    btn.setAttribute('aria-expanded', String(next));
    document.getElementById(btn.getAttribute('aria-controls')).hidden = !next;
    btn.closest('.faq-item').classList.toggle('open', next);
  }
  function initFaq() {
    const list = document.getElementById('faqList');
    if (!list) return;
    const buttons = Array.from(list.querySelectorAll('.faq-q'));
    buttons.forEach((b) => b.addEventListener('click', () => toggleFaq(b)));
    list.addEventListener('keydown', (ev) => {
      const i = buttons.indexOf(document.activeElement);
      if (i < 0) return;
      const move = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: buttons.length - 1 }[ev.key];
      if (move === undefined) return;
      ev.preventDefault();
      buttons[(move + buttons.length) % buttons.length].focus();
    });
  }

  // A soft illustration for the empty list: two speech bubbles and a spark. Decorative only.
  const EMPTY_ART = `
    <svg class="empty-art" viewBox="0 0 220 150" aria-hidden="true">
      <circle cx="46" cy="118" r="22" style="fill:var(--c-sun)"/>
      <circle cx="188" cy="30" r="14" style="fill:var(--c-mint)"/>
      <rect x="18" y="20" width="120" height="70" rx="22" style="fill:var(--accent)"/>
      <path d="M44 88 Q40 108 26 116 Q56 114 66 90 Z" style="fill:var(--accent)"/>
      <circle cx="54" cy="55" r="7" style="fill:var(--on-accent)"/><circle cx="78" cy="55" r="7" style="fill:var(--on-accent)"/><circle cx="102" cy="55" r="7" style="fill:var(--on-accent)"/>
      <rect x="96" y="66" width="106" height="62" rx="20" stroke-width="4" style="fill:var(--card);stroke:var(--ink)"/>
      <path d="M176 126 Q184 142 200 146 Q170 146 160 128 Z" stroke-width="4" stroke-linejoin="round" style="fill:var(--card);stroke:var(--ink)"/>
      <path d="M122 98l12 12 26-28" fill="none" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" style="stroke:var(--accent2)"/>
    </svg>`;

  // ---- Example answers: on phones a row you swipe, with dots (from 640px it is a plain grid) -----------------------
  function initExamples() {
    const grid = document.querySelector('.example-grid');
    if (!grid || grid.dataset.ready) return;
    grid.dataset.ready = '1';
    const cards = Array.from(grid.querySelectorAll('.example-card'));
    const phone = window.matchMedia('(max-width: 639px)');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    const dots = document.createElement('div');
    dots.className = 'ex-dots';
    grid.after(dots);

    const label = (i) => t('ex.dot').replace('{n}', i + 1).replace('{total}', cards.length);
    function drawDots(active) {
      dots.innerHTML = cards.map((_, i) => `<button type="button" data-i="${i}" aria-label="${esc(label(i))}"${i === active ? ' aria-current="true"' : ''}></button>`).join('');
    }
    function activeIndex() {
      const mid = grid.getBoundingClientRect().left + grid.clientWidth / 2;
      let best = 0, bestGap = Infinity;
      cards.forEach((c, i) => { const r = c.getBoundingClientRect(); const gap = Math.abs(r.left + r.width / 2 - mid); if (gap < bestGap) { best = i; bestGap = gap; } });
      return best;
    }
    // A scrollable area must be reachable with the keyboard, so it is one stop while it scrolls (phones only).
    function mode() {
      if (phone.matches) {
        grid.setAttribute('tabindex', '0'); grid.setAttribute('role', 'group'); grid.setAttribute('aria-roledescription', 'carousel'); grid.setAttribute('aria-label', t('ex.title'));
      } else {
        ['tabindex', 'role', 'aria-roledescription', 'aria-label'].forEach((a) => grid.removeAttribute(a));
      }
    }
    let ticking = false;
    grid.addEventListener('scroll', () => {
      if (ticking || !phone.matches) return;
      ticking = true;
      requestAnimationFrame(() => { ticking = false; const i = activeIndex(); dots.querySelectorAll('button').forEach((b, k) => (k === i ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current'))); });
    }, { passive: true });
    dots.addEventListener('click', (ev) => {
      const b = ev.target.closest('button[data-i]');
      if (b) cards[Number(b.dataset.i)].scrollIntoView({ behavior: reduce.matches ? 'auto' : 'smooth', inline: 'center', block: 'nearest' });
    });
    phone.addEventListener('change', mode);
    document.addEventListener('wisecall:lang-changed', () => { drawDots(activeIndex()); mode(); });
    drawDots(0);
    mode();
  }

  initFaq();
  // The strip's labels need the dictionary, so main.js draws it after the language is loaded.
  // "Real answers": once three answers are published, they take the place of the three examples (same cards, real content).
  async function loadRealAnswers() {
    const grid = document.querySelector('.example-grid');
    if (!grid) return;
    let d;
    try { d = await fetch('/api/answers?limit=3').then((r) => (r.ok ? r.json() : { answers: [] })); } catch (e) { return; }
    if (!d.answers || d.answers.length < 3) return;
    const prefix = WisecallI18n.getLang() === 'ka' ? '/ka' : '';
    const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
    grid.innerHTML = d.answers.map((a) => `
      <article class="example-card">
        <header><span class="ex-niche">${esc(a.niche ? t('niche.' + a.niche) : '')}</span><span class="ex-tag">${esc(t('pa.home.label'))}</span></header>
        <h3 class="ex-q"><a class="plain-link" href="${prefix}/answers/${encodeURIComponent(a.slug)}">${esc(cut(a.question, 160))}</a></h3>
        <p class="ex-a">${esc(cut(a.answer, 260))}</p>
        <p class="ex-who">${esc(a.mentor.name)}</p>
      </article>`).join('');
    const title = document.getElementById('exTitle');
    if (title) title.textContent = t('pa.home.title');
    const sub = title && title.nextElementSibling;
    if (sub) sub.innerHTML = `${esc(t('pa.home.sub'))} <a class="plain-link" href="${prefix}/answers">${esc(t('pa.home.more'))}</a>`;
  }
  // The next three live sessions, when there are any (the section stays hidden otherwise).
  async function loadLive() {
    const box = document.getElementById('liveHome');
    if (!box) return;
    let d;
    try { d = await fetch('/api/live?limit=3').then((r) => (r.ok ? r.json() : { sessions: [] })); } catch (e) { return; }
    if (!d.sessions || !d.sessions.length) return;
    const prefix = WisecallI18n.getLang() === 'ka' ? '/ka' : '';
    const when = (x) => WisecallI18n.formatDate(x, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    document.getElementById('liveHomeGrid').innerHTML = d.sessions.map((s) => `
      <article class="live-card">
        ${s.hasCover ? `<img class="live-card-cover" src="/api/live-covers/${esc(s.id)}.webp" alt="" width="600" height="315" loading="lazy">` : ''}
        <div class="live-card-body">
          <p class="live-card-meta small"><span class="live-kind">${esc(t('live.kind.' + s.kind))}</span> · ${esc(when(s.startsAt))}</p>
          <h3 class="live-card-title"><a class="plain-link" href="${prefix}/live/${encodeURIComponent(s.slug)}">${esc(s.title)}</a></h3>
          <p class="muted small">${esc(s.mentor ? s.mentor.name : '')}</p>
          <p class="live-card-foot"><strong class="price">${esc(WisecallAPI.formatAmount(s.priceNow))}</strong></p>
        </div>
      </article>`).join('');
    box.hidden = false;
  }
  document.addEventListener('DOMContentLoaded', () => WisecallI18n.ready.then(loadRealAnswers).then(initExamples).then(loadLive));
  document.addEventListener('wisecall:lang-changed', drawStrip);

  window.WisecallHome = { icon, drawStrip, emptyArt: EMPTY_ART };
})();
