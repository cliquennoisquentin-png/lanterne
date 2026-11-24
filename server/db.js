// Accès base : PostgreSQL en production (DATABASE_URL), PGlite (Postgres embarqué) en local.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

let impl;

export async function initDb() {
  if (process.env.DATABASE_URL) {
    const pg = (await import('pg')).default;
    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
      max: 10,
    });
    impl = {
      close: () => pool.end(),
      query: (text, params) => pool.query(text, params),
      exec: (text) => pool.query(text),
      async tx(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const res = await fn({ query: (t, p) => client.query(t, p) });
          await client.query('COMMIT');
          return res;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      },
    };
    console.log('[db] PostgreSQL');
  } else {
    const { PGlite } = await import('@electric-sql/pglite');
    const dir = process.env.PGLITE_DIR || path.join(here, '..', '.data');
    const lite = new PGlite(dir);
    await lite.waitReady;
    impl = {
      close: () => lite.close(),
      query: (text, params) => lite.query(text, params),
      exec: (text) => lite.exec(text),
      tx: (fn) => lite.transaction((tx) => fn({ query: (t, p) => tx.query(t, p) })),
    };
    console.log('[db] PGlite local :', dir);
  }
  await impl.exec(fs.readFileSync(path.join(here, 'schema.sql'), 'utf8'));
  await seed();
}

export const q = (text, params = []) => impl.query(text, params);
export const one = async (text, params = []) => (await impl.query(text, params)).rows[0] || null;
export const all = async (text, params = []) => (await impl.query(text, params)).rows;
export const tx = (fn) => impl.tx(fn);
export const closeDb = () => impl?.close?.();

// Catégories de départ (cahier des charges §3) — uniquement si la table est vide
const DEFAULT_CATEGORIES = [
  'Concert', 'Soirée', 'Spectacle', 'Exposition', 'Festival', 'Sport', 'Atelier',
  'Marché / vide-grenier', 'Conférence', 'Réunion', 'Assemblée générale',
];

async function seed() {
  const n = await one('SELECT count(*)::int AS n FROM categories');
  if (n.n === 0) {
    for (const [i, name] of DEFAULT_CATEGORIES.entries()) {
      await q('INSERT INTO categories (name, position) VALUES ($1, $2) ON CONFLICT DO NOTHING', [name, i]);
    }
  }
}
