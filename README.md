# Movie Watchlist

A Next.js watchlist that keeps your favourite films organised with rich metadata, weighted ratings, and persistent storage in Vercel Postgres. The UI reuses the original Tailwind styles while the backend now runs through Next.js API routes.

## Features
- **Smart ratings** – Combined /100 score using your weightings (IMDb × 0.5, Rotten Tomatoes × 0.3, Metacritic × 0.2) with graceful fallbacks.
- **OMDb auto-fill** – One-click lookup (title + optional year) to populate poster art, synopsis, and critic scores.
- **Watch states & filters** – Mark movies as watched/unwatched, filter by status, and search/sort by title, year, recency, or score.
- **Database persistence** – Entries live in Postgres (`users`, `movies`, `watch_list`). First-time visitors with existing `localStorage` data get prompted to import it into the database automatically.
- **API-first** – All CRUD operations go through Next.js route handlers (`/api/watchlist`), keeping the React client focused on rendering.

## Tech Stack
- [Next.js 14](https://nextjs.org/) with the App Router
- React 18 client components
- Tailwind CSS 3
- [Vercel Postgres](https://vercel.com/postgres) via `@vercel/postgres`

## Getting Started
1. **Install dependencies** (Node 18.17+):
   ```bash
   npm install
   ```
2. **Configure environment** – copy the example file and populate your secrets:
   ```bash
   cp .env.example .env.local
   ```
   Required keys:
   - `DATABASE_URL` – main connection string from Vercel Postgres
   - `DIRECT_URL` – (optional) direct connection string for migrations/seed scripts
   - `DEFAULT_USER_EMAIL` – fallback identifier for local development (defaults to `demo@example.com`)
3. **Run the app locally**:
   ```bash
   npm run dev
   ```
   The dev server runs at [http://localhost:3000](http://localhost:3000).
4. **Lint** (optional):
   ```bash
   npm run lint
   ```

> **Note:** the provided `lib/db.js` helper creates the tables on first use. For production you should replace this with proper migrations (e.g. Drizzle, Prisma) and run them before deploying.

## Database Schema
Tables are created automatically with the following structure:
- `users (id, email, created_at)` – uniquely identifies a viewer; the default user is upserted using `DEFAULT_USER_EMAIL`.
- `movies (id, title, year, imdb_rating, rotten_tomatoes, metacritic, poster_url, plot, letterboxd, timestamps)` – metadata for each movie.
- `watch_list (id, user_id, movie_id, watched, added_at, updated_at)` – links users to movies and captures watch status + ordering.

Relationships ensure cascading deletes when a user entry is removed, and duplicate `(user_id, movie_id)` pairs are prevented.

## Local Data Import
If you previously used the Vite/localStorage version:
- Keep the existing browser data (`watchlist.v1` or `watchlist-movies`).
- On first load of the Next.js app, the client will POST each saved movie to the API, clear the old storage keys, and refresh the list.

## OMDb Integration
1. Request a free API key from [omdbapi.com](https://www.omdbapi.com/apikey.aspx).
2. Click **OMDb Key** in the header and paste the key. It is stored in `localStorage` only on the client.
3. When adding/editing a movie, enter a title (and optional year) then press **Fetch from OMDb** to auto-fill the fields.

## Deployment (Vercel)
1. Provision a Vercel Postgres database and copy the `DATABASE_URL` (+ `DIRECT_URL` for migrations).
2. Add the environment variables in **Vercel → Project Settings → Environment Variables** for Preview & Production.
3. Deploy as usual; the API routes will connect using the Vercel-managed connection string at runtime.
4. Consider replacing the runtime table creation with repeatable migrations once the schema stabilises.

Happy movie tracking!
