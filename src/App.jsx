import React, { useEffect, useMemo, useState } from 'react';
import { Film, Plus, Trash2, Star, Search, Settings as SettingsIcon, Loader2, Pencil, CheckCircle, Circle } from 'lucide-react';

const STORAGE_KEYS = {
  watchlist: 'watchlist.v1',
  legacy: 'watchlist-movies',
  omdb: 'watchlist.omdbKey',
};

function clamp(value, min, max) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.min(Math.max(value, min), max);
}

function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

function parseNumeric(value, min, max) {
  if (value === null || value === undefined) return null;
  const cleaned = String(value).replace(/[^0-9.,-]/g, '').replace(',', '.');
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return clamp(parsed, min, max);
}

function computeScores(movie) {
  const imdb10 = parseNumeric(movie.imdb, 0, 10);
  const rtCriticsPct = parseNumeric(movie.rottenTomatoes, 0, 100);
  const metacriticPct = parseNumeric(movie.metacritic, 0, 100);

  const weights = {
    imdb: 0.5,
    rtCritics: 0.3,
    metacritic: 0.2,
  };

  let weightedSum = 0;
  let totalWeight = 0;

  if (typeof imdb10 === 'number') {
    weightedSum += (imdb10 * 10) * weights.imdb;
    totalWeight += weights.imdb;
  }
  if (typeof rtCriticsPct === 'number') {
    weightedSum += rtCriticsPct * weights.rtCritics;
    totalWeight += weights.rtCritics;
  }
  if (typeof metacriticPct === 'number') {
    weightedSum += metacriticPct * weights.metacritic;
    totalWeight += weights.metacritic;
  }

  const combinedScore = totalWeight > 0 ? weightedSum / totalWeight : null;
  return {
    imdb10,
    rtCriticsPct,
    metacriticPct,
    combinedScore,
  };
}

function describeCombinedScore(score) {
  if (typeof score !== 'number') return null;
  if (score >= 85) return 'Must-Watch';
  if (score >= 70) return 'Worth Watching';
  if (score >= 55) return 'Average';
  return 'Can Skip It';
}

function useLocalStorageState(key, defaultValue) {
  const [state, setState] = useState(() => {
    if (typeof window === 'undefined') return defaultValue;
    try {
      const stored = window.localStorage.getItem(key);
      return stored ? JSON.parse(stored) : defaultValue;
    } catch (err) {
      console.error('Failed to read localStorage key', key, err);
      return defaultValue;
    }
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch (err) {
      console.error('Failed to persist localStorage key', key, err);
    }
  }, [key, state]);

  return [state, setState];
}

function normalizeLegacyMovie(movie) {
  if (!movie) return null;
  const addedAt = typeof movie.addedAt === 'number'
    ? movie.addedAt
    : Date.parse(movie.addedDate || '') || Date.now();
  return {
    id: movie.id || generateId(),
    title: movie.title || '',
    year: movie.year || '',
    imdb: movie.imdb || '',
    rottenTomatoes: movie.rottenTomatoes || '',
    metacritic: movie.metacritic || movie.rtAudience || '',
    posterUrl: movie.posterUrl || movie.poster || '',
    plot: movie.plot || movie.description || '',
    watched: Boolean(movie.watched),
    letterboxd: movie.letterboxd || '',
    addedAt,
  };
}

function ensurePercent(value) {
  if (value === null || value === undefined || value === '') return '';
  return String(value).includes('%') ? String(value) : `${value}%`;
}

export default function MovieWatchlist() {
  const [movies, setMovies] = useLocalStorageState(STORAGE_KEYS.watchlist, []);
  const [omdbKey, setOmdbKey] = useLocalStorageState(STORAGE_KEYS.omdb, '');
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('addedDesc');
  const [statusFilter, setStatusFilter] = useState('all');
  const [message, setMessage] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [formData, setFormData] = useState(() => createEmptyMovie());
  const [editingMovieId, setEditingMovieId] = useState(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (movies.length > 0) return;
    try {
      const legacyRaw = window.localStorage.getItem(STORAGE_KEYS.legacy);
      if (!legacyRaw) return;
      const parsed = JSON.parse(legacyRaw);
      if (!Array.isArray(parsed) || parsed.length === 0) return;
      const migrated = parsed.map(normalizeLegacyMovie).filter(Boolean);
      if (migrated.length) {
        setMovies(migrated);
      }
    } catch (err) {
      console.error('Failed to migrate legacy watchlist', err);
    }
  }, [movies.length, setMovies]);

  const filteredMovies = useMemo(() => {
    const search = query.trim().toLowerCase();
    let list = movies
      .filter((movie) => {
        if (!search) return true;
        return (
          movie.title.toLowerCase().includes(search) ||
          String(movie.year).toLowerCase().includes(search)
        );
      })
      .map((movie) => ({ ...movie }));

    if (statusFilter === 'watched') {
      list = list.filter((movie) => movie.watched);
    } else if (statusFilter === 'unwatched') {
      list = list.filter((movie) => !movie.watched);
    }

    switch (sortBy) {
      case 'avgDesc':
        list.sort((a, b) => {
          const aScore = computeScores(a).combinedScore ?? -1;
          const bScore = computeScores(b).combinedScore ?? -1;
          return bScore - aScore;
        });
        break;
      case 'titleAsc':
        list.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'yearDesc':
        list.sort((a, b) => (parseInt(b.year, 10) || 0) - (parseInt(a.year, 10) || 0));
        break;
      default:
        list.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    }

    return list;
  }, [movies, query, sortBy, statusFilter]);

  const handleSubmit = () => {
    const trimmedTitle = formData.title.trim();
    if (!trimmedTitle) {
      setMessage('Please enter a movie title before saving.');
      return;
    }

    const cleanedMovie = {
      ...formData,
      title: trimmedTitle,
      year: formData.year.trim(),
      imdb: formData.imdb.trim(),
      rottenTomatoes: formData.rottenTomatoes.trim().replace(/%/g, ''),
      metacritic: formData.metacritic.trim().replace(/[^0-9.]/g, ''),
      posterUrl: formData.posterUrl.trim(),
      plot: formData.plot.trim(),
      letterboxd: formData.letterboxd.trim(),
      watched: Boolean(formData.watched),
    };

    if (editingMovieId) {
      const preservedAddedAt = formData.addedAt ?? Date.now();
      const movieToUpdate = {
        ...cleanedMovie,
        id: editingMovieId,
        addedAt: preservedAddedAt,
      };
      setMovies((current) => current.map((movie) => (movie.id === editingMovieId ? movieToUpdate : movie)));
    } else {
      const movieToAdd = {
        ...cleanedMovie,
        id: formData.id || generateId(),
        addedAt: Date.now(),
      };
      setMovies((current) => [movieToAdd, ...current]);
    }

    setFormData(createEmptyMovie());
    setEditingMovieId(null);
    setShowForm(false);
    setMessage('');
  };

  const deleteMovie = (id) => {
    setMovies((current) => current.filter((movie) => movie.id !== id));
  };

  const getCombinedScore = (movie) => {
    const { combinedScore } = computeScores(movie);
    return combinedScore === null ? null : combinedScore;
  };

  const handleStartAddNew = () => {
    setMessage('');
    setEditingMovieId(null);
    setFormData(createEmptyMovie());
    setShowForm(true);
  };

  const handleCancelForm = () => {
    setFormData(createEmptyMovie());
    setEditingMovieId(null);
    setShowForm(false);
    setMessage('');
  };

  const handleEditMovie = (movie) => {
    setMessage('');
    setEditingMovieId(movie.id);
    setFormData({
      ...createEmptyMovie(),
      ...movie,
      id: movie.id,
      imdb: movie.imdb || '',
      rottenTomatoes: movie.rottenTomatoes || '',
      metacritic: movie.metacritic || '',
      posterUrl: movie.posterUrl || '',
      plot: movie.plot || '',
      letterboxd: movie.letterboxd || '',
      watched: Boolean(movie.watched),
      addedAt: movie.addedAt,
    });
    setShowForm(true);
  };

  const handleToggleWatched = (movieId) => {
    setMovies((current) =>
      current.map((movie) =>
        movie.id === movieId ? { ...movie, watched: !movie.watched } : movie
      )
    );
    if (editingMovieId === movieId) {
      setFormData((prev) => ({ ...prev, watched: !prev.watched }));
    }
  };

  const handleOmdbFetch = async () => {
    if (!omdbKey.trim()) {
      setMessage('Add an OMDb API key in settings to use auto-fill.');
      setShowSettings(true);
      return;
    }
    if (!formData.title.trim()) {
      setMessage('Enter a movie title before fetching from OMDb.');
      return;
    }
    try {
      setIsFetching(true);
      setMessage('Looking up OMDb…');
      const url = new URL('https://www.omdbapi.com/');
      url.searchParams.set('t', formData.title.trim());
      if (formData.year.trim()) url.searchParams.set('y', formData.year.trim());
      url.searchParams.set('plot', 'short');
      url.searchParams.set('apikey', omdbKey.trim());

      const response = await fetch(url.toString());
      const data = await response.json();
      if (data?.Response === 'False') {
        throw new Error(data?.Error || 'Movie not found');
      }

      const ratings = Array.isArray(data?.Ratings) ? data.Ratings : [];
      const rtEntry = ratings.find((rating) => rating.Source === 'Rotten Tomatoes') || null;
      const metaEntry = ratings.find((rating) => rating.Source === 'Metacritic') || null;
      const metascore = data.Metascore && data.Metascore !== 'N/A' ? data.Metascore : metaEntry?.Value;

      const cleanedMetascore = (() => {
        if (!metascore) return null;
        const match = String(metascore).match(/\d+/);
        return match ? match[0] : null;
      })();

      setFormData((prev) => ({
        ...prev,
        title: data.Title || prev.title,
        year: data.Year || prev.year,
        imdb: data.imdbRating && data.imdbRating !== 'N/A' ? String(data.imdbRating) : prev.imdb,
        rottenTomatoes:
          rtEntry?.Value && rtEntry.Value !== 'N/A'
            ? rtEntry.Value.replace('%', '')
            : prev.rottenTomatoes,
        metacritic: cleanedMetascore ?? prev.metacritic,
        posterUrl:
          data.Poster && data.Poster !== 'N/A'
            ? data.Poster
            : prev.posterUrl,
        plot: data.Plot && data.Plot !== 'N/A' ? data.Plot : prev.plot,
      }));
      setMessage('OMDb data fetched. Review and save.');
    } catch (error) {
      setMessage(`OMDb lookup failed: ${error.message || error}`);
    } finally {
      setIsFetching(false);
    }
  };

  const hasMovies = movies.length > 0;
  const visibleMovies = filteredMovies;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-8">
          <div className="flex items-center gap-3">
            <Film className="w-8 h-8 text-purple-400" />
            <h1 className="text-3xl md:text-4xl font-bold text-white">My Watchlist</h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search title or year"
                className="pl-10 pr-4 py-2 bg-white/10 border border-white/20 rounded-lg text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
              className="bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="addedDesc">Recently Added</option>
              <option value="avgDesc">Top Rated</option>
              <option value="titleAsc">Title A–Z</option>
              <option value="yearDesc">Year ↓</option>
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="all">All Movies</option>
              <option value="unwatched">Unwatched</option>
              <option value="watched">Watched</option>
            </select>
            <button
              onClick={handleStartAddNew}
              className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg transition-colors"
            >
              <Plus className="w-5 h-5" />
              Add Movie
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg transition-colors"
            >
              <SettingsIcon className="w-4 h-4" />
              OMDb Key
            </button>
          </div>
        </div>

        {showForm && (
          <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 mb-6 border border-white/20">
            <h2 className="text-xl font-semibold text-white mb-4">{editingMovieId ? 'Edit Movie' : 'Add New Movie'}</h2>
            {editingMovieId ? (
              <p className="text-sm text-white/60 mb-4">
                Updating <span className="text-white font-semibold">{formData.title || 'Untitled Movie'}</span>
              </p>
            ) : null}
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <input
                  type="text"
                  placeholder="Movie Title"
                  value={formData.title}
                  onChange={(event) => setFormData({ ...formData, title: event.target.value })}
                  className="bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <input
                  type="text"
                  placeholder="Year"
                  value={formData.year}
                  onChange={(event) => setFormData({ ...formData, year: event.target.value })}
                  className="bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <label className="text-white/70 text-sm mb-1 block">IMDb (0-10)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="10"
                    placeholder="8.5"
                    value={formData.imdb}
                    onChange={(event) => setFormData({ ...formData, imdb: event.target.value })}
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="text-white/70 text-sm mb-1 block">RT Critics (0-100)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    placeholder="95"
                    value={formData.rottenTomatoes}
                    onChange={(event) => setFormData({ ...formData, rottenTomatoes: event.target.value })}
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="text-white/70 text-sm mb-1 block">Metacritic (0-100)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    placeholder="90"
                    value={formData.metacritic}
                    onChange={(event) => setFormData({ ...formData, metacritic: event.target.value })}
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="text-white/70 text-sm mb-1 block">Letterboxd (0-5)</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="5"
                    placeholder="4.2"
                    value={formData.letterboxd}
                    onChange={(event) => setFormData({ ...formData, letterboxd: event.target.value })}
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="text-white/70 text-sm mb-1 block">Poster URL</label>
                  <input
                    type="url"
                    placeholder="https://…"
                    value={formData.posterUrl}
                    onChange={(event) => setFormData({ ...formData, posterUrl: event.target.value })}
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
                <div>
                  <label className="text-white/70 text-sm mb-1 block">Plot / Notes</label>
                  <textarea
                    rows={3}
                    placeholder="Short synopsis or notes"
                    value={formData.plot}
                    onChange={(event) => setFormData({ ...formData, plot: event.target.value })}
                    className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 text-white/80">
                <input
                  id="watched-toggle"
                  type="checkbox"
                  checked={Boolean(formData.watched)}
                  onChange={(event) => setFormData({ ...formData, watched: event.target.checked })}
                  className="h-4 w-4 rounded border-white/40 bg-white/10 text-purple-500 focus:ring-purple-400 focus:outline-none"
                />
                <label htmlFor="watched-toggle" className="text-sm">Mark as watched</label>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={handleSubmit}
                  className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-lg transition-colors"
                >
                  {editingMovieId ? 'Save Changes' : 'Add to Watchlist'}
                </button>
                <button
                  onClick={handleOmdbFetch}
                  disabled={isFetching}
                  className="flex items-center gap-2 bg-white/10 hover:bg-white/20 disabled:opacity-60 text-white px-4 py-2 rounded-lg transition-colors"
                >
                  {isFetching ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  Fetch from OMDb
                </button>
                <button
                  onClick={handleCancelForm}
                  className="bg-white/10 hover:bg-white/20 text-white px-6 py-2 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                {message && (
                  <span className="text-sm text-white/70 mt-2 w-full">{message}</span>
                )}
              </div>
            </div>
          </div>
        )}

        {!hasMovies ? (
          <div className="text-center py-16">
            <Film className="w-16 h-16 text-white/30 mx-auto mb-4" />
            <p className="text-white/50 text-lg">No movies in your watchlist yet</p>
            <p className="text-white/30 text-sm mt-2">Click "Add Movie" to get started</p>
          </div>
        ) : visibleMovies.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-white/60 text-lg">No movies match your search.</p>
            <p className="text-white/40 text-sm mt-2">Try adjusting your filters.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {visibleMovies.map((movie) => {
              const combinedScoreValue = getCombinedScore(movie);
              const formattedScore = typeof combinedScoreValue === 'number' ? combinedScoreValue.toFixed(1) : null;
              const verdict = describeCombinedScore(combinedScoreValue);
              return (
                <div
                  key={movie.id}
                  className="bg-white/10 backdrop-blur-lg rounded-xl p-5 border border-white/20 hover:bg-white/15 transition-all"
                >
                  <div className="flex flex-col sm:flex-row gap-4">
                    <div className="sm:w-32 flex-shrink-0">
                      {movie.posterUrl ? (
                        <img
                          src={movie.posterUrl}
                          alt={movie.title}
                          className="w-full h-48 object-cover rounded-lg border border-white/10"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-48 rounded-lg border border-dashed border-white/20 bg-white/5 text-white/40 flex items-center justify-center text-sm">
                          No poster
                        </div>
                      )}
                    </div>

                    <div className="flex-1 flex flex-col">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex items-center flex-wrap gap-3">
                          <div className="flex items-baseline gap-3">
                            <h3 className="text-xl font-semibold text-white">{movie.title}</h3>
                            {movie.year && (
                              <span className="text-white/50 text-sm">({movie.year})</span>
                            )}
                          </div>
                          {movie.watched ? (
                            <span className="text-xs font-semibold uppercase tracking-wide bg-emerald-500/20 text-emerald-200 px-2 py-1 rounded-full">
                              Watched
                            </span>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleToggleWatched(movie.id)}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors ${movie.watched ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20' : 'border-white/20 text-white/70 hover:bg-white/10'}`}
                          >
                            {movie.watched ? (
                              <CheckCircle className="w-4 h-4" />
                            ) : (
                              <Circle className="w-4 h-4" />
                            )}
                            {movie.watched ? 'Watched' : 'Mark watched'}
                          </button>
                          <button
                            onClick={() => handleEditMovie(movie)}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/20 text-sm text-white/70 hover:bg-white/10 transition-colors"
                          >
                            <Pencil className="w-4 h-4" />
                            Edit
                          </button>
                          <button
                            onClick={() => deleteMovie(movie.id)}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-red-400/40 text-sm text-red-300 hover:bg-red-500/10 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                            Delete
                          </button>
                        </div>
                      </div>

                      {formattedScore && (
                        <div className="flex flex-wrap items-center gap-2 mt-3">
                          <Star className="w-4 h-4 text-purple-400 fill-purple-400" />
                          <span className="text-white/70 text-sm">Combined Score:</span>
                          <span className="text-purple-300 font-semibold">{formattedScore}/100</span>
                          {verdict && (
                            <span className="text-xs font-semibold uppercase tracking-wide text-white/60 bg-white/10 px-2 py-1 rounded-full">
                              {verdict}
                            </span>
                          )}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-4 mt-3">
                        {movie.imdb && (
                          <div className="flex items-center gap-2">
                            <span className="text-yellow-400 text-sm font-semibold">IMDb</span>
                            <span className="text-white font-medium">{movie.imdb}/10</span>
                          </div>
                        )}
                        {movie.rottenTomatoes && (
                          <div className="flex items-center gap-2">
                            <span className="text-red-400 text-sm font-semibold">RT Critics</span>
                            <span className="text-white font-medium">{ensurePercent(movie.rottenTomatoes)}</span>
                          </div>
                        )}
                        {movie.metacritic && (
                          <div className="flex items-center gap-2">
                            <span className="text-orange-300 text-sm font-semibold">Metacritic</span>
                            <span className="text-white font-medium">{movie.metacritic}/100</span>
                          </div>
                        )}
                        {movie.letterboxd && (
                          <div className="flex items-center gap-2">
                            <span className="text-green-400 text-sm font-semibold">Letterboxd</span>
                            <span className="text-white font-medium">{movie.letterboxd}/5</span>
                          </div>
                        )}
                      </div>

                      {movie.plot && (
                        <p className="text-white/70 text-sm leading-relaxed mt-3">
                          {movie.plot}
                        </p>
                      )}

                      <p className="text-white/40 text-xs mt-4">
                        Added: {new Date(movie.addedAt || Date.now()).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showSettings && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-xl p-6 w-full max-w-md">
            <h3 className="text-xl font-semibold text-white mb-2">OMDb Settings</h3>
            <p className="text-white/60 text-sm mb-4">
              Store your OMDb API key locally to enable one-click lookups for ratings and year details.
            </p>
            <input
              type="text"
              value={omdbKey}
              onChange={(event) => setOmdbKey(event.target.value)}
              placeholder="e.g. abcd1234"
              className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setShowSettings(false)}
                className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function createEmptyMovie() {
  return {
    id: generateId(),
    title: '',
    year: '',
    imdb: '',
    rottenTomatoes: '',
    metacritic: '',
    posterUrl: '',
    plot: '',
    watched: false,
    letterboxd: '',
    addedAt: Date.now(),
  };
}
