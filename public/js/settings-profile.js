// Settings → Profile: the public profile form (photo, username, details) with a live preview of how others see it.
window.SettingsProfile = (function () {
  const LANGUAGES = ['ka', 'en', 'ru', 'tr', 'az', 'hy', 'uk', 'de', 'fr', 'es', 'it', 'ar'];
  const MAX_LANGUAGES = 6;
  const MAX_PHOTO = 5 * 1024 * 1024;
  const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let user = null;
  let checkTimer = null;
  let checkSeq = 0;

  const t = (k) => WisecallI18n.t(k);
  const fill = (s, vars) => Object.keys(vars).reduce((out, k) => out.split('{' + k + '}').join(vars[k]), s);

  function isListedMentor() { return Boolean(user.isListedMentor); }

  // ---- Photo -----------------------------------------------------------------------------------------------------
  function drawPhoto() {
    $('photoPreview').innerHTML = WisecallAPI.avatar({ name: $('name').value || user.name, color: user.color, photoUrl: user.photoUrl }, { cls: 'avatar-xl', size: 96 });
    $('photoRemove').hidden = !user.photoUrl;
    $('photoChooseText').textContent = t(user.photoUrl ? 'profile.photo.change' : 'profile.photo.choose');
  }

  async function onPhotoChosen() {
    const input = $('photoFile');
    const file = input.files && input.files[0];
    const error = $('photoError');
    error.textContent = '';
    if (!file) return;
    if (!PHOTO_TYPES.includes(file.type)) { error.textContent = t('profile.photo.err.type'); input.value = ''; return; }
    if (file.size > MAX_PHOTO) { error.textContent = t('profile.photo.err.size'); input.value = ''; return; }
    $('photoPreview').setAttribute('aria-busy', 'true');
    try {
      const data = await WisecallAPI.uploadFile('/me/photo', file);
      Object.assign(user, data.user);
      WisecallNav.showToast(t('profile.photo.saved'));
    } catch (e) {
      const map = { file_too_large: 'profile.photo.err.size', unsupported_image_type: 'profile.photo.err.type', invalid_image: 'profile.photo.err.invalid', empty_file: 'profile.photo.err.invalid' };
      error.textContent = t(map[e.code] || 'toast.error');
    } finally {
      $('photoPreview').removeAttribute('aria-busy');
      input.value = '';
      drawPhoto();
      drawPreview();
    }
  }

  async function removePhoto() {
    try {
      const data = await WisecallAPI.apiFetch('/me/photo', { method: 'DELETE' });
      Object.assign(user, data.user);
      user.photoUrl = null;
      WisecallNav.showToast(t('profile.photo.removed'));
    } catch (e) { $('photoError').textContent = t('toast.error'); }
    drawPhoto();
    drawPreview();
  }

  // ---- Username --------------------------------------------------------------------------------------------------
  const DAY = 24 * 3600 * 1000;
  function nextChangeAt() {
    if (!user.usernameConfirmed || !user.usernameChangedAt) return null;
    const at = new Date(user.usernameChangedAt).getTime() + 30 * DAY;
    return at > Date.now() ? new Date(at) : null;
  }
  const dateText = (d) => WisecallI18n.formatDate(d, { day: 'numeric', month: 'long', year: 'numeric' });

  function drawUsernameHint() {
    const wait = nextChangeAt();
    $('usernameHint').textContent = `${window.location.origin}/u/${$('username').value.trim().toLowerCase() || user.username || ''} — ${t('profile.username.rule')}` + (wait ? ' ' + fill(t('profile.username.next'), { date: dateText(wait) }) : '');
    $('usernameSave').disabled = Boolean(wait) || $('username').value.trim().toLowerCase() === (user.username || '');
  }

  function setStatus(key, tone) {
    const el = $('usernameStatus');
    el.textContent = key ? t(key) : '';
    el.className = 'username-status' + (tone ? ' is-' + tone : '');
  }

  function checkUsername() {
    clearTimeout(checkTimer);
    drawUsernameHint();
    const value = $('username').value.trim().toLowerCase();
    if (!value || value === user.username) { setStatus(null); return; }
    const seq = ++checkSeq;
    checkTimer = setTimeout(async () => {
      try {
        const r = await WisecallAPI.apiFetch('/username/check?u=' + encodeURIComponent(value));
        if (seq !== checkSeq) return;
        if (r.available) { setStatus('profile.username.free', 'ok'); return; }
        const map = { username_taken: 'profile.username.taken', reserved_username: 'profile.username.reserved' };
        setStatus(map[r.reason] || 'profile.username.invalid', 'bad');
        $('usernameSave').disabled = true;
      } catch (e) { if (seq === checkSeq) setStatus(null); }
    }, 300);
  }

  async function saveUsername() {
    const value = $('username').value.trim().toLowerCase();
    setStatus(null);
    try {
      const data = await WisecallAPI.apiFetch('/me/username', { method: 'PUT', body: { username: value } });
      Object.assign(user, data.user);
      $('username').value = user.username;
      WisecallNav.showToast(t('profile.username.saved'));
      drawUsernameHint();
      drawPreview();
    } catch (e) {
      const map = { username_taken: 'profile.username.taken', reserved_username: 'profile.username.reserved', invalid_username: 'profile.username.invalid', username_change_too_soon: 'profile.username.tooSoon' };
      setStatus(map[e.code] || 'toast.error', 'bad');
    }
  }

  // ---- The form ---------------------------------------------------------------------------------------------------
  function drawLanguages(selected) {
    $('languageChecks').innerHTML = LANGUAGES.map((l) => `<label class="check-chip"><input type="checkbox" value="${l}"${selected.includes(l) ? ' checked' : ''}><span>${esc(t('lang.' + l))}</span></label>`).join('');
  }
  const chosenLanguages = () => Array.from($('languageChecks').querySelectorAll('input:checked')).map((i) => i.value);

  function drawBioCount() {
    const n = $('bio').value.length;
    $('bioCount').textContent = fill(t('profile.bio.count'), { n, max: 2000 });
    $('bioCount').classList.toggle('is-over', n > 2000);
  }

  function drawVisibilityHint() {
    const locked = isListedMentor();
    $('profileVisibility').disabled = locked;
    if (locked) $('profileVisibility').value = 'public';
    $('visibilityHint').textContent = t(locked ? 'profile.visibility.lockedMentor' : ($('profileVisibility').value === 'public' ? 'profile.visibility.publicHint' : 'profile.visibility.contactsHint'));
  }

  function values() {
    return {
      name: $('name').value.trim(),
      headline: $('headline').value.trim(),
      currentWork: $('currentWork').value.trim(),
      city: $('city').value.trim(),
      bio: $('bio').value.trim(),
      languages: chosenLanguages(),
      linkedinUrl: $('linkedinUrl').value.trim(),
      websiteUrl: $('websiteUrl').value.trim(),
      profileVisibility: $('profileVisibility').value
    };
  }

  // ---- The live preview: the same facts the public page shows, drawn from what is typed so far -----------------------
  function drawPreview() {
    const v = values();
    const name = v.name || user.name || '';
    const langs = v.languages.map((l) => esc(t('lang.' + l))).join(', ');
    const rows = [];
    if (v.currentWork) rows.push(`<li><span class="muted small">${t('profile.currentWork')}</span><strong>${esc(v.currentWork)}</strong></li>`);
    if (v.city) rows.push(`<li><span class="muted small">${t('profile.city')}</span><strong>${esc(v.city)}</strong></li>`);
    if (langs) rows.push(`<li><span class="muted small">${t('profile.languages')}</span><strong>${langs}</strong></li>`);
    const title = isListedMentor() ? (user.roleTitle || '') : v.headline;
    $('profilePreview').innerHTML = `
      <div class="profile-head">
        ${WisecallAPI.avatar({ name, color: user.color, photoUrl: user.photoUrl }, { cls: 'avatar-lg', size: 76 })}
        <div>
          <p class="preview-name">${esc(name)}</p>
          ${title ? `<p class="profile-title">${esc(title)}</p>` : ''}
          ${isListedMentor() && v.headline ? `<p class="profile-headline">${esc(v.headline)}</p>` : ''}
        </div>
      </div>
      ${v.bio ? `<p class="preview-bio">${esc(v.bio)}</p>` : `<p class="preview-bio muted">${t('profile.preview.noBio')}</p>`}
      ${rows.length ? `<ul class="profile-facts">${rows.join('')}</ul>` : ''}`;
    const view = $('viewPublic');
    view.href = '/u/' + (user.username || '');
    view.hidden = !user.username;
  }

  // What the form showed when it was filled: a save sends only the fields changed since then, so a field nobody touched (above all
  // "About me", which the application's story can change meanwhile) is never written back from an older copy.
  let loaded = null;
  function fillForm() {
    $('username').value = user.username || '';
    $('name').value = user.name || '';
    $('headline').value = user.headline || '';
    $('currentWork').value = user.currentWork || '';
    $('city').value = user.city || '';
    // (a mentor's About as they wrote it: empty while it is only the copy of their path, which the profile shows as "ჩემი გზა"; /api/me about)
    $('bio').value = (typeof user.about === 'string' ? user.about : user.bio) || '';
    $('linkedinUrl').value = user.linkedinUrl || '';
    $('websiteUrl').value = user.websiteUrl || '';
    $('profileVisibility').value = user.profileVisibility || 'public';
    drawLanguages(user.languages || []);
    // "More profile details" starts open once any of it is filled in; a new profile shows the four essentials first.
    if (user.currentWork || user.city || (user.languages || []).length || user.linkedinUrl || user.websiteUrl) $('profileMore').open = true;
    $('bioSync').hidden = !(user.role === 'mentor' || user.role === 'both');
    drawPhoto();
    drawBioCount();
    drawVisibilityHint();
    drawUsernameHint();
    drawPreview();
    loaded = values();
  }

  // What is wrong with "About me" is said right under it (and the box is in focus); nothing in it is ever cleared.
  let bioDraft = null;
  function bioError(text) {
    const line = $('bioError');
    line.textContent = text || '';
    line.hidden = !text;
    $('bio').setAttribute('aria-invalid', text ? 'true' : 'false');
    if (text) { $('bio').scrollIntoView({ block: 'center' }); $('bio').focus({ preventScroll: true }); }
  }

  async function save(ev) {
    ev.preventDefault();
    const error = $('profileError');
    error.textContent = '';
    bioError('');
    const v = values();
    if (!v.name) { error.textContent = t('profile.err.name'); return; }
    if (v.bio.length > 2000) { bioError(t('profile.err.bioLong')); return; }
    if (v.languages.length > MAX_LANGUAGES) { $('profileMore').open = true; error.textContent = fill(t('profile.err.languages'), { n: MAX_LANGUAGES }); return; }
    try {
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      const body = Object.fromEntries(Object.entries(v).filter(([k, val]) => !loaded || !same(val, loaded[k])));
      if (body.bio !== undefined && loaded) body.bioWas = loaded.bio; // (the server refuses it if "About me" changed since: server/routes/me.js)
      if (isListedMentor()) delete body.profileVisibility;
      if (!Object.keys(body).length) { WisecallNav.showToast(t('toast.saved')); return; }
      const data = await WisecallAPI.apiFetch('/me', { method: 'PATCH', body });
      Object.assign(user, data.user);
      // What was saved may differ a little from what was typed (spaces removed, links completed): show what is stored.
      fillForm();
      if (bioDraft) bioDraft.saved($('bio').value); // (saved: the draft of "About me" is done)
      WisecallNav.showToast(t('toast.saved'));
    } catch (e) {
      // (no answer at all: said plainly; what was typed stays, and as a draft)
      if (!e || !e.code) { error.textContent = t('apply.err.network'); return; }
      // "About me" changed elsewhere since this page was opened: what was typed stays in the box; the next save replaces the newer text,
      // knowingly (or a reload shows it)
      if (e.code === 'bio_changed') {
        if (e.data && typeof e.data.bio === 'string') { user.about = e.data.bio; loaded.bio = e.data.bio.trim(); }
        bioError(t('profile.err.bioChanged'));
        return;
      }
      // (about "About me": under the box itself)
      if ((e.data && e.data.field === 'bio') || e.code === 'bio_too_long') { bioError(t({ contact_details: 'story.err.contact', offensive: 'story.err.offensive', bio_too_long: 'profile.err.bioLong' }[e.code] || 'toast.error')); return; }
      const map = { contact_details: 'story.err.contact', offensive: 'story.err.offensive', invalid_linkedin_url: 'profile.err.linkedin', invalid_website_url: 'profile.err.website', bio_too_long: 'profile.err.bioLong', invalid_language: 'profile.err.language', missing_fields: 'profile.err.name', mentor_profile_must_be_public: 'profile.visibility.lockedMentor' };
      error.textContent = t(map[e.code] || 'toast.error');
      if (['invalid_linkedin_url', 'invalid_website_url', 'invalid_language', 'mentor_profile_must_be_public'].includes(e.code)) $('profileMore').open = true; // (the field is under "More profile details")
    }
  }

  function init(currentUser) {
    user = currentUser; // (isListedMentor: a mentor buyers can book, whose profile has to stay public)
    fillForm();
    // "About me" is never lost: a draft is kept as it is typed and put back after a failed save or a reload (public/js/drafts.js)
    if (window.WisecallDrafts) {
      WisecallDrafts.user(user.id);
      bioDraft = WisecallDrafts.bindText($('bio'), 'bio', { note: $('bioDraftNote') });
    }
    $('profileForm').addEventListener('submit', save);
    $('profileForm').addEventListener('input', (ev) => {
      if (ev.target.id === 'username') return;
      if (ev.target.id === 'bio') { drawBioCount(); if (ev.isTrusted !== false) bioError(''); }
      if (ev.target.id === 'name') drawPhoto();
      if (ev.target.id === 'profileVisibility') drawVisibilityHint();
      drawPreview();
    });
    $('username').addEventListener('input', checkUsername);
    $('usernameSave').addEventListener('click', saveUsername);
    $('photoFile').addEventListener('change', onPhotoChosen);
    $('photoRemove').addEventListener('click', removePhoto);
    // Texts drawn by script follow the language switch.
    document.addEventListener('wisecall:lang-changed', () => { drawLanguages(chosenLanguages()); drawPhoto(); drawBioCount(); drawVisibilityHint(); drawUsernameHint(); drawPreview(); });
  }

  return { init };
})();
