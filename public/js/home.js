// Pieces of the home page that are not the expert list: the hero's chips and search, the field tiles, the FAQ accordion, the live
// sessions band and the empty-list art (main.js shows it when there is nobody to list yet; the waiting-list form is in waitlist.js).
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
    const placeholder = document.getElementById('fieldsMoreSkeleton');
    if (placeholder) placeholder.remove(); // (the button's skeleton: the button itself comes now)
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

  // The hero: the first few fields as chips.
  const HERO_CHIPS = 5;
  function drawHero() {
    const all = WisecallI18n.niches();
    const chips = document.getElementById('heroChips');
    if (chips) chips.innerHTML = all.slice(0, HERO_CHIPS).map((n) => `<li><a class="chip" href="/index.html?niche=${encodeURIComponent(n.key)}#experts" data-niche-link="${esc(n.key)}">${esc(t('niche.' + n.key))}</a></li>`).join('');
  }

  // ---- The hero's example: a question and its answer --------------------------------------------------------------------------
  // Six of them are in the page (in its language, public/index.html), all in the same place, none shown until one is chosen here: a
  // random one on each page load, then the next each time the conversation plays again (every 12 seconds, when the question's
  // animation starts over), so never the same one twice in a row. With reduced motion nothing plays, so it stays the one chosen for
  // this page load. While the tab is hidden the loop waits, and so does the next example. The card is decoration (aria-hidden): a
  // screen reader hears its label once, never the rotation.
  const firstExample = (count, random = Math.random) => Math.min(count - 1, Math.floor(random() * count));
  const nextExample = (i, count) => (i + 1) % count;
  // Once mentors have written sample answers (docs/CLAUDE-CODE-MENTOR-JOURNEY-AND-ORIGINALITY.md parts 4 and 5), the conversation shows those
  // real ones instead, shortened, with the mentor's name and field; until then, the examples in the page.
  const clipText = (s, n) => { const a = [...String(s || '').replace(/\s+/g, ' ').trim()]; return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };
  async function realExamples(stage) {
    let list = [];
    try { list = ((await WisecallAPI.apiFetch('/answers?limit=12')).answers || []).filter((a) => a.sample).slice(0, 6); } catch (e) { return null; }
    if (!list.length) return null;
    const model = stage.querySelector('.stage-example');
    const box = model.parentNode;
    const made = list.map((a) => {
      const ex = model.cloneNode(true);
      ex.classList.remove('is-active');
      ex.querySelectorAll('[data-i18n]').forEach((el) => el.removeAttribute('data-i18n'));
      ex.querySelector('.bubble-q p:last-child').textContent = clipText(a.question, 150);
      const who = ex.querySelector('.bubble-a .bubble-who span:last-child');
      if (who) who.textContent = [a.mentor.name, a.mentor.field || a.mentor.roleTitle].filter(Boolean).join(' · ');
      ex.querySelector('.bubble-a p:last-child').textContent = clipText(a.answer, 220);
      return ex;
    });
    box.querySelectorAll('.stage-example').forEach((ex) => ex.remove());
    made.forEach((ex) => box.appendChild(ex));
    return made;
  }
  function initExamples() {
    const stage = document.querySelector('.hero-stage .stage');
    let examples = stage ? [...stage.querySelectorAll('.stage-example')] : [];
    if (!examples.length) return;
    // (the page's examples show at once; real sample answers take their place when they arrive)
    realExamples(stage).then((real) => { if (real) { examples = real; show(firstExample(examples.length)); } }).catch(() => {});
    let current = -1;
    const show = (i) => { current = i; examples.forEach((ex, k) => ex.classList.toggle('is-active', k === i)); };
    show(firstExample(examples.length));
    stage.addEventListener('animationiteration', (ev) => {
      if (ev.animationName === 'q-in' && ev.target.closest('.stage-example') === examples[current]) show(nextExample(current, examples.length));
    });
    const paused = () => stage.classList.toggle('is-paused', document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', paused);
    paused();
  }
  initExamples();

  // The hero's search: the words go into Browse experts' own search, and the page scrolls there (before launch, to the hero's waiting list).
  function initHeroSearch() {
    const form = document.getElementById('heroSearch');
    if (!form) return;
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const q = form.q.value.trim();
      const box = document.getElementById('searchInput');
      if (box && q && WisecallI18n.launchMode() !== 'prelaunch') { box.value = q; box.dispatchEvent(new Event('input', { bubbles: true })); }
      // (before launch the question is not lost: the waiting list keeps it and picks its field)
      if (q && window.WisecallWaitlist) WisecallWaitlist.ask(q);
      if (WisecallI18n.launchMode() === 'prelaunch' && window.WisecallWaitlist) { WisecallWaitlist.goToHero(); return; }
      document.getElementById('experts').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  }
  initHeroSearch();

  // ---- FAQ accordion: buttons with aria-expanded, arrow keys move between questions --------------------------
  // (an answer fades in as it opens, and fades out before it closes; at once with reduced motion)
  function toggleFaq(btn, open) {
    const next = open === undefined ? btn.getAttribute('aria-expanded') !== 'true' : open;
    const panel = document.getElementById(btn.getAttribute('aria-controls'));
    btn.setAttribute('aria-expanded', String(next));
    btn.closest('.faq-item').classList.toggle('open', next);
    panel.classList.remove('is-closing');
    if (next || panel.hidden || !document.documentElement.classList.contains('motion')) { panel.hidden = !next; return; }
    panel.classList.add('is-closing');
    setTimeout(() => {
      panel.classList.remove('is-closing');
      if (btn.getAttribute('aria-expanded') !== 'true') panel.hidden = true;
    }, 160);
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

  initFaq();
  // The strip's labels need the dictionary, so main.js draws it after the language is loaded.
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
  document.addEventListener('DOMContentLoaded', () => WisecallI18n.ready.then(loadLive));
  document.addEventListener('wisecall:lang-changed', drawStrip);

  window.WisecallHome = { icon, drawStrip, emptyArt: EMPTY_ART, examples: { first: firstExample, next: nextExample } };
})();
