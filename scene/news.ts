// The monument sign in the plaza: brass letters on stone and an amber LED strip that scrolls what the
// Tower just did, like the news ticker in front of a real headquarters.
import { Container, Graphics, Text } from "pixi.js";
import { GROUND_Y } from "./layout";
import { C, shade } from "./palette";
import { facetBox, label } from "./draw";
import { newsText } from "./lines";

const X = 1372;
const W = 206;
const TOP = GROUND_Y - 78;
const LED = { x: X + 10, y: TOP + 42, w: W - 20, h: 20 };
const SPEED = 42; // pixels a second

export class NewsSign {
  readonly container = new Container();
  private readonly strip = new Container();
  private text: Text;
  private next = "";
  private current = "";

  constructor() {
    const g = new Graphics();
    // stone block on a plinth
    facetBox(g, X - 6, GROUND_Y - 8, W + 12, 8, C.stoneDark, 0.4);
    facetBox(g, X, TOP, W, 70, shade(C.stone, -0.25), 0.4);
    g.rect(X, TOP, W, 3).fill(shade(C.stone, 0.05));
    g.rect(X + 6, TOP + 36, W - 12, 32).fill(0x0c0d10);
    g.rect(X + 6, TOP + 36, W - 12, 2).fill(C.brassDark);
    g.rect(LED.x, LED.y, LED.w, LED.h).fill(0x16120c);
    this.container.addChild(g);
    const name = label("THE TOWER", { fontSize: 22, fill: C.brassLight, spacing: 4 });
    name.position.set(X + W / 2 - name.width / 2, TOP + 6);
    const shadow = label("THE TOWER", { fontSize: 22, fill: 0x14161c, spacing: 4 });
    shadow.alpha = 0.5;
    shadow.position.set(name.x + 1.5, name.y + 1.5);
    this.container.addChild(shadow, name);

    this.text = label("", { fontSize: 13, fill: 0xffb347, spacing: 1.5, family: "display", weight: "600" });
    this.text.position.set(LED.w, 2);
    this.strip.position.set(LED.x, LED.y);
    this.strip.addChild(this.text);
    const mask = new Graphics().rect(LED.x, LED.y, LED.w, LED.h).fill(0xffffff);
    this.strip.mask = mask;
    // a fine grid over the strip for the look of LED dots
    const grid = new Graphics();
    for (let x = 0; x < LED.w; x += 2) grid.rect(LED.x + x, LED.y, 0.6, LED.h).fill({ color: 0x000000, alpha: 0.35 });
    for (let y = 0; y < LED.h; y += 2) grid.rect(LED.x, LED.y + y, LED.w, 0.6).fill({ color: 0x000000, alpha: 0.35 });
    const glow = new Graphics().rect(LED.x, LED.y, LED.w, LED.h).fill({ color: 0xffb347, alpha: 0.05 });
    this.container.addChild(this.strip, mask, glow, grid);
    this.container.eventMode = "none";
  }

  // New lines wait until the current run has scrolled past, so the text never jumps.
  setNews(lines: string[]) {
    this.next = newsText(lines);
    if (!this.current) this.roll();
  }

  private roll() {
    this.current = this.next || "THE TOWER   \u2022   DOCLEDGER";
    this.text.text = this.current;
    this.text.x = LED.w;
  }

  update(dtMs: number) {
    if (!this.current) return;
    this.text.x -= (dtMs / 1000) * SPEED;
    if (this.text.x + this.text.width < 0) this.roll();
  }
}
