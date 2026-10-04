// The confirmation dialog (instead of the browser's window.confirm): a native <dialog> opened with showModal(), so the rest of the page
// is inert and focus stays inside it; Esc, "Cancel" or a click outside closes it (= no), and focus goes back to the button that opened it.
// The action button says what will happen ("Refund 40.00 ₾"), red when it cannot be undone. Cancel has the focus first, so Enter never
// confirms a destructive action by accident.
//   if (!(await WisecallDialog.confirm({ message, confirmText, danger: true }))) return;
(function () {
  let dlg = null;
  const t = (k) => WisecallI18n.t(k);

  function build() {
    dlg = document.createElement('dialog');
    dlg.className = 'wc-dialog';
    dlg.setAttribute('aria-labelledby', 'wcDialogMessage');
    dlg.innerHTML = `<form method="dialog" class="wc-dialog-inner">
        <p id="wcDialogMessage" class="wc-dialog-message"></p>
        <div class="wc-dialog-actions">
          <button type="submit" value="cancel" class="btn btn-outline" data-cancel></button>
          <button type="submit" value="ok" class="btn btn-primary" data-ok></button>
        </div>
      </form>`;
    // (a click on the backdrop, outside the box, is a "no")
    dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close('cancel'); });
    // (Tab and Shift+Tab go round the two buttons: the focus never leaves the dialog)
    dlg.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Tab') return;
      const items = Array.from(dlg.querySelectorAll('button'));
      const i = items.indexOf(document.activeElement);
      const next = ev.shiftKey ? (i <= 0 ? items.length - 1 : i - 1) : (i === items.length - 1 ? 0 : i + 1);
      ev.preventDefault();
      items[next].focus();
    });
    document.body.appendChild(dlg);
  }

  function confirm({ message, confirmText, cancelText, danger = false } = {}) {
    if (!dlg) build();
    if (dlg.open) dlg.close('cancel');
    const opener = document.activeElement;
    dlg.querySelector('#wcDialogMessage').textContent = message || '';
    const ok = dlg.querySelector('[data-ok]');
    ok.textContent = confirmText || t('dialog.ok');
    ok.className = 'btn ' + (danger ? 'btn-danger' : 'btn-primary');
    dlg.querySelector('[data-cancel]').textContent = cancelText || t('dialog.cancel');
    return new Promise((resolve) => {
      dlg.returnValue = '';
      dlg.addEventListener('close', () => {
        resolve(dlg.returnValue === 'ok');
        if (opener && typeof opener.focus === 'function' && document.contains(opener)) opener.focus();
      }, { once: true });
      dlg.showModal();
      dlg.querySelector('[data-cancel]').focus();
    });
  }

  window.WisecallDialog = { confirm };
})();
