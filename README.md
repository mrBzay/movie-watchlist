# Movie Watchlist

A modern Vite + React watchlist that keeps your favorite films organised with rich metadata, weighted ratings, and persistent storage — all wrapped in a Tailwind-styled UI.

## Features
- **Smart ratings** – Calculates a combined score out of 100 using your formula: `(IMDb × 10 × 0.5) + (Rotten Tomatoes × 0.3) + (Metacritic × 0.2)`, re-normalising when some sources are missing.
- **OMDb auto-fill** – One-click lookup (title + optional year) to populate poster art, synopsis, and critic scores.
- **Poster & plot display** – Cards now show the fetched artwork and plot summary for quick recall.
- **Search & sort** – Filter by title or year and sort by recently added, top combined score, title, or year.
- **Watched tracking** – Mark movies as watched/unwatched, filter by status, and reopen entries to edit details at any time.
- **Import/export & persistence** – Data lives in `localStorage`, can be exported to JSON, and legacy data is migrated automatically.

## Getting Started
```bash
pnpm install   # or npm install / yarn
pnpm run dev   # starts Vite dev server
```

The app stores data locally, so no backend configuration is required.

## OMDb Integration
1. Request a free API key from [omdbapi.com](https://www.omdbapi.com/apikey.aspx).
2. Open the app and click the `OMDb Key` button in the header.
3. Paste your API key. It is saved to `localStorage` and used for future lookups.
4. When adding a movie, enter a title (and optionally a year) then press **Fetch from OMDb** to auto-fill poster, plot, and ratings.

## Rating Details
- **IMDb**: stored as a `/10` value and weighted at 50% (scaled to /100).
- **Rotten Tomatoes**: critic percentage weighted at 30%.
- **Metacritic**: score out of 100 weighted at 20% (auto-filled from either `Metascore` or the ratings array).
- **Combined Verdicts**: `Must-Watch` (≥ 85), `Worth Watching` (≥ 70), `Average` (≥ 55), otherwise `Can Skip It`.

## Data Model
Each movie entry includes:
- `title`, `year`
- `imdb`, `rottenTomatoes`, `metacritic`, optional `letterboxd`
- `posterUrl`, `plot`
- `watched` flag (`true` after you mark it watched)
- `addedAt` timestamp and auto-generated `id`

## Styling
The UI relies on Tailwind utility classes. If you cloned this project from scratch, ensure Tailwind is configured (see `tailwind.config.js` and `src/index.css`).

## Maintenance Notes
- Legacy records from the previous watchlist (`watchlist-movies`) are migrated on load.
- JSON export/import keeps the same shape, auto-generating missing IDs when importing.
- Combined score sorting and verdicts use the new weighted formula described above.

Happy movie tracking!
