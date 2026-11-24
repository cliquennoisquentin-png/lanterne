// Lanterne — animation d'ouverture
// La lanterne se dessine, la flamme s'allume, puis des ondes de lumière partent de la flamme
// et dévoilent l'agenda. Adapté du « Circle Reveal Loader » de Goodmotion (21st.dev),
// réécrit sans bibliothèque (clip-path + mask animés en requestAnimationFrame).

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2); // équivalent power3.inOut

function tween(duration, onUpdate) {
  return new Promise((resolve) => {
    const start = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration);
      onUpdate(easeInOut(t));
      if (t < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let skipped = false;

// Joue l'ouverture ; `ready` est une promesse résolue quand l'appli est affichée derrière
export async function playSplash(ready) {
  const el = document.getElementById('splash');
  if (!el) return;
  const done = () => { el.remove(); document.documentElement.classList.remove('splashing'); };

  let seen = false;
  try { seen = sessionStorage.getItem('lanterne-splash') === '1'; sessionStorage.setItem('lanterne-splash', '1'); } catch { /* navigation privée */ }

  // Version courte : déjà vue pendant cette session, ou animations réduites demandées
  if (seen || reduced()) {
    await ready;
    document.dispatchEvent(new Event('lanterne:reveal'));
    el.classList.add('quick');
    el.style.transition = 'opacity .35s ease';
    el.style.opacity = '0';
    await wait(360);
    return done();
  }

  // Un appui passe l'animation
  el.addEventListener('pointerdown', () => { skipped = true; }, { once: true });

  el.classList.add('play'); // dessin du logo + allumage de la flamme (CSS)
  await Promise.all([wait(950), ready]);

  // Ondes de lumière depuis la flamme
  const flame = el.querySelector('.splash-flame');
  const r = flame.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const w = window.innerWidth; const h = window.innerHeight;
  const maxR = Math.ceil(Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy))) * 1.05;
  const at = `at ${cx}px ${cy}px`;
  const [l2, l3] = el.querySelectorAll('.splash-layer.l2, .splash-layer.l3');
  const panel = el.querySelector('.splash-panel');
  const setClip = (node, rad) => { const v = `circle(${rad}px ${at})`; node.style.clipPath = v; node.style.webkitClipPath = v; };
  const setHole = (rad) => {
    const v = `radial-gradient(circle ${at}, transparent ${rad}px, #000 ${rad + 1}px)`;
    panel.style.maskImage = v; panel.style.webkitMaskImage = v;
  };
  setClip(l2, 0); setClip(l3, 0); setHole(0);
  el.classList.add('reveal'); // le logo s'efface pendant que la lumière se répand

  const D = skipped ? 380 : 720; // durée de chaque onde
  const lag = skipped ? 90 : 200; // décalage entre les ondes
  await Promise.all([
    tween(D, (t) => setClip(l2, t * maxR)),
    wait(lag).then(() => tween(D, (t) => setClip(l3, t * maxR))),
    wait(lag * 2).then(() => { document.dispatchEvent(new Event('lanterne:reveal')); return tween(D, (t) => setHole(t * maxR)); }),
  ]);
  done();
}
