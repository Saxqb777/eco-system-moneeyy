// The lift: rails and ties in the shaft, a landing door with an indicator lamp on every floor,
// a cabin with windowed doors, a counterweight and a motor room on the roof. Riders queue.
import { Container, Graphics } from "pixi.js";
import { BUILDING, LEVEL_COUNT, LIFT_DOOR_X, ROOF_Y, floorY } from "./layout";
import { C, shade } from "./palette";
import { type CharacterSprite } from "./character";
import { ease, tween, TweenRunner, wait, type Tween } from "./tween";

export interface Ride {
  rider: CharacterSprite;
  from: number;
  to: number;
  targetX: number;
  charLayer: Container;
  onArrive?: () => void;
}

const CABIN_W = 54;
const CABIN_H = 92;
const SHAFT_CX = BUILDING.shaftX + BUILDING.shaftW / 2;
const WALK_SPEED = 90;
const LANDING_X = BUILDING.interiorX - 6; // the column between shaft and floor

interface Landing {
  left: Graphics;
  right: Graphics;
  lamp: Graphics;
  level: number;
}

export class Lift {
  readonly back = new Container(); // rails, counterweight, behind the cabin
  readonly container = new Container(); // cabin and landings, in front of characters
  private readonly cabin = new Container();
  private readonly cable = new Graphics();
  private readonly weight = new Graphics();
  private readonly weightCable = new Graphics();
  private readonly doorL = new Graphics();
  private readonly doorR = new Graphics();
  private readonly inside = new Container();
  private readonly cabinLamp = new Graphics();
  private readonly landings: Landing[] = [];
  private cabinLevel = 5;
  private doorOpen = 0;
  private landingOpen = 0;
  private busy = false;
  private queue: Ride[] = [];
  private runner = new TweenRunner();
  private highlight: number | null = null;
  private blink = 0;
  onChime?: () => void;

  constructor() {
    this.buildShaft();
    this.buildCabin();
    this.buildLandings();
    this.cabin.position.set(SHAFT_CX, floorY(this.cabinLevel));
    this.drawCable();
    this.drawLandingLamps();
  }

  private buildShaft() {
    const g = new Graphics();
    const top = ROOF_Y;
    const bottom = floorY(0);
    // two guide rails with brackets and cross ties
    for (const rx of [BUILDING.shaftX + 9, BUILDING.shaftX + BUILDING.shaftW - 12]) {
      g.rect(rx, top, 4, bottom - top).fill(0x5d6472);
      g.rect(rx, top, 1.5, bottom - top).fill(0x8b93a3);
      for (let y = top + 20; y < bottom; y += 40) g.rect(rx - 3, y, 10, 3).fill(0x3f4550);
    }
    for (let y = top + 40; y < bottom; y += 80) g.rect(BUILDING.shaftX + 13, y, BUILDING.shaftW - 26, 2).fill(0x3a3f4a);
    // pit and buffer springs
    g.rect(BUILDING.shaftX + 4, bottom - 8, BUILDING.shaftW - 8, 8).fill(0x15181e);
    g.rect(SHAFT_CX - 14, bottom - 14, 6, 8).fill(0x6a707c);
    g.rect(SHAFT_CX + 8, bottom - 14, 6, 8).fill(0x6a707c);
    // motor room on the roof above the shaft
    g.rect(BUILDING.shaftX + 4, top - 34, BUILDING.shaftW - 8, 30).fill(shade(C.charcoal, 0.05));
    g.rect(BUILDING.shaftX + 4, top - 34, BUILDING.shaftW - 8, 3).fill(C.brassDark);
    g.circle(SHAFT_CX, top - 18, 9).fill(0x4a505c);
    g.circle(SHAFT_CX, top - 18, 4).fill(C.brass);
    g.circle(SHAFT_CX + 20, top - 18, 5).fill(0x4a505c);
    this.weight.rect(-8, -30, 16, 30).fill(0x3f4550);
    this.weight.rect(-8, -30, 16, 4).fill(0x6a707c);
    this.weight.rect(-8, -18, 16, 2).fill(0x6a707c);
    this.back.addChild(g, this.weightCable, this.weight);
  }

  private buildCabin() {
    const back = new Graphics();
    back.rect(-CABIN_W / 2, -CABIN_H, CABIN_W, CABIN_H).fill(shade(C.wood, -0.25));
    back.rect(-CABIN_W / 2 + 4, -CABIN_H + 6, CABIN_W - 8, CABIN_H - 12).fill({ color: C.interiorLight, alpha: 0.22 });
    back.rect(-CABIN_W / 2 + 4, -CABIN_H + 6, CABIN_W - 8, 2).fill({ color: C.interiorLight, alpha: 0.8 });
    back.rect(-CABIN_W / 2, -CABIN_H, CABIN_W, 5).fill(C.brassDark);
    back.rect(-CABIN_W / 2, -3, CABIN_W, 3).fill(C.brassDark);
    // handrail
    back.rect(-CABIN_W / 2 + 6, -CABIN_H / 2, CABIN_W - 12, 2).fill(C.brass);
    const frame = new Graphics();
    frame.rect(-CABIN_W / 2 - 3, -CABIN_H - 3, CABIN_W + 6, 3).fill(C.brass);
    frame.rect(-CABIN_W / 2 - 3, -CABIN_H - 3, 3, CABIN_H + 6).fill(C.brass);
    frame.rect(CABIN_W / 2, -CABIN_H - 3, 3, CABIN_H + 6).fill(C.brassDark);
    frame.rect(-CABIN_W / 2 - 3, 0, CABIN_W + 6, 3).fill(C.brassDark);
    // floor lamp strip on top of the cabin
    this.cabinLamp.position.set(0, -CABIN_H - 9);
    const maskL = new Graphics().rect(-CABIN_W / 2, -CABIN_H, CABIN_W / 2, CABIN_H).fill(0xffffff);
    const maskR = new Graphics().rect(0, -CABIN_H, CABIN_W / 2, CABIN_H).fill(0xffffff);
    this.doorL.mask = maskL;
    this.doorR.mask = maskR;
    this.drawDoors();
    this.cabin.addChild(back, this.inside, this.doorL, this.doorR, maskL, maskR, frame, this.cabinLamp);
    this.container.addChild(this.cable, this.cabin);
  }

  private buildLandings() {
    for (let level = 0; level < LEVEL_COUNT; level++) {
      const y = floorY(level);
      const frame = new Graphics();
      // a brass door frame seen edge on at the column, with a lamp above it
      frame.rect(LANDING_X - 2, y - 100, 12, 100).fill(C.brassDark);
      frame.rect(LANDING_X - 1, y - 99, 10, 98).fill(shade(C.charcoalDark, -0.2));
      frame.rect(LANDING_X - 3, y - 102, 14, 3).fill(C.brass);
      const left = new Graphics();
      const right = new Graphics();
      const lamp = new Graphics();
      lamp.position.set(LANDING_X + 4, y - 108);
      this.container.addChild(frame, left, right, lamp);
      this.landings.push({ left, right, lamp, level });
    }
    this.drawLandingDoors();
  }

  private drawLandingDoors() {
    for (const l of this.landings) {
      const y = floorY(l.level);
      const open = l.level === this.cabinLevel ? this.landingOpen : 0;
      const h = 96;
      const half = 48;
      const slide = Math.round((half - 3) * open);
      l.left.clear();
      l.right.clear();
      // the two leaves slide up and down the frame (edge on view): top leaf and bottom leaf
      l.left.rect(LANDING_X, y - 98 - slide, 8, half).fill(C.brass);
      l.left.rect(LANDING_X + 2, y - 96 - slide, 4, half - 4).fill(shade(C.brass, -0.15));
      l.right.rect(LANDING_X, y - 98 + half + slide, 8, half - 2).fill(C.brassDark);
      l.right.rect(LANDING_X + 2, y - 96 + half + slide, 4, half - 6).fill(shade(C.brassDark, -0.15));
      void h;
    }
  }

  private drawLandingLamps() {
    for (const l of this.landings) {
      const here = l.level === this.cabinLevel;
      const target = this.highlight === l.level && this.blink > 0.5;
      l.lamp.clear();
      l.lamp.rect(-5, -5, 10, 6).fill(C.charcoalLight);
      l.lamp.circle(0, 0, 3.2).fill(here ? C.brassLight : target ? C.glow : shade(C.charcoalLight, -0.3));
      if (here || target) l.lamp.circle(0, 0, 6).fill({ color: here ? C.brassLight : C.glow, alpha: 0.25 });
    }
    this.cabinLamp.clear();
    this.cabinLamp.rect(-14, 0, 28, 5).fill(C.charcoalLight);
    this.cabinLamp.circle(0, 2.5, 2).fill(C.brassLight);
  }

  private drawDoors() {
    const w = CABIN_W / 2;
    const slide = Math.round((w - 4) * this.doorOpen);
    this.doorL.clear();
    this.doorR.clear();
    for (const [door, color, dir] of [[this.doorL, C.brass, -1], [this.doorR, C.brassDark, 1]] as const) {
      const x0 = dir < 0 ? -w - slide : slide;
      door.rect(x0, -CABIN_H + 2, w, CABIN_H - 2).fill(color);
      door.rect(x0 + 4, -CABIN_H + 10, w - 8, CABIN_H - 20).fill(shade(color, -0.12));
      // door window
      door.rect(x0 + 8, -CABIN_H + 20, w - 16, 26).fill(shade(C.skyNightBottom, 0.2));
      door.rect(x0 + 8, -CABIN_H + 20, w - 16, 2).fill(C.brassLight);
      door.rect(x0 + (dir < 0 ? w - 6 : 3), -CABIN_H + 50, 3, 14).fill(C.brassLight);
    }
  }

  private drawCable() {
    this.cable.clear();
    const top = ROOF_Y - 18;
    const cabinTop = this.cabin.position.y - CABIN_H - 3;
    this.cable.rect(SHAFT_CX - 1, top, 2, Math.max(0, cabinTop - top)).fill(0x4a4a50);
    // counterweight travels the opposite way on the right rail
    const travel = floorY(0) - floorY(LEVEL_COUNT);
    const cabinFrac = (floorY(0) - this.cabin.position.y) / travel;
    const wy = floorY(0) - 20 - (1 - cabinFrac) * (travel - 60);
    this.weight.position.set(BUILDING.shaftX + BUILDING.shaftW - 14, wy);
    this.weightCable.clear();
    this.weightCable.rect(BUILDING.shaftX + BUILDING.shaftW - 15, top, 2, Math.max(0, wy - 30 - top)).fill(0x4a4a50);
  }

  get isBusy() {
    return this.busy || this.queue.length > 0;
  }

  get level() {
    return this.cabinLevel;
  }

  // Blinks the landing lamp of a floor that is calling for the lift (a blocked worker).
  setHighlight(level: number | null) {
    this.highlight = level;
    this.drawLandingLamps();
  }

  request(ride: Ride) {
    this.queue.push(ride);
    this.next();
  }

  private next() {
    if (this.busy) return;
    const ride = this.queue.shift();
    if (!ride) return;
    this.busy = true;
    const { rider, from, to, targetX, charLayer } = ride;
    const fromY = floorY(from);
    const toY = floorY(to);
    rider.level = from;

    const steps: Array<() => Tween> = [];
    steps.push(() => this.walkTo(rider, LIFT_DOOR_X, fromY));
    if (this.cabinLevel !== from) {
      steps.push(() => this.setDoors(0));
      steps.push(() => this.travel(from));
    }
    steps.push(() => this.setDoors(1));
    steps.push(() => this.walkTo(rider, SHAFT_CX, fromY, true));
    steps.push(() => {
      rider.setPose("stand");
      const pos = rider.position.clone();
      charLayer.removeChild(rider);
      this.inside.addChild(rider);
      rider.position.set(pos.x - this.cabin.position.x, 0);
      return wait(150);
    });
    steps.push(() => this.setDoors(0));
    steps.push(() => this.travel(to));
    steps.push(() => this.setDoors(1));
    steps.push(() => {
      this.inside.removeChild(rider);
      charLayer.addChild(rider);
      rider.position.set(SHAFT_CX, toY);
      rider.level = to;
      return wait(100);
    });
    steps.push(() => this.walkTo(rider, LIFT_DOOR_X, toY));
    steps.push(() => this.setDoors(0));
    steps.push(() => this.walkTo(rider, targetX, toY));

    let index = 0;
    let current: Tween | null = null;
    this.runner.add({
      update: (dt) => {
        if (!current) {
          const step = steps[index];
          if (!step) return true;
          current = step();
        }
        if (current.update(dt)) {
          current = null;
          index += 1;
          if (index >= steps.length) {
            rider.setPose("stand");
            this.busy = false;
            ride.onArrive?.();
            this.next();
            return true;
          }
        }
        return false;
      },
    });
  }

  private walkTo(rider: CharacterSprite, x: number, y: number, keepFacing = false): Tween {
    const startX = rider.position.x;
    const dist = Math.abs(x - startX);
    if (dist < 2) {
      rider.position.set(x, y);
      return wait(1);
    }
    rider.setPose("walk");
    if (!keepFacing) rider.setFacing(x > startX ? 1 : -1);
    return tween((dist / WALK_SPEED) * 1000, (t) => {
      rider.position.set(startX + (x - startX) * t, y);
    }, ease.linear, () => rider.setPose("stand"));
  }

  // Cabin doors and the landing doors of the current floor open and close together.
  private setDoors(open: number): Tween {
    const start = this.doorOpen;
    if (Math.abs(start - open) < 0.01) return wait(1);
    if (open > start) this.onChime?.();
    return tween(460, (t) => {
      this.doorOpen = start + (open - start) * t;
      this.landingOpen = this.doorOpen;
      this.drawDoors();
      this.drawLandingDoors();
    }, ease.inOut);
  }

  private travel(level: number): Tween {
    const startY = this.cabin.position.y;
    const endY = floorY(level);
    const ms = Math.max(600, Math.abs(level - this.cabinLevel) * 700);
    return tween(ms, (t) => {
      this.cabin.position.y = startY + (endY - startY) * t;
      this.drawCable();
    }, ease.inOut, () => {
      this.cabinLevel = level;
      this.drawLandingLamps();
      this.drawLandingDoors();
    });
  }

  update(dtMs: number) {
    this.runner.update(dtMs);
    if (this.highlight !== null) {
      const before = this.blink > 0.5;
      this.blink = (this.blink + dtMs / 900) % 1;
      if (before !== this.blink > 0.5) this.drawLandingLamps();
    }
  }
}
