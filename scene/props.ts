// Hand placed props, all flat shaded vector shapes. Positions are the base point (bottom centre).
import { Container, Graphics } from "pixi.js";
import { C, shade } from "./palette";
import { facetBox, plane, tri, twoTone } from "./draw";

export function desk(x: number, y: number, w = 84, accent: number = C.wood): Graphics {
  const g = new Graphics();
  const h = 30;
  // legs
  g.rect(x - w / 2 + 6, y - h, 5, h).fill(shade(accent, -0.35));
  g.rect(x + w / 2 - 11, y - h, 5, h).fill(shade(accent, -0.35));
  // drawer block on the right
  facetBox(g, x + w / 2 - 34, y - h + 4, 28, h - 4, shade(accent, -0.1), 0.35);
  g.rect(x + w / 2 - 24, y - h + 12, 9, 2).fill(C.brass);
  g.rect(x + w / 2 - 24, y - h + 20, 9, 2).fill(C.brass);
  // top slab with a receding top face
  g.rect(x - w / 2, y - h - 6, w, 6).fill(accent);
  plane(g, x - w / 2, y - h - 6, w, shade(accent, 0.28), 0.45);
  g.rect(x + w / 2, y - h - 6, Math.round(26 * 0.45), 6).fill(shade(accent, -0.3));
  return g;
}

export function monitor(x: number, y: number, on: boolean): Graphics {
  const g = new Graphics();
  g.rect(x - 3, y - 6, 6, 6).fill(C.charcoalLight);
  g.rect(x - 8, y - 1, 16, 2).fill(C.charcoalLight);
  g.roundRect(x - 15, y - 26, 30, 21, 2).fill(C.charcoalDark);
  g.rect(x - 13, y - 24, 26, 17).fill(on ? C.screen : 0x2a3138);
  if (on) {
    g.rect(x - 11, y - 21, 14, 2).fill(shade(C.screen, 0.35));
    g.rect(x - 11, y - 17, 20, 2).fill(shade(C.screen, 0.2));
    g.rect(x - 11, y - 13, 10, 2).fill(shade(C.screen, 0.35));
  }
  return g;
}

export function chair(x: number, y: number, color = 0x3a3f4a): Graphics {
  const g = new Graphics();
  g.rect(x - 2, y - 12, 4, 12).fill(shade(color, -0.3));
  g.rect(x - 9, y - 2, 18, 3).fill(shade(color, -0.3));
  g.roundRect(x - 11, y - 18, 22, 7, 2).fill(color);
  g.roundRect(x - 9, y - 46, 18, 30, 3).fill(color);
  g.roundRect(x, y - 46, 9, 30, 3).fill(shade(color, -0.2));
  return g;
}

export function plant(x: number, y: number, tall = 1): Graphics {
  const g = new Graphics();
  const ph = 14 * tall;
  g.poly([x - 9, y, x + 9, y, x + 7, y - ph, x - 7, y - ph]).fill(0x9a5f3a);
  g.rect(x + 1, y - ph, 6, ph).fill(0x7c4a2c);
  const top = y - ph;
  tri(g, x - 2, top, x - 20, top - 22, x - 6, top - 30 * tall, C.leaf);
  tri(g, x + 2, top, x + 20, top - 24, x + 8, top - 32 * tall, C.leafDark);
  tri(g, x - 4, top, x + 4, top, x, top - 40 * tall, C.leaf);
  tri(g, x - 12, top - 6, x + 2, top - 30 * tall, x - 2, top - 16, shade(C.leaf, 0.2));
  return g;
}

export function cabinet(x: number, y: number, h = 54, color = 0x4d5461): Graphics {
  const g = new Graphics();
  facetBox(g, x - 16, y - h, 32, h, color, 0.35);
  for (let i = 0; i < 3; i++) {
    g.rect(x - 12, y - h + 8 + i * 15, 24, 1).fill(shade(color, -0.35));
    g.rect(x - 4, y - h + 12 + i * 15, 8, 2).fill(C.brass);
  }
  return g;
}

export function lamp(x: number, y: number, on: boolean, floorLamp = true): Graphics {
  const g = new Graphics();
  if (floorLamp) {
    g.rect(x - 8, y - 3, 16, 3).fill(C.brassDark);
    g.rect(x - 1, y - 60, 2, 57).fill(C.brassDark);
    g.poly([x - 16, y - 60, x + 16, y - 60, x + 12, y - 82, x - 12, y - 82]).fill(on ? C.interiorLight : 0xc9b48f);
  } else {
    g.rect(x - 6, y - 2, 12, 2).fill(C.brassDark);
    g.rect(x - 1, y - 26, 2, 24).fill(C.brassDark);
    g.poly([x - 12, y - 26, x + 12, y - 26, x + 9, y - 40, x - 9, y - 40]).fill(on ? C.interiorLight : 0xc9b48f);
  }
  if (on) {
    const glow = new Graphics();
    const top = floorLamp ? y - 60 : y - 26;
    glow.poly([x - 16, top, x + 16, top, x + 34, top + 60, x - 34, top + 60]).fill({ color: C.glow, alpha: 0.12 });
    g.addChild(glow);
  }
  return g;
}

export function wallArt(x: number, y: number, w = 30, h = 22): Graphics {
  const g = new Graphics();
  g.rect(x - w / 2 - 2, y - h / 2 - 2, w + 4, h + 4).fill(C.brassDark);
  g.rect(x - w / 2, y - h / 2, w, h).fill(0x3b6f8f);
  tri(g, x - w / 2, y + h / 2, x - 2, y - 4, x + w / 2, y + h / 2, 0x2d4c5c);
  tri(g, x, y + h / 2, x + 10, y - 1, x + w / 2, y + h / 2, 0x223a46);
  g.circle(x + 8, y - 5, 3).fill(0xf2e8c8);
  return g;
}

export function rug(x: number, y: number, w: number, color = 0x7a2f2a): Graphics {
  const g = new Graphics();
  plane(g, x - w / 2, y, w, color, 0.9);
  plane(g, x - w / 2 + 8, y - 2, w - 16, shade(color, 0.12), 0.7);
  return g;
}

export function dustSheet(x: number, y: number, w = 70): Graphics {
  const g = new Graphics();
  // covered desk and chair, draped cloth with a few folds
  g.poly([x - w / 2, y, x + w / 2, y, x + w / 2 - 6, y - 30, x + 10, y - 36, x - 6, y - 52, x - 22, y - 48, x - w / 2 + 4, y - 30]).fill(C.dust);
  g.poly([x - 6, y - 52, x + 10, y - 36, x + w / 2 - 6, y - 30, x + w / 2, y, x + 8, y]).fill(C.dustDark);
  g.poly([x - 22, y - 48, x - 6, y - 52, x + 8, y, x - 12, y]).fill(shade(C.dust, 0.12));
  g.rect(x - w / 2 + 6, y - 3, 8, 3).fill(shade(C.dust, -0.3));
  g.rect(x + w / 2 - 14, y - 3, 8, 3).fill(shade(C.dust, -0.3));
  return g;
}

export function padlockPlate(x: number, y: number): Container {
  const c = new Container();
  const g = new Graphics();
  g.roundRect(x - 26, y - 36, 52, 36, 4).fill(C.charcoalLight);
  g.roundRect(x - 24, y - 34, 48, 32, 3).fill(C.charcoalDark);
  // lock body and shackle
  g.roundRect(x - 9, y - 20, 18, 14, 2).fill(C.brass);
  g.rect(x, y - 20, 9, 14).fill(C.brassDark);
  g.roundRect(x - 7, y - 30, 14, 14, 7).stroke({ width: 3, color: C.brassLight });
  g.rect(x - 8, y - 22, 16, 4).fill(C.charcoalDark);
  g.rect(x - 1, y - 14, 2, 4).fill(C.charcoalDark);
  c.addChild(g);
  return c;
}

export function phone(x: number, y: number): Graphics {
  const g = new Graphics();
  g.roundRect(x - 12, y - 8, 24, 8, 2).fill(C.red);
  g.rect(x, y - 8, 12, 8).fill(shade(C.red, -0.25));
  g.roundRect(x - 14, y - 14, 28, 5, 2).fill(shade(C.red, 0.1));
  g.rect(x - 2, y - 10, 4, 3).fill(shade(C.red, -0.3));
  return g;
}

export function clipboard(x: number, y: number): Graphics {
  const g = new Graphics();
  g.rect(x - 8, y - 22, 16, 22).fill(C.woodLight);
  g.rect(x - 6, y - 19, 12, 18).fill(C.paper);
  g.rect(x - 4, y - 23, 8, 3).fill(C.brass);
  g.rect(x - 4, y - 15, 8, 1).fill(C.muted);
  g.rect(x - 4, y - 11, 6, 1).fill(C.muted);
  g.rect(x - 4, y - 7, 8, 1).fill(C.muted);
  return g;
}

export function mailSlot(x: number, y: number): Graphics {
  const g = new Graphics();
  facetBox(g, x - 14, y - 22, 28, 22, C.brass, 0.4);
  g.rect(x - 9, y - 15, 18, 3).fill(C.charcoalDark);
  g.rect(x - 6, y - 8, 12, 1).fill(C.brassDark);
  return g;
}

export function bookshelf(x: number, y: number, h = 80): Graphics {
  const g = new Graphics();
  facetBox(g, x - 30, y - h, 60, h, C.woodDark, 0.4);
  const cols = [0x8f3b2f, 0x2f6f7a, 0xc9963b, 0x4a5a7a, 0x6a8a4a, 0x8a4a6a];
  for (let row = 0; row < 3; row++) {
    const sy = y - h + 8 + row * 24;
    g.rect(x - 26, sy + 18, 52, 2).fill(shade(C.woodDark, 0.3));
    let bx = x - 25;
    for (let i = 0; i < 7; i++) {
      const bw = 5 + ((i + row) % 3);
      const bh = 12 + ((i * 7 + row * 3) % 6);
      g.rect(bx, sy + 18 - bh, bw, bh).fill(cols[(i + row) % cols.length]!);
      bx += bw + 1;
    }
  }
  return g;
}

export function armchair(x: number, y: number, color = 0x6b3a2a): Graphics {
  const g = new Graphics();
  g.roundRect(x - 20, y - 26, 40, 22, 5).fill(color);
  g.roundRect(x - 22, y - 44, 10, 40, 4).fill(shade(color, -0.15));
  g.roundRect(x + 12, y - 44, 10, 40, 4).fill(shade(color, -0.3));
  g.roundRect(x - 16, y - 54, 32, 30, 5).fill(shade(color, 0.08));
  g.rect(x - 18, y - 4, 4, 4).fill(C.woodDark);
  g.rect(x + 14, y - 4, 4, 4).fill(C.woodDark);
  return g;
}

export function sofa(x: number, y: number, color = 0x5a4a3a): Graphics {
  const g = new Graphics();
  g.roundRect(x - 40, y - 22, 80, 18, 4).fill(color);
  g.roundRect(x - 44, y - 36, 10, 32, 4).fill(shade(color, -0.15));
  g.roundRect(x + 34, y - 36, 10, 32, 4).fill(shade(color, -0.3));
  g.roundRect(x - 36, y - 42, 72, 22, 4).fill(shade(color, 0.08));
  g.rect(x - 2, y - 40, 3, 18).fill(shade(color, -0.2));
  return g;
}

export function receptionDesk(x: number, y: number): Graphics {
  const g = new Graphics();
  facetBox(g, x - 70, y - 40, 140, 40, C.wood, 0.45);
  g.rect(x - 70, y - 44, 140 + 12, 5).fill(C.woodLight);
  g.rect(x - 62, y - 30, 124, 3).fill(C.brass);
  g.rect(x + 30, y - 52, 8, 8).fill(C.charcoalLight);
  g.roundRect(x + 22, y - 62, 24, 12, 2).fill(C.charcoalDark);
  return g;
}

export function cashCounter(x: number, y: number): Container {
  const c = new Container();
  const g = new Graphics();
  facetBox(g, x - 46, y - 40, 92, 40, C.woodDark, 0.45);
  g.rect(x - 46, y - 44, 92 + 12, 5).fill(C.brass);
  // brass cage bars
  for (let i = 0; i < 9; i++) g.rect(x - 42 + i * 11, y - 92, 2, 48).fill(C.brass);
  g.rect(x - 46, y - 94, 92, 4).fill(C.brassDark);
  g.rect(x - 46, y - 70, 92, 2).fill(C.brassDark);
  g.rect(x - 30, y - 64, 60, 14).fill(C.charcoalDark);
  c.addChild(g);
  return c;
}

export function toolBench(x: number, y: number): Graphics {
  const g = new Graphics();
  facetBox(g, x - 50, y - 34, 100, 34, C.woodDark, 0.45);
  g.rect(x - 50, y - 38, 100 + 12, 5).fill(C.woodLight);
  // pegboard on the wall behind
  g.rect(x - 44, y - 110, 88, 60).fill(0x6a5238);
  for (let r = 0; r < 4; r++) for (let col = 0; col < 8; col++) g.rect(x - 40 + col * 11, y - 104 + r * 14, 2, 2).fill(0x3d2e1f);
  g.rect(x - 34, y - 100, 4, 24).fill(C.charcoalLight);
  g.rect(x - 38, y - 102, 12, 5).fill(C.brassDark);
  g.rect(x - 14, y - 98, 22, 4).fill(C.charcoalLight);
  g.rect(x + 12, y - 100, 5, 20).fill(C.red);
  g.rect(x + 26, y - 94, 12, 12).fill(C.brass);
  // laptop on the bench
  g.rect(x - 16, y - 40, 32, 2).fill(C.charcoalLight);
  g.poly([x - 14, y - 40, x + 14, y - 40, x + 12, y - 60, x - 12, y - 60]).fill(C.charcoalDark);
  g.poly([x - 11, y - 43, x + 11, y - 43, x + 9, y - 57, x - 9, y - 57]).fill(C.screen);
  return g;
}

export function window(x: number, y: number, w: number, h: number, glow: number): Graphics {
  const g = new Graphics();
  g.rect(x - 3, y - 3, w + 6, h + 6).fill(C.charcoalLight);
  g.rect(x, y, w, h).fill(shade(C.skyNightBottom, glow * 0.15));
  g.rect(x + w / 2 - 1, y, 2, h).fill(C.charcoalLight);
  g.rect(x, y + h / 2 - 1, w, 2).fill(C.charcoalLight);
  return g;
}

export function doorway(x: number, y: number): Graphics {
  const g = new Graphics();
  g.rect(x - 22, y - 78, 44, 78).fill(C.charcoalDark);
  g.rect(x - 20, y - 76, 18, 76).fill(shade(C.wood, -0.1));
  g.rect(x + 2, y - 76, 18, 76).fill(shade(C.wood, -0.3));
  g.rect(x - 6, y - 40, 3, 3).fill(C.brass);
  g.rect(x + 4, y - 40, 3, 3).fill(C.brass);
  g.rect(x - 24, y - 82, 48, 4).fill(C.brassDark);
  return g;
}

export function sconce(x: number, y: number, on: boolean): Graphics {
  const g = new Graphics();
  g.rect(x - 3, y - 10, 6, 10).fill(C.brassDark);
  g.poly([x - 8, y - 10, x + 8, y - 10, x + 5, y - 18, x - 5, y - 18]).fill(on ? C.interiorLight : 0xc9b48f);
  if (on) g.poly([x - 8, y - 18, x + 8, y - 18, x + 14, y - 40, x - 14, y - 40]).fill({ color: C.glow, alpha: 0.1 });
  return g;
}

export function coffeeMachine(x: number, y: number): Graphics {
  const g = new Graphics();
  facetBox(g, x - 12, y - 30, 24, 30, C.charcoalLight, 0.3);
  g.rect(x - 8, y - 26, 16, 8).fill(C.charcoalDark);
  g.rect(x - 4, y - 12, 8, 6).fill(C.paper);
  g.circle(x + 6, y - 22, 2).fill(C.red);
  return g;
}

export function twoToneWallStrip(x: number, y: number, w: number, h: number, color: number): Graphics {
  const g = new Graphics();
  twoTone(g, x, y, w, h, color);
  return g;
}
