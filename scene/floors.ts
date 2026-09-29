// Interiors per floor. Rebuilt when the lights switch (night to day), otherwise static.
import { Container, Graphics } from "pixi.js";
import { BUILDING, DESK_SLOTS, LEVEL_H, PENTHOUSE, SLAB, WORKSHOP, floorY } from "./layout";
import { C, FLOOR_ACCENT, mix, shade } from "./palette";
import { plane, twoTone } from "./draw";
import * as P from "./props";

export interface FloorInfo {
  slug: string;
  name: string;
  level: number;
  status: string; // locked, live, paused
  unlockRule: string | null;
}

export interface FloorBuild {
  container: Container;
  deskSlots: number[];
}

const IX = BUILDING.interiorX;
const IR = BUILDING.interiorRight;
const IW = IR - IX;

export function buildFloor(info: FloorInfo, night: boolean): FloorBuild {
  const c = new Container();
  const y = floorY(info.level); // feet line
  const top = y - LEVEL_H + SLAB; // ceiling line
  const h = y - top;
  const locked = info.status === "locked";
  const accent = FLOOR_ACCENT[info.slug] ?? C.stone;
  const g = new Graphics();

  // Back wall, two tone, dimmed at night, very dim when locked
  const wallBase = locked ? mix(C.charcoalDark, accent, 0.08) : mix(C.charcoal, accent, night ? 0.32 : 0.42);
  twoTone(g, IX, top, IW, h, wallBase, 0.62, locked ? 0.08 : 0.14);
  // ceiling shadow line and baseboard
  g.rect(IX, top, IW, 6).fill(shade(wallBase, -0.35));
  g.rect(IX, y - 5, IW, 5).fill(locked ? shade(C.dustDark, -0.2) : C.woodDark);

  // Floor surface with a little depth
  const floorColor = locked ? 0x4a4842 : info.slug === "lobby" ? C.stone : info.slug === "penthouse" ? C.woodDark : C.wood;
  plane(g, IX, y, IW, shade(floorColor, 0.1), 0.5);
  if (info.slug === "lobby") {
    for (let i = 1; i < 12; i++) g.rect(IX + i * 70, y - 1, 1, 1).fill(shade(C.stone, -0.3));
  }
  c.addChild(g);

  const on = night && !locked;
  const slots = DESK_SLOTS[info.slug] ?? [];

  if (!locked && info.slug !== "lobby") {
    const lights = new Graphics();
    const xs = info.slug === "penthouse" ? [900, 1100] : [560, 800, 1040];
    for (const lx of xs) {
      lights.rect(lx - 26, top + 6, 52, 4).fill(shade(C.charcoalLight, 0.2));
      lights.rect(lx - 24, top + 10, 48, 2).fill(on ? C.interiorLight : 0xb8ad94);
      if (on) lights.poly([lx - 24, top + 12, lx + 24, top + 12, lx + 60, y - 6, lx - 60, y - 6]).fill({ color: C.glow, alpha: 0.06 });
    }
    c.addChild(lights);
  }

  if (locked) {
    for (const sx of slots) c.addChild(P.dustSheet(sx, y - 1, 74));
    c.addChild(P.padlockPlate(IR - 60, y - 40));
    const sheetPlant = new Graphics();
    sheetPlant.poly([IX + 18, y, IX + 46, y, IX + 42, y - 44, IX + 30, y - 56, IX + 20, y - 40]).fill(C.dust);
    c.addChild(sheetPlant);
    return { container: c, deskSlots: slots };
  }

  if (info.slug === "docledger") {
    c.addChild(P.plant(IX + 26, y, 1));
    c.addChild(P.wallArt(500, top + 34));
    c.addChild(P.window(680, top + 18, 110, 50, night ? 1 : 0));
    const dlView = new Graphics();
    dlView.rect(682, top + 20, 106, 46).fill(night ? 0x151c2c : 0x9cc0dc);
    for (let i = 0; i < 5; i++) {
      const bx = 688 + i * 20;
      const bh = 12 + ((i * 7) % 20);
      dlView.rect(bx, top + 66 - bh, 14, bh).fill(night ? 0x0f1420 : 0x6f8ea6);
      if (night) dlView.rect(bx + 3, top + 66 - bh + 5, 3, 3).fill(C.glow);
    }
    c.addChild(dlView);
    c.addChild(P.wallArt(900, top + 34, 36, 24));
    for (const sx of slots) {
      c.addChild(P.chair(sx, y - 2));
    }
    // partition to the workshop wing, with a doorway gap
    const part = new Graphics();
    part.rect(WORKSHOP.x - 3, top + 6, 6, h - 6 - 40).fill(shade(C.charcoal, 0.1));
    part.rect(WORKSHOP.x - 3, top + 6, 2, h - 6 - 40).fill(shade(C.charcoal, 0.35));
    c.addChild(part);
    c.addChild(P.toolBench(WORKSHOP.benchX, y - 1));
    c.addChild(P.cabinet(IR - 26, y - 1, 50));
    for (const sx of slots) {
      c.addChild(P.desk(sx, y - 1, 86));
      c.addChild(P.monitor(sx + 4, y - 36, on));
    }
  } else if (info.slug === "deals") {
    c.addChild(P.plant(IX + 26, y, 0.9));
    c.addChild(P.wallArt(620, top + 34, 34, 24));
    c.addChild(P.window(900, top + 18, 110, 50, night ? 1 : 0));
    const dealsView = new Graphics();
    dealsView.rect(902, top + 20, 106, 46).fill(night ? 0x151c2c : 0x9cc0dc);
    for (let i = 0; i < 5; i++) {
      const bx = 908 + i * 20;
      const bh = 14 + ((i * 11) % 18);
      dealsView.rect(bx, top + 66 - bh, 14, bh).fill(night ? 0x0f1420 : 0x6f8ea6);
      if (night) dealsView.rect(bx + 4, top + 66 - bh + 5, 3, 3).fill(C.glow);
    }
    c.addChild(dealsView);
    c.addChild(P.wallArt(1040, top + 32, 26, 30));
    for (const sx of slots) c.addChild(P.chair(sx, y - 2));
    c.addChild(P.cabinet(1110, y - 1, 46));
    c.addChild(P.coffeeMachine(1170, y - 1));
    for (const sx of slots) {
      c.addChild(P.desk(sx, y - 1, 90));
      c.addChild(P.monitor(sx + 4, y - 36, on));
    }
    c.addChild(P.plant(IR - 22, y, 1.1));
  } else if (info.slug === "penthouse") {
    const wain = new Graphics();
    wain.rect(IX, y - 34, IW, 30).fill(shade(C.woodDark, -0.1));
    wain.rect(IX, y - 36, IW, 2).fill(C.woodLight);
    c.addChild(wain);
    c.addChild(P.window(PENTHOUSE.windowX, top + 20, 150, 60, night ? 1 : 0));
    // city seen through the window
    const view = new Graphics();
    view.rect(PENTHOUSE.windowX + 2, top + 22, 146, 56).fill(night ? 0x151c2c : 0x9cc0dc);
    for (let i = 0; i < 6; i++) {
      const bx = PENTHOUSE.windowX + 8 + i * 24;
      const bh = 18 + ((i * 13) % 20);
      view.rect(bx, top + 78 - bh, 16, bh).fill(night ? 0x0f1420 : 0x6f8ea6);
      if (night) view.rect(bx + 4, top + 78 - bh + 6, 3, 4).fill(C.glow);
    }
    c.addChild(view);
    c.addChild(P.rug(830, y - 1, 380, 0x6b2a26));
    c.addChild(P.bookshelf(IX + 52, y - 1, 84));
    c.addChild(P.armchair(IX + 130, y - 1));
    c.addChild(P.lamp(IX + 176, y - 1, on, true));
    c.addChild(P.plant(IR - 20, y, 1.2));
    c.addChild(P.mailSlot(IR - 60, top + 62));
    c.addChild(P.chair(PENTHOUSE.deskX, y - 2, 0x4a2a22));
    c.addChild(P.desk(PENTHOUSE.deskX, y - 1, 170, C.woodDark));
    c.addChild(P.phone(PENTHOUSE.deskX - 52, y - 37));
    c.addChild(P.clipboard(PENTHOUSE.deskX + 10, y - 37));
    c.addChild(P.lamp(PENTHOUSE.deskX + 58, y - 37, on, false));
  } else if (info.slug === "lobby") {
    c.addChild(P.sconce(IX + 120, top + 44, on));
    c.addChild(P.sconce(880, top + 44, on));
    c.addChild(P.plant(IX + 28, y, 1.2));
    c.addChild(P.sofa(IX + 130, y - 1));
    c.addChild(P.receptionDesk(700, y - 1));
    c.addChild(P.cashCounter(980, y - 1));
    c.addChild(P.doorway(1170, y - 1));
    c.addChild(P.plant(IR - 20, y, 1));
    c.addChild(P.rug(700, y - 1, 240, 0x6b2a26));
  } else {
    // content and service floors when unlocked later: plain desks
    for (const sx of slots) c.addChild(P.chair(sx, y - 2));
    for (const sx of slots) {
      c.addChild(P.desk(sx, y - 1));
      c.addChild(P.monitor(sx + 4, y - 36, on));
    }
  }

  return { container: c, deskSlots: slots };
}
