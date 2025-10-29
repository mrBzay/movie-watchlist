import React, { useEffect, useMemo, useState } from "react";

// My Watch List — lightweight, single-file React app
// Features
// - Add movies with title, year, poster, links
// - Ratings: IMDb (0–10), RottenTomatoes (0–100%), Letterboxd (0–5 stars)
// - Auto-calc normalized aggregate (/10)
// - LocalStorage persistence
// - Sort, filter, search
// - Edit & delete
// - Import/Export JSON
// - Optional OMDb lookup (IMDb & RottenTomatoes) if you provide an API key
//   -> https://www.omdbapi.com/  (free key required)
//
// Styling: This app uses Tailwind CSS utility classes (e.g., bg-slate-50, rounded-xl).
// To make the design visible, ensure Tailwind CSS is installed and configured in your project.
// Install with:
//    npm install -D tailwindcss postcss autoprefixer
// Then initialize:
//    npx tailwindcss init -p
// Or for quick testing, include the CDN in your index.html:
//    <script src="https://cdn.tailwindcss.com"></script>

const LS_KEY = "watchlist.v1";

function clamp(n, min, max) {
  if (n === null || n === undefined || Number.isNaN(n)) return null;
  return Math.min(Math.max(n, min), max);
}

function pctTo10(pct) {
  if (pct === null || pct === undefined || pct === "") return null;
  const n = typeof pct === "string" ? Number(pct.replace("%", "").trim()) : Number(pct);
  if (Number.isNaN(n)) return null;
  return clamp(n / 10, 0, 10);
}

function starsTo10(stars) {
  if (stars === null || stars === undefined || stars === "") return null;
  const n = Number(stars);
  if (Number.isNaN(n)) return null;
  // Letterboxd is typically out of 5 stars
  return clamp((n / 5) * 10, 0, 10);
}

function averageDefined(values) {
  const nums = values.filter((v) => typeof v === "number" && !Number.isNaN(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function useLocalStorage(key, initialValue) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initialValue;
    } catch {
      return initialValue;
    }
  });
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(state));
  }, [key, state]);
  return [state, setState];
}

export default function WatchListApp() {
  const [items, setItems] = useLocalStorage(LS_KEY, []);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("addedDesc");
  const [draft, setDraft] = useState(emptyMovie());
  const [editingId, setEditingId] = useState(null);
  const [omdbKey, setOmdbKey] = useLocalStorage("watchlist.omdbKey", "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function emptyMovie() {
    return {
      id: crypto.randomUUID(),
      title: "",
      year: "",
      posterUrl: "",
      imdbUrl: "",
      rtUrl: "",
      letterboxdUrl: "",
      ratings: {
        imdb10: "",
        rtPct: "",
        letterboxd5: "",
      },
      addedAt: Date.now(),
    };
  }

  function computeAggregate(movie) {
    const imdb10 = movie.ratings.imdb10 === "" ? null : clamp(Number(movie.ratings.imdb10), 0, 10);
    const rt10 = pctTo10(movie.ratings.rtPct);
    const lb10 = starsTo10(movie.ratings.letterboxd5);
    const agg10 = averageDefined([imdb10, rt10, lb10]);
    return { imdb10, rt10, lb10, agg10 };
  }

  function upsertMovie(m) {
    setItems((prev) => {
      const idx = prev.findIndex((x) => x.id === m.id);
      if (idx === -1) return [{ ...m }, ...prev];
      const copy = [...prev];
      copy[idx] = { ...m };
      return copy;
    });
  }

  function removeMovie(id) {
    setItems((prev) => prev.filter((x) => x.id !== id));
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = items.filter((m) => !q || m.title.toLowerCase().includes(q) || (m.year + "").includes(q));

    switch (sort) {
      case "aggDesc":
        list.sort((a, b) => (computeAggregate(b).agg10 ?? -1) - (computeAggregate(a).agg10 ?? -1));
        break;
      case "titleAsc":
        list.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case "yearDesc":
        list.sort((a, b) => (Number(b.year) || 0) - (Number(a.year) || 0));
        break;
      default:
        // addedDesc
        list.sort((a, b) => b.addedAt - a.addedAt);
    }
    return list;
  }, [items, query, sort]);

  async function fetchFromOMDb() {
    if (!omdbKey) {
      setMessage("Add an OMDb API key in Settings first.");
      return;
    }
    if (!draft.title) {
      setMessage("Enter a title before fetching.");
      return;
    }
    try {
      setBusy(true);
      setMessage("Looking up OMDb…");
      const url = new URL("https://www.omdbapi.com/");
      url.searchParams.set("t", draft.title);
      if (draft.year) url.searchParams.set("y", draft.year);
      url.searchParams.set("plot", "short");
      url.searchParams.set("apikey", omdbKey);
      const res = await fetch(url.toString());
      const data = await res.json();
      if (data?.Response === "False") throw new Error(data?.Error || "Not found");

      const rt = Array.isArray(data.Ratings) ? data.Ratings.find((r) => r.Source === "Rotten Tomatoes") : null;

      setDraft((d) => ({
        ...d,
        title: data.Title || d.title,
        year: data.Year || d.year,
        posterUrl: data.Poster && data.Poster !== "N/A" ? data.Poster : d.posterUrl,
        imdbUrl: data.imdbID ? `https://www.imdb.com/title/${data.imdbID}/` : d.imdbUrl,
        ratings: {
          ...d.ratings,
          imdb10: data.imdbRating && data.imdbRating !== "N/A" ? String(Number(data.imdbRating)) : d.ratings.imdb10,
          rtPct: rt?.Value && rt.Value.endsWith("%") ? rt.Value : d.ratings.rtPct,
        },
      }));
      setMessage("OMDb data added. Review & save.");
    } catch (err) {
      console.error(err);
      setMessage(`Lookup failed: ${err.message || err}`);
    } finally {
      setBusy(false);
    }
  }

  function startEdit(m) {
    setEditingId(m.id);
    setDraft({ ...m });
  }

  function cancelEdit() {
    setEditingId(null);
    setDraft(emptyMovie());
    setMessage("");
  }

  function saveDraft() {
    if (!draft.title.trim()) {
      setMessage("Title is required.");
      return;
    }
    const toSave = { ...draft, title: draft.title.trim(), year: String(draft.year || ""), addedAt: draft.addedAt || Date.now() };
    upsertMovie(toSave);
    cancelEdit();
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "watchlist.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function onImportFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!Array.isArray(data)) throw new Error("Invalid file format");
        // basic shape validation
        const cleaned = data.map((d) => ({
          id: d.id || crypto.randomUUID(),
          title: String(d.title || ""),
          year: String(d.year || ""),
          posterUrl: String(d.posterUrl || ""),
          imdbUrl: String(d.imdbUrl || ""),
          rtUrl: String(d.rtUrl || ""),
          letterboxdUrl: String(d.letterboxdUrl || ""),
          ratings: {
            imdb10: d?.ratings?.imdb10 ?? "",
            rtPct: d?.ratings?.rtPct ?? "",
            letterboxd5: d?.ratings?.letterboxd5 ?? "",
          },
          addedAt: Number(d.addedAt || Date.now()),
        }));
        setItems(cleaned);
        setMessage(`Imported ${cleaned.length} movies.`);
      } catch (err) {
        setMessage("Import failed: " + (err.message || err));
      }
    };
    reader.readAsText(file);
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="sticky top-0 z-10 bg-white/80 backdrop-blur border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">My Watch List</h1>
          <div className="flex items-center gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search title/year…"
              className="px-3 py-2 rounded-xl border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400 bg-white w-56"
            />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-300 bg-white"
            >
              <option value="addedDesc">Newest added</option>
              <option value="aggDesc">Top aggregate</option>
              <option value="titleAsc">Title A→Z</option>
              <option value="yearDesc">Year ↓</option>
            </select>
            <button
              onClick={exportJson}
              className="px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-100"
              title="Export list as JSON"
            >Export</button>
            <label className="px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 cursor-pointer">
              Import
              <input type="file" accept="application/json" onChange={onImportFile} className="hidden" />
            </label>
            <Settings omdbKey={omdbKey} setOmdbKey={setOmdbKey} />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 flex flex-col md:flex-row gap-6">
        {/* Editor */}
        <section className="md:w-[380px] w-full">
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
            <h2 className="font-bold text-lg mb-3">{editingId ? "Edit movie" : "Add a movie"}</h2>

            <div className="space-y-3">
              <TextInput label="Title" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} required />
              <TextInput label="Year" value={draft.year} onChange={(v) => setDraft({ ...draft, year: v })} placeholder="e.g., 1999" />
              <TextInput label="Poster URL" value={draft.posterUrl} onChange={(v) => setDraft({ ...draft, posterUrl: v })} placeholder="https://…" />

              <div className="grid grid-cols-3 gap-3">
                <TextInput label="IMDb /10" value={draft.ratings.imdb10}
                  onChange={(v) => setDraft({ ...draft, ratings: { ...draft.ratings, imdb10: v } })}
                  placeholder="e.g., 8.6" />
                <TextInput label="RT %" value={draft.ratings.rtPct}
                  onChange={(v) => setDraft({ ...draft, ratings: { ...draft.ratings, rtPct: v } })}
                  placeholder="e.g., 92" />
                <TextInput label="LB ★ (0–5)" value={draft.ratings.letterboxd5}
                  onChange={(v) => setDraft({ ...draft, ratings: { ...draft.ratings, letterboxd5: v } })}
                  placeholder="e.g., 3.5" />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <TextInput label="IMDb link" value={draft.imdbUrl} onChange={(v) => setDraft({ ...draft, imdbUrl: v })} placeholder="https://imdb.com/title/…" />
                <TextInput label="RT link" value={draft.rtUrl} onChange={(v) => setDraft({ ...draft, rtUrl: v })} placeholder="https://rottentomatoes.com/m/…" />
                <TextInput label="LB link" value={draft.letterboxdUrl} onChange={(v) => setDraft({ ...draft, letterboxdUrl: v })} placeholder="https://letterboxd.com/film/…" />
              </div>

              <div className="flex items-center gap-2">
                <button onClick={saveDraft} className="px-4 py-2 rounded-xl bg-slate-900 text-white hover:opacity-90">
                  {editingId ? "Save changes" : "Add to list"}
                </button>
                {editingId ? (
                  <button onClick={cancelEdit} className="px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-100">Cancel</button>
                ) : (
                  <button onClick={() => setDraft(emptyMovie())} className="px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-100">Reset</button>
                )}
                <button disabled={busy} onClick={fetchFromOMDb} className="px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-100 disabled:opacity-50">
                  Fetch from OMDb
                </button>
                {message && <span className="text-sm text-slate-600">{message}</span>}
              </div>
            </div>
          </div>
        </section>

        {/* List */}
        <section className="flex-1">
          {filtered.length === 0 ? (
            <EmptyState />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filtered.map((m) => (
                <MovieCard key={m.id} movie={m}
                  onEdit={() => startEdit(m)}
                  onDelete={() => removeMovie(m.id)} />
              ))}
            </ul>
          )}
        </section>
      </main>

      <footer className="max-w-6xl mx-auto px-4 pb-10 text-center text-sm text-slate-500">
        <p>
          Aggregate formula: average of IMDb (/10), Rotten Tomatoes (% → /10), Letterboxd (★/5 → /10). Missing ratings are ignored.
        </p>
      </footer>
    </div>
  );

  function MovieCard({ movie, onEdit, onDelete }) {
    const { imdb10, rt10, lb10, agg10 } = computeAggregate(movie);
    return (
      <li className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden flex">
        {movie.posterUrl ? (
          <img src={movie.posterUrl} alt={movie.title} className="w-28 h-44 object-cover" />
        ) : (
          <div className="w-28 h-44 grid place-items-center bg-slate-100 text-slate-400">No poster</div>
        )}
        <div className="p-4 flex-1 flex flex-col">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold leading-tight">
                {movie.title} {movie.year && <span className="text-slate-500 font-normal">({movie.year})</span>}
              </h3>
              <div className="flex flex-wrap items-center gap-2 mt-1 text-xs">
                {movie.imdbUrl && <a href={movie.imdbUrl} target="_blank" rel="noreferrer" className="underline">IMDb</a>}
                {movie.rtUrl && <a href={movie.rtUrl} target="_blank" rel="noreferrer" className="underline">Rotten Tomatoes</a>}
                {movie.letterboxdUrl && <a href={movie.letterboxdUrl} target="_blank" rel="noreferrer" className="underline">Letterboxd</a>}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wide text-slate-500">Aggregate</div>
              <div className="text-xl font-extrabold">{agg10 !== null ? agg10.toFixed(1) : "–"}/10</div>
            </div>
          </div>

          <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
            <Stat label="IMDb" value={imdb10 !== null ? imdb10.toFixed(1) + "/10" : "–"} />
            <Stat label="RT" value={movie.ratings.rtPct ? `${movie.ratings.rtPct}%` : (rt10 !== null ? (rt10 * 10).toFixed(0) + "%" : "–")} />
            <Stat label="LB" value={movie.ratings.letterboxd5 ? `${movie.ratings.letterboxd5}★` : (lb10 !== null ? (lb10/2).toFixed(1) + "★" : "–")} />
          </div>

          <div className="mt-auto flex items-center gap-2 pt-3">
            <button onClick={onEdit} className="px-3 py-1.5 rounded-lg border border-slate-300 hover:bg-slate-100 text-sm">Edit</button>
            <button onClick={onDelete} className="px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700 hover:bg-rose-50 text-sm">Delete</button>
          </div>
        </div>
      </li>
    );
  }

  function Stat({ label, value }) {
    return (
      <div className="rounded-xl bg-slate-50 border border-slate-200 p-2 text-center">
        <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
        <div className="font-semibold">{value}</div>
      </div>
    );
  }

  function EmptyState() {
    return (
      <div className="h-[50vh] grid place-items-center">
        <div className="text-center max-w-md">
          <h3 className="text-lg font-semibold mb-2">No movies yet</h3>
          <p className="text-slate-600">Add a title on the left. Optionally paste a poster URL and ratings. If you add an OMDb API key in Settings, you can auto-fill IMDb & Rotten Tomatoes.</p>
        </div>
      </div>
    );
  }

  function TextInput({ label, value, onChange, placeholder, required }) {
    return (
      <label className="block">
        <span className="block text-sm text-slate-600 mb-1">{label}{required ? <span className="text-rose-600"> *</span> : null}</span>
        <input
          className="w-full px-3 py-2 rounded-xl border border-slate-300 bg-white focus:outline-none focus:ring-2 focus:ring-slate-400"
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    );
  }

  function Settings({ omdbKey, setOmdbKey }) {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <button onClick={() => setOpen(true)} className="px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-100">Settings</button>
        {open && (
          <div className="fixed inset-0 bg-black/20 grid place-items-center p-4">
            <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-6 w-full max-w-md">
              <h3 className="font-bold text-lg mb-2">Settings</h3>
              <p className="text-sm text-slate-600 mb-4">Provide your OMDb API key to enable one-click lookups for title, year, poster, IMDb score, and Rotten Tomatoes %.</p>
              <TextInput label="OMDb API key" value={omdbKey} onChange={setOmdbKey} placeholder="e.g., 123abc" />
              <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => setOpen(false)} className="px-3 py-2 rounded-xl border border-slate-300 hover:bg-slate-100">Close</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }
}