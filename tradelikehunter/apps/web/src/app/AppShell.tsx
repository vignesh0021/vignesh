import { NavLink, Outlet } from 'react-router-dom';

import { Logo } from './Logo';
import { useTheme } from './theme';

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: '◉' },
  { to: '/markets', label: 'Markets', icon: '▤' },
  { to: '/trade', label: 'Trade', icon: '⇄' },
  { to: '/portfolio', label: 'Portfolio', icon: '▦' },
  { to: '/learn', label: 'Learn', icon: '🎓' },
];

/** App layout: desktop sidebar + topbar, mobile bottom tab bar. */
export function AppShell() {
  const theme = useTheme((s) => s.theme);
  const toggle = useTheme((s) => s.toggle);

  return (
    <div className="flex h-full flex-col md:flex-row">
      {/* Sidebar (desktop) */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface md:flex">
        <div className="flex items-center gap-2 px-5 py-4">
          <Logo />
          <span className="font-extrabold tracking-tight">TradeLikeHunter</span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  isActive ? 'bg-surface-2 text-text' : 'text-muted hover:text-text'
                }`
              }
            >
              <span aria-hidden="true" className="w-4 text-center">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-4 text-xs text-faint">Virtual wallet · ₹10,00,000</div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border bg-surface px-4 py-3 md:px-6">
          <div className="flex items-center gap-2 md:hidden">
            <Logo size={24} />
            <span className="font-extrabold">TLH</span>
          </div>
          <div className="ml-auto flex items-center gap-4 font-mono text-xs text-muted">
            <span>NIFTY <span className="text-profit">24,180 ▲0.4%</span></span>
            <span className="hidden sm:inline">VIX <span className="text-text">13.4</span></span>
            <button
              onClick={toggle}
              className="rounded-md border border-border px-2 py-1 text-text hover:bg-surface-2"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? '☀︎' : '☾'}
            </button>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto p-4 pb-24 md:p-6 md:pb-6">
          <Outlet />
        </main>
      </div>

      {/* Bottom nav (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-surface md:hidden">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${
                isActive ? 'text-brand' : 'text-muted'
              }`
            }
          >
            <span aria-hidden="true" className="text-base">{n.icon}</span>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
