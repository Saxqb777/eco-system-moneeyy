// The lift: a real cabin in the shaft. Riders queue, doors open and close, the cabin travels.
import { Container, Graphics } from "pixi.js";
import { BUILDING, LIFT_DOOR_X, floorY } from "./layout";
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

const CABIN_W = 56;
const CABIN_H = 92;
const SHAFT_CX = BUILDING.shaftX + BUILDING.shaftW / 2;
const WALK_SPEED = 90; // px per second

export class Lift {
  readonly container = new Container();
  private readonly cabin = new Container();
  private readonly cable = new Graphics();
  private readonly doorL = new Graphics();
  private readonly doorR = new Graphics();
  private readonly inside = new Container();
  private cabinLevel = 5;
  private doorOpen = 0; // 0 closed, 1 open
  private busy = false;
  private queue: Ride[] = [];
  private runner = new TweenRunner();
  onChime?: () => void;

  constructor() {
    const back = new Graphics();
    back.rect(-CABIN_W / 2, -CABIN_H, CABIN_W, CABIN_H).fill(shade(C.wood, -0.2));
    back.rect(-CABIN_W / 2 + 4, -CABIN_H + 4, CABIN_W - 8, CABIN_H - 8).fill({ color: C.interiorLight, alpha: 0.18 });
    back.rect(-CABIN_W / 2, -CABIN_H, CABIN_W, 6).fill(C.brassDark);
    back.rect(-CABIN_W / 2, -4, CABIN_W, 4).fill(C.brassDark);
    // frame
    const frame = new Graphics();
    frame.rect(-CABIN_W / 2 - 3, -CABIN_H - 3, CABIN_W + 6, 3).fill(C.brass);
    frame.rect(-CABIN_W / 2 - 3, -CABIN_H - 3, 3, CABIN_H + 6).fill(C.brass);
    frame.rect(CABIN_W / 2, -CABIN_H - 3, 3, CABIN_H + 6).fill(C.brassDark);
    frame.rect(-CABIN_W / 2 - 3, 0, CABIN_W + 6, 3).fill(C.brassDark);
    frame.circle(-CABIN_W / 2 - 8, -CABIN_H + 10, 3).fill(C.brassLight);
    this.drawDoors();
    this.cabin.addChild(back, this.inside, this.doorL, this.doorR, frame);
    this.container.addChild(this.cable, this.cabin);
    this.cabin.position.set(SHAFT_CX, floorY(this.cabinLevel));
    this.drawCable();
  }

  private drawDoors() {
    const w = CABIN_W / 2;
    const slide = Math.round((w - 4) * this.doorOpen);
    this.doorL.clear();
    this.doorR.clear();
    this.doorL.rect(-w - slide, -CABIN_H + 2, w, CABIN_H - 2).fill(C.brass);
    this.doorL.rect(-w - slide + 4, -CABIN_H + 10, w - 8, CABIN_H - 20).fill(shade(C.brass, -0.12));
    this.doorL.rect(-w - slide + 6, -CABIN_H + 30, w - 12, 20).fill(shade(C.brass, 0.15));
    this.doorR.rect(slide, -CABIN_H + 2, w, CABIN_H - 2).fill(C.brassDark);
    this.doorR.rect(slide + 4, -CABIN_H + 10, w - 8, CABIN_H - 20).fill(shade(C.brassDark, -0.12));
    this.doorR.rect(slide + 6, -CABIN_H + 30, w - 12, 20).fill(shade(C.brassDark, 0.15));
    // door masks: keep doors inside the cabin width
    const maskL = new Graphics().rect(-w, -CABIN_H, w, CABIN_H).fill(0xffffff);
    const maskR = new Graphics().rect(0, -CABIN_H, w, CABIN_H).fill(0xffffff);
    this.doorL.mask = maskL;
    this.doorR.mask = maskR;
    this.cabin.addChild(maskL, maskR);
  }

  private drawCable() {
    this.cable.clear();
    const top = floorY(6) - 6;
    this.cable.rect(SHAFT_CX - 1, top, 2, Math.max(0, this.cabin.position.y - CABIN_H - top)).fill(0x4a4a50);
    this.cable.rect(SHAFT_CX - 12, top - 2, 24, 4).fill(C.brassDark);
  }

  get isBusy() {
    return this.busy || this.queue.length > 0;
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
    // 1. rider walks to the lift door on its floor
    steps.push(() => this.walkTo(rider, LIFT_DOOR_X, fromY));
    // 2. cabin comes to the rider's floor with doors closed
    if (this.cabinLevel !== from) {
      steps.push(() => this.setDoors(0));
      steps.push(() => this.travel(from));
    }
    // 3. doors open, rider steps in
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
    // 4. travel
    steps.push(() => this.travel(to));
    // 5. doors open, rider steps out and walks to the target
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

  private setDoors(open: number): Tween {
    const start = this.doorOpen;
    if (Math.abs(start - open) < 0.01) return wait(1);
    if (open > start) this.onChime?.();
    return tween(420, (t) => {
      this.doorOpen = start + (open - start) * t;
      this.drawDoors();
    }, ease.inOut);
  }

  private travel(level: number): Tween {
    const startY = this.cabin.position.y;
    const endY = floorY(level);
    const ms = Math.max(500, Math.abs(level - this.cabinLevel) * 650);
    return tween(ms, (t) => {
      this.cabin.position.y = startY + (endY - startY) * t;
      this.drawCable();
    }, ease.inOut, () => {
      this.cabinLevel = level;
    });
  }

  update(dtMs: number) {
    this.runner.update(dtMs);
  }
}
