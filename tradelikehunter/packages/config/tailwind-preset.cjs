/**
 * TradeLikeHunter design tokens — the single source of truth for the design
 * system. Consumed by apps/web and packages/ui. Premium dark-first SaaS palette
 * with a light theme via CSS variables (data-theme on <html>).
 */
module.exports = {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // semantic tokens resolve to CSS vars so light/dark swap cleanly
        bg: 'rgb(var(--bg) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--surface-2) / <alpha-value>)',
        border: 'rgb(var(--border) / <alpha-value>)',
        text: 'rgb(var(--text) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        faint: 'rgb(var(--faint) / <alpha-value>)',
        brand: 'rgb(var(--brand) / <alpha-value>)', // hunter orange
        profit: 'rgb(var(--profit) / <alpha-value>)', // green/cyan
        loss: 'rgb(var(--loss) / <alpha-value>)', // red
        accent: 'rgb(var(--accent) / <alpha-value>)',
      },
      borderRadius: { sm: '6px', md: '10px', lg: '16px', xl: '22px' },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'], // tabular numbers for prices
      },
      boxShadow: {
        card: '0 1px 0 rgb(255 255 255 / 0.02) inset, 0 8px 24px -12px rgb(0 0 0 / 0.6)',
        pop: '0 12px 40px -8px rgb(0 0 0 / 0.55)',
      },
      transitionTimingFunction: { smooth: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    },
  },
  // Token values (drop into a global stylesheet):
  //  :root[data-theme="dark"]  { --bg:11 14 17; --surface:20 26 32; --surface-2:27 34 43;
  //    --border:36 45 56; --text:242 244 246; --muted:138 148 160; --faint:91 101 114;
  //    --brand:247 148 30; --profit:37 208 165; --loss:234 57 67; --accent:99 102 241; }
  //  :root[data-theme="light"] { --bg:247 248 250; --surface:255 255 255; --surface-2:243 245 248;
  //    --border:225 229 234; --text:17 24 33; --muted:90 100 112; --faint:150 158 168;
  //    --brand:214 120 6; --profit:16 160 116; --loss:214 42 42; --accent:79 82 210; }
};
