// The run banner: when the owner presses Run the Tower now, a paper banner unrolls from the roof edge on two
// brass chains. It says the Tower is working, then what the run did, then rolls back up.
import { Container, Graphics, Text } from "pixi.js";
import { BUILDING, ROOF_Y } from "./layout";
import { C, shade } from "./palette";
import { label } from "./draw";

export type BannerTone = "work" | "cap" | "info";

const W = 520;
const H = 62;
const CX = (BUILDING.interiorX + BUILDING.interiorRight) / 2;
// Hung over the roof counters, so the penthouse (and the Warden calling everyone) stays in view.
const TOP = ROOF_Y - 100;
const TONE: Record<BannerTone, number> = { work: 0x2a9d8f, cap: 0xf08a24, info: C.brass };

function fit(t: Text, max: number) {
  let s = t.text;
  while (t.width > max && s.length > 4) {
    s = s.slice(0, -2).trimEnd();
    t.text = `${s}...`;
  }
}

export class RunBanner {
  readonly container = new Container();
  private readonly roll = new Container();
  private readonly paper = new Graphics();
  private readonly chains = new Graphics();
  private headline: Text;
  private sub: Text;
  private t = 0;
  private open = 0; // 0 rolled up, 1 open
  private target = 0;
  private hideAt = 0;
  private working = false;

  constructor() {
    this.headline = label("", { fontSize: 24, fill: C.ink, spacing: 1.5 });
    this.sub = label("", { fontSize: 13, fill: shade(C.ink, 0.25), family: "panel", weight: "600" });
    this.roll.addChild(this.paper, this.headline, this.sub);
    this.roll.position.set(CX - W / 2, TOP);
    this.container.addChild(this.chains, this.roll);
    this.container.visible = false;
    this.container.eventMode = "none";
  }

  private draw(tone: BannerTone) {
    const g = this.paper;
    g.clear();
    g.roundRect(3, 3, W, H, 3).fill({ color: 0x000000, alpha: 0.25 });
    g.roundRect(0, 0, W, H, 3).fill(C.paper);
    g.rect(0, 0, W, 6).fill(TONE[tone]);
    g.rect(0, H - 3, W, 3).fill(C.paperShade);
    g.circle(12, 16, 3).fill(C.brassDark);
    g.circle(W - 12, 16, 3).fill(C.brassDark);
    // the wooden rod the banner rolls onto
    g.roundRect(-8, -6, W + 16, 8, 3).fill(C.woodDark);
    g.rect(-8, -6, W + 16, 2).fill(C.woodLight);
  }

  private place() {
    this.headline.position.set(W / 2 - this.headline.width / 2, 10);
    this.sub.position.set(W / 2 - this.sub.width / 2, 38);
  }

  // While the tick runs: "THE TOWER IS WORKING" with dots that count up.
  showWorking(): void {
    this.working = true;
    this.draw("info");
    this.headline.text = "THE TOWER IS WORKING";
    this.sub.text = "Warden is calling the floors";
    this.place();
    this.target = 1;
    this.hideAt = Number.POSITIVE_INFINITY;
    this.container.visible = true;
  }

  show(headline: string, sub: string, tone: BannerTone, ms = 9000) {
    this.working = false;
    this.draw(tone);
    this.headline.text = headline.toUpperCase();
    fit(this.headline, W - 40);
    this.sub.text = sub;
    fit(this.sub, W - 40);
    this.place();
    this.target = 1;
    this.hideAt = this.t + ms;
    this.container.visible = true;
  }

  update(dtMs: number) {
    this.t += dtMs;
    if (!this.container.visible) return;
    if (this.working) {
      const dots = ".".repeat(1 + (Math.floor(this.t / 400) % 3));
      this.sub.text = `Warden is calling the floors${dots}`;
    }
    if (this.t > this.hideAt) this.target = 0;
    const k = Math.min(1, dtMs / 180);
    this.open += (this.target - this.open) * k;
    if (this.target === 0 && this.open < 0.02) {
      this.open = 0;
      this.container.visible = false;
    }
    this.roll.scale.y = Math.max(0.02, this.open);
    this.roll.alpha = Math.min(1, this.open * 1.6);
    const chainTop = TOP - 16;
    const chainBottom = TOP - 4;
    this.chains.clear();
    for (const x of [CX - W / 2 + 30, CX + W / 2 - 30]) {
      for (let y = chainTop; y < chainBottom; y += 5) this.chains.rect(x - 1.5, y, 3, 3).fill(C.brass);
    }
  }
}
