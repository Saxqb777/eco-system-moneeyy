// World coordinates. Design resolution 1600 by 900, scaled to fit the viewport.

export const WORLD = { w: 1600, h: 900 };
export const GROUND_Y = 880;
export const LEVEL_H = 120;
export const SLAB = 14;
export const LEVEL_COUNT = 6;

export const BUILDING = {
  left: 330,
  right: 1270,
  shaftX: 330,
  shaftW: 70,
  interiorX: 400,
  interiorRight: 1230,
  sideW: 40,
};

// Slight isometric depth for slab top faces and the side facade.
export const DEPTH = { dx: 26, dy: -13 };

export function floorY(level: number): number {
  return GROUND_Y - level * LEVEL_H;
}

export function levelTop(level: number): number {
  return floorY(level) - LEVEL_H;
}

export const ROOF_Y = floorY(LEVEL_COUNT); // 160

// Level 3 was the Deals Engine until 2026-09-30; DocLedger Growth moved in (D065).
export const LEVEL_SLUGS = ["lobby", "service", "content", "growth", "docledger", "penthouse"] as const;
export type LevelSlug = (typeof LEVEL_SLUGS)[number];

export function levelOf(slug: string): number {
  const i = LEVEL_SLUGS.indexOf(slug as LevelSlug);
  return i < 0 ? 0 : i;
}

// Desk slots per floor: x of the chair. Workers sit behind their desk, facing out: the desk front is drawn over them.
export const DESK_SLOTS: Record<string, number[]> = {
  docledger: [480, 610, 740, 870],
  growth: [490, 605, 720, 835, 950, 1065],
  deals: [520, 720, 920],
  content: [500, 660, 820, 980],
  service: [500, 660, 820, 980],
  penthouse: [],
  lobby: [],
};

export const WORKSHOP = { x: 1010, benchX: 1120 };
export const PENTHOUSE = { deskX: 1060, paceMin: 480, paceMax: 940, windowX: 600, window2X: 800 };
export const LIFT_DOOR_X = BUILDING.interiorX + 22; // where riders stand before boarding
