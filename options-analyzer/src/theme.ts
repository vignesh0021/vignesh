/**
 * Delta-Exchange-inspired dark palette. Orange primary, green/red for
 * profit/loss, dense dark surfaces for high-density trading data.
 */
export const theme = {
  colors: {
    bg: '#0B0E11',
    surface: '#141A20',
    surfaceAlt: '#1B222B',
    border: '#242D38',
    primary: '#F7941E', // Delta orange
    primaryDim: '#7a4c12',
    text: '#F2F4F6',
    textDim: '#8A94A0',
    textFaint: '#5B6572',
    profit: '#16C784', // green / cyan expiry-favourable
    profitLine: '#25D0A5',
    loss: '#EA3943', // red
    expiryLine: '#F7941E', // orange expiry curve
    t0Line: '#25D0A5', // green/cyan T+0 curve
    buy: '#16C784',
    sell: '#EA3943',
    grid: '#20272F',
    crosshair: '#F2F4F6',
  },
  spacing: (n: number) => n * 4,
  radius: { sm: 6, md: 10, lg: 16 },
  font: {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 18,
    xl: 22,
  },
} as const;

export type Theme = typeof theme;
