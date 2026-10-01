// Colours as numbers for PixiJS. Same values as design/palette.html.

export const C = {
  skyNightTop: 0x0e1422,
  skyNightBottom: 0x1b2438,
  horizonNight: 0x3a2a24,
  skyDayTop: 0x7fb2d9,
  skyDayBottom: 0xe8d6b3,
  skyDawnTop: 0x1b2438,
  skyDawnBottom: 0xe8a66c,
  skyDuskTop: 0x1b2e3d,
  skyDuskBottom: 0xe07a3a,
  charcoal: 0x262a33,
  charcoalDark: 0x1a1d24,
  charcoalLight: 0x343946,
  brass: 0xc9963b,
  brassDark: 0x8a6424,
  brassLight: 0xe0b56a,
  wood: 0x8c5a2b,
  woodDark: 0x5a3a22,
  woodLight: 0xa9743d,
  glow: 0xf2b86c,
  interiorLight: 0xffd9a0,
  paper: 0xf3e9d2,
  paperShade: 0xd9cdb2,
  ink: 0x1e1a16,
  muted: 0x6e6455,
  stone: 0x9c8f7a,
  stoneDark: 0x6f6553,
  real: 0xe0b04a,
  sim: 0x5da9e9,
  red: 0xc0392b,
  screen: 0x7fc8c0,
  dust: 0x8d8a82,
  dustDark: 0x67645c,
  leaf: 0x4f8a4a,
  leafDark: 0x35613a,
  skin: [0xf1c9a5, 0xd9a577, 0xb97a4b, 0x8c5a3c],
  shirt: [0xe8e1d4, 0x9bb7c7, 0xc9a27a, 0xb8c4a8],
  hair: [0x2b2118, 0x4a2f1c, 0x8a6a3a, 0x1e1e22, 0xb9b3a8, 0x6a3b2a],
  trouser: 0x2f3340,
  coat: 0x2b2f3a,
  coatLight: 0x3d4250,
} as const;

export const FLOOR_ACCENT: Record<string, number> = {
  penthouse: 0xd4a537,
  docledger: 0x2a9d8f,
  growth: 0x3a86c8,
  deals: 0xf08a24,
  content: 0x5fa55a,
  trading: 0x1fa35b,
  service: 0xc94f7c,
  lobby: 0x9c8f7a,
};

export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

// Positive lightens toward white, negative darkens toward black.
export function shade(color: number, amount: number): number {
  return amount >= 0 ? mix(color, 0xffffff, amount) : mix(color, 0x000000, -amount);
}
