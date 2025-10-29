'use server';

import { sql } from '@vercel/postgres';
import { randomUUID } from 'crypto';

const DEFAULT_USER_EMAIL = process.env.DEFAULT_USER_EMAIL?.toLowerCase() ?? 'demo@example.com';

let schemaPromise;

async function ensureSchema() {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await sql`
        CREATE TABLE IF NOT EXISTS users (
          id uuid PRIMARY KEY,
          email text UNIQUE NOT NULL,
          created_at timestamptz DEFAULT timezone('utc', now())
        )
      `;

      await sql`
        CREATE TABLE IF NOT EXISTS movies (
          id uuid PRIMARY KEY,
          title text NOT NULL,
          year text,
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

      await sql`
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
  const { rows } = await sql`
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
  const { rows } = await sql`
    SELECT
      wl.id AS watchlist_id,
      wl.watched,
      wl.added_at,
      m.id AS movie_id,
      m.title,
      m.year,
      m.imdb_rating,
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
  const { rows } = await sql`
    SELECT
      wl.id AS watchlist_id,
      wl.watched,
      wl.added_at,
      m.id AS movie_id,
      m.title,
      m.year,
      m.imdb_rating,
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

  await sql`
    INSERT INTO movies (
      id,
      title,
      year,
      imdb_rating,
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
      ${cleaned.rottenTomatoes},
      ${cleaned.metacritic},
      ${cleaned.posterUrl},
      ${cleaned.plot},
      ${cleaned.letterboxd},
      ${now.toISOString()},
      ${now.toISOString()}
    )
  `;

  await sql`
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

  const { rows } = await sql`
    SELECT movie_id FROM watch_list WHERE id = ${watchlistId} AND user_id = ${userId}
  `;
  if (!rows.length) {
    const error = new Error('Watchlist entry not found');
    error.status = 404;
    throw error;
  }
  const movieId = rows[0].movie_id;

  await sql`
    UPDATE movies
    SET
      title = ${cleaned.title},
      year = ${cleaned.year},
      imdb_rating = ${cleaned.imdb},
      rotten_tomatoes = ${cleaned.rottenTomatoes},
      metacritic = ${cleaned.metacritic},
      poster_url = ${cleaned.posterUrl},
      plot = ${cleaned.plot},
      letterboxd = ${cleaned.letterboxd},
      updated_at = ${now.toISOString()}
    WHERE id = ${movieId}
  `;

  await sql`
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
  const { rows } = await sql`
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

  const { rows: remaining } = await sql`
    SELECT COUNT(*)::int AS count
    FROM watch_list
    WHERE movie_id = ${movieId}
  `;

  if (remaining[0]?.count === 0) {
    await sql`DELETE FROM movies WHERE id = ${movieId}`;
  }
}

