// Wall Street's props (D075): the LED ticker tape, the race board, the market wall, twin trading screens,
// the brass opening bell, a bronze bull and Lazy Larry's recliner. Low poly, same palette as the building.
import { Container, Graphics, Text } from "pixi.js";
import { label } from "./draw";
import { C, shade } from "./palette";
import type { MonitorProp } from "./props";

export const LED = { green: 0x3ddc84, red: 0xff5a4f, amber: 0xffc857, dim: 0x1d2a24, bg: 0x07100c, white: 0xe8f5ee };

export interface TapeEntry {
  s: string;
  p: number;
  chg: number | null;
}

export function priceText(p: number): string {
  if (p >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}

export function changeText(chg: number | null): { text: string; color: number } {
  if (chg === null || Math.abs(chg) < 0.005) return { text: "0.00%", color: LED.amber };
  return { text: `${chg > 0 ? "▲" : "▼"}${Math.abs(chg).toFixed(2)}%`, color: chg > 0 ? LED.green : LED.red };
}

export interface TickerTape {
  container: Container;
  setItems(items: TapeEntry[]): void;
  update(dt: number): void;
}

// A running LED strip under the ceiling with real prices, green up and red down.
export function tickerTape(x: number, y: number, w: number, h = 11): TickerTape {
  const container = new Container();
  const g = new Graphics();
  g.rect(x, y - 1, w, h + 2).fill(0x0b0d10);
  g.rect(x, y, w, h).fill(LED.bg);
  for (let i = x + 2; i < x + w; i += 3) g.rect(i, y + h - 1, 1, 1).fill(LED.dim);
  container.addChild(g);
  const strip = new Container();
  strip.position.set(x, y - 1);
  const mask = new Graphics().rect(x, y, w, h).fill(0xffffff);
  strip.mask = mask;
  container.addChild(strip, mask);
  let width = 0;
  let offset = 0;
  let key = "";
  const build = (items: TapeEntry[]) => {
    strip.removeChildren().forEach((c) => c.destroy());
    let cx = 0;
    const one = (): number => {
      let start = cx;
      for (const it of items) {
        const sym = label(it.s, { fontSize: 10, fill: LED.amber, spacing: 0.5 });
        sym.position.set(cx, 0);
        strip.addChild(sym);
        cx += sym.width + 4;
        const price = label(priceText(it.p), { fontSize: 10, fill: LED.white });
        price.position.set(cx, 0);
        strip.addChild(price);
        cx += price.width + 4;
        const ch = changeText(it.chg);
        const chg = label(ch.text, { fontSize: 10, fill: ch.color });
        chg.position.set(cx, 0);
        strip.addChild(chg);
        cx += chg.width + 18;
      }
      return cx - start;
    };
    width = one();
    // a second copy so the strip loops without a gap
    while (cx < w + width) one();
  };
  build([{ s: "WALL STREET", p: 0, chg: null }]);
  return {
    container,
    setItems(items) {
      const k = items.map((i) => `${i.s}${i.p.toFixed(4)}${i.chg?.toFixed(2)}`).join("|");
      if (!items.length || k === key) return;
      key = k;
      build(items);
    },
    update(dt) {
      if (width <= 0) return;
      offset = (offset + dt * 0.035) % width;
      strip.position.x = x - offset;
    },
  };
}

export interface RaceRow {
  name: string;
  pnlPct: number;
  status: string;
  hold: boolean;
}

export interface RaceBoard {
  container: Container;
  set(rows: RaceRow[], footer: string): void;
  // a line in amber over the footer for a while: the room's vote
  note(text: string, ms: number): void;
  flash(): void;
  update(dt: number): void;
}

// The scoreboard on the back wall: four desks ranked by return, Larry's line in amber.
export function raceBoard(x: number, y: number, w: number, h: number): RaceBoard {
  const container = new Container();
  const g = new Graphics();
  g.rect(x - 3, y - 3, w + 6, h + 6).fill(C.brassDark);
  g.rect(x - 1, y - 1, w + 2, h + 2).fill(C.brass);
  g.rect(x, y, w, h).fill(LED.bg);
  container.addChild(g);
  const title = label("THE RACE", { fontSize: 10, fill: LED.amber, spacing: 2 });
  title.position.set(x + 5, y + 1);
  container.addChild(title);
  const rowsC = new Container();
  container.addChild(rowsC);
  const glow = new Graphics().rect(x, y, w, h).fill(LED.green);
  glow.alpha = 0;
  container.addChild(glow);
  let last = "";
  let flashT = 0;
  let noteT = 0;
  const noteBox = new Container();
  container.addChild(noteBox);
  return {
    container,
    note(text, ms) {
      noteBox.removeChildren().forEach((c) => c.destroy());
      const bg = new Graphics().rect(x + 1, y + h - 13, w - 2, 12).fill(LED.bg);
      const t = label(`VOTE ${text}`, { fontSize: 9, fill: LED.amber, spacing: 1 });
      t.position.set(x + 5, y + h - 13);
      noteBox.addChild(bg, t);
      noteBox.visible = true;
      noteT = ms;
      flashT = 900;
    },
    set(rows, footer) {
      const k = rows.map((r) => `${r.name}${r.pnlPct.toFixed(2)}${r.status}`).join("|") + footer;
      if (k === last) return;
      last = k;
      rowsC.removeChildren().forEach((c) => c.destroy());
      rows.slice(0, 4).forEach((r, i) => {
        const ty = y + 13 + i * 10;
        const color = r.hold ? LED.amber : r.pnlPct > 0.005 ? LED.green : r.pnlPct < -0.005 ? LED.red : LED.white;
        // a benched desk gets an amber light, a frozen one a blue light: no words to crowd the row
        if (r.status !== "live") {
          const dot = new Graphics().circle(x + 6, ty + 6, 2.2).fill(r.status === "frozen" ? 0x5da9e9 : LED.amber);
          rowsC.addChild(dot);
        }
        const name = label(`${i + 1} ${r.name.toUpperCase()}`, { fontSize: 9, fill: r.status === "live" ? color : 0x8fa79a, spacing: 0.4 });
        name.position.set(x + 11, ty);
        const ch = changeText(r.pnlPct);
        const pct = label(ch.text, { fontSize: 9, fill: ch.color });
        pct.position.set(x + w - 5 - pct.width, ty);
        rowsC.addChild(name, pct);
      });
      if (footer) {
        const f = label(footer, { fontSize: 8, fill: 0x8fa79a, family: "panel", weight: "600" });
        f.position.set(x + 5, y + h - 11);
        rowsC.addChild(f);
      }
    },
    flash() {
      flashT = 900;
    },
    update(dt) {
      if (noteT > 0) {
        noteT = Math.max(0, noteT - dt);
        if (noteT === 0) noteBox.visible = false;
      }
      if (flashT <= 0) return;
      flashT = Math.max(0, flashT - dt);
      glow.alpha = Math.sin((flashT / 900) * Math.PI) * 0.35;
    },
  };
}

export interface MarketWall {
  container: Container;
  setQuote(name: string, price: number | null, chg: number | null): void;
  update(dt: number): void;
}

// A wide screen over the trading pit: a live line for the market, drawn point by point.
export function marketWall(x: number, y: number, w: number, h: number): MarketWall {
  const container = new Container();
  const frame = new Graphics();
  frame.rect(x - 2, y - 2, w + 4, h + 4).fill(0x0b0d10);
  frame.rect(x, y, w, h).fill(0x0a1720);
  for (let gx = x + 20; gx < x + w; gx += 20) frame.rect(gx, y + 1, 1, h - 2).fill(0x10242f);
  frame.rect(x, y + h / 2, w, 1).fill(0x10242f);
  container.addChild(frame);
  const line = new Graphics();
  container.addChild(line);
  const caption = new Container();
  container.addChild(caption);
  const points: number[] = Array.from({ length: 48 }, (_, i) => Math.sin(i / 5) * 0.3);
  let drift = 0;
  let acc = 0;
  let up = true;
  const draw = () => {
    line.clear();
    const lo = Math.min(...points);
    const hi = Math.max(...points);
    const span = Math.max(0.0001, hi - lo);
    const step = (w - 8) / (points.length - 1);
    const py = (v: number) => y + h - 3 - ((v - lo) / span) * (h - 6);
    line.moveTo(x + 4, py(points[0]!));
    points.forEach((v, i) => line.lineTo(x + 4 + i * step, py(v)));
    line.stroke({ width: 1.5, color: up ? LED.green : LED.red });
    const lx = x + 4 + (points.length - 1) * step;
    line.circle(lx, py(points[points.length - 1]!), 2).fill(LED.white);
  };
  draw();
  return {
    container,
    setQuote(name, price, chg) {
      caption.removeChildren().forEach((c) => c.destroy());
      const n = label(name, { fontSize: 9, fill: LED.amber, spacing: 1 });
      n.position.set(x + 4, y + 1);
      caption.addChild(n);
      if (price !== null) {
        const p = label(priceText(price), { fontSize: 9, fill: LED.white });
        p.position.set(x + 8 + n.width, y + 1);
        const ch = changeText(chg);
        const c = label(ch.text, { fontSize: 9, fill: ch.color });
        c.position.set(x + 12 + n.width + p.width, y + 1);
        caption.addChild(p, c);
      }
      up = (chg ?? 0) >= 0;
      drift = (chg ?? 0) / 100;
    },
    update(dt) {
      acc += dt;
      if (acc < 450) return;
      acc = 0;
      const last = points[points.length - 1]!;
      points.push(last + (Math.random() - 0.5 + drift * 3) * 0.12);
      points.shift();
      draw();
    },
  };
}

// Two small screens with candles. Each redraw while someone types moves the live candle, now and then a new one.
export function tradingScreens(x: number, y: number, on: boolean): MonitorProp {
  const container = new Container();
  const frame = new Graphics();
  frame.rect(x + 10, y - 6, 4, 6).fill(C.charcoalLight);
  frame.rect(x + 2, y - 1, 20, 2).fill(C.charcoalLight);
  frame.roundRect(x - 2, y - 25, 13, 19, 1).fill(C.charcoalDark);
  frame.roundRect(x + 12, y - 25, 13, 19, 1).fill(C.charcoalDark);
  const screen = new Graphics();
  container.addChild(frame, screen);
  const series: Array<Array<{ o: number; c: number }>> = [[], []];
  for (const s of series) {
    let v = 0.5;
    for (let i = 0; i < 5; i++) {
      const c = Math.min(0.9, Math.max(0.1, v + (Math.random() - 0.5) * 0.3));
      s.push({ o: v, c });
      v = c;
    }
  }
  const paint = (lit: boolean) => {
    screen.clear();
    [x - 1, x + 13].forEach((sx, k) => {
      screen.rect(sx, y - 24, 11, 17).fill(lit ? 0x0a1720 : 0x2a3138);
      if (!lit) return;
      series[k]!.forEach((cd, i) => {
        const top = y - 9 - Math.max(cd.o, cd.c) * 13;
        const hgt = Math.max(1, Math.abs(cd.c - cd.o) * 13);
        screen.rect(sx + 1 + i * 2, top, 1.5, hgt).fill(cd.c >= cd.o ? LED.green : LED.red);
      });
    });
  };
  paint(on);
  return {
    container,
    redraw(seed, lit) {
      if (lit) {
        const r = ((seed >>> 0) % 1000) / 1000;
        for (const s of series) {
          const last = s[s.length - 1]!;
          if (r < 0.3) {
            s.push({ o: last.c, c: Math.min(0.9, Math.max(0.1, last.c + (Math.random() - 0.5) * 0.3)) });
            s.shift();
          } else last.c = Math.min(0.9, Math.max(0.1, last.c + (Math.random() - 0.5) * 0.08));
        }
      }
      paint(lit);
    },
  };
}

export interface Bell {
  container: Container;
  swing(t: number): void;
}

// The brass opening bell on a wall bracket. The controller swings it.
export function brassBell(x: number, y: number): Bell {
  const container = new Container();
  const bracket = new Graphics();
  bracket.rect(x - 2, y - 4, 4, 8).fill(C.brassDark);
  bracket.rect(x - 1, y, 2, 4).fill(C.brassDark);
  container.addChild(bracket);
  const bell = new Container();
  bell.position.set(x, y + 4);
  const g = new Graphics();
  g.poly([-3, 0, 3, 0, 7, 11, 8, 14, -8, 14, -7, 11]).fill(C.brass);
  g.poly([1, 0, 3, 0, 7, 11, 8, 14, 3, 14]).fill(C.brassLight);
  g.rect(-9, 13, 18, 2).fill(C.brassDark);
  g.circle(0, 16, 2).fill(C.brassDark);
  bell.addChild(g);
  container.addChild(bell);
  return {
    container,
    swing(t) {
      bell.rotation = Math.sin(t * Math.PI * 6) * 0.5 * (1 - t);
    },
  };
}

// A bronze bull on a stone plinth: the floor's mascot.
export function bullStatue(x: number, y: number): Graphics {
  const g = new Graphics();
  g.rect(x - 22, y - 9, 44, 9).fill(C.stoneDark);
  g.rect(x - 22, y - 10, 44, 2).fill(C.stone);
  g.rect(x - 10, y - 7, 20, 4).fill(C.brassDark);
  const bronze = 0x7a5230;
  const hi = shade(bronze, 0.25);
  // legs
  for (const lx of [-13, -8, 6, 11]) g.rect(x + lx, y - 18, 3, 8).fill(shade(bronze, -0.2));
  // body, then the lowered head charging to the right
  g.poly([x - 16, y - 26, x + 6, y - 28, x + 12, y - 22, x + 10, y - 16, x - 16, y - 16, x - 18, y - 21]).fill(bronze);
  g.poly([x - 16, y - 26, x + 6, y - 28, x + 4, y - 24, x - 14, y - 23]).fill(hi);
  g.poly([x + 9, y - 25, x + 18, y - 21, x + 19, y - 16, x + 12, y - 15]).fill(bronze);
  g.poly([x + 13, y - 24, x + 20, y - 29, x + 16, y - 23]).fill(C.brassLight);
  g.poly([x - 18, y - 24, x - 23, y - 20, x - 18, y - 21]).fill(shade(bronze, -0.15));
  return g;
}

// Lazy Larry's green leather recliner: the back behind him, the footrest out front.
export function recliner(x: number, y: number): { back: Graphics; front: Graphics } {
  const leather = 0x2f6b4a;
  const back = new Graphics();
  back.poly([x - 18, y - 52, x - 8, y - 56, x + 4, y - 24, x - 10, y - 20]).fill(shade(leather, -0.1));
  back.poly([x - 18, y - 52, x - 13, y - 54, x - 4, y - 25, x - 10, y - 20]).fill(shade(leather, 0.12));
  back.rect(x - 14, y - 22, 34, 10).fill(leather);
  back.rect(x - 16, y - 12, 4, 12).fill(C.woodDark);
  back.rect(x + 14, y - 12, 4, 12).fill(C.woodDark);
  const front = new Graphics();
  front.rect(x - 8, y - 18, 30, 8).fill(shade(leather, 0.08));
  front.rect(x - 8, y - 18, 30, 2).fill(shade(leather, 0.25));
  front.poly([x + 22, y - 18, x + 34, y - 14, x + 34, y - 8, x + 22, y - 10]).fill(leather);
  return { back, front };
}

// A round rug in the trading pit, where the desk meetings happen.
export function pitRug(x: number, y: number, w: number): Graphics {
  const g = new Graphics();
  g.ellipse(x, y - 1, w / 2, 4).fill(0x1d4a35);
  g.ellipse(x, y - 1, w / 2 - 3, 3).stroke({ width: 1, color: C.brass });
  return g;
}

export interface Stamp {
  container: Container;
}

// The big word that pops over the pit: BUY in green, PASS in grey, VETO in red.
export function stampText(text: string, color: number): Text {
  const t = label(text, { fontSize: 26, fill: color, spacing: 3 });
  t.anchor.set(0.5);
  return t;
}

// The Chief's glass corner office (D078). back: the carpet, the partition and the wall screens (behind the
// characters); front: the glass pane's shine and the name plate (in front). screens() tints the small screens
// so the office looks alive when the market moves.
export interface CornerOffice {
  back: Container;
  front: Container;
  screens: (chg: number | null, on: boolean) => void;
}

export function cornerOffice(wallX: number, right: number, top: number, floor: number, on: boolean): CornerOffice {
  const back = new Container();
  const front = new Container();
  const carpet = new Graphics();
  carpet.rect(wallX + 3, floor - 4, right - wallX - 3, 4).fill(0x1b2a3a);
  carpet.rect(wallX + 3, floor - 4, right - wallX - 3, 1).fill(0x2d4258);
  back.addChild(carpet);
  // the partition: frosted glass in a dark frame, a door gap near the floor on the pit side
  const wall = new Graphics();
  const wallTop = top + 46;
  const doorH = 46;
  wall.rect(wallX, wallTop, 4, floor - wallTop - doorH).fill(0x2b3a33);
  wall.rect(wallX - 1, wallTop, 6, 3).fill(0x3ddc84, 0.6);
  wall.rect(wallX + 1, wallTop + 3, 2, floor - wallTop - doorH - 3).fill({ color: 0xbfe8d8, alpha: 0.35 });
  // the door frame and a brass handle
  wall.rect(wallX, floor - doorH, 4, 3).fill(0x8a6424);
  wall.rect(wallX + 1, floor - doorH + 3, 2, doorH - 3).fill({ color: 0xbfe8d8, alpha: 0.12 });
  wall.rect(wallX + 3, floor - 22, 3, 2).fill(0xc9963b);
  back.addChild(wall);
  // the wall of small screens under the race board
  const screens: Graphics[] = [];
  const sx0 = wallX + 10;
  const cols = Math.max(3, Math.floor((right - wallX - 18) / 22));
  for (let i = 0; i < cols; i++) {
    const g = new Graphics();
    const x = sx0 + i * 22;
    g.rect(x, top + 84, 18, 11).fill(0x0b1a14);
    g.rect(x + 1, top + 85, 16, 9).fill(on ? 0x15402c : 0x0f1f18);
    back.addChild(g);
    screens.push(g);
  }
  // the name on the glass, under the wall of screens so it never sits on the race board
  const plate = new Graphics();
  plate.rect(wallX + 8, top + 100, 48, 10).fill({ color: 0x07140f, alpha: 0.7 });
  plate.rect(wallX + 8, top + 100, 48, 1).fill(0xc9963b);
  front.addChild(plate);
  const name = new Text({ text: "THE CHIEF", style: { fontFamily: "Barlow Condensed, sans-serif", fontSize: 8, fontWeight: "700", fill: 0xe0b56a, letterSpacing: 1 } });
  name.x = wallX + 12;
  name.y = top + 101;
  front.addChild(name);
  // the glass pane's shine
  const shine = new Graphics();
  shine.rect(wallX + 6, wallTop + 6, 1, 40).fill({ color: 0xffffff, alpha: 0.12 });
  shine.rect(wallX + 8, wallTop + 10, 1, 24).fill({ color: 0xffffff, alpha: 0.08 });
  front.addChild(shine);
  return {
    back,
    front,
    screens(chg, live) {
      screens.forEach((g, i) => {
        g.clear();
        const x = sx0 + i * 22;
        g.rect(x, top + 84, 18, 11).fill(0x0b1a14);
        const tone = !live ? 0x0f1f18 : chg === null ? 0x15402c : (chg >= 0) !== (i % 3 === 1) ? 0x1d6b3f : 0x6b2a24;
        g.rect(x + 1, top + 85, 16, 9).fill(tone);
        g.rect(x + 3, top + 87 + (i % 3), 10, 1).fill({ color: 0xe8f5ee, alpha: 0.35 });
      });
    },
  };
}
