// /live (written by the server): the header and footer, and each session's start in the visitor's own time zone when it is not Tbilisi's.
(async function () {
  await WisecallI18n.initI18n();
  await WisecallNav.initNav();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!zone || zone === 'Asia/Tbilisi') return;
  document.querySelectorAll('time[data-local]').forEach((el) => {
    el.textContent = WisecallI18n.formatDate(el.dataset.local, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  });
})();
