// Tests des outils de l'interface qui n'ont pas besoin de navigateur : recherche, export, dates.
// Usage : node scripts/unit-test.mjs (lancé aussi par « npm test »)
import assert from 'node:assert/strict';
import { fold, searchEvents, eventsCsv, parisDate, dayKey, timeHM, eventDays, addDays, addMonths, weekday, html, raw } from '../public/lib.js';

let passed = 0;
const ok = (msg) => { passed++; console.log('  ✓', msg); };
console.log('Lanterne — tests des outils');

// ---------- gabarit HTML ----------
assert.equal(String(html`<b>${'<script>'}</b>${raw('<i>')}${['a&b', raw('<u>')]}${null}${false}`), '<b>&lt;script&gt;</b><i>a&amp;b<u>');
ok('le gabarit HTML échappe tout ce qui n’est pas marqué comme sûr');

// ---------- dates à l'heure de Paris ----------
assert.equal(parisDate('2026-07-14', '20:30').toISOString(), '2026-07-14T18:30:00.000Z'); // heure d'été
assert.equal(parisDate('2026-12-24', '20:30').toISOString(), '2026-12-24T19:30:00.000Z'); // heure d'hiver
assert.equal(dayKey('2026-12-31T23:30:00.000Z'), '2027-01-01');
assert.equal(timeHM('2026-12-24T19:30:00.000Z'), '20h30');
assert.equal(addDays('2026-02-28', 1), '2026-03-01');
assert.equal(addMonths('2026-12', 1), '2027-01');
assert.equal(weekday('2026-11-23'), 0); // un lundi
ok('dates : heure d’été, heure d’hiver, passage d’année, lundi en premier');

const soiree = { starts_at: parisDate('2026-06-12', '21:00'), ends_at: parisDate('2026-06-13', '03:00') };
const festival = { starts_at: parisDate('2026-06-12', '18:00'), ends_at: parisDate('2026-06-14', '19:00') };
assert.deepEqual(eventDays(soiree), ['2026-06-12']);
assert.deepEqual(eventDays(festival), ['2026-06-12', '2026-06-13', '2026-06-14']);
ok('une soirée qui finit à 3 h reste sur son jour ; un festival couvre ses trois jours');

// ---------- recherche ----------
const events = [
  { id: 1, title: 'Fête de la Saint-Éloi', asso_name: 'Les Amis du Fil', orgs: [{ id: 1, name: 'Les Amis du Fil' }, { id: 2, name: 'Quartier Libre' }],
    venue_name: 'Le Fil', venue_city: 'Saint-Étienne', venue_district: 'Châteaucreux', category_name: 'Concert', description: 'Bal et fanfare' },
  { id: 2, title: 'Assemblée générale', asso_name: 'Quartier Libre', orgs: [{ id: 2, name: 'Quartier Libre' }],
    venue_name: 'MJC de Beaubrun', venue_city: 'Saint-Étienne', venue_district: '', category_name: 'Assemblée générale', description: '' },
];
assert.equal(fold('Saint-Étienne  CHÂTEAUCREUX'), 'saint-etienne  chateaucreux');
assert.deepEqual(searchEvents(events, '').map((e) => e.id), [1, 2]);
assert.deepEqual(searchEvents(events, 'eloi').map((e) => e.id), [1]);
assert.deepEqual(searchEvents(events, 'ASSEMBLEE').map((e) => e.id), [2]);
assert.deepEqual(searchEvents(events, 'chateaucreux fanfare').map((e) => e.id), [1]);
assert.deepEqual(searchEvents(events, 'quartier libre').map((e) => e.id), [1, 2]); // co-organisatrice comprise
assert.deepEqual(searchEvents(events, 'beaubrun fanfare'), []);
ok('recherche : sans accents ni majuscules, tous les mots, dans le titre, l’association, le lieu, la catégorie et la description');

// ---------- export CSV ----------
const csv = eventsCsv([{
  id: 7, title: '=SOMME(A1) ; "concert"', starts_at: parisDate('2026-12-24', '20:30'), ends_at: parisDate('2026-12-25', '01:00'),
  status: 'valide', type: 'public', visibility: 'associations', category_name: 'Concert', asso_name: 'Les Amis du Fil', association_id: 1,
  orgs: [{ id: 1, name: 'Les Amis du Fil' }, { id: 2, name: 'Quartier Libre' }], venue_name: 'Le Fil', venue_address: '20 boulevard Thiers',
  venue_city: 'Saint-Étienne', venue_district: '', price: 'Prix\nlibre', link: 'https://exemple.fr',
  attendances: [{ id: 3, name: 'Fanfare', kind: 'going' }, { id: 4, name: 'Chorale', kind: 'interested' }],
}], 'https://lanterne.test');
assert.ok(csv.startsWith('﻿Date;Début;Date de fin;Fin;Titre;'));
const [head, line, rest] = csv.slice(1).split('\r\n');
assert.equal(rest, '');
assert.equal(head.split(';').length, 20);
assert.equal(line, '24/12/2026;20:30;25/12/2026;01:00;"\'=SOMME(A1) ; ""concert""";Validé;Public;Associations;Concert;Les Amis du Fil;Quartier Libre;'
  + 'Le Fil;20 boulevard Thiers;Saint-Étienne;;Prix libre;https://exemple.fr;Fanfare;Chorale;https://lanterne.test/evenement/7');
ok('export : accents lisibles par Excel, point-virgule, guillemets doublés, formules neutralisées, heure de Paris');

console.log(`\n${passed} vérifications réussies.`);
