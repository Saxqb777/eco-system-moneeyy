// Life outside the tower: people on the pavement, cars on the road, birds by day and planes by night, and a
// window cleaner working the side of the building in daylight. All of it is ambient and off in Low Effects.
import { Container, Graphics } from "pixi.js";
import { CharacterSprite, type Look } from "./character";
import { BUILDING, DEPTH, GROUND_Y, ROOF_Y, WORLD } from "./layout";
import { C, shade } from "./palette";

const TAU = Math.PI * 2;
const WALK_Y = GROUND_Y + 12;
const CAR_Y = WORLD.h - 1;
const CAR_COLORS = [0xc0392b, 0x2a9d8f, 0xe8e1d4, 0x3a86c8, 0x2b2f3a, 0xd4a537, 0x6b4a8a];

interface Walker {
  s: CharacterSprite;
  dir: number;
  speed: number;
  active: boolean;
}

interface Car {
  c: Container;
  lights: Graphics;
  dir: number;
  speed: number;
  active: boolean;
}

interface Flyer {
  c: Container;
  dir: number;
  speed: number;
  active: boolean;
  wings: Graphics[];
  blink?: Graphics;
}

function look(i: number): Look {
  return { hair: (i * 5 + 1) % 6, glasses: i % 3 === 0, mug: false, slouch: false, coat: i % 4 === 1, tone: (i * 3) % 4 };
}

function buildCar(color: number): { c: Container; lights: Graphics } {
  const c = new Container();
  const g = new Graphics();
  // low poly body: lower hull, a cabin, two wheels
  g.poly([-28, -6, -26, -13, -14, -14, -8, -22, 10, -22, 17, -14, 27, -12, 28, -6]).fill(color);
  g.poly([-8, -22, 10, -22, 17, -14, -14, -14]).fill(shade(color, 0.18));
  g.poly([-6, -20, 1, -20, 1, -15, -11, -15]).fill(0x9cc0dc);
  g.poly([3, -20, 9, -20, 14, -15, 3, -15]).fill(0x7fa6c4);
  g.rect(-28, -8, 56, 2).fill(shade(color, -0.3));
  for (const wx of [-16, 16]) {
    g.circle(wx, -5, 5).fill(0x14161c);
    g.circle(wx, -5, 2).fill(0x8c8f96);
  }
  const lights = new Graphics();
  lights.poly([28, -11, 90, -18, 90, 2, 28, -8]).fill({ color: 0xfff1c4, alpha: 0.16 });
  lights.rect(26, -11, 3, 3).fill(0xfff1c4);
  lights.rect(-29, -11, 3, 3).fill(0xe0463a);
  c.addChild(lights, g);
  return { c, lights };
}

function buildBird(): { c: Container; wings: Graphics[] } {
  const c = new Container();
  const wings: Graphics[] = [];
  for (let i = 0; i < 4; i++) {
    const w = new Graphics();
    w.moveTo(-5, 0).lineTo(0, 2).lineTo(5, 0).stroke({ width: 1.4, color: 0x2b2f3a });
    w.position.set(i * 14 - (i % 2) * 4, (i % 2) * 7 + i * 2);
    c.addChild(w);
    wings.push(w);
  }
  return { c, wings };
}

function buildPlane(): { c: Container; blink: Graphics } {
  const c = new Container();
  const g = new Graphics();
  g.rect(-12, -1, 24, 3).fill(0x6f737a);
  g.poly([-2, 0, 4, 0, -4, 7]).fill(0x5f636a);
  g.poly([-11, -1, -8, -1, -12, -5]).fill(0x5f636a);
  const blink = new Graphics();
  blink.circle(0, 0, 1.8).fill(0xff4a3a);
  blink.position.set(12, 0);
  c.addChild(g, blink);
  return { c, blink };
}

export class Street {
  readonly layer = new Container(); // pavement and road, in front of the building base
  readonly sky = new Container(); // birds and planes, behind the city
  readonly facade = new Container(); // the window cleaner on the side of the tower
  private readonly walkers: Walker[] = [];
  private readonly cars: Car[] = [];
  private readonly flyers: Flyer[] = [];
  private readonly gondola = new Container();
  private readonly cables = new Graphics();
  private readonly cleaner: CharacterSprite;
  private gondolaY = ROOF_Y + 70;
  private gondolaState: { mode: "down" | "scrub" | "up"; left: number } = { mode: "scrub", left: 3000 };
  private walkerAt = 0;
  private carAt = 2500;
  private flyerAt = 6000;
  private t = 0;

  constructor() {
    for (let i = 0; i < 6; i++) {
      const s = new CharacterSprite(`walker_${i}`, "", look(i), false);
      s.eventMode = "none";
      s.scale.set(0.62);
      s.visible = false;
      s.setPose("walk");
      this.layer.addChild(s);
      this.walkers.push({ s, dir: 1, speed: 36, active: false });
    }
    for (let i = 0; i < 3; i++) {
      const { c, lights } = buildCar(CAR_COLORS[i % CAR_COLORS.length]!);
      c.visible = false;
      this.layer.addChild(c);
      this.cars.push({ c, lights, dir: 1, speed: 180, active: false });
    }
    for (let i = 0; i < 2; i++) {
      const { c, wings } = buildBird();
      c.visible = false;
      this.sky.addChild(c);
      this.flyers.push({ c, dir: 1, speed: 45, active: false, wings });
    }
    const plane = buildPlane();
    plane.c.visible = false;
    this.sky.addChild(plane.c);
    this.flyers.push({ c: plane.c, dir: -1, speed: 26, active: false, wings: [], blink: plane.blink });

    // Window cleaner: a cradle on two cables hanging off the roof edge, over the side facade.
    const g = new Graphics();
    g.rect(-24, 0, 48, 6).fill(C.brassDark);
    g.rect(-24, -14, 48, 2).fill(C.brass);
    g.rect(-24, -14, 2, 20).fill(C.brass);
    g.rect(22, -14, 2, 20).fill(C.brass);
    g.rect(-20, 6, 4, 3).fill(0x3a3f4a);
    g.rect(16, 6, 4, 3).fill(0x3a3f4a);
    this.cleaner = new CharacterSprite("cleaner", "", { hair: 5, glasses: false, mug: false, slouch: false, coat: false, tone: 1 }, false);
    this.cleaner.eventMode = "none";
    this.cleaner.scale.set(0.6);
    this.cleaner.position.set(-4, 1);
    this.cleaner.setPose("wave");
    this.gondola.addChild(this.cleaner, g);
    this.facade.addChild(this.cables, this.gondola);
  }

  private gondolaX(): number {
    return BUILDING.right + 40;
  }

  private drawCables() {
    const x = this.gondolaX();
    const anchorY = ROOF_Y + Math.round(DEPTH.dy * 1.5) - 4;
    this.cables.clear();
    this.cables.rect(x - 21, anchorY, 1.5, this.gondolaY - 14 - anchorY).fill(0x2b2f3a);
    this.cables.rect(x + 20, anchorY - 2, 1.5, this.gondolaY - 12 - anchorY).fill(0x2b2f3a);
    this.cables.rect(x - 30, anchorY - 6, 60, 4).fill(C.charcoalLight);
  }

  update(dtMs: number, env: { day: boolean; night: boolean }) {
    this.t += dtMs;
    const dt = dtMs / 1000;

    // pedestrians
    if (this.t > this.walkerAt) {
      this.walkerAt = this.t + 2500 + Math.random() * (env.night ? 9000 : 4500);
      const active = this.walkers.filter((w) => w.active).length;
      const w = this.walkers.find((x) => !x.active);
      if (w && active < (env.night ? 2 : 5)) {
        w.active = true;
        w.dir = Math.random() < 0.5 ? 1 : -1;
        w.speed = 28 + Math.random() * 18;
        w.s.visible = true;
        w.s.position.set(w.dir > 0 ? -30 : WORLD.w + 30, WALK_Y);
        w.s.setFacing(w.dir);
      }
    }
    for (const w of this.walkers) {
      if (!w.active) continue;
      w.s.position.x += w.dir * w.speed * dt;
      w.s.update(dtMs);
      if (w.s.position.x < -40 || w.s.position.x > WORLD.w + 40) {
        w.active = false;
        w.s.visible = false;
      }
    }

    // cars
    if (this.t > this.carAt) {
      this.carAt = this.t + 3500 + Math.random() * 7000;
      const car = this.cars.find((x) => !x.active);
      if (car) {
        car.active = true;
        car.dir = Math.random() < 0.5 ? 1 : -1;
        car.speed = 150 + Math.random() * 90;
        car.c.visible = true;
        car.c.scale.x = car.dir;
        car.c.position.set(car.dir > 0 ? -80 : WORLD.w + 80, CAR_Y);
      }
    }
    for (const car of this.cars) {
      if (!car.active) continue;
      car.lights.visible = env.night;
      car.c.position.x += car.dir * car.speed * dt;
      if (car.c.position.x < -120 || car.c.position.x > WORLD.w + 120) {
        car.active = false;
        car.c.visible = false;
      }
    }

    // birds by day, a plane by night
    if (this.t > this.flyerAt) {
      this.flyerAt = this.t + 9000 + Math.random() * 14000;
      const f = this.flyers.find((x) => !x.active && (env.night ? !!x.blink : !x.blink));
      if (f) {
        f.active = true;
        f.dir = f.blink ? -1 : Math.random() < 0.5 ? 1 : -1;
        f.speed = f.blink ? 22 + Math.random() * 10 : 40 + Math.random() * 25;
        f.c.visible = true;
        f.c.scale.x = f.dir;
        f.c.position.set(f.dir > 0 ? -60 : WORLD.w + 60, f.blink ? 70 + Math.random() * 60 : 110 + Math.random() * 200);
      }
    }
    for (const f of this.flyers) {
      if (!f.active) continue;
      f.c.position.x += f.dir * f.speed * dt;
      f.c.position.y += Math.sin(this.t / 900 + f.speed) * 0.08;
      f.wings.forEach((w, i) => (w.scale.y = Math.sin(this.t / 110 + i * 1.3) * 1.2));
      if (f.blink) f.blink.alpha = Math.sin((this.t / 1000) * TAU * 0.8) > 0.4 ? 1 : 0.15;
      if (f.c.position.x < -80 || f.c.position.x > WORLD.w + 80) {
        f.active = false;
        f.c.visible = false;
      }
    }

    // the window cleaner works in daylight, a few steps down at a time, then rides back up
    this.facade.visible = env.day;
    if (env.day) {
      const st = this.gondolaState;
      st.left -= dtMs;
      if (st.mode === "down") this.gondolaY += 16 * dt;
      if (st.mode === "up") this.gondolaY -= 60 * dt;
      if (st.left <= 0) {
        if (st.mode === "up" || (st.mode === "scrub" && this.gondolaY > GROUND_Y - 110)) {
          if (st.mode === "scrub") this.gondolaState = { mode: "up", left: ((this.gondolaY - (ROOF_Y + 70)) / 60) * 1000 };
          else this.gondolaState = { mode: "scrub", left: 3500 };
        } else if (st.mode === "scrub") this.gondolaState = { mode: "down", left: 1600 };
        else this.gondolaState = { mode: "scrub", left: 3000 + Math.random() * 2000 };
      }
      this.cleaner.setPose(this.gondolaState.mode === "scrub" ? "wave" : "stand");
      this.cleaner.update(dtMs);
      this.gondola.position.set(this.gondolaX(), this.gondolaY);
      this.drawCables();
    }
  }
}
