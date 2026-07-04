// 5 design themes = 5 "different elevations" for the SAME plan geometry.
// Palette cues taken from the designer's reference render (white + grey + teak).
export const THEMES = [
  {
    id: "white-teak",
    name: "Contemporary White & Teak",
    plaster: "#eceae4",     // main wall
    accent: "#b7bcc0",      // grey band / fluted panel
    wood: "#a5642a",        // teak cladding
    rail: "#2b2d31",        // black metal railing
    railGlass: "#bcd4e0",
    glass: "#8fb8cf",
    trim: "#f4f2ec",
    slab: "#dedbd3",
    ground: "#8a9a5b",
    sky: "#7fb4e6",
  },
  {
    id: "sand-bronze",
    name: "Warm Sandstone & Bronze",
    plaster: "#e7d8c3", accent: "#c9a884", wood: "#8a5a2b",
    rail: "#6e4b2a", railGlass: "#d8c6a8", glass: "#a9b7a0",
    trim: "#f2e9db", slab: "#d8c7ad", ground: "#9a8b56", sky: "#8cc0ea",
  },
  {
    id: "mono",
    name: "Modern Monochrome",
    plaster: "#f2f2f2", accent: "#3a3d42", wood: "#5b5f66",
    rail: "#1c1e21", railGlass: "#c4ccd2", glass: "#9aa7b0",
    trim: "#ffffff", slab: "#d7d7d9", ground: "#7f8a6f", sky: "#8fb9e0",
  },
  {
    id: "terracotta",
    name: "Earthy Terracotta",
    plaster: "#f1e7db", accent: "#b5613e", wood: "#8f4a2a",
    rail: "#4a2f22", railGlass: "#e0c9b4", glass: "#a7bca6",
    trim: "#faf3e9", slab: "#e2d3c1", ground: "#8f9a52", sky: "#86bde6",
  },
  {
    id: "slate-oak",
    name: "Cool Slate & Timber",
    plaster: "#dfe3e6", accent: "#586770", wood: "#c08a4a",
    rail: "#2c3338", railGlass: "#c8d6de", glass: "#8fb0c2",
    trim: "#eef1f3", slab: "#cdd4d8", ground: "#7d9a6a", sky: "#84b6e8",
  },
];

export const themeById = (id) => THEMES.find((t) => t.id === id) || THEMES[0];
