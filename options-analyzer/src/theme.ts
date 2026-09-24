/**
 * Delta-Exchange-inspired dark palette. Orange primary, green/red for
 * profit/loss, dense dark surfaces for high-density trading data.
 */
export const theme = {
  colors: {
    // Layered near-black surfaces (base → cards → sheets → inputs) per design spec.
    bg: '#0A0A0D',
    surface: '#131316',
    surfaceAlt: '#1B1B1F',
    surface3: '#232327',
    border: '#26262B',
    // Brand red is magenta-leaning (hue ~350°) and is the ONLY red allowed to glow.
    primary: '#FF1F3D',
    primaryDim: '#2A0E15', // dark brand tint for active fills
    text: '#FFFFFF',
    textDim: '#A0A0A8',
    textFaint: '#5C5C64',
    // Semantic up/down — down is deliberately a DIFFERENT (orange-leaning) red so
    // P&L losses never read as the brand accent.
    profit: '#22C55E',
    profitLine: '#25D0A5',
    loss: '#F4574C',
    expiryLine: '#FF1F3D',
    t0Line: '#25D0A5',
    buy: '#22C55E',
    sell: '#F4574C',
    warning: '#F5A623',
    grid: '#1E1E24',
    crosshair: '#FFFFFF',
    glow: '#FF3D5C',
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
