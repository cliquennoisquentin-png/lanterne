// Lanterne — « Mise à jour disponible »
// L'appli connaît sa version au démarrage. Elle vérifie s'il en existe une plus récente
// quand on y revient, puis toutes les 15 minutes. Si oui : un bandeau, un appui, et c'est à jour.

let current = null;
let shown = false;

async function latest() {
  try {
    const r = await fetch('/api/version', { cache: 'no-store' });
    if (!r.ok) return null;
    return (await r.json()).version;
  } catch { return null; } // hors ligne : on réessaiera plus tard
}

async function applyUpdate(btn) {
  btn.disabled = true;
  btn.textContent = 'Mise à jour…';
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    reg?.waiting?.postMessage('skip-waiting');
  } catch { /* pas de service worker : un simple rechargement suffit */ }
  location.reload();
}

function showBanner() {
  if (shown) return;
  shown = true;
  const bar = document.createElement('div');
  bar.className = 'update-bar';
  bar.setAttribute('role', 'status');
  bar.innerHTML = `<span class="update-dot" aria-hidden="true"></span>
    <span class="update-text"><b>Nouvelle version de Lanterne</b><span>Une mise à jour est prête.</span></span>
    <button class="btn primary small" type="button">Mettre à jour</button>
    <button class="icon-btn" type="button" aria-label="Plus tard"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
  document.body.append(bar);
  requestAnimationFrame(() => bar.classList.add('show'));
  bar.querySelector('.btn').addEventListener('click', (ev) => applyUpdate(ev.currentTarget));
  bar.querySelector('.icon-btn').addEventListener('click', () => {
    bar.classList.remove('show');
    setTimeout(() => { bar.remove(); shown = false; }, 400);
  });
}

async function check() {
  if (!current || shown) return;
  const v = await latest();
  if (v && v !== current) showBanner();
}

export function watchUpdates(version) {
  current = version;
  if (!current) return;
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  window.addEventListener('focus', check);
  window.addEventListener('online', check);
  setInterval(check, 15 * 60e3);
}
