// Drafts: what a person has typed into a long text field and not saved yet is never lost. Kept in this browser as it is typed
// (localStorage, per person and field), and for a signed-in person on the server too (PUT /api/me/drafts/<key>, server/drafts.js: it
// comes back on another device, or when the browser's copy is gone). A draft is exactly what was typed; it is put back after a failed
// save, a reload, or a later step of the same flow, and cleared only when its text is saved.
//   key   "question:<mentor id>", "answer:<booking id>", "story" (My path, About and the sample answer in Settings), "apply-story"
//         (the same form on the application), "bio" (About me on the Profile tab)
//   base  what the server had saved when the draft was typed: a draft is put back only over that (something saved since, here or on
//         another device, is newer than the draft and wins)
//
//   WisecallDrafts.user(id)                 the signed-in person (null: a visitor; only this browser then)
//   WisecallDrafts.read(key)                -> { value, base, at } | null   (this browser)
//   WisecallDrafts.readServer(key)          -> Promise of the same, from the server (null for a visitor, or when there is none)
//   WisecallDrafts.write(key, value, base)  kept now here, a moment later on the server; an empty text clears the draft
//   WisecallDrafts.clear(key)               after a successful save
//   WisecallDrafts.bindText(textarea, key, { note })  -> { clear(), saved(value), restored }
//         one text box: puts a draft back into it (and says so in `note`, an element), keeps one as the person types
(function () {
  const PREFIX = 'wisecall_draft_';
  const SERVER_DELAY = 1200;
  let userId = null;
  const timers = new Map();
  const pending = new Set(); // (keys whose newest text has not reached the server yet)

  const storeKey = (key, who) => `${PREFIX}${who || 'guest'}_${key}`;
  const store = {
    get(k) { try { const d = JSON.parse(localStorage.getItem(k) || 'null'); return d && typeof d.value === 'string' ? d : null; } catch (e) { return null; } },
    set(k, d) { try { localStorage.setItem(k, JSON.stringify(d)); } catch (e) { /* storage unavailable or full: the server copy still works */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* none */ } }
  };

  function user(id) { userId = id || null; }

  // (typed as a visitor, then signed in: the visitor's draft is theirs)
  function read(key) {
    return store.get(storeKey(key, userId)) || (userId ? store.get(storeKey(key, null)) : null);
  }

  const api = (path, opts) => fetch('/api/me/drafts/' + encodeURIComponent(path), {
    credentials: 'include', keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'wisecall' }, ...opts
  });

  async function readServer(key) {
    if (!userId) return null;
    try {
      const res = await api(key, { method: 'GET' });
      if (!res.ok) return null;
      const d = (await res.json()).draft;
      return d && typeof d.value === 'string' ? { value: d.value, base: d.base === null ? undefined : d.base, at: new Date(d.updatedAt).getTime() } : null;
    } catch (e) { return null; }
  }

  // The newest text of this key goes to the server (or its draft is removed there). Quietly: a failure leaves the browser's copy.
  function push(key) {
    clearTimeout(timers.get(key));
    timers.delete(key);
    pending.delete(key);
    if (!userId) return;
    const d = store.get(storeKey(key, userId));
    const req = d ? api(key, { method: 'PUT', body: JSON.stringify({ value: d.value, ...(d.base !== undefined ? { base: d.base } : {}) }) }) : api(key, { method: 'DELETE' });
    req.catch(() => { /* offline: the browser has it, and the next change tries again */ });
  }
  function later(key) {
    if (!userId) return;
    pending.add(key);
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => push(key), SERVER_DELAY));
  }

  function write(key, value, base) {
    const text = String(value === null || value === undefined ? '' : value);
    if (!text.trim()) { clear(key); return; }
    store.set(storeKey(key, userId), { value: text, ...(base !== undefined ? { base } : {}), at: Date.now() });
    if (userId) store.del(storeKey(key, null));
    later(key);
  }

  function clear(key) {
    store.del(storeKey(key, userId));
    store.del(storeKey(key, null));
    if (userId) { pending.add(key); push(key); }
  }

  // Leaving the page: what has not reached the server yet is sent now.
  const flush = () => [...pending].forEach(push);
  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

  // One text box. What is in it when it is bound is what the server has (its base). A draft typed over that same base is put back, from
  // this browser first, otherwise from the server; typing keeps the draft; back at the base, there is nothing to keep.
  function bindText(el, key, { note } = {}) {
    let base = el.value;
    let touched = false;
    const say = (on) => { if (note) note.hidden = !on; };
    const put = (d) => {
      if (!d || d.value === el.value || (d.base !== undefined && d.base !== base)) return false;
      el.value = d.value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      say(true);
      return true;
    };
    const onInput = (ev) => {
      if (ev.isTrusted !== false) { touched = true; say(false); }
      if (el.value === base) clear(key); else write(key, el.value, base);
    };
    const local = read(key);
    const restoredNow = put(local);
    if (local && !restoredNow && local.base !== undefined && local.base !== base) clear(key); // (something newer was saved: the draft is old)
    el.addEventListener('input', onInput);
    const restored = restoredNow ? Promise.resolve(true)
      : readServer(key).then((d) => (!touched && el.isConnected ? put(d) : false));
    return {
      restored,
      // (saved: the draft is done, and what was saved is the new base)
      saved(value) { base = value === undefined ? el.value : value; touched = false; say(false); clear(key); },
      clear() { say(false); clear(key); }
    };
  }

  window.WisecallDrafts = { user, read, readServer, write, clear, bindText, flush };
})();
