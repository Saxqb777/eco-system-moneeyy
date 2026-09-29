// Small vector rigs with visible personality: hair, glasses, mugs, one slouching per floor.
import { Container, Graphics } from "pixi.js";
import { C, shade } from "./palette";
import { label } from "./draw";

export interface Look {
  hair: number;
  glasses: boolean;
  mug: boolean;
  slouch: boolean;
  coat: boolean;
  tone: number;
}

export type Pose = "sit_idle" | "sit_type" | "stand" | "walk" | "raise" | "pace" | "look_out" | "dim";

const TAU = Math.PI * 2;

export class CharacterSprite extends Container {
  readonly agentId: string;
  readonly isWarden: boolean;
  level = 0;
  pose: Pose = "stand";
  facing = 1;
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
  private t = 0;
  private gestureUntil = 0;
  private gesture: "none" | "sip" | "stretch" = "none";
  private nextGestureAt = 4000 + Math.random() * 8000;
  private walkPhase = 0;
  readonly bodyHeight: number;

  constructor(agentId: string, name: string, look: Look, isWarden: boolean) {
    super();
    this.agentId = agentId;
    this.isWarden = isWarden;
    const scale = isWarden ? 1.3 : 1;
    this.bodyHeight = 52 * scale;
    this.addChild(this.body);
    this.body.scale.set(scale);

    const skin = C.skin[Math.abs(look.tone) % C.skin.length] ?? C.skin[0]!;
    const shirt = isWarden ? C.coat : C.shirt[Math.abs(look.tone) % C.shirt.length] ?? C.shirt[0]!;
    const hair = C.hair[Math.abs(look.hair) % C.hair.length] ?? C.hair[0]!;

    // legs (pivot at hip)
    for (const [leg, x] of [[this.legL, -4], [this.legR, 3]] as const) {
      leg.rect(-3, 0, 6, 18).fill(C.trouser);
      leg.rect(0, 0, 3, 18).fill(shade(C.trouser, -0.3));
      leg.rect(-4, 16, 8, 3).fill(0x1a1a1e);
      leg.position.set(x, -18);
      this.body.addChild(leg);
    }

    // torso: trapezoid, lit left, shaded right. Warden gets a long coat over the knees.
    if (isWarden) {
      this.torso.poly([-11, -40, 11, -40, 15, -6, -15, -6]).fill(C.coat);
      this.torso.poly([0, -40, 11, -40, 15, -6, 0, -6]).fill(shade(C.coat, -0.25));
      this.torso.poly([-4, -40, -1, -40, 1, -14, -3, -14]).fill(C.coatLight);
      this.torso.poly([1, -40, 4, -40, 3, -14, 1, -14]).fill(shade(C.coatLight, -0.2));
      this.torso.rect(-3, -22, 6, 2).fill(C.brass);
    } else {
      this.torso.poly([-10, -40, 10, -40, 9, -18, -9, -18]).fill(shirt);
      this.torso.poly([0, -40, 10, -40, 9, -18, 0, -18]).fill(shade(shirt, -0.18));
      this.torso.rect(-1, -40, 2, 10).fill(shade(shirt, -0.35));
    }
    this.body.addChild(this.torso);

    // arms (pivot at shoulder)
    for (const [arm, x, side] of [[this.armL, -9, -1], [this.armR, 9, 1]] as const) {
      const g = new Graphics();
      g.rect(-2.5, 0, 5, 16).fill(isWarden ? C.coat : shirt);
      g.rect(0, 0, 2.5, 16).fill(shade(isWarden ? C.coat : shirt, -0.25));
      g.rect(-2.5, 15, 5, 4).fill(skin);
      arm.addChild(g);
      arm.position.set(x, -38);
      arm.rotation = side * 0.12;
      this.body.addChild(arm);
    }
    this.mug.rect(-4, 0, 8, 8).fill(C.paper);
    this.mug.rect(0, 0, 4, 8).fill(C.paperShade);
    this.mug.rect(4, 2, 3, 4).stroke({ width: 1.5, color: C.paper });
    this.mug.position.set(0, 14);
    this.mug.visible = false;
    this.armR.addChild(this.mug);

    // head (pivot at neck)
    const hg = new Graphics();
    hg.roundRect(-7, -16, 14, 15, 3).fill(skin);
    hg.roundRect(0, -16, 7, 15, 3).fill(shade(skin, -0.14));
    hg.rect(0, -16, 3, 15).fill(shade(skin, -0.14));
    hg.rect(-4, -8, 2, 2).fill(C.ink);
    hg.rect(2, -8, 2, 2).fill(C.ink);
    hg.rect(-2, -4, 4, 1).fill(shade(skin, -0.4));
    // hair styles
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

    // bubble and name tag live above the head, outside the body scale
    this.bubble.visible = false;
    this.tag.visible = false;
    this.addChild(this.bubble, this.tag);
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

  setBubble(text: string | null) {
    this.bubble.removeChildren();
    if (!text) {
      this.bubble.visible = false;
      return;
    }
    const t = label(text, { fontSize: 12, fill: C.ink, family: "panel", weight: "600" });
    const w = Math.min(150, t.width + 16);
    const g = new Graphics();
    g.roundRect(-w / 2 + 2, -20, w, 24, 2).fill(C.paperShade);
    g.roundRect(-w / 2, -22, w, 24, 2).fill(C.paper);
    g.rect(-w / 2, -22, w, 3).fill(shade(C.paper, -0.08));
    g.circle(-w / 2 + 7, -19, 2).fill(C.red);
    g.poly([-5, 2, 5, 2, 0, 7]).fill(C.paper);
    t.position.set(-w / 2 + 8, -20);
    this.bubble.addChild(g, t);
    this.bubble.position.set(0, -this.bodyHeight - 12);
    this.bubble.visible = true;
  }

  showTag(show: boolean) {
    this.tag.visible = show;
    if (show && this.bubble.visible) this.tag.position.set(0, -this.bodyHeight - 46);
    else this.tag.position.set(0, -this.bodyHeight - 22);
  }

  setFacing(dir: number) {
    this.facing = dir < 0 ? -1 : 1;
    this.body.scale.x = Math.abs(this.body.scale.x) * this.facing;
  }

  setPose(pose: Pose) {
    if (this.pose === pose) return;
    this.pose = pose;
    const seated = pose === "sit_idle" || pose === "sit_type" || pose === "dim";
    this.legL.visible = !seated;
    this.legR.visible = !seated;
    this.body.position.y = seated ? 14 : 0;
    this.alpha = pose === "dim" ? 0.6 : 1;
    this.armL.rotation = -0.12;
    this.armR.rotation = 0.12;
    this.head.rotation = 0;
    this.mug.visible = false;
    if (seated) {
      this.armL.rotation = -0.9;
      this.armR.rotation = 0.9;
    }
    if (pose === "raise") {
      this.armR.rotation = Math.PI * 0.92;
      this.head.rotation = -0.22;
    }
    if (pose === "pace") {
      this.armL.rotation = -0.55;
      this.armR.rotation = 0.55;
    }
  }

  update(dtMs: number) {
    this.t += dtMs;
    const s = this.t / 1000;
    switch (this.pose) {
      case "sit_idle":
      case "dim": {
        this.torso.scale.y = 1 + Math.sin(s * TAU * 0.25) * 0.015;
        if (this.gesture === "none" && this.t > this.nextGestureAt) {
          this.gesture = Math.random() < 0.55 && this.mug.parent ? "sip" : "stretch";
          this.gestureUntil = this.t + (this.gesture === "sip" ? 1400 : 1600);
          this.nextGestureAt = this.t + 6000 + Math.random() * 10000;
        }
        if (this.gesture === "sip") {
          const k = Math.sin(Math.min(1, (this.gestureUntil - this.t) / 1400) * Math.PI);
          this.mug.visible = true;
          this.armR.rotation = 0.9 + k * 1.9;
          if (this.t > this.gestureUntil) {
            this.gesture = "none";
            this.mug.visible = false;
            this.armR.rotation = 0.9;
          }
        } else if (this.gesture === "stretch") {
          const k = Math.sin(Math.min(1, 1 - (this.gestureUntil - this.t) / 1600) * Math.PI);
          this.armL.rotation = -0.9 - k * 2.2;
          this.armR.rotation = 0.9 + k * 2.2;
          if (this.t > this.gestureUntil) {
            this.gesture = "none";
            this.armL.rotation = -0.9;
            this.armR.rotation = 0.9;
          }
        }
        break;
      }
      case "sit_type": {
        this.armL.rotation = -0.95 + Math.sin(s * TAU * 3.5) * 0.08;
        this.armR.rotation = 0.95 - Math.sin(s * TAU * 3.5 + 1.2) * 0.08;
        this.head.rotation = Math.sin(s * TAU * 0.4) * 0.03;
        this.bubble.position.y = -this.bodyHeight - 12 + Math.sin(s * TAU * 0.5) * 2;
        break;
      }
      case "walk":
      case "pace": {
        this.walkPhase += dtMs / 1000 * TAU * 1.6;
        const sw = Math.sin(this.walkPhase);
        this.legL.rotation = sw * 0.45;
        this.legR.rotation = -sw * 0.45;
        this.body.position.y = -Math.abs(Math.sin(this.walkPhase)) * 2;
        if (this.pose === "walk") {
          this.armL.rotation = -0.12 - sw * 0.35;
          this.armR.rotation = 0.12 + sw * 0.35;
        }
        break;
      }
      case "raise": {
        this.armR.rotation = Math.PI * 0.92 + Math.sin(s * TAU * 1.2) * 0.12;
        this.body.position.y = -Math.abs(Math.sin(s * TAU * 0.6)) * 1.5;
        break;
      }
      case "look_out": {
        this.head.rotation = -0.06 + Math.sin(s * TAU * 0.2) * 0.03;
        break;
      }
      default:
        break;
    }
  }
}
