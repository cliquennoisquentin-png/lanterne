// Génération de fichiers iCalendar (.ics) : ajout à son agenda et liens d'abonnement.

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => {
  const x = new Date(d);
  return `${x.getUTCFullYear()}${pad(x.getUTCMonth() + 1)}${pad(x.getUTCDate())}T${pad(x.getUTCHours())}${pad(x.getUTCMinutes())}${pad(x.getUTCSeconds())}Z`;
};
const escText = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Lignes de 75 octets maximum (RFC 5545)
function fold(line) {
  const out = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) { out.push(cur); cur = ch; } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

const STATUS_LABEL = { option: 'Option', en_cours: 'En cours', valide: 'Validé', annule: 'Annulé' };

export function buildCalendar(events, { name = 'Lanterne', baseUrl = '' } = {}) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Lanterne//Agenda commun//FR', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escText(name)}`, 'X-WR-TIMEZONE:Europe/Paris', 'REFRESH-INTERVAL;VALUE=DURATION:PT1H', 'X-PUBLISHED-TTL:PT1H',
  ];
  for (const e of events) {
    const end = e.ends_at || new Date(new Date(e.starts_at).getTime() + 2 * 3600 * 1000);
    const loc = [e.venue_name, e.venue_address].filter(Boolean).join(', ');
    const url = `${baseUrl}/evenement/${e.id}`;
    const statusPrefix = e.status === 'annule' ? 'ANNULÉ · ' : e.status === 'option' ? '(option) ' : '';
    const desc = [
      e.orgs ? `Par : ${e.orgs}` : '',
      `Statut : ${STATUS_LABEL[e.status] || e.status}`,
      e.price ? `Tarif : ${e.price}` : '',
      e.description || '',
      e.link ? `Lien : ${e.link}` : '',
      `Sur Lanterne : ${url}`,
    ].filter(Boolean).join('\n');
    lines.push(
      'BEGIN:VEVENT',
      `UID:lanterne-${e.id}@lanterne`,
      `DTSTAMP:${stamp(e.updated_at || new Date())}`,
      `LAST-MODIFIED:${stamp(e.updated_at || new Date())}`,
      `DTSTART:${stamp(e.starts_at)}`,
      `DTEND:${stamp(end)}`,
      `SUMMARY:${escText(statusPrefix + e.title)}`,
      `DESCRIPTION:${escText(desc)}`,
      loc ? `LOCATION:${escText(loc)}` : null,
      e.lat != null && e.lng != null ? `GEO:${e.lat};${e.lng}` : null,
      `URL:${url}`,
      `STATUS:${e.status === 'annule' ? 'CANCELLED' : e.status === 'valide' ? 'CONFIRMED' : 'TENTATIVE'}`,
      e.category_name ? `CATEGORIES:${escText(e.category_name)}` : null,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  return lines.filter(Boolean).map(fold).join('\r\n') + '\r\n';
}
