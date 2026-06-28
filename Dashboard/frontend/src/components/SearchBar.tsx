import React, { useEffect, useRef, useState } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { api } from '../api';
import { SearchResults, Task } from '../types';

interface Props {
  onSelectTask: (task: Task) => void;
  onSelectGoal: () => void;
  onSelectHabit: () => void;
}

// AI Search Assistant: substring search is instant; when that finds
// nothing, the backend falls back to Gemini ranking so loose phrasing
// still finds the right item — this component just renders whatever
// /api/search returns, the "AI" part is entirely server-side.
export default function SearchBar({ onSelectTask, onSelectGoal, onSelectHabit }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      setOpen(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await api.search(query.trim());
        setResults(r);
        setOpen(true);
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const clear = () => {
    setQuery('');
    setResults(null);
    setOpen(false);
  };

  const total = results ? results.tasks.length + results.goals.length + results.habits.length + results.sessions.length : 0;

  return (
    <div ref={boxRef} className="relative">
      <div className="flex items-center gap-2 border border-[#1A1A1A] px-3 py-1.5 bg-white">
        <Search className="w-3.5 h-3.5 opacity-60 shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results && setOpen(true)}
          placeholder="Search everything…"
          className="font-sans text-xs focus:outline-none w-36 md:w-44"
        />
        {loading ? (
          <Loader2 className="w-3 h-3 animate-spin opacity-50 shrink-0" />
        ) : query ? (
          <button onClick={clear} aria-label="Clear search">
            <X className="w-3 h-3 opacity-50" />
          </button>
        ) : null}
      </div>

      {open && results && (
        <div className="absolute top-full mt-1 right-0 w-80 bg-white border border-[#1A1A1A] shadow-[4px_4px_0px_0px_rgba(26,26,26,0.15)] max-h-96 overflow-y-auto z-50">
          {total === 0 ? (
            <div className="p-3 font-sans text-xs opacity-50 italic">No matches.</div>
          ) : (
            <>
              {results.tasks.length > 0 && (
                <div className="p-2">
                  <p className="font-sans text-[9px] uppercase font-bold tracking-widest opacity-50 px-1 mb-1">Tasks</p>
                  {results.tasks.map((t) => (
                    <button key={t.id} onClick={() => { onSelectTask(t); clear(); }}
                      className="w-full text-left px-2 py-1.5 hover:bg-[#F5F2ED] font-sans text-sm truncate block">
                      {t.task_name}
                    </button>
                  ))}
                </div>
              )}
              {results.goals.length > 0 && (
                <div className="p-2 border-t border-[#1A1A1A]/10">
                  <p className="font-sans text-[9px] uppercase font-bold tracking-widest opacity-50 px-1 mb-1">Goals</p>
                  {results.goals.map((g) => (
                    <button key={g.id} onClick={() => { onSelectGoal(); clear(); }}
                      className="w-full text-left px-2 py-1.5 hover:bg-[#F5F2ED] font-sans text-sm truncate block">
                      {g.title}
                    </button>
                  ))}
                </div>
              )}
              {results.habits.length > 0 && (
                <div className="p-2 border-t border-[#1A1A1A]/10">
                  <p className="font-sans text-[9px] uppercase font-bold tracking-widest opacity-50 px-1 mb-1">Habits</p>
                  {results.habits.map((h) => (
                    <button key={h.id} onClick={() => { onSelectHabit(); clear(); }}
                      className="w-full text-left px-2 py-1.5 hover:bg-[#F5F2ED] font-sans text-sm truncate block">
                      {h.name}
                    </button>
                  ))}
                </div>
              )}
              {results.sessions.length > 0 && (
                <div className="p-2 border-t border-[#1A1A1A]/10">
                  <p className="font-sans text-[9px] uppercase font-bold tracking-widest opacity-50 px-1 mb-1">Focus Sessions</p>
                  {results.sessions.map((s) => (
                    <div key={s.id} className="px-2 py-1.5 font-sans text-sm truncate opacity-70">
                      {s.description || 'Focus session'}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
