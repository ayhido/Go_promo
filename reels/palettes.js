// Цветовые настроения роликов. Сценарий выбирает одно по эмоции темы.
export const PALETTES = {
  sunrise: { bg1: "#2b1055", bg2: "#0b0a24", glow: "#ff8a3d", accent: "#ffb703", accent2: "#ff4d8d", card: "#2a1f5c", card2: "#3d2b85", accentCard: "#c2410c", caption: "#ffd84d" },
  ocean: { bg1: "#0a3d62", bg2: "#04111f", glow: "#36d1dc", accent: "#3ee8ff", accent2: "#7b61ff", card: "#0f2d4a", card2: "#1d4f7a", accentCard: "#0d5c94", caption: "#5ff4ff" },
  mint: { bg1: "#0b4f4a", bg2: "#03161a", glow: "#7cf2c9", accent: "#4ef0a8", accent2: "#ffd84d", card: "#0d3a3a", card2: "#16605a", accentCard: "#0b6e57", caption: "#b6ff5c" },
  neon: { bg1: "#250b4f", bg2: "#06030f", glow: "#c13cff", accent: "#ff3cac", accent2: "#2bd2ff", card: "#2a0f4a", card2: "#4b1d7a", accentCard: "#6a1bb5", caption: "#ff9cf0" },
  gold: { bg1: "#3a2a0a", bg2: "#0d0903", glow: "#ffcf5c", accent: "#ffcf5c", accent2: "#ff7a45", card: "#33260f", card2: "#5c4416", accentCard: "#8a5a00", caption: "#ffe066" },
  fire: { bg1: "#4a0d12", bg2: "#120305", glow: "#ff6a3d", accent: "#ff7a1a", accent2: "#ffd84d", card: "#3f1115", card2: "#6e1c22", accentCard: "#a3241a", caption: "#ffd84d" }
};

export const pickPalette = (name) => PALETTES[name] || PALETTES.sunrise;
