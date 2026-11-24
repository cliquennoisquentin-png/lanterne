-- Lanterne : schéma de la base (idempotent, rejoué à chaque démarrage)

CREATE TABLE IF NOT EXISTS images (
  id          TEXT PRIMARY KEY,
  mime        TEXT NOT NULL,
  data        BYTEA NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS associations (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,
  color        TEXT NOT NULL DEFAULT '#2B8FD9',
  logo_id      TEXT REFERENCES images(id) ON DELETE SET NULL,
  description  TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  phone        TEXT NOT NULL DEFAULT '',
  website      TEXT NOT NULL DEFAULT '',
  socials      JSONB NOT NULL DEFAULT '{}'::jsonb,
  commune      TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  name           TEXT NOT NULL DEFAULT '',
  association_id INTEGER REFERENCES associations(id) ON DELETE SET NULL,
  is_admin       BOOLEAN NOT NULL DEFAULT false,
  ics_token      TEXT NOT NULL UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash  TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS invitations (
  id             SERIAL PRIMARY KEY,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  invited_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  token_hash     TEXT NOT NULL UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at    TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS categories (
  id        SERIAL PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE,
  position  INTEGER NOT NULL DEFAULT 0,
  active    BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS venues (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  address     TEXT NOT NULL DEFAULT '',
  city        TEXT NOT NULL DEFAULT '',
  citycode    TEXT NOT NULL DEFAULT '',
  district    TEXT NOT NULL DEFAULT '',
  lat         DOUBLE PRECISION,
  lng         DOUBLE PRECISION,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived    BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS events (
  id               SERIAL PRIMARY KEY,
  association_id   INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  title            TEXT NOT NULL,
  starts_at        TIMESTAMPTZ NOT NULL,
  ends_at          TIMESTAMPTZ,
  venue_id         INTEGER REFERENCES venues(id) ON DELETE SET NULL,
  category_id      INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  type             TEXT NOT NULL DEFAULT 'public' CHECK (type IN ('public','internal','inter','ag')),
  status           TEXT NOT NULL DEFAULT 'option' CHECK (status IN ('option','en_cours','valide','annule')),
  visibility       TEXT NOT NULL DEFAULT 'associations' CHECK (visibility IN ('public','associations','private')),
  description      TEXT NOT NULL DEFAULT '',
  image_id         TEXT REFERENCES images(id) ON DELETE SET NULL,
  link             TEXT NOT NULL DEFAULT '',
  price            TEXT NOT NULL DEFAULT '',
  rescheduled_from INTEGER REFERENCES events(id) ON DELETE SET NULL,
  created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS events_starts_idx ON events (starts_at);

-- Co-organisation : toutes les associations rattachées (y compris la créatrice)
CREATE TABLE IF NOT EXISTS event_orgs (
  event_id       INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  PRIMARY KEY (event_id, association_id)
);

-- « On y va » / « Intéressé »
CREATE TABLE IF NOT EXISTS attendances (
  event_id       INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  association_id INTEGER NOT NULL REFERENCES associations(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('going','interested')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, association_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id             SERIAL PRIMARY KEY,
  event_id       INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  author_name    TEXT NOT NULL DEFAULT '',
  association_id INTEGER REFERENCES associations(id) ON DELETE SET NULL,
  body           TEXT NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at     TIMESTAMPTZ
);

-- Historique : qui a modifié quoi, pour pouvoir revenir en arrière
CREATE TABLE IF NOT EXISTS history (
  id          SERIAL PRIMARY KEY,
  entity      TEXT NOT NULL,
  entity_id   INTEGER NOT NULL,
  action      TEXT NOT NULL,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name   TEXT NOT NULL DEFAULT '',
  association_name TEXT NOT NULL DEFAULT '',
  before      JSONB,
  after       JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS history_entity_idx ON history (entity, entity_id);

-- Évolutions
ALTER TABLE venues ADD COLUMN IF NOT EXISTS district TEXT NOT NULL DEFAULT '';
