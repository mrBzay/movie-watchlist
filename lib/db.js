'use server';

import { sql as pooledSql } from '@vercel/postgres';
import { randomUUID } from 'crypto';

const DEFAULT_USER_EMAIL = process.env.DEFAULT_USER_EMAIL?.toLowerCase() ?? 'demo@example.com';

function normalizeConnectionString(value) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^postgresql:\/\//i, 'postgres://');
}

const directCandidates = [
  process.env.DIRECT_URL,
  process.env.POSTGRES_URL_NON_POOLING,
  process.env.WATCHLIST_POSTGRES_URL_NON_POOLING,
  process.env.WATCHLIST_DATABASE_URL_UNPOOLED,
]
  .map(normalizeConnectionString)
  .filter(Boolean);

const pooledCandidates = [
  process.env.DATABASE_URL,
  process.env.POSTGRES_URL,
  process.env.WATCHLIST_DATABASE_URL,
  process.env.WATCHLIST_POSTGRES_URL,
]
  .map(normalizeConnectionString)
  .filter(Boolean);

const CONNECTION_STRING = pooledCandidates[0] || directCandidates[0] || null;

const directPreference = new Set(directCandidates);

const shouldUseDirectClient = (() => {
  if (!CONNECTION_STRING) return false;
  if (directPreference.has(CONNECTION_STRING)) {
    return true;
  }
  const lowered = CONNECTION_STRING.toLowerCase();
  if (lowered.includes('pooler') || lowered.includes('connection_limit')) {
    return false;
  }
  return (
    lowered.includes('localhost') ||
    lowered.includes('127.0.0.1') ||
    lowered.includes('::1') ||
    lowered.includes('non_pooling') ||
    lowered.includes('direct')
  );
})();

let directExecutorPromise;

async function getExecutor() {
  if (!shouldUseDirectClient) {
    return pooledSql;
  }

  if (!CONNECTION_STRING) {
    throw new Error(
      'DATABASE_URL (or POSTGRES_URL) must be set to use a direct Postgres connection.',
    );
  }

  if (!directExecutorPromise) {
    directExecutorPromise = (async () => {
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: CONNECTION_STRING, ssl: resolveSslOptions(CONNECTION_STRING) });

      return async (strings, ...values) => {
        const text = strings.reduce(
          (acc, segment, index) => `${acc}${segment}${index < values.length ? `$${index + 1}` : ''}`,
          '',
        );
        const result = await pool.query(text, values);
        return result;
      };
    })();
  }

  return directExecutorPromise;
}

async function query(sqlSegments, ...values) {
  const executor = await getExecutor();
  return executor(sqlSegments, ...values);
}

function resolveSslOptions(connectionString) {
  if (!connectionString) return undefined;
  const lower = connectionString.toLowerCase();
  if (lower.includes('localhost') || lower.includes('127.0.0.1') || lower.includes('::1')) {
    return false;
  }
  if (lower.includes('sslmode=disable')) {
    return false;
  }
  if (lower.includes('sslmode=require') || lower.includes('ssl=true')) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

let schemaPromise;

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await query`
        CREATE TABLE IF NOT EXISTS users (
          id uuid PRIMARY KEY,
          email text UNIQUE NOT NULL,
          created_at timestamptz DEFAULT timezone('utc', now())
        )
      `;

      await query`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash text`;
      await query`ALTER TABLE users ADD COLUMN IF NOT EXISTS role text`;
      await query`ALTER TABLE users ADD COLUMN IF NOT EXISTS omdb_api_key text`;
      await query`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at timestamptz`;
      await query`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user'`;
      await query`
        ALTER TABLE users
        ALTER COLUMN updated_at
        SET DEFAULT timezone('utc', now())
      `;
      await query`UPDATE users SET role = 'user' WHERE role IS NULL`;
      await query`
        UPDATE users
        SET updated_at = timezone('utc', now())
        WHERE updated_at IS NULL
      `;
      await query`CREATE INDEX IF NOT EXISTS idx_users_email_lower ON users ((lower(email)))`;

      await query`
        CREATE TABLE IF NOT EXISTS movies (
          id uuid PRIMARY KEY,
          title text NOT NULL,
          year text,
          genre text,
          imdb_rating text,
          rotten_tomatoes text,
          metacritic text,
          poster_url text,
          plot text,
          letterboxd text,
          created_at timestamptz DEFAULT timezone('utc', now()),
          updated_at timestamptz DEFAULT timezone('utc', now())
        )
      `;

      await query`ALTER TABLE movies ADD COLUMN IF NOT EXISTS genre text`;

      await query`
        CREATE TABLE IF NOT EXISTS watch_list (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          movie_id uuid NOT NULL REFERENCES movies(id) ON DELETE CASCADE,
          watched boolean DEFAULT false,
          added_at timestamptz DEFAULT timezone('utc', now()),
          updated_at timestamptz DEFAULT timezone('utc', now()),
          UNIQUE(user_id, movie_id)
        )
      `;

      await query`
        CREATE TABLE IF NOT EXISTS sessions (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          session_token text UNIQUE NOT NULL,
          expires_at timestamptz NOT NULL,
          created_at timestamptz DEFAULT timezone('utc', now())
        )
      `;

      await query`CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions (session_token)`;
      await query`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id)`;
    })();
  }
  return schemaPromise;
}

function toNull(value) {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toUrl(value) {
  const trimmed = toNull(value);
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    return url.toString();
  } catch (error) {
    console.warn('Ignoring invalid URL', trimmed, error);
    return null;
  }
}

function toDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  if (typeof value === 'string' && value) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

function sanitizeMoviePayload(payload) {
  const safeTitle = toNull(payload?.title);
  if (!safeTitle) {
    const error = new Error('Title is required');
    error.status = 400;
    throw error;
  }

  return {
    title: safeTitle,
    year: toNull(payload?.year),
    imdb: toNull(payload?.imdb),
    rottenTomatoes: toNull(payload?.rottenTomatoes),
    metacritic: toNull(payload?.metacritic),
    letterboxd: toNull(payload?.letterboxd),
    posterUrl: toUrl(payload?.posterUrl),
    plot: toNull(payload?.plot),
    genre: toNull(payload?.genre),
    watched: Boolean(payload?.watched),
    addedAt: toDate(payload?.addedAt ?? Date.now()),
  };
}

function mapWatchlistRow(row) {
  return {
    id: row.watchlist_id,
    movieId: row.movie_id,
    title: row.title,
    year: row.year ?? '',
    imdb: row.imdb_rating ?? '',
    rottenTomatoes: row.rotten_tomatoes ?? '',
    metacritic: row.metacritic ?? '',
    genre: row.genre ?? '',
    posterUrl: row.poster_url ?? '',
    plot: row.plot ?? '',
    letterboxd: row.letterboxd ?? '',
    watched: row.watched,
    addedAt: row.added_at ? new Date(row.added_at).getTime() : Date.now(),
  };
}

export async function getDefaultUser() {
  await ensureSchema();
  const email = DEFAULT_USER_EMAIL;
  const { rows } = await query`
    INSERT INTO users (id, email)
    VALUES (${randomUUID()}, ${email})
    ON CONFLICT (email)
    DO UPDATE SET email = EXCLUDED.email
    RETURNING id, email
  `;
  return rows[0];
}

export async function listWatchlist(userId) {
  await ensureSchema();
  const { rows } = await query`
    SELECT
      wl.id AS watchlist_id,
      wl.watched,
      wl.added_at,
      m.id AS movie_id,
      m.title,
      m.year,
      m.imdb_rating,
      m.genre,
      m.rotten_tomatoes,
      m.metacritic,
      m.poster_url,
      m.plot,
      m.letterboxd
    FROM watch_list wl
    INNER JOIN movies m ON m.id = wl.movie_id
    WHERE wl.user_id = ${userId}
    ORDER BY wl.added_at DESC
  `;
  return rows.map(mapWatchlistRow);
}

export async function getWatchlistEntry(userId, watchlistId) {
  await ensureSchema();
  const { rows } = await query`
    SELECT
      wl.id AS watchlist_id,
      wl.watched,
      wl.added_at,
      m.id AS movie_id,
      m.title,
      m.year,
      m.imdb_rating,
      m.genre,
      m.rotten_tomatoes,
      m.metacritic,
      m.poster_url,
      m.plot,
      m.letterboxd
    FROM watch_list wl
    INNER JOIN movies m ON m.id = wl.movie_id
    WHERE wl.user_id = ${userId} AND wl.id = ${watchlistId}
    LIMIT 1
  `;
  if (!rows.length) return null;
  return mapWatchlistRow(rows[0]);
}

export async function createWatchlistEntry(userId, payload) {
  await ensureSchema();
  const cleaned = sanitizeMoviePayload(payload);
  const movieId = randomUUID();
  const watchlistId = randomUUID();
  const addedAt = cleaned.addedAt;
  const now = new Date();

  await query`
    INSERT INTO movies (
      id,
      title,
      year,
      imdb_rating,
      genre,
      rotten_tomatoes,
      metacritic,
      poster_url,
      plot,
      letterboxd,
      created_at,
      updated_at
    )
    VALUES (
      ${movieId},
      ${cleaned.title},
      ${cleaned.year},
      ${cleaned.imdb},
      ${cleaned.genre},
      ${cleaned.rottenTomatoes},
      ${cleaned.metacritic},
      ${cleaned.posterUrl},
      ${cleaned.plot},
      ${cleaned.letterboxd},
      ${now.toISOString()},
      ${now.toISOString()}
    )
  `;

  await query`
    INSERT INTO watch_list (
      id,
      user_id,
      movie_id,
      watched,
      added_at,
      updated_at
    )
    VALUES (
      ${watchlistId},
      ${userId},
      ${movieId},
      ${cleaned.watched},
      ${addedAt.toISOString()},
      ${now.toISOString()}
    )
  `;

  return getWatchlistEntry(userId, watchlistId);
}

export async function updateWatchlistEntry(userId, watchlistId, payload) {
  await ensureSchema();
  const cleaned = sanitizeMoviePayload(payload);
  const now = new Date();

  const { rows } = await query`
    SELECT movie_id FROM watch_list WHERE id = ${watchlistId} AND user_id = ${userId}
  `;
  if (!rows.length) {
    const error = new Error('Watchlist entry not found');
    error.status = 404;
    throw error;
  }
  const movieId = rows[0].movie_id;

  await query`
    UPDATE movies
    SET
      title = ${cleaned.title},
      year = ${cleaned.year},
      imdb_rating = ${cleaned.imdb},
      genre = ${cleaned.genre},
      rotten_tomatoes = ${cleaned.rottenTomatoes},
      metacritic = ${cleaned.metacritic},
      poster_url = ${cleaned.posterUrl},
      plot = ${cleaned.plot},
      letterboxd = ${cleaned.letterboxd},
      updated_at = ${now.toISOString()}
    WHERE id = ${movieId}
  `;

  await query`
    UPDATE watch_list
    SET
      watched = ${cleaned.watched},
      added_at = ${cleaned.addedAt.toISOString()},
      updated_at = ${now.toISOString()}
    WHERE id = ${watchlistId} AND user_id = ${userId}
  `;

  return getWatchlistEntry(userId, watchlistId);
}

export async function deleteWatchlistEntry(userId, watchlistId) {
  await ensureSchema();
  const { rows } = await query`
    DELETE FROM watch_list
    WHERE id = ${watchlistId} AND user_id = ${userId}
    RETURNING movie_id
  `;
  if (!rows.length) {
    const error = new Error('Watchlist entry not found');
    error.status = 404;
    throw error;
  }
  const movieId = rows[0].movie_id;

  const { rows: remaining } = await query`
    SELECT COUNT(*)::int AS count
    FROM watch_list
    WHERE movie_id = ${movieId}
  `;

  if (remaining[0]?.count === 0) {
    await query`DELETE FROM movies WHERE id = ${movieId}`;
  }
}

function mapUserRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    role: row.role || 'user',
    omdbKey: row.omdb_api_key ?? '',
    createdAt: row.created_at ? new Date(row.created_at) : null,
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
  };
}

export async function createUser({ email, passwordHash, role = 'user' }) {
  await ensureSchema();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    const error = new Error('Email is required');
    error.status = 400;
    throw error;
  }

  const now = new Date().toISOString();
  const id = randomUUID();

  const { rows } = await query`
    INSERT INTO users (id, email, password_hash, role, created_at, updated_at)
    VALUES (${id}, ${normalizedEmail}, ${passwordHash}, ${role}, ${now}, ${now})
    RETURNING id, email, role, omdb_api_key, created_at, updated_at
  `;

  return mapUserRow(rows[0]);
}

export async function findUserByEmail(email) {
  await ensureSchema();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return null;

  const { rows } = await query`
    SELECT id, email, role, omdb_api_key, password_hash, created_at, updated_at
    FROM users
    WHERE lower(email) = ${normalizedEmail}
    LIMIT 1
  `;

  if (!rows.length) return null;

  return {
    ...mapUserRow(rows[0]),
    passwordHash: rows[0].password_hash || null,
  };
}

export async function getUserById(userId) {
  await ensureSchema();
  if (!userId) return null;

  const { rows } = await query`
    SELECT id, email, role, omdb_api_key, created_at, updated_at
    FROM users
    WHERE id = ${userId}
    LIMIT 1
  `;

  return mapUserRow(rows[0]);
}

export async function listUsers() {
  await ensureSchema();
  const { rows } = await query`
    SELECT id, email, role, created_at, updated_at
    FROM users
    ORDER BY created_at ASC
  `;

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role || 'user',
    createdAt: row.created_at ? new Date(row.created_at) : null,
    updatedAt: row.updated_at ? new Date(row.updated_at) : null,
  }));
}

export async function updateUserRole(userId, role) {
  await ensureSchema();
  if (!userId) {
    const error = new Error('User ID is required');
    error.status = 400;
    throw error;
  }

  const normalizedRole = String(role || '').trim() || 'user';
  const now = new Date().toISOString();

  const { rows } = await query`
    UPDATE users
    SET role = ${normalizedRole}, updated_at = ${now}
    WHERE id = ${userId}
    RETURNING id, email, role, omdb_api_key, created_at, updated_at
  `;

  if (!rows.length) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  return mapUserRow(rows[0]);
}

export async function updateUserOmdbKey(userId, omdbKey) {
  await ensureSchema();
  if (!userId) {
    const error = new Error('User ID is required');
    error.status = 400;
    throw error;
  }

  const now = new Date().toISOString();
  const sanitizedKey = typeof omdbKey === 'string' ? omdbKey.trim() : null;

  const { rows } = await query`
    UPDATE users
    SET omdb_api_key = ${sanitizedKey || null}, updated_at = ${now}
    WHERE id = ${userId}
    RETURNING id, email, role, omdb_api_key, created_at, updated_at
  `;

  if (!rows.length) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  return mapUserRow(rows[0]);
}

export async function setUserPassword(userId, passwordHash) {
  await ensureSchema();
  if (!userId) {
    const error = new Error('User ID is required');
    error.status = 400;
    throw error;
  }

  const now = new Date().toISOString();

  const { rows } = await query`
    UPDATE users
    SET password_hash = ${passwordHash}, updated_at = ${now}
    WHERE id = ${userId}
    RETURNING id, email, role, omdb_api_key, created_at, updated_at
  `;

  if (!rows.length) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }

  return mapUserRow(rows[0]);
}

export async function createSession(userId, sessionToken, expiresAt) {
  await ensureSchema();
  if (!userId || !sessionToken || !expiresAt) {
    const error = new Error('Invalid session payload');
    error.status = 400;
    throw error;
  }

  const sessionId = randomUUID();

  await query`
    INSERT INTO sessions (id, user_id, session_token, expires_at)
    VALUES (${sessionId}, ${userId}, ${sessionToken}, ${expiresAt.toISOString()})
  `;
}

export async function getSessionWithUser(sessionToken) {
  await ensureSchema();
  if (!sessionToken) return null;

  const { rows } = await query`
    SELECT
      s.id AS session_id,
      s.user_id,
      s.session_token,
      s.expires_at,
      u.id,
      u.email,
      u.role,
      u.omdb_api_key,
      u.created_at,
      u.updated_at
    FROM sessions s
    INNER JOIN users u ON u.id = s.user_id
    WHERE s.session_token = ${sessionToken}
      AND s.expires_at > timezone('utc', now())
    LIMIT 1
  `;

  if (!rows.length) return null;

  const session = rows[0];

  return {
    sessionId: session.session_id,
    userId: session.user_id,
    expiresAt: session.expires_at ? new Date(session.expires_at) : null,
    user: mapUserRow(session),
  };
}

export async function deleteSession(sessionToken) {
  await ensureSchema();
  if (!sessionToken) return;

  await query`
    DELETE FROM sessions
    WHERE session_token = ${sessionToken}
  `;
}

export async function deleteUserSessions(userId) {
  await ensureSchema();
  if (!userId) return;

  await query`
    DELETE FROM sessions
    WHERE user_id = ${userId}
  `;
}
