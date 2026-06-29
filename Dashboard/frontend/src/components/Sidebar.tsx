import React from 'react';
import { CalendarDays, LayoutGrid, Target, Repeat, Workflow as WorkflowIcon, GitBranch, Brain, LucideIcon } from 'lucide-react';

export type Section = 'plan' | 'board' | 'goals' | 'habits' | 'workflows' | 'breakdown' | 'memory';

interface NavItem {
  id: Section;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'plan', label: 'Plan', icon: CalendarDays },
  { id: 'board', label: 'Tasks', icon: LayoutGrid },
  { id: 'breakdown', label: 'Breakdown', icon: GitBranch },
  { id: 'goals', label: 'Goals', icon: Target },
  { id: 'habits', label: 'Habits', icon: Repeat },
  { id: 'workflows', label: 'Workflows', icon: WorkflowIcon },
  { id: 'memory', label: 'Memory', icon: Brain },
];

interface Props {
  active: Section;
  onSelect: (s: Section) => void;
  badges?: Partial<Record<Section, number>>;
  // Rendered as a horizontal strip on small screens instead of a sidebar —
  // every section stays one tap away regardless of viewport.
  horizontal?: boolean;
}

export default function Sidebar({ active, onSelect, badges = {}, horizontal = false }: Props) {
  if (horizontal) {
    return (
      <nav className="relative z-50 flex lg:hidden border-b border-[#1A1A1A] bg-white overflow-x-auto">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => onSelect(id)} data-tour={`nav-${id}`}
            className={`flex items-center gap-1.5 px-4 py-3 font-sans text-[10px] uppercase font-black tracking-widest whitespace-nowrap shrink-0 ${
              active === id ? 'bg-[#1A1A1A] text-white' : 'opacity-70 hover:opacity-100'
            }`}>
            <Icon className="w-3.5 h-3.5" />
            {label}
            {!!badges[id] && (
              <span className="ml-1 px-1.5 bg-[#D14D2A] text-white rounded-full text-[9px]">{badges[id]}</span>
            )}
          </button>
        ))}
      </nav>
    );
  }

  return (
    <nav className="hidden lg:flex flex-col w-56 shrink-0 border-r border-[#1A1A1A] bg-white h-screen sticky top-0">
      <div className="px-5 py-6 border-b border-[#1A1A1A]">
        <div className="flex items-center gap-2 mb-1">
          <img src="/logo-mark.png" alt="" className="h-5 w-5" />
          <span className="font-sans text-[9px] uppercase tracking-widest font-bold opacity-60">Task Weave</span>
        </div>
        <h1 className="text-2xl font-black italic tracking-tight leading-none font-serif">Remember.<br />Connect. Execute.</h1>
      </div>

      <div className="flex flex-col gap-1 p-3 flex-grow">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => onSelect(id)} data-tour={`nav-${id}`}
            className={`flex items-center gap-3 px-3 py-2.5 font-sans text-[11px] uppercase font-black tracking-widest transition-colors text-left ${
              active === id ? 'bg-[#1A1A1A] text-white' : 'hover:bg-[#F5F2ED]'
            }`}>
            <Icon className="w-4 h-4 shrink-0" />
            <span className="flex-grow">{label}</span>
            {!!badges[id] && (
              <span className={`px-1.5 rounded-full text-[9px] font-bold ${active === id ? 'bg-white text-[#1A1A1A]' : 'bg-[#D14D2A] text-white'}`}>
                {badges[id]}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="p-4 border-t border-[#1A1A1A]/10">
        <p className="font-sans text-[9px] uppercase font-black tracking-widest opacity-40">Zero-friction starts.</p>
        <p className="font-sans text-[9px] uppercase font-black tracking-widest opacity-40">Real deadlines met.</p>
      </div>
    </nav>
  );
}
