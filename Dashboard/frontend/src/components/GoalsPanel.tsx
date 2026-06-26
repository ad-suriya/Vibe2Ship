import React, { useState } from 'react';
import { Plus, Minus, Trash2, Target } from 'lucide-react';
import { Goal } from '../types';

interface Props {
  goals: Goal[];
  onAdd: (body: { title: string; metric: string; target_value: number; deadline: string | null }) => void;
  onIncrement: (id: number, delta: number) => void;
  onDelete: (id: number) => void;
}

export default function GoalsPanel({ goals, onAdd, onIncrement, onDelete }: Props) {
  const [show, setShow] = useState(false);
  const [draft, setDraft] = useState({ title: '', metric: 'steps', target_value: 5, deadline: '' });

  const submit = () => {
    if (!draft.title.trim()) return;
    onAdd({
      title: draft.title.trim(),
      metric: draft.metric.trim() || 'steps',
      target_value: Number(draft.target_value) || 1,
      deadline: draft.deadline || null,
    });
    setDraft({ title: '', metric: 'steps', target_value: 5, deadline: '' });
    setShow(false);
  };

  return (
    <div>
      <div className="flex items-center gap-3 border-b border-[#1A1A1A] pb-2 mb-4">
        <Target className="w-4 h-4" />
        <span className="font-sans text-[10px] uppercase tracking-widest font-black">Goals</span>
        <div className="h-[1px] flex-grow bg-[#1A1A1A] opacity-20" />
        <button onClick={() => setShow((s) => !s)} className="font-sans text-[10px] uppercase font-bold tracking-widest flex items-center gap-1 px-2 py-1 border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white transition-colors">
          <Plus className="w-3 h-3" /> Goal
        </button>
      </div>

      {show && (
        <div className="bg-white border border-[#1A1A1A] p-4 mb-4 space-y-3 shadow-[3px_3px_0px_0px_rgba(26,26,26,0.1)]">
          <input className="w-full p-2 border border-[#1A1A1A]/30 font-sans text-sm focus:outline-none focus:ring-1 focus:ring-[#1A1A1A]"
            placeholder="Goal title (e.g. Finish thesis chapter)" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <div className="grid grid-cols-3 gap-2">
            <label className="font-sans text-[10px] uppercase font-bold tracking-widest flex flex-col gap-1">Target
              <input type="number" min={1} className="p-2 border border-[#1A1A1A]/30 font-sans text-xs" value={draft.target_value} onChange={(e) => setDraft({ ...draft, target_value: Number(e.target.value) })} />
            </label>
            <label className="font-sans text-[10px] uppercase font-bold tracking-widest flex flex-col gap-1">Unit
              <input className="p-2 border border-[#1A1A1A]/30 font-sans text-xs normal-case" value={draft.metric} onChange={(e) => setDraft({ ...draft, metric: e.target.value })} />
            </label>
            <label className="font-sans text-[10px] uppercase font-bold tracking-widest flex flex-col gap-1">Due
              <input type="date" className="p-2 border border-[#1A1A1A]/30 font-sans text-xs normal-case" value={draft.deadline} onChange={(e) => setDraft({ ...draft, deadline: e.target.value })} />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShow(false)} className="font-sans text-[10px] uppercase font-bold tracking-widest px-3 py-2">Cancel</button>
            <button onClick={submit} disabled={!draft.title.trim()} className="font-sans text-[10px] uppercase font-bold tracking-widest px-3 py-2 bg-[#1A1A1A] text-white disabled:opacity-40">Add goal</button>
          </div>
        </div>
      )}

      {goals.length === 0 ? (
        <div className="font-sans text-sm opacity-50 italic py-10 text-center border border-dashed border-[#1A1A1A]/30">
          No goals yet. Set one to track the bigger picture behind your tasks.
        </div>
      ) : (
        <div className="space-y-4">
          {goals.map((g) => {
            const pct = g.target_value > 0 ? Math.min(100, Math.round((g.current_value / g.target_value) * 100)) : 0;
            const complete = g.current_value >= g.target_value;
            return (
              <div key={g.id} className="bg-white border border-[#1A1A1A] p-4 shadow-[3px_3px_0px_0px_rgba(26,26,26,0.1)]">
                <div className="flex justify-between items-start gap-2 mb-2">
                  <h3 className="text-lg font-bold tracking-tight leading-tight">{g.title}</h3>
                  <button onClick={() => onDelete(g.id)} title="Delete" className="p-1 border border-[#1A1A1A]/30 hover:border-[#D14D2A] hover:text-[#D14D2A] transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-grow h-3 bg-[#F5F2ED] border border-[#1A1A1A]/20 overflow-hidden">
                    <div className="h-full transition-all" style={{ width: `${pct}%`, backgroundColor: complete ? '#2A6B5E' : '#D14D2A' }} />
                  </div>
                  <span className="font-sans text-xs font-bold tabular-nums whitespace-nowrap">{g.current_value}/{g.target_value} {g.metric}</span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="font-sans text-[10px] uppercase tracking-wide opacity-60">
                    {g.linked_total > 0 ? `${g.linked_done}/${g.linked_total} linked tasks done` : 'No linked tasks'}
                    {g.deadline && ` · by ${new Date(g.deadline).toLocaleDateString()}`}
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => onIncrement(g.id, -1)} className="p-1.5 border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white transition-colors" aria-label="Decrement"><Minus className="w-3 h-3" /></button>
                    <button onClick={() => onIncrement(g.id, 1)} className="p-1.5 border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white transition-colors" aria-label="Increment"><Plus className="w-3 h-3" /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
