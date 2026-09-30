// Hand placed props, all flat shaded vector shapes. Positions are the base point (bottom centre).
import { Container, Graphics } from "pixi.js";
import { C, shade } from "./palette";
import { facetBox, label, plane, tri, twoTone } from "./draw";

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

// Phase 2 fixes and polish props

// A desk and monitor under a dust cloth: the shapes read through the cloth, folds hang down,
// a chair leg pokes out on the left and, every other desk, a lamp pokes out on the right.
export function coveredDesk(x: number, y: number, withLamp: boolean): Graphics {
  const g = new Graphics();
  // things poking out from under the cloth
  g.rect(x - 44, y - 14, 4, 14).fill(shade(C.charcoalLight, -0.1)); // chair leg
  g.rect(x - 48, y - 3, 12, 3).fill(shade(C.charcoalLight, -0.3));
  if (withLamp) {
    g.rect(x + 44, y - 44, 2, 40).fill(C.brassDark);
    g.poly([x + 36, y - 44, x + 54, y - 44, x + 51, y - 54, x + 39, y - 54]).fill(0xc9b48f);
  }
  // cloth silhouette: desk block with a monitor bump, folds down the front
  const top = y - 36;
  const cloth = [
    x - 40, y, x - 42, top + 4, x - 36, top, x - 12, top, x - 8, top - 22, x + 10, top - 24, x + 14, top, x + 38, top, x + 44, top + 6, x + 42, y,
  ];
  g.poly(cloth).fill(C.dust);
  // shaded right side of the monitor bump and desk
  g.poly([x + 2, top - 24, x + 10, top - 24, x + 14, top, x + 4, top]).fill(C.dustDark);
  g.poly([x + 14, top, x + 38, top, x + 44, top + 6, x + 42, y, x + 22, y]).fill(shade(C.dust, -0.12));
  // hanging folds
  for (let i = 0; i < 5; i++) {
    const fx = x - 34 + i * 16;
    g.poly([fx, top + 6, fx + 5, top + 6, fx + 3, y, fx - 2, y]).fill(shade(C.dust, i % 2 ? -0.18 : 0.1));
  }
  g.rect(x - 40, y - 2, 82, 2).fill(shade(C.dust, -0.35));
  return g;
}

export function waterCooler(x: number, y: number): Graphics {
  const g = new Graphics();
  facetBox(g, x - 10, y - 40, 20, 40, C.paper, 0.3);
  g.rect(x - 7, y - 30, 14, 6).fill(0x3b6f8f);
  g.rect(x - 4, y - 24, 8, 4).fill(C.charcoalLight);
  // bottle
  g.roundRect(x - 9, y - 68, 18, 30, 5).fill({ color: 0x8fd0e6, alpha: 0.9 });
  g.roundRect(x - 1, y - 68, 10, 30, 5).fill({ color: 0x6fb6d0, alpha: 0.9 });
  g.rect(x - 4, y - 72, 8, 5).fill(0x3b6f8f);
  // paper cups
  g.rect(x + 12, y - 36, 5, 7).fill(C.paper);
  g.rect(x + 12, y - 44, 5, 7).fill(C.paperShade);
  return g;
}

export interface Fan {
  container: Container;
  blades: Container;
}

export function ceilingFan(x: number, y: number): Fan {
  const container = new Container();
  const rod = new Graphics();
  rod.rect(x - 2, y, 4, 22).fill(C.brassDark);
  rod.circle(x, y + 24, 5).fill(C.brass);
  const blades = new Container();
  const b = new Graphics();
  for (let i = 0; i < 4; i++) {
    const a = (i * Math.PI) / 2;
    const cx = Math.cos(a), sy = Math.sin(a) * 0.35;
    b.poly([0, 0, cx * 30 - sy * 4, sy * 30 + cx * 4 * 0.35, cx * 30 + sy * 4, sy * 30 - cx * 4 * 0.35]).fill(i % 2 ? C.woodDark : C.wood);
  }
  blades.addChild(b);
  blades.position.set(x, y + 24);
  container.addChild(rod, blades);
  return { container, blades };
}

export interface DeskLamp {
  container: Container;
  setOn(on: boolean): void;
}

// A small brass desk lamp that turns red when its worker is blocked.
export function deskLamp(x: number, y: number): DeskLamp {
  const container = new Container();
  const base = new Graphics();
  base.rect(x - 5, y - 2, 10, 2).fill(C.brassDark);
  base.rect(x - 1, y - 18, 2, 16).fill(C.brassDark);
  const shadeG = new Graphics();
  const glow = new Graphics();
  container.addChild(base, glow, shadeG);
  const draw = (on: boolean) => {
    shadeG.clear();
    shadeG.poly([x - 8, y - 18, x + 8, y - 18, x + 6, y - 28, x - 6, y - 28]).fill(on ? C.red : C.brassDark);
    glow.clear();
    if (on) {
      glow.poly([x - 8, y - 18, x + 8, y - 18, x + 20, y + 2, x - 20, y + 2]).fill({ color: C.red, alpha: 0.22 });
      glow.circle(x, y - 23, 3).fill({ color: 0xff8a80, alpha: 0.9 });
    }
  };
  draw(false);
  return { container, setOn: draw };
}

export function keyboard(x: number, y: number): Graphics {
  const g = new Graphics();
  g.roundRect(x - 14, y - 4, 28, 5, 1).fill(C.charcoalLight);
  for (let i = 0; i < 6; i++) g.rect(x - 12 + i * 4.3, y - 3, 3, 1.5).fill(shade(C.charcoalLight, 0.4));
  g.rect(x - 9, y - 1, 18, 1).fill(shade(C.charcoalLight, 0.3));
  return g;
}

export function speakerSwitch(x: number, y: number, on: boolean): Graphics {
  const g = new Graphics();
  facetBox(g, x - 16, y - 24, 32, 24, C.charcoal, 0.4);
  g.rect(x - 10, y - 18, 8, 12).fill(on ? C.brassLight : C.stoneDark);
  g.poly([x - 2, y - 18, x + 6, y - 22, x + 6, y - 2, x - 2, y - 6]).fill(on ? C.brassLight : C.stoneDark);
  if (on) {
    g.moveTo(x + 9, y - 16).lineTo(x + 12, y - 12).lineTo(x + 9, y - 8).stroke({ width: 1.5, color: C.brassLight });
  } else {
    g.moveTo(x + 9, y - 16).lineTo(x + 13, y - 8).stroke({ width: 1.5, color: C.red });
    g.moveTo(x + 13, y - 16).lineTo(x + 9, y - 8).stroke({ width: 1.5, color: C.red });
  }
  return g;
}

export function coin(): Graphics {
  const g = new Graphics();
  g.circle(0, 0, 7).fill(C.brassDark);
  g.circle(-1, -1, 6).fill(C.real);
  g.circle(-2, -2, 3).fill(0xfbe7a8);
  return g;
}

export function paperSheet(): Graphics {
  const g = new Graphics();
  g.rect(-5, -7, 10, 14).fill(C.paper);
  g.rect(-3, -4, 6, 1).fill(C.muted);
  g.rect(-3, -1, 6, 1).fill(C.muted);
  g.rect(-3, 2, 4, 1).fill(C.muted);
  return g;
}

// Animated prop variants used by the polish layer

export interface PlantProp {
  container: Container;
  leaves: Container;
}

// A plant whose leaves can sway: the pot stays, the leaves pivot at the soil line.
export function plantSway(x: number, y: number, tall = 1): PlantProp {
  const container = new Container();
  const pot = new Graphics();
  const ph = 14 * tall;
  pot.poly([x - 9, y, x + 9, y, x + 7, y - ph, x - 7, y - ph]).fill(0x9a5f3a);
  pot.rect(x + 1, y - ph, 6, ph).fill(0x7c4a2c);
  const leaves = new Container();
  const lg = new Graphics();
  tri(lg, -2, 0, -20, -22, -6, -30 * tall, C.leaf);
  tri(lg, 2, 0, 20, -24, 8, -32 * tall, C.leafDark);
  tri(lg, -4, 0, 4, 0, 0, -40 * tall, C.leaf);
  tri(lg, -12, -6, 2, -30 * tall, -2, -16, shade(C.leaf, 0.2));
  leaves.addChild(lg);
  leaves.position.set(x, y - ph);
  container.addChild(pot, leaves);
  return { container, leaves };
}

export interface MonitorProp {
  container: Container;
  redraw(seed: number, on: boolean): void;
}

// A monitor whose screen content changes now and then, like someone actually working.
export function monitorProp(x: number, y: number, on: boolean): MonitorProp {
  const container = new Container();
  const frame = new Graphics();
  frame.rect(x - 3, y - 6, 6, 6).fill(C.charcoalLight);
  frame.rect(x - 8, y - 1, 16, 2).fill(C.charcoalLight);
  frame.roundRect(x - 15, y - 26, 30, 21, 2).fill(C.charcoalDark);
  const screen = new Graphics();
  container.addChild(frame, screen);
  const redraw = (seed: number, lit: boolean) => {
    screen.clear();
    screen.rect(x - 13, y - 24, 26, 17).fill(lit ? C.screen : 0x2a3138);
    if (!lit) return;
    let s = seed >>> 0 || 1;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    const rows = 3 + Math.floor(rnd() * 2);
    for (let i = 0; i < rows; i++) {
      const w = 6 + Math.floor(rnd() * 16);
      screen.rect(x - 11, y - 21 + i * 4, w, 2).fill(shade(C.screen, 0.2 + rnd() * 0.3));
    }
    if (rnd() < 0.4) screen.rect(x - 11 + Math.floor(rnd() * 14), y - 9, 6, 2).fill(C.paper);
  };
  redraw(1, on);
  return { container, redraw };
}

export function namePlate(x: number, y: number, name: string): Container {
  const c = new Container();
  const t = label(name.toUpperCase(), { fontSize: 9, fill: C.ink, spacing: 1 });
  const w = t.width + 10;
  const g = new Graphics();
  g.rect(0, 0, w, 12).fill(C.brassDark);
  g.rect(1, 1, w - 2, 10).fill(C.brass);
  t.position.set(5, 1);
  c.addChild(g, t);
  c.position.set(x - w / 2, y);
  return c;
}

export function openSign(x: number, y: number): Container {
  const c = new Container();
  const g = new Graphics();
  g.rect(x - 1, y - 14, 2, 14).fill(C.brassDark);
  g.rect(x - 20, y, 40, 16).fill(C.paper);
  g.rect(x - 20, y, 40, 2).fill(C.paperShade);
  g.rect(x - 20, y, 40, 16).stroke({ width: 1.5, color: C.brassDark });
  const t = label("OPEN", { fontSize: 11, fill: C.red, spacing: 2 });
  t.position.set(x - t.width / 2, y + 1);
  c.addChild(g, t);
  return c;
}

// A small office printer on a stand, a green ready light and a sheet in the tray.
export function printer(x: number, y: number): Graphics {
  const g = new Graphics();
  facetBox(g, x - 14, y - 26, 28, 26, 0x4d5461, 0.3);
  g.rect(x - 10, y - 20, 20, 2).fill(shade(0x4d5461, 0.25));
  facetBox(g, x - 16, y - 42, 32, 16, 0xd6d9dc, 0.35);
  g.rect(x - 16, y - 42, 32, 3).fill(0xeef0f1);
  g.rect(x - 11, y - 33, 22, 3).fill(0x2b2f3a);
  g.rect(x - 9, y - 46, 18, 4).fill(C.paper);
  g.circle(x + 11, y - 37, 1.6).fill(0x3bd16f);
  return g;
}

export interface WallClock {
  container: Container;
  set(hour: number, minute: number, second: number): void;
}

// A round office clock on the wall, showing Dubai time.
export function wallClock(x: number, y: number, r = 13): WallClock {
  const container = new Container();
  const face = new Graphics();
  face.circle(x, y, r + 3).fill(C.brassDark);
  face.circle(x, y, r + 1.5).fill(C.brass);
  face.circle(x, y, r).fill(C.paper);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const len = i % 3 === 0 ? 3 : 1.5;
    face.rect(x + Math.sin(a) * (r - 3) - 0.75, y - Math.cos(a) * (r - 3) - len / 2, 1.5, len).fill(C.ink);
  }
  const hands = new Graphics();
  container.addChild(face, hands);
  let last = "";
  return {
    container,
    set(hour, minute, second) {
      const key = `${hour}:${minute}:${second}`;
      if (key === last) return;
      last = key;
      hands.clear();
      const hand = (angle: number, len: number, width: number, color: number) => {
        hands.moveTo(x, y).lineTo(x + Math.sin(angle) * len, y - Math.cos(angle) * len).stroke({ width, color, cap: "round" });
      };
      hand(((hour % 12) + minute / 60) / 12 * Math.PI * 2, r * 0.5, 2, C.ink);
      hand((minute + second / 60) / 60 * Math.PI * 2, r * 0.78, 1.5, C.ink);
      hand((second / 60) * Math.PI * 2, r * 0.82, 0.8, C.red);
      hands.circle(x, y, 1.6).fill(C.brassDark);
    },
  };
}

// Brass letters fixed to a wall, with a thin shadow so they stand off it.
export function brassLetters(text: string, x: number, y: number, size = 20): Container {
  const c = new Container();
  const shadow = label(text, { fontSize: size, fill: 0x14161c, spacing: size * 0.18 });
  const face = label(text, { fontSize: size, fill: C.brassLight, spacing: size * 0.18 });
  shadow.alpha = 0.45;
  shadow.position.set(x - face.width / 2 + 2, y + 2);
  face.position.set(x - face.width / 2, y);
  c.addChild(shadow, face);
  return c;
}
