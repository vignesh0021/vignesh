import { create } from 'zustand';

export type Theme = 'dark' | 'light';

const KEY = 'tlh-theme';

function readStored(): Theme {
  if (typeof localStorage === 'undefined') return 'dark';
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' ? v : 'dark';
}

export function applyTheme(theme: Theme): void {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

function persist(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* ignore (private mode / SSR) */
  }
}

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => ({
  theme: readStored(),
  setTheme: (t) => {
    applyTheme(t);
    persist(t);
    set({ theme: t });
  },
  toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}));

// Apply the persisted theme as early as possible.
applyTheme(readStored());
