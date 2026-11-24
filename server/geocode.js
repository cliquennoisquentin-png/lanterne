// Retrouver la position d'une adresse (pour la placer sur la carte), côté serveur.
// Service public de la Géoplateforme (IGN), gratuit et sans clé. Recherche centrée sur Saint-Étienne.
// GEOCODER_URL permet de le remplacer (les tests utilisent un faux service local).

const GEOCODER_URL = process.env.GEOCODER_URL || 'https://data.geopf.fr/geocodage/search';
const CENTER = { lat: 45.4397, lon: 4.3872 };
const MIN_SCORE = 0.45; // en dessous, l'adresse trouvée a de bonnes chances d'être la mauvaise

export async function geocode(text, { timeoutMs = 6000 } = {}) {
  const q = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (q.length < 3) return null;
  const url = new URL(GEOCODER_URL);
  url.searchParams.set('q', q);
  url.searchParams.set('limit', '1');
  url.searchParams.set('lat', String(CENTER.lat));
  url.searchParams.set('lon', String(CENTER.lon));
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const f = (await res.json())?.features?.[0];
    const [lng, lat] = f?.geometry?.coordinates || [];
    const p = f?.properties || {};
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Number(p.score ?? 1) < MIN_SCORE) return null;
    return { label: String(p.label || q), city: String(p.city || ''), citycode: String(p.citycode || ''), lat, lng };
  } catch {
    return null; // service injoignable : le lieu reste simplement hors carte, rien ne casse
  }
}
