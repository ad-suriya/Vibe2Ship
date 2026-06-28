import React from 'react';
import { AlertOctagon, Check } from 'lucide-react';
import { Task } from '../types';

interface Props {
  task: Task;
  onMarkDone: (task: Task) => void;
}

const fmtDeadline = (iso: string) =>
  new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

// Panic Mode per spec: near-deadline + large backlog -> show exactly one
// task and suppress everything else. No board, no list, no choice to make.
export default function PanicPanel({ task, onMarkDone }: Props) {
  return (
    <div className="bg-[#D14D2A] text-white p-8 shadow-[6px_6px_0px_0px_#1A1A1A] flex flex-col items-center text-center gap-4">
      <AlertOctagon className="w-8 h-8" />
      <span className="font-sans text-[10px] uppercase tracking-widest font-black opacity-80">
        Only this matters right now
      </span>
      <h2 className="text-3xl font-black italic tracking-tight leading-tight">{task.task_name}</h2>
      {task.deadline && (
        <p className="font-sans text-xs uppercase tracking-widest opacity-80">Due {fmtDeadline(task.deadline)}</p>
      )}
      <div className="bg-white/10 px-5 py-4 w-full max-w-md">
        <span className="font-sans text-[9px] font-bold uppercase block mb-1 opacity-70">Do this now</span>
        <p className="font-sans text-sm leading-snug">{task.next_micro_step || 'Pick the smallest next action and start.'}</p>
      </div>
      <button onClick={() => onMarkDone(task)}
        className="font-sans text-[11px] font-bold uppercase tracking-widest px-5 py-3 bg-white text-[#D14D2A] hover:bg-[#1A1A1A] hover:text-white transition-colors flex items-center gap-2">
        <Check className="w-3.5 h-3.5" /> Mark Done
      </button>
    </div>
  );
}
