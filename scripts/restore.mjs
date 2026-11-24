// Restaure une sauvegarde Lanterne (.zip) dans la base.
// ATTENTION : remplace tout le contenu de la base par celui de la sauvegarde.
//
// Usage :
//   DATABASE_URL=postgres://… npm run restore -- chemin/lanterne-sauvegarde-….zip --confirmer
//   (sans DATABASE_URL : base locale de test dans .data/)
import fs from 'node:fs';
import { initDb, closeDb, all } from '../server/db.js';
import { restoreData, unzipOne, TABLES } from '../server/backup.js';

const file = process.argv.slice(2).find((a) => !a.startsWith('--'));
const confirmed = process.argv.includes('--confirmer');
if (!file) {
  console.error('Indiquez le fichier de sauvegarde : npm run restore -- lanterne-sauvegarde-….zip --confirmer');
  process.exit(1);
}
const data = JSON.parse(unzipOne(fs.readFileSync(file)).toString('utf8'));
const counts = Object.fromEntries(TABLES.map((t) => [t, (data.tables?.[t] || []).length]));
console.log(`Sauvegarde du ${data.created_at}${data.with_images ? '' : ' (sans images)'} :`);
console.log(counts);
if (!confirmed) {
  console.log('\nRien n’a été modifié. Pour remplacer la base par cette sauvegarde, relancez avec --confirmer.');
  process.exit(0);
}
await initDb();
await restoreData(data);
const after = {};
for (const t of TABLES) after[t] = (await all(`SELECT count(*)::int AS n FROM ${t}`))[0].n;
console.log('\nBase restaurée :', after);
await closeDb();
