import React, { useEffect, useState } from 'react';

interface Step {
  selector: string;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    selector: '[data-tour="chat-toggle"]',
    title: 'Start with Chat',
    body: "Toggle this open anytime. Dump a deadline or half-finished task in here — AI turns it into a plan and starts the first step for you.",
  },
  {
    selector: '[data-tour="nav-plan"]',
    title: 'Plan',
    body: 'Your tasks land on the Task Board. The Execution Panel above it always shows the one thing to do right now, with a timer.',
  },
  {
    selector: '[data-tour="task-toolbar"]',
    title: 'Add tasks',
    body: "Add a task manually here, or hit \"Plan my day\" to auto time-block everything you've got.",
  },
  {
    selector: '[data-tour="nav-goals"]',
    title: 'Goals',
    body: 'Set a goal and link tasks to it to track the bigger picture behind the busywork.',
  },
  {
    selector: '[data-tour="nav-habits"]',
    title: 'Habits',
    body: 'Track daily or weekly streaks — weekly streaks forgive an off day as long as you hit your count for the week.',
  },
  {
    selector: '[data-tour="nav-workflows"]',
    title: 'Workflows',
    body: 'Describe a recurring procedure in plain English and AI builds an automated workflow that creates those tasks for you.',
  },
  {
    selector: '[data-tour="search-bar"]',
    title: 'Search',
    body: 'Find any task, goal, habit, or focus session instantly from here.',
  },
];

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function findVisible(selector: string): HTMLElement | null {
  const els = Array.from(document.querySelectorAll<HTMLElement>(selector));
  return els.find((e) => e.getClientRects().length > 0) ?? els[0] ?? null;
}

interface Props {
  onDismiss: () => void;
}

export default function GuidedTour({ onDismiss }: Props) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const isLast = step === STEPS.length - 1;

  useEffect(() => {
    const measure = () => {
      const el = findVisible(STEPS[step].selector);
      if (!el) {
        setRect(null);
        return;
      }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      // Let the scroll settle before measuring final position.
      window.setTimeout(() => {
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      }, 250);
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [step]);

  // No anchor found (e.g. element not rendered in this view) — skip ahead
  // rather than leaving the tour stuck pointing at nothing.
  useEffect(() => {
    if (rect === null && findVisible(STEPS[step].selector) === null) {
      const id = window.setTimeout(() => {
        if (step < STEPS.length - 1) setStep((s) => s + 1);
        else onDismiss();
      }, 600);
      return () => window.clearTimeout(id);
    }
  }, [rect, step, onDismiss]);

  const pad = 8;
  const spotlight = rect && {
    top: rect.top - pad,
    left: rect.left - pad,
    width: rect.width + pad * 2,
    height: rect.height + pad * 2,
  };

  // Tooltip placement: prefer below the target, flip above if it would run
  // off the bottom of the viewport; clamp horizontally so it never clips.
  const TOOLTIP_W = 320;
  let tooltipStyle: React.CSSProperties = { visibility: 'hidden' };
  if (spotlight) {
    const spaceBelow = window.innerHeight - (spotlight.top + spotlight.height);
    const placeBelow = spaceBelow > 180;
    const top = placeBelow ? spotlight.top + spotlight.height + 12 : undefined;
    const bottom = !placeBelow ? window.innerHeight - spotlight.top + 12 : undefined;
    let left = spotlight.left;
    left = Math.max(12, Math.min(left, window.innerWidth - TOOLTIP_W - 12));
    tooltipStyle = { top, bottom, left, width: TOOLTIP_W, visibility: 'visible' };
  }

  return (
    <>
      {spotlight && (
        <div
          className="fixed z-[60] rounded-md pointer-events-none transition-all duration-200"
          style={{
            top: spotlight.top, left: spotlight.left, width: spotlight.width, height: spotlight.height,
            boxShadow: '0 0 0 9999px rgba(26,26,26,0.55)',
          }}
        />
      )}
      <div className="fixed z-[61] bg-white border-2 border-[#1A1A1A] shadow-[6px_6px_0px_0px_#1A1A1A] p-5 space-y-3 font-sans"
        style={tooltipStyle}>
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-black italic font-serif">{STEPS[step].title}</h3>
          <span className="text-[10px] uppercase font-bold opacity-40">{step + 1}/{STEPS.length}</span>
        </div>
        <p className="text-xs leading-relaxed opacity-80">{STEPS[step].body}</p>
        <div className="flex justify-between items-center gap-3 pt-1">
          <button onClick={onDismiss} className="text-[10px] uppercase font-bold tracking-widest opacity-50 hover:opacity-100 transition-opacity">
            Skip
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button onClick={() => setStep((s) => s - 1)}
                className="px-3 py-1.5 border border-[#1A1A1A] text-[10px] font-bold uppercase tracking-widest hover:bg-[#1A1A1A] hover:text-white transition-colors">
                Back
              </button>
            )}
            <button onClick={() => (isLast ? onDismiss() : setStep((s) => s + 1))}
              className="px-3 py-1.5 bg-[#1A1A1A] text-white text-[10px] font-bold uppercase tracking-widest hover:bg-[#333] transition-colors">
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
