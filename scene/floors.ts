// Interiors per floor. Static shell plus the animated props the polish layer drives.
import { Container, Graphics } from "pixi.js";
import { BUILDING, DESK_SLOTS, LEVEL_H, PENTHOUSE, SLAB, WORKSHOP, floorY } from "./layout";
import { C, FLOOR_ACCENT, mix, shade } from "./palette";
import { label, plane, twoTone } from "./draw";
import * as P from "./props";
import { CharacterSprite } from "./character";

export interface FloorInfo {
  slug: string;
  name: string;
  level: number;
  status: string;
  unlockRule: string | null;
}

// The Growth floor's whiteboard: the company's numbers, written up live.
export interface Whiteboard {
  set(lines: string[]): void;
}

export interface FloorBuild {
  container: Container;
  deskSlots: number[];
  monitors: P.MonitorProp[];
  plants: P.PlantProp[];
  fans: P.Fan[];
  lamps: Map<number, P.DeskLamp>; // by desk slot x
  coolerX: number | null;
  extras: CharacterSprite[]; // decorative people such as the receptionist
  tint: Graphics; // amber tint for a paused floor
  front: Container; // desk fronts, drawn over the seated workers so they sit behind their desks
  board: Whiteboard | null;
}

const IX = BUILDING.interiorX;
const IR = BUILDING.interiorRight;
const IW = IR - IX;

function cityView(g: Graphics, x: number, top: number, w: number, night: boolean, seed: number) {
  g.rect(x + 2, top + 2, w - 4, 46).fill(night ? 0x151c2c : 0x9cc0dc);
  const n = Math.floor((w - 8) / 20);
  for (let i = 0; i < n; i++) {
    const bx = x + 6 + i * 20;
    const bh = 12 + ((i * 7 + seed) % 20);
    g.rect(bx, top + 48 - bh, 14, bh).fill(night ? 0x0f1420 : 0x6f8ea6);
    if (night) g.rect(bx + 3, top + 48 - bh + 5, 3, 3).fill(C.glow);
  }
}

export function buildFloor(info: FloorInfo, night: boolean): FloorBuild {
  const c = new Container();
  const y = floorY(info.level);
  const top = y - LEVEL_H + SLAB;
  const h = y - top;
  const locked = info.status === "locked";
  const accent = FLOOR_ACCENT[info.slug] ?? C.stone;
  const g = new Graphics();
  const build: FloorBuild = { container: c, deskSlots: DESK_SLOTS[info.slug] ?? [], monitors: [], plants: [], fans: [], lamps: new Map(), coolerX: null, extras: [], tint: new Graphics(), front: new Container(), board: null };

  const wallBase = locked ? mix(C.charcoalDark, accent, 0.08) : mix(C.charcoal, accent, night ? 0.32 : 0.42);
  twoTone(g, IX, top, IW, h, wallBase, 0.62, locked ? 0.08 : 0.14);
  g.rect(IX, top, IW, 6).fill(shade(wallBase, -0.35));
  g.rect(IX, y - 5, IW, 5).fill(locked ? shade(C.dustDark, -0.2) : C.woodDark);
  const floorColor = locked ? 0x4a4842 : info.slug === "lobby" ? C.stone : info.slug === "penthouse" ? C.woodDark : C.wood;
  plane(g, IX, y, IW, shade(floorColor, 0.1), 0.5);
  c.addChild(g);

  const on = night && !locked;
  const slots = build.deskSlots;

  if (locked) {
    slots.forEach((sx, i) => c.addChild(P.coveredDesk(sx, y - 1, i % 2 === 1)));
    const sheetPlant = new Graphics();
    sheetPlant.poly([IX + 18, y, IX + 46, y, IX + 42, y - 44, IX + 30, y - 56, IX + 20, y - 40]).fill(C.dust);
    sheetPlant.poly([IX + 30, y - 56, IX + 42, y - 44, IX + 46, y, IX + 34, y]).fill(C.dustDark);
    c.addChild(sheetPlant);
    c.addChild(P.padlockPlate(IR - 60, y - 40));
    build.tint.rect(IX, top, IW, h).fill({ color: 0xf08a24, alpha: 1 });
    build.tint.alpha = 0;
    c.addChild(build.tint);
    return build;
  }

  if (info.slug !== "lobby") {
    const lights = new Graphics();
    const xs = info.slug === "penthouse" ? [700, 1000] : [560, 800, 1040];
    for (const lx of xs) {
      lights.rect(lx - 26, top + 6, 52, 4).fill(shade(C.charcoalLight, 0.2));
      lights.rect(lx - 24, top + 10, 48, 2).fill(on ? C.interiorLight : 0xb8ad94);
      if (on) lights.poly([lx - 24, top + 12, lx + 24, top + 12, lx + 60, y - 6, lx - 60, y - 6]).fill({ color: C.glow, alpha: 0.06 });
    }
    c.addChild(lights);
  }

  // The chair, the monitor and the lamp stand behind the worker; the desk and the keyboard go in front, so a
  // seated worker shows from the chest up with the hands on the keys. The monitor sits to the side, clear of the face.
  const addDesks = (desks: number[], deskW: number) => {
    for (const sx of desks) c.addChild(P.chair(sx, y - 2));
    for (const sx of desks) {
      const m = P.monitorProp(sx + 25, y - 40, on);
      c.addChild(m.container);
      build.monitors.push(m);
      const lamp = P.deskLamp(sx - deskW / 2 + 12, y - 36);
      c.addChild(lamp.container);
      build.lamps.set(sx, lamp);
      build.front.addChild(P.desk(sx, y - 1, deskW));
      build.front.addChild(P.keyboard(sx, y - 37));
    }
  };

  const addPlant = (x: number, tall: number) => {
    const p = P.plantSway(x, y, tall);
    c.addChild(p.container);
    build.plants.push(p);
  };

  if (info.slug === "docledger") {
    addPlant(IX + 26, 1);
    c.addChild(P.wallArt(500, top + 34));
    c.addChild(P.window(680, top + 18, 110, 50, night ? 1 : 0));
    const v = new Graphics();
    cityView(v, 680, top + 18, 110, night, 3);
    c.addChild(v);
    c.addChild(P.wallArt(900, top + 34, 36, 24));
    const part = new Graphics();
    part.rect(WORKSHOP.x - 3, top + 6, 6, h - 6 - 40).fill(shade(C.charcoal, 0.1));
    part.rect(WORKSHOP.x - 3, top + 6, 2, h - 6 - 40).fill(shade(C.charcoal, 0.35));
    c.addChild(part);
    c.addChild(P.waterCooler(985, y - 1));
    build.coolerX = 985;
    c.addChild(P.toolBench(WORKSHOP.benchX, y - 1));
    c.addChild(P.cabinet(IR - 26, y - 1, 50));
    addDesks(slots, 86);
  } else if (info.slug === "growth") {
    addPlant(IX + 26, 1);
    c.addChild(P.wallArt(660, top + 30, 34, 26));
    c.addChild(P.window(870, top + 18, 110, 50, night ? 1 : 0));
    const v = new Graphics();
    cityView(v, 870, top + 18, 110, night, 11);
    c.addChild(v);
    addDesks(slots, 84);
    // the team's whiteboard on its stand at the end of the room, clear of the desks
    build.board = whiteboard(c, IR - 116, top + 12, y);
  } else if (info.slug === "deals") {
    addPlant(IX + 26, 0.9);
    c.addChild(P.wallArt(620, top + 34, 34, 24));
    c.addChild(P.window(900, top + 18, 110, 50, night ? 1 : 0));
    const v = new Graphics();
    cityView(v, 900, top + 18, 110, night, 7);
    c.addChild(v);
    c.addChild(P.wallArt(1040, top + 32, 26, 30));
    c.addChild(P.cabinet(1110, y - 1, 46));
    c.addChild(P.coffeeMachine(1170, y - 1));
    c.addChild(P.waterCooler(1050, y - 1));
    build.coolerX = 1050;
    addDesks(slots, 90);
    addPlant(IR - 22, 1.1);
  } else if (info.slug === "penthouse") {
    const wain = new Graphics();
    wain.rect(IX, y - 34, IW, 30).fill(shade(C.woodDark, -0.1));
    wain.rect(IX, y - 36, IW, 2).fill(C.woodLight);
    c.addChild(wain);
    for (const wx of [PENTHOUSE.windowX, PENTHOUSE.window2X]) {
      c.addChild(P.window(wx, top + 18, 130, 56, night ? 1 : 0));
      const v = new Graphics();
      cityView(v, wx, top + 20, 130, night, wx);
      c.addChild(v);
    }
    // the pacing rug in the middle, between the shelves and the desk
    c.addChild(P.rug(760, y - 1, 420, 0x6b2a26));
    c.addChild(P.bookshelf(IX + 52, y - 1, 84));
    c.addChild(P.armchair(IX + 128, y - 1));
    c.addChild(P.lamp(IX + 172, y - 1, on, true));
    addPlant(IR - 20, 1.2);
    c.addChild(P.mailSlot(IR - 56, top + 62));
    c.addChild(P.chair(PENTHOUSE.deskX, y - 2, 0x4a2a22));
    c.addChild(P.desk(PENTHOUSE.deskX, y - 1, 170, C.woodDark));
    c.addChild(P.phone(PENTHOUSE.deskX - 52, y - 37));
    c.addChild(P.clipboard(PENTHOUSE.deskX + 10, y - 37));
    c.addChild(P.lamp(PENTHOUSE.deskX + 58, y - 37, on, false));
  } else if (info.slug === "lobby") {
    const fan = P.ceilingFan(640, top + 4);
    c.addChild(fan.container);
    build.fans.push(fan);
    c.addChild(P.sconce(IX + 120, top + 44, on));
    c.addChild(P.sconce(880, top + 44, on));
    addPlant(IX + 28, 1.2);
    c.addChild(P.sofa(IX + 130, y - 1));
    c.addChild(P.rug(700, y - 1, 240, 0x6b2a26));
    c.addChild(P.receptionDesk(700, y - 1));
    // the receptionist sits behind the petty cash counter, under an OPEN sign
    const receptionist = new CharacterSprite("receptionist", "Reception", { hair: 2, glasses: true, mug: false, slouch: false, coat: false, tone: 2, mugColor: "#F3E9D2" }, false);
    receptionist.position.set(980, y - 1);
    receptionist.setPose("sit_type");
    receptionist.eventMode = "none";
    c.addChild(receptionist);
    build.extras.push(receptionist);
    c.addChild(P.cashCounter(980, y - 1));
    c.addChild(P.openSign(980, y - 112));
    c.addChild(P.doorway(1170, y - 1));
    addPlant(IR - 20, 1);
  } else {
    addDesks(slots, 84);
  }

  build.tint.rect(IX, top, IW, h).fill({ color: 0xf08a24, alpha: 1 });
  build.tint.alpha = 0;
  return build;
}

// A whiteboard on a stand at the end of the Growth floor, with the company's numbers in marker.
function whiteboard(c: Container, x: number, top: number, floor: number): Whiteboard {
  const w = 106;
  const h = 84;
  const g = new Graphics();
  // legs and a marker tray
  g.rect(x + 12, top + h, 4, floor - top - h).fill(0x6f737a);
  g.rect(x + w - 16, top + h, 4, floor - top - h).fill(0x6f737a);
  g.rect(x + 6, floor - 3, 16, 3).fill(0x5f636a);
  g.rect(x + w - 22, floor - 3, 16, 3).fill(0x5f636a);
  g.rect(x - 3, top - 3, w + 6, h + 6).fill(0x8c8f96);
  g.rect(x, top, w, h).fill(0xf4f6f2);
  g.rect(x, top + h - 3, w, 3).fill(0xdfe3dd);
  g.rect(x + 8, top + h + 3, w - 16, 3).fill(0x8c8f96);
  g.rect(x + 14, top + h + 1, 9, 3).fill(0x3a86c8);
  g.rect(x + 26, top + h + 1, 9, 3).fill(0xc94f7c);
  c.addChild(g);
  const text = new Container();
  text.position.set(x + 7, top + 16);
  c.addChild(text);
  const title = label("THIS WEEK", { fontSize: 10, fill: 0x2a9d8f, weight: "700", spacing: 1 });
  title.position.set(x + 7, top + 3);
  c.addChild(title);
  let last = "";
  return {
    set(lines: string[]) {
      const key = lines.join("|");
      if (key === last) return;
      last = key;
      text.removeChildren();
      lines.slice(0, 6).forEach((line, i) => {
        const t = label(line, { fontSize: 10, fill: i % 2 ? 0x3a86c8 : 0x2b2f3a, family: "panel", weight: "600" });
        t.position.set(0, i * 11);
        text.addChild(t);
      });
    },
  };
}
