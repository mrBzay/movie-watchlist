'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Film,
  Plus,
  Trash2,
  Star,
  Search,
  Settings as SettingsIcon,
  Loader2,
  Pencil,
  CheckCircle,
  Circle,
  CloudDownload,
} from 'lucide-react';

const STORAGE_KEYS = {
  watchlist: 'watchlist.v1',
  legacy: 'watchlist-movies',
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
  // existing helpers assumed:
  // parseNumeric(value, min, max) -> number | null

  const imdb10 = parseNumeric(movie.imdb, 0, 10);               // e.g. "8.3/10" -> 8.3
  const rtCriticsPct = parseNumeric(movie.rottenTomatoes, 0, 100); // e.g. "93%" -> 93
  const metacriticPct = parseNumeric(movie.metacritic, 0, 100);    // e.g. "90/100" -> 90
  const letterboxd5 = parseNumeric(movie.letterboxd, 0, 5);        // e.g. "4.2/5" or 4.2 -> 4.2

  // Updated base weights (sum to 1.0). Letterboxd added at 10%.
  const weights = {
    imdb: 0.4,
    rtCritics: 0.3,
    metacritic: 0.2,
    letterboxd: 0.1,
  };

  let weightedSum = 0;
  let totalWeight = 0;

  if (typeof imdb10 === 'number') {
    weightedSum += imdb10 * 10 * weights.imdb;        // 1–10 -> 10–100
    totalWeight += weights.imdb;
  }
  if (typeof rtCriticsPct === 'number') {
    weightedSum += rtCriticsPct * weights.rtCritics;  // already 0–100
    totalWeight += weights.rtCritics;
  }
  if (typeof metacriticPct === 'number') {
    weightedSum += metacriticPct * weights.metacritic; // already 0–100
    totalWeight += weights.metacritic;
  }
  if (typeof letterboxd5 === 'number') {
    weightedSum += letterboxd5 * 20 * weights.letterboxd; // 0–5 -> 0–100
    totalWeight += weights.letterboxd;
  }

  const combinedScore = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) / 100 : null;

  return {
    imdb10,
    rtCriticsPct,
    metacriticPct,
    letterboxd5,
    combinedScore, // 0–100
  };
}


function describeCombinedScore(score) {
  if (typeof score !== 'number') return null;
  if (score >= 85) return 'Must-Watch';
  if (score >= 70) return 'Worth Watching';
  if (score >= 55) return 'Average';
  return 'Can Skip It';
}

function normalizeLegacyMovie(movie) {
  if (!movie) return null;
  const addedAt =
    typeof movie.addedAt === 'number'
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
  const [user, setUser] = useState(null);
  const [isSessionLoading, setIsSessionLoading] = useState(true);
  const [authMode, setAuthMode] = useState('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [isAuthSubmitting, setIsAuthSubmitting] = useState(false);

  const [movies, setMovies] = useState([]);
  const [omdbKey, setOmdbKey] = useState('');
  const [isSavingOmdbKey, setIsSavingOmdbKey] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState('addedDesc');
  const [statusFilter, setStatusFilter] = useState('all');
  const [message, setMessage] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showUserAdmin, setShowUserAdmin] = useState(false);
  const [userAdminError, setUserAdminError] = useState('');
  const [userList, setUserList] = useState([]);
  const [isLoadingUsers, setIsLoadingUsers] = useState(false);
  const [updatingUserId, setUpdatingUserId] = useState(null);
  const [formData, setFormData] = useState(() => createEmptyMovie());
  const [editingMovieId, setEditingMovieId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [hasMigratedLocal, setHasMigratedLocal] = useState(false);

  const loadSession = useCallback(async () => {
    try {
      setIsSessionLoading(true);
      const response = await fetch('/api/auth/session', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data?.user) {
        setUser(data.user);
        setOmdbKey(data.user.omdbKey ?? '');
      } else {
        setUser(null);
        setOmdbKey('');
        setMovies([]);
      }
    } catch (error) {
      console.error('Failed to load session', error);
      setUser(null);
      setOmdbKey('');
      setMovies([]);
    } finally {
      setIsSessionLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  const fetchWatchlist = useCallback(async () => {
    if (!user) return;
    try {
      setIsLoading(true);
      setMessage('');
      const response = await fetch('/api/watchlist', { cache: 'no-store' });
      if (response.status === 401) {
        setUser(null);
        setMovies([]);
        setMessage('Session expired. Please sign in again.');
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to load watchlist');
      }
      setMovies(Array.isArray(data?.movies) ? data.movies : []);
    } catch (error) {
      console.error('Failed to fetch watchlist', error);
      setMessage(error?.message || 'Unable to load watchlist');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    fetchWatchlist();
  }, [fetchWatchlist, user]);

  useEffect(() => {
    if (!user && !isSessionLoading) {
      setIsLoading(false);
    }
  }, [isSessionLoading, user]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!user || isSessionLoading) return;
    if (isLoading || hasMigratedLocal || movies.length > 0) return;

    const migrate = async () => {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEYS.watchlist);
        const legacyRaw = window.localStorage.getItem(STORAGE_KEYS.legacy);
        const fromStored = stored ? JSON.parse(stored) : [];
        const fromLegacy = legacyRaw ? JSON.parse(legacyRaw) : [];
        const normalizedLegacy = Array.isArray(fromLegacy)
          ? fromLegacy.map(normalizeLegacyMovie).filter(Boolean)
          : [];

        const toImport = [];
        if (Array.isArray(fromStored)) {
          toImport.push(...fromStored);
        }
        toImport.push(...normalizedLegacy);

        if (!toImport.length) {
          setHasMigratedLocal(true);
          return;
        }

        setIsMigrating(true);
        setMessage('Importing your existing local watchlist…');

        for (const entry of toImport) {
          const payload = buildPayloadFromMovie(entry);
          const response = await fetch('/api/watchlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          if (response.status === 401) {
            setUser(null);
            setMovies([]);
            setMessage('Session expired. Please sign in again.');
            return;
          }
          if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data?.error || 'Failed to import movie');
          }
        }

        window.localStorage.removeItem(STORAGE_KEYS.watchlist);
        window.localStorage.removeItem(STORAGE_KEYS.legacy);

        await fetchWatchlist();
        setMessage('Imported watchlist from local storage.');
      } catch (error) {
        console.error('Local watchlist import failed', error);
        setMessage('Failed to import saved watchlist. You can re-add movies manually.');
      } finally {
        setIsMigrating(false);
        setHasMigratedLocal(true);
      }
    };

    migrate();
  }, [fetchWatchlist, hasMigratedLocal, isLoading, isSessionLoading, movies.length, user]);

  useEffect(() => {
    if (!showUserAdmin || user?.role !== 'admin') return;
    const loadUsers = async () => {
      try {
        setIsLoadingUsers(true);
        setUserAdminError('');
        const response = await fetch('/api/users', { cache: 'no-store' });
        if (response.status === 401) {
          setUser(null);
          setMovies([]);
          setShowUserAdmin(false);
          setMessage('Session expired. Please sign in again.');
          return;
        }
        const data = await response.json().catch(() => ({}));
        if (response.status === 403) {
          setUserAdminError(data?.error || 'Admin privileges required.');
          return;
        }
        if (!response.ok) {
          throw new Error(data?.error || 'Failed to load users');
        }
        setUserList(Array.isArray(data?.users) ? data.users : []);
      } catch (error) {
        console.error('Failed to load users', error);
        setUserAdminError(error?.message || 'Unable to load users.');
      } finally {
        setIsLoadingUsers(false);
      }
    };

    loadUsers();
  }, [showUserAdmin, user?.role]);

  const handleAuthSubmit = async (event) => {
    event.preventDefault();
    setAuthError('');
    setMessage('');
    try {
      setIsAuthSubmitting(true);
      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail, password: authPassword }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Authentication failed');
      }
      setUser(data.user ?? null);
      setOmdbKey(data.user?.omdbKey ?? '');
      setAuthEmail('');
      setAuthPassword('');
      setHasMigratedLocal(false);
      setMessage(authMode === 'login' ? 'Signed in successfully.' : 'Account created.');
    } catch (error) {
      console.error('Authentication failed', error);
      setAuthError(error?.message || 'Unable to authenticate.');
    } finally {
      setIsAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (error) {
      console.error('Logout failed', error);
    } finally {
      setUser(null);
      setOmdbKey('');
      setMovies([]);
      setShowForm(false);
      setShowSettings(false);
      setShowUserAdmin(false);
      setMessage('Signed out.');
      setHasMigratedLocal(false);
    }
  };

  const handleSaveOmdbKey = async () => {
    try {
      setIsSavingOmdbKey(true);
      const response = await fetch('/api/settings/omdb', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ omdbKey }),
      });
      if (response.status === 401) {
        setUser(null);
        setMovies([]);
        setShowSettings(false);
        setMessage('Session expired. Please sign in again.');
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to save OMDb key');
      }
      setOmdbKey(data?.omdbKey ?? '');
      setMessage('Saved OMDb key.');
    } catch (error) {
      console.error('Saving OMDb key failed', error);
      setMessage(error?.message || 'Unable to save OMDb key.');
    } finally {
      setIsSavingOmdbKey(false);
    }
  };

  const handleRoleChange = async (targetUserId, role) => {
    try {
      setUserAdminError('');
      setUpdatingUserId(targetUserId);
      const response = await fetch(`/api/users/${targetUserId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role }),
      });
      if (response.status === 401) {
        setUser(null);
        setMovies([]);
        setShowUserAdmin(false);
        setMessage('Session expired. Please sign in again.');
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (response.status === 403) {
        setUserAdminError(data?.error || 'Admin privileges required.');
        return;
      }
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to update role');
      }
      setUserList((current) =>
        current.map((entry) =>
          entry.id === targetUserId ? { ...entry, role: data.user?.role ?? entry.role } : entry,
        ),
      );
      if (user?.id === targetUserId) {
        const nextRole = data.user?.role ?? role;
        setUser((current) => (current ? { ...current, role: nextRole } : current));
        if (nextRole !== 'admin') {
          setShowUserAdmin(false);
        }
      }
      setMessage('Updated user role.');
    } catch (error) {
      console.error('Failed to update role', error);
      setUserAdminError(error?.message || 'Unable to update role.');
    } finally {
      setUpdatingUserId(null);
    }
  };

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

  const handleSubmit = async () => {
    const trimmedTitle = formData.title.trim();
    if (!trimmedTitle) {
      setMessage('Please enter a movie title before saving.');
      return;
    }

    const payload = buildPayloadFromMovie({
      ...formData,
      title: trimmedTitle,
      rottenTomatoes: formData.rottenTomatoes.replace(/%/g, ''),
      metacritic: formData.metacritic.replace(/[^0-9.]/g, ''),
    });

    try {
      setIsSaving(true);
      setMessage('');

      if (editingMovieId) {
        const response = await fetch(`/api/watchlist/${editingMovieId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (response.status === 401) {
          setUser(null);
          setMovies([]);
          setShowForm(false);
          throw new Error('Session expired. Please sign in again.');
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || 'Failed to update movie');
        }
        setMovies((current) =>
          current.map((movie) => (movie.id === editingMovieId ? data.movie : movie)),
        );
      } else {
        const response = await fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (response.status === 401) {
          setUser(null);
          setMovies([]);
          setShowForm(false);
          throw new Error('Session expired. Please sign in again.');
        }
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error || 'Failed to add movie');
        }
        setMovies((current) => [data.movie, ...current]);
      }

      setFormData(createEmptyMovie());
      setEditingMovieId(null);
      setShowForm(false);
    } catch (error) {
      console.error('Saving movie failed', error);
      setMessage(error?.message || 'Unable to save movie.');
    } finally {
      setIsSaving(false);
    }
  };

  const deleteMovie = async (id) => {
    try {
      setIsSaving(true);
      setMessage('');
      const response = await fetch(`/api/watchlist/${id}`, { method: 'DELETE' });
      if (response.status === 401) {
        setUser(null);
        setMovies([]);
        setShowForm(false);
        throw new Error('Session expired. Please sign in again.');
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to delete movie');
      }
      setMovies((current) => current.filter((movie) => movie.id !== id));
    } catch (error) {
      console.error('Deletion failed', error);
      setMessage(error?.message || 'Unable to delete movie.');
    } finally {
      setIsSaving(false);
    }
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

  const handleToggleWatched = async (movieId) => {
    const target = movies.find((movie) => movie.id === movieId);
    if (!target) return;
    const payload = buildPayloadFromMovie({ ...target, watched: !target.watched });

    try {
      setIsSaving(true);
      setMessage('');
      const response = await fetch(`/api/watchlist/${movieId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (response.status === 401) {
        setUser(null);
        setMovies([]);
        setShowForm(false);
        throw new Error('Session expired. Please sign in again.');
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to update movie');
      }
      setMovies((current) =>
        current.map((movie) => (movie.id === movieId ? data.movie : movie)),
      );
      if (editingMovieId === movieId) {
        setFormData((prev) => ({ ...prev, watched: data.movie.watched }));
      }
    } catch (error) {
      console.error('Toggle watched failed', error);
      setMessage(error?.message || 'Unable to update status.');
    } finally {
      setIsSaving(false);
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

  if (isSessionLoading) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center text-white">
        <Loader2 className="w-8 h-8 animate-spin text-purple-300" />
        <p className="mt-4 text-sm text-white/60">Loading your session…</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-xl p-6 space-y-6">
          <div className="flex items-center gap-3">
            <Film className="w-8 h-8 text-purple-400" />
            <div>
              <h1 className="text-2xl font-bold text-white">Movie Watchlist</h1>
              <p className="text-white/50 text-sm">Sign in to access your saved movies.</p>
            </div>
          </div>

          <form onSubmit={handleAuthSubmit} className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm text-white/70" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                value={authEmail}
                onChange={(event) => setAuthEmail(event.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm text-white/70" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={authPassword}
                onChange={(event) => setAuthPassword(event.target.value)}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="Minimum 8 characters"
                required
              />
            </div>

            {authError ? (
              <div className="bg-red-500/10 border border-red-500/40 text-red-200 px-3 py-2 rounded-lg text-sm">
                {authError}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={isAuthSubmitting || !authEmail || !authPassword}
              className={`w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2 font-medium transition-colors ${
                isAuthSubmitting
                  ? 'bg-purple-600/60 text-white/80 cursor-not-allowed'
                  : 'bg-purple-600 hover:bg-purple-700 text-white'
              }`}
            >
              {isAuthSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {authMode === 'login' ? 'Signing in…' : 'Creating account…'}
                </>
              ) : authMode === 'login' ? (
                'Sign In'
              ) : (
                'Create Account'
              )}
            </button>
          </form>

          <div className="flex items-center justify-between text-sm text-white/60">
            <span>
              {authMode === 'login'
                ? "Don't have an account?"
                : 'Already have an account?'}
            </span>
            <button
              type="button"
              onClick={() => {
                setAuthMode((mode) => (mode === 'login' ? 'register' : 'login'));
                setAuthError('');
              }}
              className="text-purple-300 hover:text-purple-200"
            >
              {authMode === 'login' ? 'Create one' : 'Sign in'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex flex-col gap-6 mb-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3">
              <Film className="w-8 h-8 text-purple-400" />
              <div>
                <h1 className="text-3xl md:text-4xl font-bold text-white">My Watchlist</h1>
                <p className="text-sm text-white/60">Signed in as {user.email}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 justify-start md:justify-end">
              <span className="text-xs uppercase tracking-wide bg-white/10 text-white/60 px-3 py-1 rounded-full">
                {user.role === 'admin' ? 'Admin' : 'Member'}
              </span>
              {user.role === 'admin' ? (
                <button
                  onClick={() => setShowUserAdmin(true)}
                  className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg transition-colors"
                >
                  Manage Users
                </button>
              ) : null}
              <button
                onClick={() => setShowSettings(true)}
                className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg transition-colors"
              >
                <SettingsIcon className="w-4 h-4" />
                OMDb Key
              </button>
              <button
                onClick={handleLogout}
                className="bg-red-500/20 hover:bg-red-500/30 text-red-200 px-4 py-2 rounded-lg transition-colors"
              >
                Sign Out
              </button>
            </div>
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
          </div>
        </div>

        {(isLoading || isMigrating || isSaving) && (
          <div className="flex items-center gap-2 text-sm text-white/70 mb-6">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>
              {isLoading
                ? 'Loading watchlist…'
                : isMigrating
                ? 'Importing saved movies…'
                : 'Saving changes…'}
            </span>
          </div>
        )}

        {!showForm && message && (
          <div className="bg-white/10 border border-white/20 rounded-lg px-4 py-3 text-sm text-white/80 mb-6">
            {message}
          </div>
        )}

        {showForm && (
          <div className="bg-white/10 backdrop-blur-lg rounded-xl p-6 mb-6 border border-white/20">
            <h2 className="text-xl font-semibold text-white mb-4">
              {editingMovieId ? 'Edit Movie' : 'Add New Movie'}
            </h2>
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
                <input
                  type="text"
                  placeholder="IMDb Rating"
                  value={formData.imdb}
                  onChange={(event) => setFormData({ ...formData, imdb: event.target.value })}
                  className="bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <input
                  type="text"
                  placeholder="Rotten Tomatoes %"
                  value={formData.rottenTomatoes}
                  onChange={(event) => setFormData({ ...formData, rottenTomatoes: event.target.value })}
                  className="bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <input
                  type="text"
                  placeholder="Metacritic Score"
                  value={formData.metacritic}
                  onChange={(event) => setFormData({ ...formData, metacritic: event.target.value })}
                  className="bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <input
                  type="text"
                  placeholder="Letterboxd Rating"
                  value={formData.letterboxd}
                  onChange={(event) => setFormData({ ...formData, letterboxd: event.target.value })}
                  className="bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <input
                type="url"
                placeholder="Poster URL"
                value={formData.posterUrl}
                onChange={(event) => setFormData({ ...formData, posterUrl: event.target.value })}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
              />

              <textarea
                placeholder="Plot or notes"
                value={formData.plot}
                onChange={(event) => setFormData({ ...formData, plot: event.target.value })}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
                rows={3}
              />

              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 text-white">
                  <input
                    type="checkbox"
                    checked={formData.watched}
                    onChange={(event) =>
                      setFormData({ ...formData, watched: event.target.checked })
                    }
                    className="h-4 w-4 rounded border-white/30 bg-white/10"
                  />
                  Mark as watched
                </label>
              </div>

              {showForm && message ? (
                <p className="text-purple-200 text-sm">{message}</p>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleSubmit}
                  disabled={isSaving}
                  className={`px-4 py-2 rounded-lg transition-colors ${
                    isSaving
                      ? 'bg-purple-600/60 text-white/80 cursor-not-allowed'
                      : 'bg-purple-600 hover:bg-purple-700 text-white'
                  }`}
                >
                  {editingMovieId ? 'Save Changes' : 'Add to Watchlist'}
                </button>
                <button
                  type="button"
                  onClick={handleOmdbFetch}
                  className="inline-flex items-center gap-2 px-4 py-2 border border-white/20 rounded-lg text-white hover:bg-white/10 transition-colors"
                  disabled={isFetching}
                >
                  {isFetching ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <CloudDownload className="w-4 h-4" />
                  )}
                  Fetch from OMDb
                </button>
                <button
                  onClick={handleCancelForm}
                  className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {!isLoading && !hasMovies && !showForm ? (
          <div className="bg-white/10 border border-dashed border-white/30 rounded-xl p-10 text-center text-white/60">
            <p className="text-lg">Your watchlist is empty.</p>
            <p className="text-sm mt-2">Click “Add Movie” to start tracking what to watch next.</p>
          </div>
        ) : null}

        {!isLoading && hasMovies && visibleMovies.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-white/60 text-lg">No movies match your search.</p>
            <p className="text-white/40 text-sm mt-2">Try adjusting your filters.</p>
          </div>
        ) : null}

        {!isLoading && visibleMovies.length > 0 ? (
          <div className="grid grid-cols-1 gap-4">
            {visibleMovies.map((movie) => {
              const combinedScoreValue = getCombinedScore(movie);
              const formattedScore =
                typeof combinedScoreValue === 'number' ? combinedScoreValue.toFixed(1) : null;
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
                            disabled={isSaving}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                              movie.watched
                                ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200 hover:bg-emerald-500/20'
                                : 'border-white/20 text-white/70 hover:bg-white/10'
                            } ${isSaving ? 'opacity-60 cursor-not-allowed' : ''}`}
                          >
                            {movie.watched ? <CheckCircle className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
                            {movie.watched ? 'Watched' : 'Mark watched'}
                          </button>
                          <button
                            onClick={() => handleEditMovie(movie)}
                            disabled={isSaving}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/20 text-sm text-white/70 hover:bg-white/10 transition-colors ${isSaving ? 'opacity-60 cursor-not-allowed' : ''}`}
                          >
                            <Pencil className="w-4 h-4" />
                            Edit
                          </button>
                          <button
                            onClick={() => deleteMovie(movie.id)}
                            disabled={isSaving}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border border-red-400/40 text-sm text-red-300 hover:bg-red-500/10 transition-colors ${isSaving ? 'opacity-60 cursor-not-allowed' : ''}`}
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
                        <p className="text-white/70 text-sm leading-relaxed mt-3">{movie.plot}</p>
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
        ) : null}
      </div>

      {showSettings && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-xl p-6 w-full max-w-md">
            <h3 className="text-xl font-semibold text-white mb-2">OMDb Settings</h3>
            <p className="text-white/60 text-sm mb-4">
              Save your OMDb API key with your account to enable one-click lookups for ratings and
              summaries across your devices.
            </p>
            <input
              type="text"
              value={omdbKey}
              onChange={(event) => setOmdbKey(event.target.value)}
              placeholder="e.g. abcd1234"
              className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <div className="flex justify-between items-center gap-2 mt-4 text-xs text-white/40">
              <span>Leave blank to remove the stored key.</span>
              {isSavingOmdbKey ? <Loader2 className="w-4 h-4 animate-spin text-white/60" /> : null}
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={handleSaveOmdbKey}
                disabled={isSavingOmdbKey}
                className={`px-4 py-2 rounded-lg transition-colors ${
                  isSavingOmdbKey
                    ? 'bg-purple-600/60 text-white/80 cursor-not-allowed'
                    : 'bg-purple-600 hover:bg-purple-700 text-white'
                }`}
              >
                {isSavingOmdbKey ? 'Saving…' : 'Save'}
              </button>
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

      {showUserAdmin && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-white/10 rounded-xl p-6 w-full max-w-2xl">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-xl font-semibold text-white">Manage Users</h3>
                <p className="text-white/50 text-sm">Promote or demote accounts between member and admin roles.</p>
              </div>
              <button
                onClick={() => {
                  setShowUserAdmin(false);
                  setUserAdminError('');
                }}
                className="bg-white/10 hover:bg-white/20 text-white px-4 py-2 rounded-lg transition-colors"
              >
                Close
              </button>
            </div>

            {userAdminError ? (
              <div className="bg-red-500/10 border border-red-500/40 text-red-200 px-3 py-2 rounded-lg text-sm mb-4">
                {userAdminError}
              </div>
            ) : null}

            {isLoadingUsers ? (
              <div className="flex items-center gap-2 text-white/70 text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Loading users…</span>
              </div>
            ) : userList.length === 0 ? (
              <p className="text-white/60 text-sm">No other users have registered yet.</p>
            ) : (
              <div className="space-y-3 max-h-80 overflow-y-auto pr-1">
                {userList.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between gap-3 border border-white/10 rounded-lg px-4 py-3"
                  >
                    <div>
                      <p className="text-white font-medium">{entry.email}</p>
                      <p className="text-xs text-white/40">
                        {entry.id === user.id ? 'This is you' : entry.role === 'admin' ? 'Admin' : 'Member'}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {updatingUserId === entry.id ? (
                        <Loader2 className="w-4 h-4 animate-spin text-white/70" />
                      ) : null}
                      <select
                        value={entry.role}
                        onChange={(event) => handleRoleChange(entry.id, event.target.value)}
                        disabled={updatingUserId === entry.id}
                        className="bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                      >
                        <option value="user">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            )}
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

function buildPayloadFromMovie(movie) {
  return {
    title: (movie?.title || '').trim(),
    year: movie?.year ? String(movie.year).trim() : '',
    imdb: movie?.imdb ? String(movie.imdb).trim() : '',
    rottenTomatoes: movie?.rottenTomatoes ? String(movie.rottenTomatoes).trim() : '',
    metacritic: movie?.metacritic ? String(movie.metacritic).trim() : '',
    posterUrl: movie?.posterUrl ? String(movie.posterUrl).trim() : '',
    plot: movie?.plot ? String(movie.plot).trim() : '',
    letterboxd: movie?.letterboxd ? String(movie.letterboxd).trim() : '',
    watched: Boolean(movie?.watched),
    addedAt:
      typeof movie?.addedAt === 'number' && Number.isFinite(movie.addedAt)
        ? movie.addedAt
        : Date.now(),
  };
}
