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
// Level 2 was the locked Content Farm until 2026-10-01; Wall Street moved in (D075).
export const LEVEL_SLUGS = ["lobby", "service", "trading", "growth", "docledger", "penthouse"] as const;
export type LevelSlug = (typeof LEVEL_SLUGS)[number];

export function levelOf(slug: string): number {
  const i = LEVEL_SLUGS.indexOf(slug as LevelSlug);
  return i < 0 ? 0 : i;
}

// Desk slots per floor: x of the chair. Workers sit behind their desk, facing out: the desk front is drawn over them.
export const DESK_SLOTS: Record<string, number[]> = {
  docledger: [480, 610, 740, 870],
  // seven since Social joined (D074): a little closer together, the whiteboard still clear at the end
  growth: [480, 578, 676, 774, 872, 970, 1068],
  deals: [520, 720, 920],
  content: [500, 660, 820, 980],
  // eight trading desks, four each side of the meeting pit in the middle
  trading: [515, 581, 647, 713, 847, 913, 979, 1045],
  service: [500, 660, 820, 980],
  penthouse: [],
  lobby: [],
};

export const WORKSHOP = { x: 1010, benchX: 1120 };
export const PENTHOUSE = { deskX: 1060, paceMin: 480, paceMax: 940, windowX: 600, window2X: 800 };
export const LIFT_DOOR_X = BUILDING.interiorX + 22; // where riders stand before boarding

// Wall Street (D075): who sits where. Larry naps in his recliner by the lift, the pit is between Chief and Bear.
export const TRADING_SEATS: Record<string, number> = {
  trading_larry: 452,
  trading_news: 515,
  trading_quant: 581,
  trading_bull: 647,
  trading_bear: 847,
  trading_risk: 913,
  trading_runner: 979,
  trading_coach: 1045,
  // the Chief runs the floor from the glass corner office at the end (D078)
  trading_chief: 1150,
  // the Strategist stands in the pit under the market wall
  trading_strategist: 780,
};
export const TRADING_PIT = { x: 780, w: 66 };
// The Chief's glass corner office (D078): the partition, the door gap, the desk inside, the bull outside by the pit.
export const TRADING_OFFICE = { wallX: 1112, doorY: 0, bullX: 740 };
