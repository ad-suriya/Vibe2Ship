import React from 'react';
import { Bell } from 'lucide-react';

interface Props {
  onEnable: () => void;
  onDismiss: () => void;
}

// Asked once, right after first login, instead of being buried inside the
// Reminders bell dropdown where most people would never find it.
export default function NotificationPrompt({ onEnable, onDismiss }: Props) {
  return (
    <div className="bg-white border border-[#1A1A1A] p-4 flex items-center justify-between gap-4 shadow-[5px_5px_0px_0px_rgba(26,26,26,0.1)] flex-wrap">
      <div className="flex items-center gap-3">
        <Bell className="w-5 h-5 text-[#2A6B5E] shrink-0" />
        <div>
          <span className="font-sans text-[10px] uppercase tracking-widest font-bold opacity-60 block">Stay on top of deadlines</span>
          <p className="font-sans text-sm">Turn on browser notifications so reminders reach you even when this tab isn't active.</p>
        </div>
      </div>
      <div className="flex gap-2 shrink-0">
        <button onClick={onDismiss} className="font-sans text-[10px] uppercase font-bold tracking-widest px-3 py-2 hover:opacity-70 transition-opacity">
          Not now
        </button>
        <button onClick={onEnable} className="font-sans text-[11px] font-bold uppercase tracking-widest px-4 py-2 bg-[#2A6B5E] text-white hover:opacity-90 transition-opacity">
          Enable
        </button>
      </div>
    </div>
  );
}
