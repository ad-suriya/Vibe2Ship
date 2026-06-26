import React, { useState } from 'react';
import { Plus, Trash2, Flame, Check, Repeat } from 'lucide-react';
import { Habit } from '../types';

interface Props {
  habits: Habit[];
  onAdd: (name: string, cadence: 'DAILY' | 'WEEKLY') => void;
  onCheck: (id: number) => void;
  onDelete: (id: number) => void;
}

const WEEKDAY = (iso: string) => new Date(iso).toLocaleDateString([], { weekday: 'narrow' });

export default function HabitsPanel({ habits, onAdd, onCheck, onDelete }: Props) {
  const [show, setShow] = useState(false);
  const [draft, setDraft] = useState<{ name: string; cadence: 'DAILY' | 'WEEKLY' }>({ name: '', cadence: 'DAILY' });

  const submit = () => {
    if (!draft.name.trim()) return;
    onAdd(draft.name.trim(), draft.cadence);
    setDraft({ name: '', cadence: 'DAILY' });
    setShow(false);
  };

  return (
    <div>
      <div className="flex items-center gap-3 border-b border-[#1A1A1A] pb-2 mb-4">
        <Repeat className="w-4 h-4" />
        <span className="font-sans text-[10px] uppercase tracking-widest font-black">Habits</span>
        <div className="h-[1px] flex-grow bg-[#1A1A1A] opacity-20" />
        <button onClick={() => setShow((s) => !s)} className="font-sans text-[10px] uppercase font-bold tracking-widest flex items-center gap-1 px-2 py-1 border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white transition-colors">
          <Plus className="w-3 h-3" /> Habit
        </button>
      </div>

      {show && (
        <div className="bg-white border border-[#1A1A1A] p-4 mb-4 space-y-3 shadow-[3px_3px_0px_0px_rgba(26,26,26,0.1)]">
          <input className="w-full p-2 border border-[#1A1A1A]/30 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-[#1A1A1A]"
            placeholder="Habit (e.g. Read 20 pages)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <div className="flex items-center justify-between">
            <select className="p-2 border border-[#1A1A1A]/30 font-sans text-xs" value={draft.cadence} onChange={(e) => setDraft({ ...draft, cadence: e.target.value as 'DAILY' | 'WEEKLY' })}>
              <option value="DAILY">Daily</option>
              <option value="WEEKLY">Weekly</option>
            </select>
            <div className="flex gap-2">
              <button onClick={() => setShow(false)} className="font-sans text-[10px] uppercase font-bold tracking-widest px-3 py-2">Cancel</button>
              <button onClick={submit} disabled={!draft.name.trim()} className="font-sans text-[10px] uppercase font-bold tracking-widest px-3 py-2 bg-[#1A1A1A] text-white disabled:opacity-40">Add habit</button>
            </div>
          </div>
        </div>
      )}

      {habits.length === 0 ? (
        <div className="font-sans text-sm opacity-50 italic py-10 text-center border border-dashed border-[#1A1A1A]/30">
          No habits yet. Build momentum with small daily wins.
        </div>
      ) : (
        <div className="space-y-3">
          {habits.map((h) => (
            <div key={h.id} className="bg-white border border-[#1A1A1A] p-4 flex items-center gap-4 shadow-[3px_3px_0px_0px_rgba(26,26,26,0.1)]">
              <button
                onClick={() => onCheck(h.id)}
                className={`w-10 h-10 shrink-0 border-2 flex items-center justify-center transition-colors ${h.done_today ? 'bg-[#2A6B5E] border-[#2A6B5E] text-white' : 'border-[#1A1A1A] hover:bg-[#F5F2ED]'}`}
                aria-label={h.done_today ? 'Mark not done' : 'Mark done'}
              >
                {h.done_today && <Check className="w-5 h-5" />}
              </button>

              <div className="flex-grow min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className={`text-lg font-bold tracking-tight ${h.done_today ? '' : ''}`}>{h.name}</h3>
                  <span className="font-sans text-[9px] uppercase font-bold opacity-40">{h.cadence}</span>
                </div>
                <div className="flex items-center gap-1 mt-1">
                  {h.last7.map((d) => (
                    <div key={d.date} title={d.date} className={`w-5 h-5 flex items-center justify-center font-sans text-[8px] font-bold ${d.done ? 'bg-[#2A6B5E] text-white' : 'bg-[#F5F2ED] border border-[#1A1A1A]/15 opacity-60'}`}>
                      {WEEKDAY(d.date)}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-1 shrink-0 font-sans font-black text-lg" title={`${h.streak} ${h.cadence === 'WEEKLY' ? 'week' : 'day'} streak`}>
                <Flame className={`w-5 h-5 ${h.streak > 0 ? 'text-[#D14D2A]' : 'opacity-30'}`} />
                {h.streak}
              </div>
              <button onClick={() => onDelete(h.id)} title="Delete" className="p-1 border border-[#1A1A1A]/30 hover:border-[#D14D2A] hover:text-[#D14D2A] transition-colors shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
