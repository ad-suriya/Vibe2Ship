import React, { useEffect, useRef, useState } from 'react';
import { Bell, X, Clock } from 'lucide-react';
import { api } from '../api';
import { Reminder } from '../types';

const NOTIFIED_KEY = 'lmls_notified_reminders';

function loadNotified(): Set<number> {
  try { return new Set(JSON.parse(localStorage.getItem(NOTIFIED_KEY) || '[]')); }
  catch { return new Set(); }
}
function saveNotified(set: Set<number>) {
  localStorage.setItem(NOTIFIED_KEY, JSON.stringify([...set]));
}

const fmt = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function RemindersBell() {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [open, setOpen] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  );
  const notifiedRef = useRef<Set<number>>(loadNotified());

  const fireNotifications = (items: Reminder[]) => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    for (const r of items) {
      if (r.due && !r.acknowledged && !notifiedRef.current.has(r.id)) {
        new Notification('Task Weave', { body: r.message });
        notifiedRef.current.add(r.id);
      }
    }
    saveNotified(notifiedRef.current);
  };

  const refresh = async () => {
    try {
      const items = await api.listReminders();
      setReminders(items);
      fireNotifications(items);
    } catch { /* backend offline */ }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enable = async () => {
    if (typeof Notification === 'undefined') return;
    const p = await Notification.requestPermission();
    setPermission(p);
    if (p === 'granted') fireNotifications(reminders);
  };

  const dismiss = async (id: number) => {
    await api.ackReminder(id);
    setReminders((prev) => prev.filter((r) => r.id !== id));
  };

  const dueCount = reminders.filter((r) => r.due).length;

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative p-2 border border-[#1A1A1A] hover:bg-[#1A1A1A] hover:text-white transition-colors" aria-label="Reminders">
        <Bell className="w-4 h-4" />
        {dueCount > 0 && (
          <span className="absolute -top-2 -right-2 bg-[#D14D2A] text-white font-sans text-[9px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
            {dueCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 bg-white border border-[#1A1A1A] shadow-[6px_6px_0px_0px_#1A1A1A] z-50">
          <div className="flex items-center justify-between border-b border-[#1A1A1A] px-4 py-2">
            <span className="font-sans text-[10px] uppercase tracking-widest font-black">Reminders</span>
            <button onClick={() => setOpen(false)}><X className="w-4 h-4" /></button>
          </div>

          {permission !== 'granted' && (
            <button onClick={enable} className="w-full font-sans text-[11px] font-bold uppercase tracking-widest px-4 py-2 bg-[#2A6B5E] text-white hover:opacity-90">
              Enable browser notifications
            </button>
          )}

          <div className="max-h-80 overflow-y-auto">
            {reminders.length === 0 ? (
              <p className="font-sans text-xs opacity-50 italic p-4 text-center">No reminders yet. Plan your day to generate them.</p>
            ) : (
              reminders.map((r) => (
                <div key={r.id} className={`flex items-start gap-2 px-4 py-3 border-b border-[#1A1A1A]/10 ${r.due ? 'bg-[#D14D2A]/5' : ''}`}>
                  <Clock className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${r.due ? 'text-[#D14D2A]' : 'opacity-40'}`} />
                  <div className="flex-grow min-w-0">
                    <p className="font-sans text-xs leading-snug">{r.message}</p>
                    <p className="font-sans text-[10px] opacity-50 mt-0.5">{fmt(r.remind_at)}{r.due && ' · due'}</p>
                  </div>
                  <button onClick={() => dismiss(r.id)} className="font-sans text-[9px] uppercase font-bold opacity-50 hover:opacity-100 hover:text-[#D14D2A]">Dismiss</button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
