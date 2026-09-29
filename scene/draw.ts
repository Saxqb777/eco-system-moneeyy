// Drawing helpers for the flat shaded look: every solid gets a lit face and a shade face.
import { Graphics, Text, type TextStyleOptions } from "pixi.js";
import { shade } from "./palette";
import { DEPTH } from "./layout";

export type G = Graphics;

// A box seen slightly from above and the right: front face, top face, right face.
export function facetBox(g: G, x: number, y: number, w: number, h: number, color: number, depth = 0.5): G {
  const dx = Math.round(DEPTH.dx * depth);
  const dy = Math.round(DEPTH.dy * depth);
  g.rect(x, y, w, h).fill(color);
  g.poly([x, y, x + dx, y + dy, x + w + dx, y + dy, x + w, y]).fill(shade(color, 0.22));
  g.poly([x + w, y, x + w + dx, y + dy, x + w + dx, y + h + dy, x + w, y + h]).fill(shade(color, -0.28));
  return g;
}

// A flat plane receding into depth (floor surfaces, desks tops).
export function plane(g: G, x: number, y: number, w: number, color: number, depth = 1): G {
  const dx = Math.round(DEPTH.dx * depth);
  const dy = Math.round(DEPTH.dy * depth);
  g.poly([x, y, x + dx, y + dy, x + w + dx, y + dy, x + w, y]).fill(color);
  return g;
}

// Two tone rectangle: left part lit, right part in shade. Good for walls, cabinets, screens.
export function twoTone(g: G, x: number, y: number, w: number, h: number, color: number, split = 0.6, amount = 0.18): G {
  const sw = Math.round(w * split);
  g.rect(x, y, sw, h).fill(color);
  g.rect(x + sw, y, w - sw, h).fill(shade(color, -amount));
  return g;
}

export function roundedTwoTone(g: G, x: number, y: number, w: number, h: number, r: number, color: number, amount = 0.18): G {
  g.roundRect(x, y, w, h, r).fill(color);
  g.roundRect(x + w / 2, y, w / 2, h, r).fill(shade(color, -amount));
  g.rect(x + w / 2, y, r, h).fill(shade(color, -amount));
  return g;
}

export function tri(g: G, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number, color: number): G {
  g.poly([x1, y1, x2, y2, x3, y3]).fill(color);
  return g;
}

export function label(text: string, opts: Partial<TextStyleOptions> & { fontSize?: number; fill?: number; family?: "display" | "panel"; weight?: string; spacing?: number } = {}): Text {
  const family = opts.family === "panel" ? '"IBM Plex Sans", sans-serif' : '"Barlow Condensed", sans-serif';
  const t = new Text({
    text,
    style: {
      fontFamily: family,
      fontSize: opts.fontSize ?? 14,
      fill: opts.fill ?? 0xf3e9d2,
      fontWeight: (opts.weight ?? "700") as TextStyleOptions["fontWeight"],
      letterSpacing: opts.spacing ?? 0,
      align: opts.align ?? "left",
    },
  });
  t.resolution = 2;
  return t;
}
