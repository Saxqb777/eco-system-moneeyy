// Office life: what people do between tasks. The state decides whether a worker is typing, stuck or paused;
// this director fills the time around it so the building is never still: coffee and water breaks, a look out
// of the window, the printer, chats between desks, stand ups at the whiteboard, errands to another floor by
// lift, the Warden walking the floors, visitors at the lobby counter and a cheer when a task lands.
import type { Container } from "pixi.js";
import type { TowerState } from "@/lib/state";
import { CharacterSprite, type Look, type Pose } from "./character";
import type { FloorBuild } from "./floors";
import type { Lift } from "./lift";
import { BUILDING, LIFT_DOOR_X, floorY } from "./layout";
import { ease, sequence, tween, until, wait, type Tween, type TweenRunner } from "./tween";
import { LINES } from "./lines";

type AgentState = TowerState["floors"][number]["agents"][number];
type FloorState = TowerState["floors"][number];

export interface LifeHost {
  sprites: Map<string, CharacterSprite>;
  agent(id: string): AgentState | undefined;
  floors(): FloorState[];
  build(slug: string): FloorBuild | undefined;
  homeX(a: AgentState, slug: string): number;
  // puts a sprite back to what the state says it is doing (pose, desk, task label)
  restore(s: CharacterSprite): void;
  lift: Lift;
  charLayer: Container;
  runner: TweenRunner;
}

const IDLE: ReadonlySet<Pose> = new Set<Pose>(["sit_idle", "feet_up", "dim"]);
const WALK_SPEED = 90;

function pick<T>(list: readonly T[]): T | undefined {
  return list.length ? list[Math.floor(Math.random() * list.length)] : undefined;
}

function pickN<T>(list: readonly T[], n: number): T[] {
  const copy = [...list];
  const out: T[] = [];
  while (copy.length && out.length < n) out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]!);
  return out;
}

function weighted(options: Array<[string, number]>): string {
  const total = options.reduce((a, [, w]) => a + w, 0);
  let r = Math.random() * total;
  for (const [k, w] of options) {
    r -= w;
    if (r <= 0) return k;
  }
  return options[options.length - 1]![0];
}

function randomLook(): Look {
  const r = (n: number) => Math.floor(Math.random() * n);
  return { hair: r(6), glasses: Math.random() < 0.3, mug: false, slouch: false, coat: false, tone: r(4) };
}

export class OfficeLife {
  private nextAt = 0;
  private tourAt = 0;
  private visitAt = 0;
  private guestAt = 0;
  private started = false;

  constructor(private readonly host: LifeHost) {}

  // Floors with people at work or on a break: not locked, not the penthouse or the lobby.
  private workFloors(): FloorState[] {
    return this.host.floors().filter((f) => (f.status === "live" || f.status === "paused") && f.slug !== "penthouse" && f.slug !== "lobby");
  }

  private crew(f: FloorState): CharacterSprite[] {
    return f.agents.filter((a) => a.kind !== "warden").map((a) => this.host.sprites.get(a.id)).filter((s): s is CharacterSprite => !!s);
  }

  private free(s: CharacterSprite, now: number): boolean {
    return !s.away && s.busyUntil <= now && IDLE.has(s.pose);
  }

  private walk(s: CharacterSprite, x: number, y: number): Tween {
    const startX = s.position.x;
    const dist = Math.abs(x - startX);
    if (dist < 2) return wait(1);
    s.setPose("walk");
    s.setFacing(x > startX ? 1 : -1);
    return tween((dist / WALK_SPEED) * 1000, (t) => s.position.set(startX + (x - startX) * t, y), ease.linear, () => s.setPose("stand"));
  }

  private home(s: CharacterSprite): { x: number; y: number; level: number } | null {
    const a = this.host.agent(s.agentId);
    if (!a) return null;
    const f = this.host.floors().find((x) => x.agents.some((y) => y.id === a.id));
    return { x: this.host.homeX(a, f?.slug ?? "lobby"), y: floorY(a.locationLevel), level: a.locationLevel };
  }

  private back(s: CharacterSprite): () => void {
    return () => {
      s.busyUntil = 0;
      s.away = false;
      s.setCarry(false);
      s.setBubble(null);
      this.host.restore(s);
    };
  }

  update(now: number) {
    if (!this.started) {
      this.started = true;
      this.tourAt = now + 18000;
      this.visitAt = now + 40000;
      this.guestAt = now + 9000;
    }
    if (now < this.nextAt) return;
    this.nextAt = now + 1300;
    for (const f of this.workFloors()) {
      const crew = this.crew(f);
      if (!crew.length) continue;
      const moving = crew.filter((s) => s.away || s.busyUntil > now).length;
      // a paused floor is on a break: more people up and about
      const target = f.status === "paused" ? 3 : 2;
      if (moving >= target || Math.random() > 0.55) continue;
      const free = crew.filter((s) => this.free(s, now));
      const s = pick(free);
      if (s) this.activity(s, f, free, now);
    }
    if (now > this.tourAt) this.tourAt = now + (this.wardenTour(now) ? 70000 + Math.random() * 60000 : 8000);
    if (now > this.visitAt) this.visitAt = now + (this.floorErrand(now) ? 35000 + Math.random() * 40000 : 10000);
    if (now > this.guestAt) this.guestAt = now + (this.lobbyGuest(now) ? 30000 + Math.random() * 45000 : 12000);
  }

  private activity(s: CharacterSprite, f: FloorState, free: CharacterSprite[], now: number) {
    const b = this.host.build(f.slug);
    const options: Array<[string, number]> = [["stretch", 1], ["sip", 1], ["chat", 2.5], ["phone", 1.5], ["spin", 0.6]];
    if (s.look.quirk) options.push([s.look.quirk, 3]);
    if (b?.spots.window) options.push(["window", 2]);
    if (b?.spots.printer) options.push(["printer", 2]);
    if (b?.coolerX) options.push(["cooler", 1.5]);
    if (b?.spots.board && free.length >= 2) options.push(["board", 3]);
    if (s.pose !== "dim") options.push(["nap", 0.5]);
    const kind = weighted(options);
    const home = this.home(s);
    if (!home) return;
    const { x, y } = home;
    const done = this.back(s);
    const run = (ms: number, steps: Array<() => Tween>) => {
      s.busyUntil = now + ms;
      this.host.runner.add(sequence(steps, done));
    };
    switch (kind) {
      case "cooler":
        if (!b?.coolerX) return;
        return run(15000, [() => this.walk(s, b.coolerX! - 22, y), () => { s.setFacing(1); s.setPose("drink"); return wait(2600); }, () => this.walk(s, x, y)]);
      case "window": {
        const wx = (b?.spots.window ?? x) + (Math.random() - 0.5) * 50;
        return run(16000, [() => this.walk(s, wx, y), () => { s.setFacing(1); s.setPose("look_out"); return wait(3500 + Math.random() * 1500); }, () => this.walk(s, x, y)]);
      }
      case "printer": {
        const px = (b?.spots.printer ?? x) - 24;
        return run(16000, [
          () => this.walk(s, px, y),
          () => { s.setFacing(1); s.setPose("stand"); return wait(1600); },
          () => { s.setCarry(true); return this.walk(s, x, y); },
          () => wait(400),
        ]);
      }
      case "chat": {
        const other = free.find((o) => o !== s);
        if (!other) return this.simple(s, "stretch", 2500, now);
        const ox = other.position.x;
        other.busyUntil = now + 14000;
        const otherDone = this.back(other);
        s.busyUntil = now + 14000;
        this.host.runner.add(sequence([
          () => this.walk(s, ox - 32, y),
          () => {
            s.setPose("chat"); s.setFacing(1); s.setBubble("...", "chat");
            other.setPose("chat"); other.setFacing(-1);
            return wait(3800);
          },
          () => { s.setBubble(null); return this.walk(s, x, y); },
        ], () => {
          done();
          otherDone();
        }));
        return;
      }
      case "phone":
        return run(6500, [
          () => { s.position.set(x + 16, y); s.setFacing(1); s.setPose("phone"); return tween(2500, (t) => s.position.set(x + 16 + Math.sin(t * Math.PI) * 18, y), ease.inOut); },
          () => { s.setFacing(-1); return tween(2500, (t) => s.position.set(x + 16 + Math.sin(t * Math.PI) * 12, y), ease.inOut); },
        ]);
      case "board":
        return this.standUp(s, f, free, now);
      case "nap":
        return this.simple(s, "asleep", 8500, now);
      case "spin":
        return this.simple(s, "spin", 1500, now);
      case "sip":
        return this.simple(s, "coffee", 2200, now);
      default:
        return this.simple(s, "stretch", 2500, now);
    }
  }

  private simple(s: CharacterSprite, pose: Pose, ms: number, now: number) {
    s.busyUntil = now + ms + 300;
    s.setPose(pose);
    this.host.runner.add(sequence([() => wait(ms)], this.back(s)));
  }

  // A stand up at the whiteboard: one points at the numbers, one or two listen and one answers, then everyone
  // goes back to work. The presenter leads; the others wait for their cue, so no two bubbles overlap.
  private standUp(s: CharacterSprite, f: FloorState, free: CharacterSprite[], now: number) {
    const b = this.host.build(f.slug);
    const bx = b?.spots.board;
    if (!bx) return;
    const y = floorY(f.level);
    const listeners = pickN(free.filter((o) => o !== s), Math.random() < 0.5 ? 2 : 1);
    const numbers = (f.board ?? []).filter((l) => /[0-9]/.test(l));
    const first = pick(numbers) ?? pick(LINES.board)!;
    const second = pick(LINES.board)!;
    const home = this.home(s);
    if (!home) return;
    const cue = { gathered: 0, over: false };
    s.busyUntil = now + 40000;
    this.host.runner.add(sequence([
      () => this.walk(s, bx, y),
      () => until(() => cue.gathered >= listeners.length, 12000),
      () => { s.setFacing(1); s.setPose("point"); s.setBubble(first, "chat"); return wait(3200); },
      () => {
        s.setBubble(null);
        const answer = listeners[0];
        if (answer) {
          answer.setPose("chat");
          answer.setBubble(pick(LINES.boardReply)!, "chat");
        }
        return wait(answer ? 2400 : 10);
      },
      () => { listeners[0]?.setBubble(null); s.setBubble(second, "chat"); return wait(3000); },
      () => { s.setBubble(null); cue.over = true; return this.walk(s, home.x, y); },
    ], this.back(s)));
    listeners.forEach((l, i) => {
      const lh = this.home(l);
      if (!lh) return;
      l.busyUntil = now + 40000;
      this.host.runner.add(sequence([
        () => this.walk(l, bx - 52 - i * 42, y),
        () => { l.setFacing(1); l.setPose("stand"); cue.gathered += 1; return until(() => cue.over, 25000); },
        () => { l.setBubble(null); return wait(300 + i * 400); },
        () => this.walk(l, lh.x, y),
      ], this.back(l)));
    });
  }

  // The Warden takes the lift down, stops at a desk or two for a word, and rides back up.
  wardenTour(now: number, opener?: string): boolean {
    const w = [...this.host.sprites.values()].find((s) => s.isWarden);
    if (!w || w.away || this.host.lift.isBusy) return false;
    const wa = this.host.agent(w.agentId);
    if (!wa || wa.status === "helping") return false;
    const floor = pick(this.workFloors().filter((f) => this.crew(f).length));
    if (!floor) return false;
    const stops = pickN(this.crew(floor).filter((s) => !s.away), 2).sort((a, b) => a.position.x - b.position.x);
    const firstX = stops[0] ? stops[0].position.x + 46 : BUILDING.interiorX + 160;
    w.away = true;
    w.busyUntil = now + 120000;
    const go = () => {
      w.setBubble(null);
      this.host.lift.request({ rider: w, from: w.level, to: floor.level, targetX: firstX, charLayer: this.host.charLayer, onArrive: () => this.walkTheFloor(w, wa.locationLevel, floor, stops) });
    };
    if (opener) {
      w.setBubble(opener, "chat", 8);
      w.setPose("wave");
      this.host.runner.add(sequence([() => wait(1800)], go));
    } else go();
    return true;
  }

  private walkTheFloor(w: CharacterSprite, homeLevel: number, floor: FloorState, stops: CharacterSprite[]) {
    const y = floorY(floor.level);
    const capped = floor.status === "paused";
    const steps: Array<() => Tween> = [];
    for (const s of stops) {
      let talking = false;
      steps.push(() => this.walk(w, s.position.x + 46, y));
      steps.push(() => {
        w.setFacing(-1);
        w.setPose("chat");
        w.setBubble(pick(capped ? LINES.wardenCapped : LINES.warden)!, "chat", 16);
        return wait(1700);
      });
      steps.push(() => {
        const now = performance.now();
        talking = !s.away && s.busyUntil <= now;
        if (talking) {
          s.busyUntil = now + 3000;
          w.setBubble(null);
          s.setBubble(pick(capped ? LINES.crewCapped : LINES.crew)!, "chat");
        }
        return wait(2300);
      });
      steps.push(() => {
        w.setBubble(null);
        if (talking) {
          s.busyUntil = 0;
          this.host.restore(s);
        }
        return wait(250);
      });
    }
    steps.push(() => this.walk(w, LIFT_DOOR_X + 30, y));
    this.host.runner.add(sequence(steps, () => {
      this.host.lift.request({ rider: w, from: floor.level, to: homeLevel, targetX: 700, charLayer: this.host.charLayer, onArrive: this.back(w) });
    }));
  }

  // Someone carries a folder to a colleague on another floor and rides back.
  private floorErrand(now: number): boolean {
    if (this.host.lift.isBusy) return false;
    const floors = this.workFloors().filter((f) => this.crew(f).length);
    if (floors.length < 2) return false;
    const from = pick(floors)!;
    const to = pick(floors.filter((f) => f !== from))!;
    const s = pick(this.crew(from).filter((x) => this.free(x, now)));
    const target = pick(this.crew(to).filter((x) => !x.away));
    const home = s ? this.home(s) : null;
    if (!s || !target || !home) return false;
    s.away = true;
    s.busyUntil = now + 120000;
    s.setCarry(true);
    const y = floorY(to.level);
    this.host.lift.request({
      rider: s,
      from: from.level,
      to: to.level,
      targetX: target.position.x + 42,
      charLayer: this.host.charLayer,
      onArrive: () => {
        let thanked = false;
        this.host.runner.add(sequence([
          () => { s.setFacing(-1); s.setPose("chat"); s.setBubble(pick(LINES.errand)!, "chat"); return wait(1800); },
          () => {
            s.setCarry(false);
            const t = performance.now();
            thanked = !target.away && target.busyUntil <= t;
            if (thanked) {
              target.busyUntil = t + 2600;
              s.setBubble(null);
              target.setBubble(pick(LINES.thanks)!, "chat");
            }
            return wait(2200);
          },
          () => {
            s.setBubble(null);
            if (thanked) {
              target.busyUntil = 0;
              this.host.restore(target);
            }
            return this.walk(s, LIFT_DOOR_X + 30, y);
          },
        ], () => {
          this.host.lift.request({ rider: s, from: to.level, to: home.level, targetX: home.x, charLayer: this.host.charLayer, onArrive: this.back(s) });
        }));
      },
    });
    return true;
  }

  // A visitor comes in through the lobby door, stops at the counter, and either leaves or rides up for a meeting.
  private lobbyGuest(now: number): boolean {
    const lobby = this.host.build("lobby");
    const door = lobby?.spots.door;
    const counter = lobby?.spots.counter;
    if (!lobby || !door || !counter) return false;
    const reception = lobby.extras[0];
    const y = floorY(0);
    const g = new CharacterSprite(`guest_${Math.floor(now)}`, "Visitor", randomLook(), false);
    g.eventMode = "none";
    g.level = 0;
    g.alpha = 0;
    g.position.set(door, y);
    g.setPose("stand");
    this.host.charLayer.addChild(g);
    const leave = () => {
      this.host.runner.add(sequence([
        () => this.walk(g, door, y),
        () => tween(400, (t) => (g.alpha = 1 - t), ease.linear),
      ], () => g.destroy({ children: true })));
    };
    const meeting = !this.host.lift.isBusy && Math.random() < 0.55 ? pick(this.workFloors().filter((f) => this.crew(f).length)) : undefined;
    this.host.runner.add(sequence([
      () => tween(400, (t) => (g.alpha = t), ease.linear),
      () => this.walk(g, counter, y),
      () => { g.setFacing(-1); g.setPose("chat"); g.setBubble(pick(LINES.guest)!, "chat"); return wait(2200); },
      () => { g.setBubble(null); reception?.setBubble(pick(LINES.reception)!, "chat"); reception?.setPose("wave"); return wait(2200); },
      () => { reception?.setBubble(null); reception?.setPose("sit_type"); return wait(200); },
    ], () => {
      const host = meeting ? pick(this.crew(meeting).filter((x) => !x.away)) : undefined;
      if (!meeting || !host || this.host.lift.isBusy) return leave();
      const my = floorY(meeting.level);
      this.host.lift.request({
        rider: g,
        from: 0,
        to: meeting.level,
        targetX: host.position.x + 42,
        charLayer: this.host.charLayer,
        onArrive: () => {
          this.host.runner.add(sequence([
            () => { g.setFacing(-1); g.setPose("chat"); g.setBubble("Nice to meet you", "chat"); return wait(3200); },
            () => { g.setBubble(null); return this.walk(g, LIFT_DOOR_X + 30, my); },
          ], () => {
            this.host.lift.request({ rider: g, from: meeting.level, to: 0, targetX: door - 60, charLayer: this.host.charLayer, onArrive: leave });
          }));
        },
      });
    }));
    return true;
  }

  // A task just landed: a quick cheer at the desk.
  cheer(s: CharacterSprite, now: number) {
    if (s.away || s.busyUntil > now) return;
    s.busyUntil = now + 1700;
    s.setPose("cheer");
    this.host.runner.add(sequence([() => wait(1500)], this.back(s)));
  }

  // The owner pressed Run the Tower now: the Warden calls everyone to work and heads down; people wake up.
  runStarted(now: number) {
    if (!this.wardenTour(now, LINES.runStart)) {
      const w = [...this.host.sprites.values()].find((s) => s.isWarden);
      if (w && !w.away) {
        w.setBubble(LINES.runStart, "chat");
        this.host.runner.add(sequence([() => wait(2500)], () => w.setBubble(null)));
      }
    }
    this.tourAt = now + 90000;
    let i = 0;
    for (const f of this.workFloors()) {
      for (const s of this.crew(f)) {
        if (!this.free(s, now)) continue;
        const delay = 200 + i * 160;
        i += 1;
        s.busyUntil = now + delay + 1600;
        this.host.runner.add(sequence([() => wait(delay), () => { s.setPose("stretch"); return wait(1300); }], this.back(s)));
      }
    }
  }

  // The run came back capped: one worker on each paused floor says so.
  runCapped(now: number) {
    for (const f of this.workFloors().filter((x) => x.status === "paused")) {
      const s = pick(this.crew(f).filter((x) => this.free(x, now)));
      if (!s) continue;
      s.busyUntil = now + 3200;
      s.setBubble(pick(LINES.crewCapped)!, "chat");
      this.host.runner.add(sequence([() => wait(3000)], this.back(s)));
    }
  }
}
