// Charge le fichier .env en local (modèle : .env.example). Sur Railway il n'y a pas de fichier .env :
// les variables viennent du tableau de bord. Une variable déjà définie garde toujours la priorité.
// Pendant les tests (NODE_ENV=test), on ne lit rien : jamais la vraie base, jamais de vrai mail.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
if (process.env.NODE_ENV !== 'test' && fs.existsSync(file)) {
  try { process.loadEnvFile(file); } catch (err) { console.error('[env] fichier .env illisible :', err.message); }
}
