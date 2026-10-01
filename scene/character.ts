// Small vector rigs with visible personality: hair, glasses, a coloured mug, one slouching per floor.
// Poses are unmistakable from across the room: typing hammers the keys, idle leans back.
import { Container, Graphics } from "pixi.js";
import { C, shade } from "./palette";
import { label } from "./draw";
import { BUILDING } from "./layout";

export interface Look {
  hair: number;
  glasses: boolean;
  mug: boolean;
  slouch: boolean;
  coat: boolean;
  tone: number;
  mugColor?: string;
  quirk?: string;
}

export type Pose =
  | "sit_idle"
  | "sit_type"
  | "stand"
  | "walk"
  | "raise"
  | "pace"
  | "look_out"
  | "dim"
  | "feet_up"
  | "asleep"
  | "chat"
  | "spin"
  | "drink"
  | "coffee"
  | "stretch"
  | "cheer"
  | "point"
  | "phone"
  | "wave";

const TAU = Math.PI * 2;

function hexToNum(hex: string | undefined, fallback: number): number {
  if (!hex) return fallback;
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return Number.isFinite(n) ? n : fallback;
}

// Seated workers sit high enough that the chest, arms and head show over the desk top (desk top 36 above the floor).
const SEAT_Y = -12;
// How far the forearms reach in toward the keyboard while typing.
const TYPE_REACH = 0.42;

export class CharacterSprite extends Container {
  readonly agentId: string;
  readonly isWarden: boolean;
  readonly look: Look;
  level = 0;
  pose: Pose = "stand";
  facing = 1;
  busyUntil = 0; // idle director leaves the sprite alone until this time
  // Out on an errand (a lift ride, a tour, a visit): state updates leave the sprite alone until it is back.
  away = false;
  private readonly body = new Container();
  private readonly legL = new Graphics();
  private readonly legR = new Graphics();
  private readonly torso = new Graphics();
  private readonly armL = new Container();
  private readonly armR = new Container();
  private readonly head = new Container();
  private readonly mug = new Graphics();
  private readonly bubble = new Container();
  private readonly tag = new Container();
  private readonly zz = new Container();
  // A light bulb over the head while the owner has this worker's idea or ticket on his phone.
  private readonly bulb = new Graphics();
  // A folder in the right hand, for errands between desks and floors.
  private readonly folder = new Graphics();
  // A phone in the right hand for the phone pose.
  private readonly handset = new Graphics();
  // Typing comes in bursts: a run of keys, then a look at the screen, now and then a hand to the chin.
  private typing = true;
  private typeClock = 0;
  private typeNext = 1500;
  private thinking = false;
  private bubbleLift = 0;
  private t = 0;
  private walkPhase = 0;
  private spinPhase = 0;
  readonly bodyHeight: number;
  private readonly scaleBase: number;
  private mugTint: number;

  constructor(agentId: string, name: string, look: Look, isWarden: boolean) {
    super();
    this.agentId = agentId;
    this.isWarden = isWarden;
    this.look = look;
    this.scaleBase = isWarden ? 1.4 : 1;
    this.bodyHeight = 52 * this.scaleBase;
    this.mugTint = hexToNum(look.mugColor, C.paper);
    this.addChild(this.body);
    this.body.scale.set(this.scaleBase);

    const skin = C.skin[Math.abs(look.tone) % C.skin.length] ?? C.skin[0]!;
    const shirt = isWarden ? C.coat : C.shirt[Math.abs(look.tone) % C.shirt.length] ?? C.shirt[0]!;
    const hair = isWarden ? 0xb9b3a8 : C.hair[Math.abs(look.hair) % C.hair.length] ?? C.hair[0]!;
    const stance = isWarden ? 7 : 4; // Warden stands wider

    for (const [leg, x] of [[this.legL, -stance], [this.legR, stance - 1]] as const) {
      leg.rect(-3, 0, 6, 18).fill(C.trouser);
      leg.rect(0, 0, 3, 18).fill(shade(C.trouser, -0.3));
      leg.rect(-4, 16, 8, 3).fill(0x1a1a1e);
      leg.position.set(x, -18);
      this.body.addChild(leg);
    }

    if (isWarden) {
      // long coat over the knees, broad shoulders, brass buttons
      this.torso.poly([-13, -42, 13, -42, 17, -4, -17, -4]).fill(C.coat);
      this.torso.poly([0, -42, 13, -42, 17, -4, 0, -4]).fill(shade(C.coat, -0.25));
      this.torso.poly([-5, -42, -1, -42, 1, -12, -3, -12]).fill(C.coatLight);
      this.torso.poly([1, -42, 5, -42, 3, -12, 1, -12]).fill(shade(C.coatLight, -0.2));
      this.torso.rect(-2, -30, 4, 2).fill(C.brass);
      this.torso.rect(-2, -22, 4, 2).fill(C.brass);
      this.torso.rect(-13, -44, 26, 3).fill(shade(C.coat, 0.15)); // collar
    } else {
      this.torso.poly([-10, -40, 10, -40, 9, -18, -9, -18]).fill(shirt);
      this.torso.poly([0, -40, 10, -40, 9, -18, 0, -18]).fill(shade(shirt, -0.18));
      this.torso.rect(-1, -40, 2, 10).fill(shade(shirt, -0.35));
    }
    this.body.addChild(this.torso);

    for (const [arm, x, side] of [[this.armL, -9, -1], [this.armR, 9, 1]] as const) {
      const g = new Graphics();
      g.rect(-2.5, 0, 5, 16).fill(isWarden ? C.coat : shirt);
      g.rect(0, 0, 2.5, 16).fill(shade(isWarden ? C.coat : shirt, -0.25));
      g.rect(-2.5, 15, 5, 4).fill(skin);
      arm.addChild(g);
      arm.position.set(x * (isWarden ? 1.3 : 1), -38);
      arm.rotation = side * 0.12;
      this.body.addChild(arm);
    }
    this.mug.rect(-4, 0, 8, 8).fill(this.mugTint);
    this.mug.rect(0, 0, 4, 8).fill(shade(this.mugTint, -0.2));
    this.mug.rect(4, 2, 3, 4).stroke({ width: 1.5, color: this.mugTint });
    this.mug.position.set(0, 14);
    this.mug.visible = false;
    this.armR.addChild(this.mug);
    this.folder.rect(-7, 0, 13, 10).fill(0xe2c27a);
    this.folder.rect(-7, 0, 13, 2).fill(0xc9a45a);
    this.folder.rect(-7, 0, 5, 2).fill(0xd1b06a);
    this.folder.rect(-5, 4, 9, 1).fill(0xf3e9d2);
    this.folder.position.set(0, 15);
    this.folder.visible = false;
    this.armR.addChild(this.folder);
    this.handset.roundRect(-2, 0, 5, 10, 1).fill(0x1e1e22);
    this.handset.rect(-1, 1, 3, 6).fill(0x5da9e9);
    this.handset.position.set(-1, 13);
    this.handset.visible = false;
    this.armR.addChild(this.handset);

    const hg = new Graphics();
    hg.roundRect(-7, -16, 14, 15, 3).fill(skin);
    hg.roundRect(0, -16, 7, 15, 3).fill(shade(skin, -0.14));
    hg.rect(0, -16, 3, 15).fill(shade(skin, -0.14));
    hg.rect(-4, -8, 2, 2).fill(C.ink);
    hg.rect(2, -8, 2, 2).fill(C.ink);
    hg.rect(-2, -4, 4, 1).fill(shade(skin, -0.4));
    switch (Math.abs(look.hair) % 6) {
      case 0:
        hg.roundRect(-7, -18, 14, 6, 3).fill(hair);
        break;
      case 1:
        hg.roundRect(-8, -18, 15, 7, 3).fill(hair);
        hg.rect(-8, -14, 3, 8).fill(hair);
        break;
      case 2:
        hg.roundRect(-7, -18, 14, 6, 3).fill(hair);
        hg.circle(0, -19, 4).fill(hair);
        break;
      case 3:
        hg.poly([-8, -12, -8, -18, -4, -21, 0, -19, 4, -21, 8, -18, 8, -12, 5, -14, 0, -13, -5, -14]).fill(hair);
        break;
      case 4:
        hg.roundRect(-8, -18, 16, 8, 3).fill(hair);
        hg.rect(-8, -14, 3, 14).fill(hair);
        hg.rect(5, -14, 3, 14).fill(hair);
        break;
      default:
        hg.rect(-6, -3, 12, 3).fill(hair);
        hg.roundRect(-7, -18, 14, 3, 1).fill(shade(skin, 0.05));
    }
    if (look.glasses) {
      hg.rect(-6, -9, 5, 4).stroke({ width: 1, color: C.ink });
      hg.rect(1, -9, 5, 4).stroke({ width: 1, color: C.ink });
      hg.rect(-1, -7, 2, 1).fill(C.ink);
    }
    this.head.addChild(hg);
    this.head.position.set(0, -40);
    this.body.addChild(this.head);

    if (look.slouch && !isWarden) {
      this.torso.rotation = -0.14;
      this.head.position.set(-3, -37);
    }

    // sleeping letters
    for (let i = 0; i < 2; i++) {
      const z = label("z", { fontSize: 11 + i * 3, fill: C.paper, family: "panel", weight: "600" });
      z.position.set(6 + i * 8, -10 - i * 12);
      this.zz.addChild(z);
    }
    this.zz.visible = false;

    this.bulb.circle(0, 0, 6).fill(0xffd35a);
    this.bulb.circle(-2, -2, 2).fill(0xfff4c2);
    this.bulb.rect(-3, 5, 6, 4).fill(0x8c8f96);
    this.bulb.rect(-3, 7, 6, 1).fill(0x5f636a);
    this.bulb.position.set(-19, -this.bodyHeight + 2);
    this.bulb.visible = false;

    this.bubble.visible = false;
    this.tag.visible = false;
    this.addChild(this.bubble, this.tag, this.zz, this.bulb);
    this.setTag(name);
    this.eventMode = "static";
    this.cursor = "pointer";
  }

  setTag(name: string) {
    this.tag.removeChildren();
    const t = label(name, { fontSize: 13, fill: C.ink, spacing: 0.5 });
    const w = t.width + 14;
    const g = new Graphics();
    g.roundRect(-w / 2, -14, w, 20, 3).fill(C.paper);
    g.rect(-w / 2, 4, w, 2).fill(C.paperShade);
    g.poly([-4, 6, 4, 6, 0, 10]).fill(C.paperShade);
    t.position.set(-w / 2 + 7, -12);
    this.tag.addChild(g, t);
    this.tag.position.set(0, -this.bodyHeight - 22);
  }

  // Paper task label. Big enough to read the three words from across the room. Alert style for blocked.
  setBubble(text: string | null, style: "task" | "alert" | "chat" = "task", lift = 0) {
    this.bubble.removeChildren();
    if (!text) {
      this.bubble.visible = false;
      return;
    }
    const alert = style === "alert";
    const t = label(text, { fontSize: style === "chat" ? 12 : 14, fill: alert ? C.red : C.ink, family: "panel", weight: "600" });
    // a long line wraps onto a second one instead of running past the paper (Wall Street's debates, D075)
    const maxW = 250;
    if (t.width + 20 > maxW) {
      t.style.wordWrap = true;
      t.style.wordWrapWidth = maxW - 20;
      t.style.breakWords = true;
    }
    const w = Math.min(maxW, t.width + 20);
    const h = Math.max(28, Math.ceil(t.height) + 10);
    // keep the paper inside the building: a worker by the lift gets the bubble shifted in, the pointer stays put
    const left = this.position.x - w / 2;
    const right = this.position.x + w / 2;
    const dx = left < BUILDING.interiorX + 4 ? BUILDING.interiorX + 4 - left : right > BUILDING.interiorRight - 4 ? BUILDING.interiorRight - 4 - right : 0;
    const g = new Graphics();
    g.roundRect(-w / 2 + 2 + dx, -h + 2, w, h, 2).fill(C.paperShade);
    g.roundRect(-w / 2 + dx, -h, w, h, 2).fill(C.paper);
    g.rect(-w / 2 + dx, -h, w, 3).fill(alert ? C.red : shade(C.paper, -0.08));
    if (alert) g.roundRect(-w / 2 + dx, -h, w, h, 2).stroke({ width: 1.5, color: C.red });
    g.circle(-w / 2 + 8 + dx, -h + 8, 2).fill(alert ? C.red : C.brassDark);
    g.poly([-5, 0, 5, 0, 0, 6]).fill(C.paper);
    t.position.set(-w / 2 + 10 + dx, -h + 5);
    this.bubble.addChild(g, t);
    this.bubbleLift = lift;
    this.bubble.position.set(0, -this.bodyHeight - 12 - lift);
    this.bubble.visible = true;
  }

  showTag(show: boolean) {
    this.tag.visible = show;
    this.tag.position.set(0, -this.bodyHeight - (this.bubble.visible ? 52 : 22));
  }

  setFacing(dir: number) {
    this.facing = dir < 0 ? -1 : 1;
    this.body.scale.x = this.scaleBase * this.facing;
  }

  setPose(pose: Pose) {
    if (this.pose === pose) return;
    this.pose = pose;
    const seated = pose === "sit_idle" || pose === "sit_type" || pose === "dim" || pose === "feet_up" || pose === "asleep" || pose === "spin" || pose === "stretch";
    this.legL.visible = !seated || pose === "feet_up";
    this.legR.visible = !seated || pose === "feet_up";
    this.legL.rotation = 0;
    this.legR.rotation = 0;
    this.body.position.set(0, seated ? SEAT_Y : 0);
    this.body.rotation = 0;
    this.torso.rotation = this.look.slouch && !this.isWarden ? -0.14 : 0;
    this.alpha = pose === "dim" ? 0.6 : 1;
    // seated people draw over anyone walking between the desks, so their task labels stay readable
    this.zIndex = seated ? 2 : 1;
    this.armL.rotation = -0.12;
    this.armR.rotation = 0.12;
    this.head.rotation = 0;
    this.head.position.x = this.look.slouch && !this.isWarden ? -3 : 0;
    this.armL.position.y = -38;
    this.armR.position.y = -38;
    this.mug.visible = false;
    this.handset.visible = false;
    this.zz.visible = false;
    this.thinking = false;
    switch (pose) {
      case "sit_idle":
        // leaning back, arms folded on the chest
        this.torso.rotation += 0.08;
        this.armL.rotation = -1.5;
        this.armR.rotation = 1.5;
        break;
      case "sit_type":
        // leaning in a little, both hands down on the keyboard on the desk in front
        this.torso.rotation -= 0.05;
        this.armL.rotation = -TYPE_REACH;
        this.armR.rotation = TYPE_REACH;
        break;
      case "dim":
        this.armL.rotation = -1.7;
        this.armR.rotation = 1.7;
        break;
      case "feet_up":
        this.torso.rotation += 0.3;
        this.legL.rotation = -1.4;
        this.legR.rotation = -1.5;
        this.legL.position.y = -12;
        this.legR.position.y = -12;
        this.armL.rotation = -2.6;
        this.armR.rotation = 2.6;
        break;
      case "asleep":
        this.torso.rotation += 0.18;
        this.head.rotation = 0.45;
        this.armL.rotation = -0.3;
        this.armR.rotation = 0.3;
        this.zz.visible = true;
        break;
      case "raise":
        this.armR.rotation = Math.PI * 0.92;
        this.head.rotation = -0.22;
        break;
      case "pace":
        this.armL.rotation = -0.55;
        this.armR.rotation = 0.55;
        break;
      case "coffee":
        this.armR.rotation = 2.6;
        this.mug.visible = true;
        break;
      case "drink":
        this.armR.rotation = 2.5;
        this.mug.visible = true;
        break;
      case "chat":
        this.armR.rotation = 1.2;
        break;
      case "cheer":
        this.armL.rotation = -2.8;
        this.armR.rotation = 2.8;
        this.head.rotation = -0.1;
        break;
      case "point":
        this.armR.rotation = -1.45;
        break;
      case "phone":
        this.armR.rotation = 2.75;
        this.handset.visible = true;
        this.head.rotation = 0.12;
        break;
      case "wave":
        this.armR.rotation = 2.9;
        break;
      default:
        break;
    }
    if (pose === "feet_up") return;
    this.legL.position.y = -18;
    this.legR.position.y = -18;
  }

  setBulb(on: boolean) {
    this.bulb.visible = on;
  }

  setCarry(on: boolean) {
    this.folder.visible = on;
  }

  // True while the hands are on the keys, so the monitor next to the worker can scroll with them.
  get keysActive(): boolean {
    return this.pose === "sit_type" && this.typing;
  }

  update(dtMs: number) {
    this.t += dtMs;
    const s = this.t / 1000;
    if (this.bulb.visible) {
      this.bulb.alpha = 0.75 + Math.sin(s * TAU * 0.6) * 0.25;
      this.bulb.y = -this.bodyHeight + 2 + this.body.position.y + Math.sin(s * TAU * 0.4) * 1.5;
    }
    switch (this.pose) {
      case "sit_idle":
      case "dim":
        this.torso.scale.y = 1 + Math.sin(s * TAU * 0.25) * 0.015;
        this.head.rotation = Math.sin(s * TAU * 0.15) * 0.05;
        break;
      case "sit_type": {
        // Typing in bursts: quick taps from each hand in turn, then a pause to read the screen beside the
        // desk, now and then a hand to the chin while thinking. The hands stay down on the keyboard.
        this.typeClock += dtMs;
        if (this.typeClock > this.typeNext) {
          this.typeClock = 0;
          this.typing = !this.typing;
          this.thinking = !this.typing && Math.random() < 0.3;
          this.typeNext = this.typing ? 1400 + Math.random() * 2600 : 700 + Math.random() * 1500;
        }
        if (this.typing) {
          const k = s * TAU * 4.2;
          const tapL = Math.max(0, Math.sin(k));
          const tapR = Math.max(0, Math.sin(k + Math.PI * 0.9));
          this.armL.rotation = -TYPE_REACH - tapL * 0.1;
          this.armR.rotation = TYPE_REACH + tapR * 0.1;
          this.armL.position.y = -38 - tapL * 1.6;
          this.armR.position.y = -38 - tapR * 1.6;
          this.torso.rotation = (this.look.slouch ? -0.14 : 0) - 0.07;
          this.head.rotation = 0.04 + Math.sin(s * TAU * 0.9) * 0.03;
          this.head.position.x = (this.look.slouch ? -3 : 0) + 0.5;
        } else {
          this.armL.position.y = -38;
          this.armR.position.y = -38;
          this.armL.rotation = -TYPE_REACH;
          this.armR.rotation = this.thinking ? 2.55 : TYPE_REACH;
          this.torso.rotation = (this.look.slouch ? -0.14 : 0) + (this.thinking ? 0.04 : -0.02);
          // eyes on the monitor to the side
          this.head.rotation = this.thinking ? -0.12 : 0.14;
          this.head.position.x = (this.look.slouch ? -3 : 0) + (this.thinking ? 0 : 1.5);
        }
        this.body.position.y = SEAT_Y + Math.sin(s * TAU * 1.1) * 0.3;
        this.bubble.position.y = -this.bodyHeight - 12 - this.bubbleLift + Math.sin(s * TAU * 0.5) * 2;
        break;
      }
      case "cheer": {
        const b = Math.abs(Math.sin(s * TAU * 1.6));
        this.body.position.y = -b * 4;
        this.armL.rotation = -2.8 + Math.sin(s * TAU * 3.2) * 0.2;
        this.armR.rotation = 2.8 - Math.sin(s * TAU * 3.2) * 0.2;
        break;
      }
      case "point":
        this.armR.rotation = -1.45 + Math.sin(s * TAU * 0.9) * 0.1;
        this.head.rotation = Math.sin(s * TAU * 0.4) * 0.05;
        break;
      case "phone":
        this.armR.rotation = 2.75 + Math.sin(s * TAU * 0.3) * 0.05;
        this.armL.rotation = -0.3 + Math.sin(s * TAU * 0.7) * 0.25;
        this.head.rotation = 0.12 + Math.sin(s * TAU * 0.5) * 0.05;
        break;
      case "wave":
        this.armR.rotation = 2.9 + Math.sin(s * TAU * 2) * 0.35;
        break;
      case "walk":
      case "pace": {
        const rate = this.pose === "pace" ? 1.1 : 1.6;
        this.walkPhase += (dtMs / 1000) * TAU * rate;
        const sw = Math.sin(this.walkPhase);
        this.legL.rotation = sw * 0.45;
        this.legR.rotation = -sw * 0.45;
        this.body.position.y = -Math.abs(Math.sin(this.walkPhase)) * 2;
        if (this.pose === "walk") {
          // both arms swing the same way, like a pendulum, instead of flapping in and out
          this.armL.rotation = -0.1 + sw * 0.22;
          this.armR.rotation = 0.1 + sw * 0.22;
        }
        break;
      }
      case "raise":
        this.armR.rotation = Math.PI * 0.92 + Math.sin(s * TAU * 1.2) * 0.12;
        this.body.position.y = -Math.abs(Math.sin(s * TAU * 0.6)) * 1.5;
        break;
      case "look_out":
      case "coffee":
        this.head.rotation = -0.06 + Math.sin(s * TAU * 0.2) * 0.03;
        if (this.pose === "coffee") this.armR.rotation = 2.6 + Math.sin(s * TAU * 0.3) * 0.25;
        break;
      case "stretch": {
        const k = (Math.sin(s * TAU * 0.5) + 1) / 2;
        this.armL.rotation = -1.7 - k * 1.4;
        this.armR.rotation = 1.7 + k * 1.4;
        this.torso.rotation = 0.12 + k * 0.1;
        break;
      }
      case "spin":
        this.spinPhase += (dtMs / 1000) * TAU * 1.4;
        this.body.scale.x = this.scaleBase * Math.cos(this.spinPhase) * this.facing;
        break;
      case "asleep":
        this.torso.scale.y = 1 + Math.sin(s * TAU * 0.12) * 0.02;
        this.zz.alpha = 0.5 + Math.sin(s * TAU * 0.5) * 0.5;
        this.zz.position.set(8, -this.bodyHeight + 8 + Math.sin(s * TAU * 0.25) * 3);
        break;
      case "drink":
        this.armR.rotation = 2.5 + Math.sin(s * TAU * 0.5) * 0.2;
        break;
      case "chat":
        this.armR.rotation = 1.1 + Math.sin(s * TAU * 0.8) * 0.16;
        this.head.rotation = Math.sin(s * TAU * 0.6) * 0.08;
        break;
      case "feet_up":
        this.torso.scale.y = 1 + Math.sin(s * TAU * 0.2) * 0.015;
        break;
      default:
        break;
    }
    if (this.pose !== "spin") this.body.scale.x = this.scaleBase * this.facing;
  }
}
