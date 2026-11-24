// Lanterne — sauvegardes de la base
// Export complet (sauf sessions et liens de connexion, temporaires) en JSON, emballé dans un .zip.
// Envoyé chaque nuit par mail aux administrateurs fondateurs, et téléchargeable depuis l'administration.
import zlib from 'node:zlib';
import { all, one, q, tx } from './db.js';

// Ordre d'insertion qui respecte les liens entre tables
export const TABLES = ['images', 'associations', 'users', 'categories', 'venues', 'events', 'event_orgs', 'attendances', 'comments', 'invitations', 'history'];

export async function exportData({ withImages = true } = {}) {
  const tables = {};
  for (const t of TABLES) {
    if (t === 'images') {
      const rows = withImages ? await all('SELECT id, mime, encode(data, \'base64\') AS data_b64, created_at FROM images ORDER BY created_at') : [];
      tables.images = rows;
      continue;
    }
    tables[t] = await all(`SELECT * FROM ${t}`);
  }
  return { app: 'lanterne', format: 1, created_at: new Date().toISOString(), with_images: withImages, tables };
}

// ---------- .zip minimal (un seul fichier, compressé) ----------
function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}
export function zipOne(name, content) {
  const data = Buffer.from(content);
  const deflated = zlib.deflateRawSync(data, { level: 9 });
  const crc = zlib.crc32(data);
  const nameBuf = Buffer.from(name, 'utf8');
  const { time, date } = dosDateTime(new Date());
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(8, 8);
  local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(deflated.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10);
  central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(deflated.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const centralStart = local.length + nameBuf.length + deflated.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + nameBuf.length, 12); end.writeUInt32LE(centralStart, 16);
  return Buffer.concat([local, nameBuf, deflated, central, nameBuf, end]);
}
export function unzipOne(buf) {
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('Ce fichier n’est pas une sauvegarde Lanterne (.zip).');
  const method = buf.readUInt16LE(8);
  const size = buf.readUInt32LE(18);
  const nameLen = buf.readUInt16LE(26); const extraLen = buf.readUInt16LE(28);
  const start = 30 + nameLen + extraLen;
  const body = buf.subarray(start, start + size);
  return method === 8 ? zlib.inflateRawSync(body) : body;
}

export function backupFileName(d = new Date()) {
  return `lanterne-sauvegarde-${d.toISOString().slice(0, 16).replace(/[:T]/g, '-')}.zip`;
}

export async function buildBackup({ withImages = true } = {}) {
  const data = await exportData({ withImages });
  const json = JSON.stringify(data);
  const counts = Object.fromEntries(Object.entries(data.tables).map(([k, v]) => [k, v.length]));
  return { zip: zipOne('lanterne.json', json), counts, name: backupFileName() };
}

// ---------- restauration (utilisée par scripts/restore.mjs) ----------
export async function restoreData(data) {
  if (data?.app !== 'lanterne' || !data.tables) throw new Error('Sauvegarde Lanterne invalide.');
  await tx(async (db) => {
    await db.query(`TRUNCATE ${[...TABLES].reverse().join(', ')}, sessions, login_tokens RESTART IDENTITY CASCADE`);
    for (const t of TABLES) {
      // Par ordre de numéro : une date reportée vient après la date d'origine qu'elle cite
      const rows = [...(data.tables[t] || [])].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
      for (const r of rows) {
        const row = { ...r };
        if (t === 'images') { row.data = Buffer.from(row.data_b64, 'base64'); delete row.data_b64; }
        for (const [k, v] of Object.entries(row)) if (v && typeof v === 'object' && !(v instanceof Buffer) && !(v instanceof Date)) row[k] = JSON.stringify(v);
        const cols = Object.keys(row);
        await db.query(`INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`, cols.map((c) => row[c]));
      }
    }
    // Les compteurs automatiques repartent après le plus grand numéro restauré
    for (const t of ['associations', 'users', 'categories', 'venues', 'events', 'comments', 'invitations', 'history']) {
      await db.query(`SELECT setval(pg_get_serial_sequence('${t}', 'id'), GREATEST((SELECT COALESCE(max(id), 0) FROM ${t}), 1), (SELECT count(*) > 0 FROM ${t}))`);
    }
  });
}

// ---------- suivi : dernière sauvegarde automatique ----------
export async function getMeta(key) { return (await one('SELECT value FROM meta WHERE key = $1', [key]))?.value || null; }
export async function setMeta(key, value) {
  await q('INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value', [key, value]);
}
