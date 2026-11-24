// Génère les icônes PNG de l'appli (écran d'accueil, partage) à partir du logo
import sharp from 'sharp';
const lantern = (scale, cx, cy, sw = 1.6) => `
  <g transform="translate(${cx - 32 * scale} ${cy - 40 * scale}) scale(${scale})">
    <g fill="none" stroke="#3998EB" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round" filter="url(#glow)">
      <circle cx="32" cy="6" r="4"/><path d="M32 10 V14"/><path d="M18 22 L24 14 H40 L46 22 Z"/><path d="M14 22 H50"/>
      <path d="M18 22 V62 M46 22 V62"/><path d="M26 22 V62 M38 22 V62" opacity=".45"/><path d="M14 62 H50"/>
      <path d="M18 62 L24 70 H40 L46 62"/><path d="M22 76 H42"/><path d="M18 22 L46 62 M46 22 L18 62" opacity=".18"/>
    </g>
    <path filter="url(#glow)" d="M32 30 C36.5 36 39 40 39 45 C39 49.5 35.8 53 32 53 C28.2 53 25 49.5 25 45 C25 41.5 27 39 29 36.5 C29.6 39.5 31 41 32.5 41.5 C31.6 37.8 31.4 34 32 30 Z" fill="#7cc0ff"/>
  </g>`;
const defs = `<defs>
  <radialGradient id="bg" cx="50%" cy="45%" r="65%"><stop offset="0" stop-color="#0f1a2e"/><stop offset="1" stop-color="#05060a"/></radialGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
</defs>`;
const square = (size, pad) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${defs}
  <rect width="${size}" height="${size}" fill="url(#bg)"/>${lantern((size * (1 - pad * 2)) / 80, size / 2, size / 2, 1.6)}</svg>`;
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">${defs}
  <rect width="1200" height="630" fill="url(#bg)"/>${lantern(4.2, 250, 315, 1.4)}
  <text x="450" y="290" font-family="Helvetica, Arial, sans-serif" font-size="88" font-weight="700" letter-spacing="18" fill="#ffffff">LANTERNE</text>
  <text x="454" y="360" font-family="Helvetica, Arial, sans-serif" font-size="36" fill="#9fb3d1">L’agenda commun</text><text x="454" y="408" font-family="Helvetica, Arial, sans-serif" font-size="36" fill="#9fb3d1">des associations stéphanoises</text></svg>`;
const out = 'public/icons/';
await sharp(Buffer.from(square(512, 0.14))).png().toFile(out + 'icon-512.png');
await sharp(Buffer.from(square(192, 0.14))).png().toFile(out + 'icon-192.png');
await sharp(Buffer.from(square(512, 0.22))).png().toFile(out + 'maskable-512.png');
await sharp(Buffer.from(square(180, 0.14))).png().toFile(out + 'apple-touch-icon.png');
await sharp(Buffer.from(og)).png().toFile(out + 'og.png');
console.log('icônes générées');
