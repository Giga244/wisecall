// Pieces of the home page that are not the expert list: the field strip, the FAQ accordion and the
// empty-list art (main.js shows it when there is nobody to list yet; the waiting-list form is in waitlist.js).
(function () {
  const t = (k) => WisecallI18n.t(k);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // The strip of fields under the hero. Each is a link to Browse experts filtered by that field. The niches come from the server (an
  // admin can add more); the first STRIP_FIRST show, the rest behind "Show all".
  const STRIP_FIRST = 12;
  let stripOpen = false;
  const iconOf = (key) => { const n = WisecallI18n.niches().find((x) => x.key === key); return n ? n.icon : 'spark'; };
  const icon = (key, size) => WisecallNicheIcons.svg(iconOf(key), size);
  function drawStrip() {
    const list = document.getElementById('nicheStrip');
    if (!list) return;
    const all = WisecallI18n.niches();
    const shown = stripOpen ? all : all.slice(0, STRIP_FIRST);
    list.innerHTML = shown.map((n) => `
      <li><a class="niche-chip" href="/index.html?niche=${encodeURIComponent(n.key)}#experts" data-niche-link="${esc(n.key)}">${icon(n.key)}<span>${esc(t('niche.' + n.key))}</span></a></li>`).join('') +
      (all.length > STRIP_FIRST ? `<li><button type="button" class="niche-chip niche-more" aria-expanded="${stripOpen}">${esc(stripOpen ? t('home.fields.less') : t('home.fields.more').replace('{n}', all.length))}</button></li>` : '');
    const more = list.querySelector('.niche-more');
    if (more) more.addEventListener('click', () => { stripOpen = !stripOpen; drawStrip(); list.querySelector('.niche-more').focus(); });
  }

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
      <circle cx="46" cy="118" r="22" style="fill:var(--blob-sun)"/>
      <circle cx="188" cy="30" r="14" style="fill:var(--blob-mint)"/>
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
  document.addEventListener('DOMContentLoaded', () => WisecallI18n.ready.then(initExamples));
  document.addEventListener('wisecall:lang-changed', drawStrip);

  window.WisecallHome = { icon, drawStrip, emptyArt: EMPTY_ART };
})();
