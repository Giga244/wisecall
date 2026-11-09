// Browse experts (/experts.html), apart from the list itself: the field tiles and the empty-list art (main.js shows it when there is nobody to
// list yet; the waiting-list form is in waitlist.js). The home page has its own script, public/js/landing.js.
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // The fields: a grid of tiles, each a link to Browse experts filtered by that field (the niches come from the server; an
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
    const all = WisecallI18n.fields();
    const placeholder = document.getElementById('fieldsMoreSkeleton');
    if (placeholder) placeholder.remove(); // (the button's skeleton: the button itself comes now)
    list.classList.toggle('is-open', stripOpen);
    list.innerHTML = all.map((n) => `
      <li><a class="field-tile" href="/experts.html?field=${encodeURIComponent(n.id)}" data-field-link="${esc(n.id)}"><span class="field-emoji" aria-hidden="true">${n.icon}</span><span>${esc(WisecallI18n.nameIn(n))}</span></a></li>`).join('');
    const more = document.getElementById('fieldsMore');
    if (more) {
      more.hidden = all.length <= firstShown();
      more.textContent = stripOpen ? t('home.fields.less') : t('home.fields.more').replace('{n}', all.length);
      more.setAttribute('aria-expanded', String(stripOpen));
      more.classList.toggle('btn-arrow', !stripOpen);
    }
    fitTiles();
  }
  function fitTiles() {
    const list = document.getElementById('nicheStrip');
    if (!list) return;
    const items = [...list.children];
    items.forEach((li) => li.classList.remove('is-wide'));
    const wide = items.filter((li) => {
      const node = li.querySelector('.field-tile span:last-child'); // (the name, not the icon)
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
    more.textContent = stripOpen ? t('home.fields.less') : t('home.fields.more').replace('{n}', WisecallI18n.fields().length);
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
    if (more) more.hidden = WisecallI18n.fields().length <= firstShown();
    if (!fitting) { fitting = true; requestAnimationFrame(() => { fitting = false; fitTiles(); }); }
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTiles);

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

  // The strip's labels need the dictionary, so main.js draws it after the language is loaded.
  document.addEventListener('wisecall:lang-changed', drawStrip);

  window.WisecallHome = { icon, drawStrip, emptyArt: EMPTY_ART };
})();
