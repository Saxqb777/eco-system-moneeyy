// Roof counters, floor plates and locked labels. Text uses the display face.
import { Container, Graphics, Text } from "pixi.js";
import { BUILDING, ROOF_Y, floorY } from "./layout";
import { C, shade } from "./palette";
import { facetBox, label } from "./draw";
import { formatUsdCompact } from "./format";

export interface CounterValues {
  netUsd: number;
  spendTodayUsd: number;
  capUsd: number;
  level: number;
  simulated: boolean;
}

export class RoofHud {
  readonly container = new Container();
  private netText: Text;
  private netLabel: Text;
  private spendText: Text;
  private levelText: Text;
  private stamp: Container;
  private segments: Graphics[] = [];
  private shown = { net: 0, spend: 0 };
  private target: CounterValues = { netUsd: 0, spendTodayUsd: 0, capUsd: 1.7, level: 1, simulated: true };

  constructor() {
    const g = new Graphics();
    const baseY = ROOF_Y - 10;
    // Net counter: big mechanical box on brass feet
    const nx = 560;
    facetBox(g, nx, baseY - 78, 250, 70, C.charcoalDark, 0.5);
    g.rect(nx + 6, baseY - 72, 238, 58).fill(shade(C.charcoalDark, -0.3));
    g.rect(nx + 6, baseY - 72, 238, 2).fill(C.brassDark);
    g.rect(nx + 6, baseY - 16, 238, 2).fill(C.brassDark);
    g.rect(nx, baseY - 8, 250, 8).fill(C.brassDark);
    g.rect(nx - 4, baseY - 82, 258, 5).fill(C.brass);
    // dials
    g.circle(nx + 232, baseY - 62, 5).fill(C.brass);
    g.circle(nx + 232, baseY - 48, 5).fill(C.brassDark);
    // Spend counter
    const sx = 830;
    facetBox(g, sx, baseY - 60, 180, 52, C.charcoalDark, 0.5);
    g.rect(sx + 5, baseY - 55, 170, 42).fill(shade(C.charcoalDark, -0.3));
    g.rect(sx - 3, baseY - 64, 186, 4).fill(C.brass);
    g.rect(sx, baseY - 8, 180, 8).fill(C.brassDark);
    // Budget meter: segmented upgrade bar
    const mx = 1030;
    facetBox(g, mx, baseY - 50, 200, 42, C.charcoal, 0.5);
    g.rect(mx - 3, baseY - 54, 206, 4).fill(C.brass);
    g.rect(mx, baseY - 8, 200, 8).fill(C.brassDark);
    // Ideas mailbox
    const bx = 470;
    facetBox(g, bx, baseY - 40, 44, 32, C.brass, 0.4);
    g.rect(bx + 8, baseY - 30, 28, 4).fill(C.charcoalDark);
    g.rect(bx + 20, baseY - 8, 4, 8).fill(C.brassDark);
    g.rect(bx + 34, baseY - 52, 3, 14).fill(C.red);
    g.rect(bx + 34, baseY - 52, 9, 6).fill(C.red);
    this.container.addChild(g);

    this.netLabel = label("NET", { fontSize: 13, fill: C.stone, spacing: 3 });
    this.netLabel.position.set(nx + 14, baseY - 70);
    this.netText = label("0.00 USD", { fontSize: 38, fill: C.real, spacing: 1 });
    this.netText.position.set(nx + 14, baseY - 58);
    this.stamp = this.buildStamp();
    this.stamp.position.set(nx + 60, baseY - 68);
    const spendLabel = label("SPEND TODAY", { fontSize: 11, fill: C.stone, spacing: 2 });
    spendLabel.position.set(sx + 12, baseY - 53);
    this.spendText = label("0.00 / 1.70", { fontSize: 24, fill: C.paper });
    this.spendText.position.set(sx + 12, baseY - 41);
    const levelLabel = label("BUDGET LEVEL", { fontSize: 11, fill: C.stone, spacing: 2 });
    levelLabel.position.set(mx + 10, baseY - 47);
    this.levelText = label("1", { fontSize: 22, fill: C.brassLight });
    this.levelText.position.set(mx + 170, baseY - 46);
    for (let i = 0; i < 5; i++) {
      const seg = new Graphics();
      seg.rect(0, 0, 26, 12).fill(shade(C.charcoalDark, -0.2));
      seg.position.set(mx + 10 + i * 30, baseY - 30);
      this.segments.push(seg);
      this.container.addChild(seg);
    }
    const ideasLabel = label("IDEAS", { fontSize: 10, fill: C.stone, spacing: 2 });
    ideasLabel.position.set(bx + 4, baseY - 64);
    this.container.addChild(this.netLabel, this.netText, this.stamp, spendLabel, this.spendText, levelLabel, this.levelText, ideasLabel);
  }

  private buildStamp(): Container {
    const c = new Container();
    const t = label("SIMULATED", { fontSize: 10, fill: C.sim, spacing: 2 });
    const g = new Graphics();
    g.roundRect(-4, -3, t.width + 8, 16, 2).stroke({ width: 1, color: C.sim });
    c.addChild(g, t);
    c.rotation = -0.04;
    return c;
  }

  set(values: CounterValues) {
    this.target = values;
    this.stamp.visible = values.simulated;
    const color = values.simulated ? C.sim : C.real;
    this.netText.style.fill = color;
    this.levelText.text = String(values.level);
    this.segments.forEach((seg, i) => {
      seg.clear();
      seg.rect(0, 0, 26, 12).fill(i < values.level ? C.brassLight : shade(C.charcoalDark, -0.2));
      if (i < values.level) seg.rect(0, 0, 26, 3).fill(0xfbe7a8);
    });
  }

  update(dtMs: number) {
    const k = Math.min(1, dtMs / 400);
    this.shown.net += (this.target.netUsd - this.shown.net) * k;
    this.shown.spend += (this.target.spendTodayUsd - this.shown.spend) * k;
    const sign = this.shown.net < -0.005 ? "-" : "+";
    this.netText.text = `${sign} ${formatUsdCompact(Math.abs(this.shown.net))} USD`;
    this.spendText.text = `${this.shown.spend.toFixed(2)} / ${this.target.capUsd.toFixed(2)}`;
  }
}

export function floorPlate(name: string, accent: number, level: number): Container {
  const c = new Container();
  // A brass plate riveted to the slab front, like a floor number in a real lobby.
  const y = floorY(level) - 3;
  const t = label(name.toUpperCase(), { fontSize: 12, fill: C.ink, spacing: 1.5 });
  const w = t.width + 26;
  const g = new Graphics();
  g.rect(0, 0, w, 20).fill(C.brassDark);
  g.rect(1, 1, w - 2, 18).fill(C.brass);
  g.rect(1, 1, w - 2, 2).fill(C.brassLight);
  g.rect(0, 0, 6, 20).fill(accent);
  g.circle(w - 5, 5, 1.2).fill(C.brassDark);
  g.circle(w - 5, 15, 1.2).fill(C.brassDark);
  t.position.set(12, 2);
  c.addChild(g, t);
  c.position.set(BUILDING.interiorX + 10, y);
  c.eventMode = "static";
  c.cursor = "pointer";
  return c;
}

export function lockedLabel(rule: string, level: number): Container {
  const c = new Container();
  const y = floorY(level) - 66;
  const lines = wrap(rule, 34);
  const g = new Graphics();
  const w = 250;
  const h = 14 + lines.length * 15;
  g.roundRect(0, 0, w, h, 3).fill(C.paper);
  g.rect(0, 0, w, 3).fill(C.paperShade);
  g.rect(0, h - 3, w, 3).fill(C.paperShade);
  c.addChild(g);
  lines.forEach((line, i) => {
    const t = label(line, { fontSize: 12, fill: C.ink, family: "panel", weight: "600" });
    t.position.set(10, 7 + i * 15);
    c.addChild(t);
  });
  const lock = label("LOCKED", { fontSize: 11, fill: C.red, spacing: 2 });
  lock.position.set(w - lock.width - 10, h - 17);
  c.addChild(lock);
  c.position.set(BUILDING.interiorX + 120, y - h + 14);
  return c;
}

function wrap(text: string, max: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if ((line + " " + w).trim().length > max) {
      if (line) lines.push(line.trim());
      line = w;
    } else {
      line = `${line} ${w}`;
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines.slice(0, 3);
}
