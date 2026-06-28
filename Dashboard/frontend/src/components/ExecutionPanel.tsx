import React from 'react';
import { Play, Pause, RotateCcw, Check, Crosshair } from 'lucide-react';
import { Task } from '../types';

interface Props {
  task: Task | null;
  isActive: boolean; // true if `task` is the IN_PROGRESS one (vs. just "up next")
  pomoSeconds: number;
  pomoRunning: boolean;
  onStartFocus: (task: Task) => void;
  onToggleTimer: () => void;
  onResetTimer: () => void;
  onMarkDone: (task: Task) => void;
}

const fmtTimer = (s: number) => {
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
};

// The single execution surface the spec calls for: one active task, a timer,
// and the next micro-step — no list, no decision-making while executing.
export default function ExecutionPanel({
  task, isActive, pomoSeconds, pomoRunning, onStartFocus, onToggleTimer, onResetTimer, onMarkDone,
}: Props) {
  if (!task) return null;

  return (
    <div className="bg-[#1A1A1A] text-white p-5 shadow-[5px_5px_0px_0px_#D14D2A]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Crosshair className="w-4 h-4 text-[#D14D2A]" />
          <span className="font-sans text-[10px] uppercase tracking-widest font-bold opacity-60">
            {isActive ? 'Executing' : 'Up Next'}
          </span>
        </div>
        {isActive && (
          <span className="font-serif font-black text-3xl tabular-nums tracking-tight">{fmtTimer(pomoSeconds)}</span>
        )}
      </div>

      <h3 className="text-xl font-bold tracking-tight leading-tight mb-2">{task.task_name}</h3>

      <div className="mb-4 pt-3 border-t border-dashed border-white/20">
        <span className="font-sans text-[9px] font-bold uppercase block mb-1 opacity-60">Next Step</span>
        <p className="font-sans text-sm leading-snug">{task.next_micro_step || 'Just start — momentum will tell you the rest.'}</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {isActive ? (
          <>
            <button onClick={onToggleTimer} className="p-2.5 border border-white/40 hover:bg-white hover:text-[#1A1A1A] transition-colors" aria-label={pomoRunning ? 'Pause' : 'Play'}>
              {pomoRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button onClick={onResetTimer} className="p-2.5 border border-white/40 hover:bg-white hover:text-[#1A1A1A] transition-colors" aria-label="Reset">
              <RotateCcw className="w-4 h-4" />
            </button>
            <button onClick={() => onMarkDone(task)} className="ml-auto font-sans text-[11px] font-bold uppercase tracking-widest px-3 py-2 bg-[#2A6B5E] hover:opacity-90 transition-opacity flex items-center gap-2">
              <Check className="w-3.5 h-3.5" /> Done
            </button>
          </>
        ) : (
          <button onClick={() => onStartFocus(task)} className="font-sans text-[11px] font-bold uppercase tracking-widest px-4 py-2 bg-[#D14D2A] hover:opacity-90 transition-opacity">
            Start Focus
          </button>
        )}
      </div>
    </div>
  );
}
