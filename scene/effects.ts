// Ambient motion and event effects. Everything here is optional and skipped in Low Effects mode.
import { Container, Graphics } from "pixi.js";
import { C } from "./palette";
import { coin, paperSheet } from "./props";
import { ease, tween, TweenRunner } from "./tween";
import type { FloorBuild } from "./floors";

const TAU = Math.PI * 2;

export class Ambient {
  private t = 0;
  private flickerAt = 0;
  private windowsAt = 0;
  private steamAt = 0;
  private steam: { g: Graphics; life: number }[] = [];
  private readonly steamLayer = new Container();
  private cityRects: Graphics;
  private citySeed = 1;
  private windowCells: { x: number; y: number; on: boolean }[] = [];

  constructor(private floors: FloorBuild[], cityGlow: Graphics, private night: () => boolean) {
    this.cityRects = cityGlow;
    // read the glow rects back as cells so we can toggle them
    this.windowCells = [];
  }

  get layer() {
    return this.steamLayer;
  }

  setFloors(floors: FloorBuild[]) {
    this.floors = floors;
  }

  setCityCells(cells: { x: number; y: number; on: boolean }[]) {
    this.windowCells = cells;
  }

  update(dtMs: number, mugs: { x: number; y: number }[]) {
    this.t += dtMs;
    const s = this.t / 1000;
    // plants sway
    for (const f of this.floors) {
      f.plants.forEach((p, i) => {
        p.leaves.rotation = Math.sin(s * TAU * 0.18 + i * 1.7) * 0.05;
      });
      for (const fan of f.fans) fan.blades.rotation += (dtMs / 1000) * 3.2;
    }
    // screens change content every couple of seconds, one at a time
    if (this.t > this.flickerAt) {
      this.flickerAt = this.t + 900 + Math.random() * 1400;
      const all = this.floors.flatMap((f) => f.monitors);
      const m = all[Math.floor(Math.random() * all.length)];
      m?.redraw(Math.floor(Math.random() * 1e9), this.night());
    }
    // city windows toggle
    if (this.t > this.windowsAt && this.windowCells.length) {
      this.windowsAt = this.t + 700 + Math.random() * 900;
      for (let k = 0; k < 3; k++) {
        const cell = this.windowCells[Math.floor(Math.random() * this.windowCells.length)];
        if (cell) cell.on = !cell.on;
      }
      this.cityRects.clear();
      for (const cell of this.windowCells) if (cell.on) this.cityRects.rect(cell.x, cell.y, 9, 11).fill(C.glow);
      this.citySeed += 1;
    }
    // mug steam
    if (this.t > this.steamAt) {
      this.steamAt = this.t + 700;
      for (const m of mugs) {
        if (Math.random() < 0.5) continue;
        const g = new Graphics();
        g.circle(0, 0, 2).fill({ color: 0xffffff, alpha: 0.35 });
        g.position.set(m.x + (Math.random() - 0.5) * 4, m.y);
        this.steamLayer.addChild(g);
        this.steam.push({ g, life: 0 });
      }
    }
    for (const p of this.steam) {
      p.life += dtMs;
      p.g.position.y -= dtMs * 0.012;
      p.g.position.x += Math.sin(p.life / 250) * 0.15;
      p.g.alpha = Math.max(0, 0.35 * (1 - p.life / 1400));
      p.g.scale.set(1 + p.life / 900);
    }
    this.steam = this.steam.filter((p) => {
      if (p.life > 1400) {
        p.g.destroy();
        return false;
      }
      return true;
    });
  }
}

export class Effects {
  readonly layer = new Container();
  private runner = new TweenRunner();
  onCoin?: () => void;

  // A finished task: a paper sheet flies from the worker up to the roof counter.
  paperFlight(fromX: number, fromY: number, toX: number, toY: number, onArrive?: () => void) {
    const p = paperSheet();
    p.position.set(fromX, fromY);
    this.layer.addChild(p);
    const midX = (fromX + toX) / 2 + 60;
    this.runner.add(
      tween(1100, (t) => {
        const u = 1 - t;
        p.position.x = u * u * fromX + 2 * u * t * midX + t * t * toX;
        p.position.y = u * u * fromY + 2 * u * t * (Math.min(fromY, toY) - 120) + t * t * toY;
        p.rotation = t * 6;
        p.alpha = t > 0.85 ? (1 - t) / 0.15 : 1;
      }, ease.inOut, () => {
        p.destroy();
        onArrive?.();
      }),
    );
  }

  // Verified money: a coin drops into the lobby counter and bounces once.
  coinDrop(x: number, topY: number, landY: number) {
    const c = coin();
    c.position.set(x, topY);
    this.layer.addChild(c);
    this.runner.add(
      tween(650, (t) => {
        c.position.y = topY + (landY - topY) * t * t;
        c.rotation = t * 4;
      }, ease.linear, () => {
        this.onCoin?.();
        this.runner.add(
          tween(420, (t) => {
            c.position.y = landY - Math.sin(t * Math.PI) * 14;
            c.alpha = 1 - t * 0.9;
          }, ease.linear, () => c.destroy()),
        );
      }),
    );
  }

  // A soft gold flash over a rectangle (the net counter after a task lands).
  flash(x: number, y: number, w: number, h: number, color = C.brassLight) {
    const g = new Graphics();
    g.roundRect(x, y, w, h, 4).fill(color);
    g.alpha = 0;
    this.layer.addChild(g);
    this.runner.add(
      tween(700, (t) => {
        g.alpha = Math.sin(t * Math.PI) * 0.45;
      }, ease.linear, () => g.destroy()),
    );
  }

  update(dtMs: number) {
    this.runner.update(dtMs);
  }
}
