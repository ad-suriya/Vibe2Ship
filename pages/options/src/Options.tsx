import '@src/Options.css';
import { useStorage, withErrorBoundary, withSuspense } from '@extension/shared';
import { exampleThemeStorage, FRONTEND_URL } from '@extension/storage';
import { cn, ErrorDisplay, LoadingSpinner } from '@extension/ui';

interface Feature {
  icon: string;
  title: string;
  body: string;
}

const FEATURES: Feature[] = [
  {
    icon: '📥',
    title: 'Capture a task from anywhere',
    body:
      'Right-click any page (or a text selection) and choose "Add to Task Weave," or press ' +
      '⌘/Ctrl+Shift+Y. It grabs the title, the URL, and anything you had highlighted.',
  },
  {
    icon: '⏱️',
    title: 'Run a focus session',
    body:
      "Open the popup, describe what you're doing (or pick an open task) and hit Start. It tracks " +
      "elapsed time and shows up on your dashboard's Execution Panel and the popup's daily/weekly totals.",
  },
  {
    icon: '🚧',
    title: 'Stay off distracting sites',
    body:
      'Every focus session blocks a default list — YouTube, Instagram, X, Reddit — editable anytime ' +
      'from the popup. Landing on a blocked site redirects to a lock screen with a one-time, ' +
      '5-minute-delayed override if you really need through.',
  },
  {
    icon: '🔒',
    title: "Lock to one task's site",
    body:
      'When you capture a task from a page, check "Lock my browser" — only that site stays reachable ' +
      'until you finish or hit Unlock in the popup. Built for tasks like "finish this lesson" where ' +
      'every other tab is the distraction, not just the usual suspects.',
  },
  {
    icon: '🔄',
    title: 'Everything syncs',
    body:
      'Same login as your Task Weave dashboard — tasks, focus sessions, and logged time all show up ' +
      'there immediately, no separate account or export step.',
  },
];

const Options = () => {
  const { isLight } = useStorage(exampleThemeStorage);
  const openDashboard = () => chrome.tabs.create({ url: FRONTEND_URL });

  return (
    <div className={cn('min-h-screen font-sans py-10 px-6', isLight ? 'bg-paper text-ink' : 'bg-ink text-paper')}>
      <div className="mx-auto max-w-2xl space-y-8">
        <div>
          <img src={chrome.runtime.getURL('icon-128.png')} alt="" className="h-10 w-10 mb-2" />
          <p className={cn('text-[10px] uppercase tracking-widest font-bold', isLight ? 'text-ink/60' : 'text-paper/60')}>
            Task Weave
          </p>
          <h1 className="font-serif italic font-black text-3xl leading-tight">
            Remember.
            <br />
            Connect. Execute.
          </h1>
          <p className={cn('mt-2 text-sm', isLight ? 'text-ink/70' : 'text-paper/70')}>
            This extension is how Task Weave reaches you outside the dashboard — capturing what's in front of
            you and keeping you on it. Here's everything it does.
          </p>
        </div>

        <div className="space-y-4">
          {FEATURES.map(f => (
            <div
              key={f.title}
              className={cn(
                'flex gap-4 border p-4',
                isLight
                  ? 'bg-white border-ink shadow-[3px_3px_0px_0px_rgba(26,26,26,0.15)]'
                  : 'bg-[#222] border-paper shadow-[3px_3px_0px_0px_rgba(245,242,237,0.15)]',
              )}>
              <span className="text-2xl shrink-0" aria-hidden="true">
                {f.icon}
              </span>
              <div>
                <h2 className="font-bold tracking-tight">{f.title}</h2>
                <p className={cn('mt-1 text-sm leading-snug', isLight ? 'text-ink/70' : 'text-paper/70')}>{f.body}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between pt-2">
          <p className={cn('text-[10px] uppercase tracking-widest', isLight ? 'text-ink/50' : 'text-paper/50')}>
            Revisit this anytime: right-click the extension icon → Options.
          </p>
          <button
            onClick={openDashboard}
            className={cn(
              'shrink-0 px-4 py-2 text-xs font-bold uppercase tracking-widest border',
              isLight
                ? 'bg-ink text-paper border-ink shadow-[3px_3px_0px_0px_#D14D2A] hover:bg-[#333]'
                : 'bg-paper text-ink border-paper shadow-[3px_3px_0px_0px_#D14D2A] hover:bg-gray-200',
            )}>
            Open Dashboard
          </button>
        </div>
      </div>
    </div>
  );
};

export default withErrorBoundary(withSuspense(Options, <LoadingSpinner />), ErrorDisplay);
