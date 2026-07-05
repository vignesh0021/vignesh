import { describe, expect, it } from 'vitest';

import { useTheme } from '../src/app/theme';

describe('theme store', () => {
  it('sets data-theme on the root element', () => {
    useTheme.getState().setTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(useTheme.getState().theme).toBe('light');
  });

  it('toggles between dark and light', () => {
    useTheme.getState().setTheme('dark');
    useTheme.getState().toggle();
    expect(useTheme.getState().theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    useTheme.getState().toggle();
    expect(useTheme.getState().theme).toBe('dark');
  });
});
