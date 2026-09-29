// The building shell: ground, floor slabs, columns, lift shaft, side facade, roof deck, city behind.
import { Container, Graphics } from "pixi.js";
import { BUILDING, DEPTH, GROUND_Y, LEVEL_COUNT, ROOF_Y, WORLD, floorY } from "./layout";
import { C, shade } from "./palette";
import { plane } from "./draw";

export interface Shell {
  back: Container; // behind interiors
  front: Container; // in front of characters (slab edges, columns)
  facadeGlow: Graphics; // window glow on the side facade, alpha follows darkness
  skylineGlow: Graphics;
}

export function buildSkyline(): { base: Graphics; glow: Graphics } {
  const base = new Graphics();
  const glow = new Graphics();
  const far = shade(C.skyNightBottom, -0.15);
  const near = shade(C.skyNightTop, -0.1);
  // far row
  const farBlocks = [
    [20, 620, 90], [130, 560, 70], [210, 660, 120], [1290, 600, 80], [1380, 520, 60], [1450, 640, 110], [1560, 580, 40],
  ];
  for (const [x, top, w] of farBlocks) {
    base.rect(x!, top!, w!, GROUND_Y - top!).fill(far);
    for (let r = 0; r < 6; r++) for (let c = 0; c < 3; c++) {
      if (((r * 7 + c * 3 + x!) % 5) < 2) glow.rect(x! + 10 + c * 22, top! + 14 + r * 30, 8, 10).fill(C.glow);
    }
  }
  // near row
  const nearBlocks = [
    [0, 700, 110], [110, 740, 60], [180, 690, 100], [1240, 720, 90], [1330, 680, 70], [1410, 730, 120], [1530, 700, 70],
  ];
  for (const [x, top, w] of nearBlocks) {
    base.rect(x!, top!, w!, GROUND_Y - top!).fill(near);
    base.rect(x!, top!, w!, 6).fill(shade(near, 0.15));
    for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) {
      if (((r * 5 + c * 11 + x!) % 7) < 3) glow.rect(x! + 8 + c * 24, top! + 16 + r * 26, 9, 11).fill(C.glow);
    }
  }
  return { base, glow };
}

export function buildShell(): Shell {
  const back = new Container();
  const front = new Container();
  const g = new Graphics();
  const f = new Graphics();
  const facadeGlow = new Graphics();
  const skylineGlow = new Graphics();

  // Ground and pavement
  g.rect(0, GROUND_Y, WORLD.w, WORLD.h - GROUND_Y).fill(0x14161c);
  plane(g, 0, GROUND_Y, WORLD.w, 0x1d2027, 1);
  g.rect(BUILDING.left - 60, GROUND_Y, BUILDING.right - BUILDING.left + 200, 8).fill(C.stoneDark);
  g.rect(BUILDING.left - 60, GROUND_Y, BUILDING.right - BUILDING.left + 200, 2).fill(shade(C.stoneDark, 0.2));

  // Side facade receding to the right with rows of windows
  const fx = BUILDING.right;
  const dx = DEPTH.dx * 3;
  const dy = DEPTH.dy * 3;
  g.poly([fx, ROOF_Y, fx + dx, ROOF_Y + dy, fx + dx, GROUND_Y + dy, fx, GROUND_Y]).fill(shade(C.charcoal, -0.25));
  for (let level = 0; level < LEVEL_COUNT; level++) {
    const top = floorY(level) - 96;
    for (let i = 0; i < 2; i++) {
      const wx = fx + 14 + i * 34;
      const t = (wx - fx) / dx;
      const wy = top + dy * t;
      const ww = 18;
      const t2 = (wx + ww - fx) / dx;
      const wy2 = top + dy * t2;
      g.poly([wx, wy, wx + ww, wy2, wx + ww, wy2 + 30, wx, wy + 30]).fill(shade(C.charcoalDark, -0.2));
      facadeGlow.poly([wx + 2, wy + 2, wx + ww - 2, wy2 + 2, wx + ww - 2, wy2 + 28, wx + 2, wy + 28]).fill(C.glow);
    }
  }
  // Roof deck
  g.poly([BUILDING.left, ROOF_Y, BUILDING.left + dx, ROOF_Y + dy, fx + dx, ROOF_Y + dy, fx, ROOF_Y]).fill(shade(C.charcoal, 0.12));
  g.rect(BUILDING.left, ROOF_Y - 8, BUILDING.right - BUILDING.left, 8).fill(C.charcoalLight);
  g.rect(BUILDING.left, ROOF_Y - 10, BUILDING.right - BUILDING.left, 2).fill(C.brassDark);
  // Parapet along the roof back edge
  g.poly([BUILDING.left + dx, ROOF_Y + dy - 10, fx + dx, ROOF_Y + dy - 10, fx + dx, ROOF_Y + dy, BUILDING.left + dx, ROOF_Y + dy]).fill(shade(C.charcoal, -0.05));

  // Lift shaft back and rails
  g.rect(BUILDING.shaftX, ROOF_Y, BUILDING.shaftW, GROUND_Y - ROOF_Y).fill(C.charcoalDark);
  g.rect(BUILDING.shaftX + 12, ROOF_Y, 3, GROUND_Y - ROOF_Y).fill(shade(C.brassDark, -0.3));
  g.rect(BUILDING.shaftX + BUILDING.shaftW - 15, ROOF_Y, 3, GROUND_Y - ROOF_Y).fill(shade(C.brassDark, -0.3));
  for (let level = 0; level <= LEVEL_COUNT; level++) {
    const y = floorY(level);
    g.rect(BUILDING.shaftX, y - 3, BUILDING.shaftW, 3).fill(shade(C.charcoalDark, 0.2));
  }
  // Shaft outer frame and left wall
  g.rect(BUILDING.left - 10, ROOF_Y - 10, 10, GROUND_Y - ROOF_Y + 10).fill(shade(C.charcoal, -0.3));

  // Slabs: front face and top face (front layer so they overlap characters' feet)
  for (let level = 0; level <= LEVEL_COUNT; level++) {
    const y = floorY(level);
    if (level < LEVEL_COUNT) {
      f.rect(BUILDING.interiorX, y, BUILDING.interiorRight - BUILDING.interiorX, 14).fill(C.charcoalLight);
      f.rect(BUILDING.interiorX, y, BUILDING.interiorRight - BUILDING.interiorX, 2).fill(C.brassDark);
      f.rect(BUILDING.interiorX, y + 12, BUILDING.interiorRight - BUILDING.interiorX, 2).fill(shade(C.charcoalLight, -0.3));
    }
  }
  // Columns between shaft and interiors, and the right column
  f.rect(BUILDING.interiorX - 6, ROOF_Y, 6, GROUND_Y - ROOF_Y).fill(C.charcoal);
  f.rect(BUILDING.interiorX - 6, ROOF_Y, 2, GROUND_Y - ROOF_Y).fill(shade(C.charcoal, 0.2));
  f.rect(BUILDING.interiorRight, ROOF_Y, BUILDING.sideW, GROUND_Y - ROOF_Y).fill(C.charcoal);
  f.rect(BUILDING.interiorRight, ROOF_Y, 3, GROUND_Y - ROOF_Y).fill(shade(C.charcoal, 0.18));
  f.rect(BUILDING.interiorRight + BUILDING.sideW - 4, ROOF_Y, 4, GROUND_Y - ROOF_Y).fill(shade(C.charcoal, -0.3));
  // Level markers on the right column: brass rings
  for (let level = 0; level < LEVEL_COUNT; level++) {
    f.rect(BUILDING.interiorRight + 6, floorY(level) - 60, BUILDING.sideW - 12, 3).fill(C.brassDark);
  }

  back.addChild(g, facadeGlow);
  front.addChild(f);
  return { back, front, facadeGlow, skylineGlow };
}

export function buildSky(): Graphics {
  return new Graphics();
}

export function buildStars(): Graphics {
  const g = new Graphics();
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 90; i++) {
    const x = rnd() * WORLD.w;
    const y = rnd() * 520;
    const s = rnd() < 0.15 ? 2 : 1;
    g.rect(Math.round(x), Math.round(y), s, s).fill({ color: 0xffffff, alpha: 0.35 + rnd() * 0.5 });
  }
  return g;
}

export function buildMoon(): Graphics {
  const g = new Graphics();
  g.circle(0, 0, 26).fill(0xf1e6c8);
  g.circle(10, -6, 22).fill(0x0e1422);
  g.circle(-10, 4, 3).fill(0xd9cda8);
  g.circle(-4, 14, 2).fill(0xd9cda8);
  return g;
}

export function buildSun(): Graphics {
  const g = new Graphics();
  g.circle(0, 0, 30).fill(0xf6d98a);
  g.circle(0, 0, 24).fill(0xfbe7a8);
  return g;
}
