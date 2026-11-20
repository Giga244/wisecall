// The mentor's story on the profile ("ჩემი გზა": where I started, how I coped, where I am now) as tabs (docs/CLAUDE-CODE-STORY-TABS.md).
// public/js/profile.js draws the parts one under the other, each with its title: that is what is read without this script. This turns
// them into one card with a tab bar above it, one tab per part the mentor wrote (one part alone: just its card, no tab bar):
//   - a tap or click on a tab shows its part; a swipe left or right on the card goes to the next or the previous one
//   - a short fade (none for a person who asked for less motion)
//   - role="tablist"/"tab"/"tabpanel", aria-selected; the arrow keys, Home and End move between the tabs; the focus ring shows
//   - dots under the card say which part is shown; on a touch screen a hint says the card can be swiped
//   WisecallStoryTabs.enhance(root)   (every [data-story-tabs] section in root)
(function () {
  const t = (k) => (window.WisecallI18n ? WisecallI18n.t(k) : k);
  const reduced = () => Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function enhance(root) {
    (root || document).querySelectorAll('[data-story-tabs]:not([data-story-ready])').forEach(wire);
  }

  function wire(section) {
    section.setAttribute('data-story-ready', '');
    const panels = [...section.querySelectorAll('[data-story-panel]')];
    if (panels.length < 2) return; // (one part: its card with its title, as drawn)
    const titles = panels.map((p) => (p.querySelector('.story-panel-title') || { textContent: '' }).textContent);
    const heading = section.querySelector('h2');
    const bar = document.createElement('div');
    bar.className = 'story-tabs';
    bar.setAttribute('role', 'tablist');
    if (heading && heading.id) bar.setAttribute('aria-labelledby', heading.id);
    bar.style.setProperty('--story-tab-count', String(panels.length));
    const tabs = panels.map((panel, i) => {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'story-tab';
      tab.id = `${panel.id}-tab`;
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-controls', panel.id);
      tab.textContent = titles[i];
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      panel.tabIndex = 0;
      bar.appendChild(tab);
      return tab;
    });
    const box = panels[0].parentElement;
    box.parentElement.insertBefore(bar, box);
    // (the dots and, on a touch screen, the hint: what the tabs already say, so hidden from screen readers)
    const nav = document.createElement('div');
    nav.className = 'story-nav';
    nav.setAttribute('aria-hidden', 'true');
    nav.innerHTML = `<span class="story-dots">${panels.map(() => '<span class="story-dot"></span>').join('')}</span><span class="story-hint">${t('profile.story.hint')}</span>`;
    box.parentElement.insertBefore(nav, box.nextSibling);
    const dots = [...nav.querySelectorAll('.story-dot')];
    section.classList.add('is-tabbed');

    let current = -1;
    function show(i, { focus = false } = {}) {
      const next = (i + panels.length) % panels.length;
      if (next === current) { if (focus) tabs[next].focus(); return; }
      current = next;
      tabs.forEach((tab, k) => {
        const on = k === next;
        tab.setAttribute('aria-selected', String(on));
        tab.tabIndex = on ? 0 : -1;
        panels[k].hidden = !on;
        dots[k].classList.toggle('is-on', on);
      });
      const panel = panels[next];
      if (!reduced()) {
        panel.classList.add('is-entering');
        requestAnimationFrame(() => requestAnimationFrame(() => panel.classList.remove('is-entering')));
      }
      if (focus) tabs[next].focus();
    }
    tabs.forEach((tab, i) => tab.addEventListener('click', () => show(i)));
    bar.addEventListener('keydown', (ev) => {
      const i = tabs.indexOf(document.activeElement);
      if (i < 0) return;
      const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[ev.key];
      if (to === undefined) return;
      ev.preventDefault();
      show(to, { focus: true });
    });
    // A swipe on the card: left for the next part, right for the previous one (a mostly sideways move of 40px or more; a scroll is left alone).
    let start = null;
    box.addEventListener('touchstart', (ev) => { const p = ev.touches[0]; start = p ? { x: p.clientX, y: p.clientY } : null; }, { passive: true });
    box.addEventListener('touchend', (ev) => {
      const p = ev.changedTouches[0];
      if (!start || !p) return;
      const dx = p.clientX - start.x, dy = p.clientY - start.y;
      start = null;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      show(current + (dx < 0 ? 1 : -1));
    }, { passive: true });
    show(0);
  }

  window.WisecallStoryTabs = { enhance };
})();
