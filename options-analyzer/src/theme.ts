/**
 * Delta-Exchange-inspired dark palette. Orange primary, green/red for
 * profit/loss, dense dark surfaces for high-density trading data.
 */
export const theme = {
  colors: {
    bg: '#0A0A0C', // near-black
    surface: '#141416',
    surfaceAlt: '#1C1C20',
    border: '#2A2A30',
    primary: '#FF3B47', // glowing red brand accent
    primaryDim: '#2A1013', // dark red tint for active fills
    text: '#F5F6F8',
    textDim: '#8A8E97',
    textFaint: '#5B5E66',
    profit: '#16C784', // up / buy — kept distinct from the brand red
    profitLine: '#25D0A5',
    loss: '#F6465D', // down / sell (slightly brighter than brand so numbers read as loss)
    expiryLine: '#FF3B47',
    t0Line: '#25D0A5',
    buy: '#16C784',
    sell: '#F6465D',
    grid: '#1E1E24',
    crosshair: '#F5F6F8',
    glow: '#FF3B47',
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
