// Orchestrates the building: sky, shell, floors, characters, lift, counters. Driven by TowerState.
import { Application, Container, FillGradient, Graphics } from "pixi.js";
import { OutlineFilter } from "pixi-filters";
import type { TowerState } from "@/lib/state";
import { buildMoon, buildShell, buildSkyline, buildStars, buildSun, type Shell } from "./building";
import { CharacterSprite, type Look, type Pose } from "./character";
import { buildFloor } from "./floors";
import { floorPlate, lockedLabel, RoofHud } from "./hud";
import { BUILDING, DESK_SLOTS, GROUND_Y, PENTHOUSE, WORKSHOP, WORLD, floorY, levelOf } from "./layout";
import { C, FLOOR_ACCENT } from "./palette";
import { Lift } from "./lift";
import { dubaiHour, skyAt } from "./sky";

export type Selection = { type: "agent"; id: string; slug: string } | { type: "floor"; slug: string } | { type: "warden" };

export interface SceneOptions {
  onSelect?: (sel: Selection) => void;
  onHover?: (sel: Selection | null) => void;
}

type AgentState = TowerState["floors"][number]["agents"][number];

export class TowerScene {
  readonly app: Application;
  private readonly host: HTMLElement;
  private readonly world = new Container();
  private readonly skyG = new Graphics();
  private readonly stars = buildStars();
  private readonly moon = buildMoon();
  private readonly sun = buildSun();
  private readonly skyline = buildSkyline();
  private readonly shell: Shell;
  private readonly floorsLayer = new Container();
  private readonly charLayer = new Container();
  private readonly lift = new Lift();
  private readonly hud = new RoofHud();
  private readonly platesLayer = new Container();
  private readonly nightOverlay = new Graphics();
  private readonly sprites = new Map<string, CharacterSprite>();
  private agentsBySlug = new Map<string, AgentState>();
  private floorsBySlug = new Map<string, TowerState["floors"][number]>();
  private night: boolean | null = null;
  private lastSkyDraw = -1;
  private state: TowerState | null = null;
  private wardenPace = { dir: 1, pauseUntil: 0 };
  private opts: SceneOptions;
  private destroyed = false;
  private readonly outline = new OutlineFilter({ thickness: 2, color: C.glow, alpha: 0.9 });

  private constructor(app: Application, host: HTMLElement, opts: SceneOptions) {
    this.app = app;
    this.host = host;
    this.opts = opts;
    this.shell = buildShell();
  }

  static async create(host: HTMLElement, opts: SceneOptions = {}): Promise<TowerScene> {
    const app = new Application();
    await app.init({
      width: host.clientWidth || WORLD.w,
      height: host.clientHeight || WORLD.h,
      antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      backgroundColor: C.skyNightTop,
      preference: "webgl",
    });
    try {
      await Promise.all([
        document.fonts.load('700 20px "Barlow Condensed"'),
        document.fonts.load('600 14px "IBM Plex Sans"'),
      ]);
    } catch {
      // fonts fall back, the scene still renders
    }
    host.appendChild(app.canvas);
    const scene = new TowerScene(app, host, opts);
    scene.build();
    scene.fit();
    app.ticker.add((ticker) => scene.tick(ticker.deltaMS));
    return scene;
  }

  private build() {
    this.world.addChild(this.skyG, this.stars, this.moon, this.sun, this.skyline.base, this.skyline.glow, this.shell.back, this.floorsLayer, this.charLayer, this.lift.container, this.shell.front, this.platesLayer, this.nightOverlay, this.hud.container);
    this.app.stage.addChild(this.world);
    this.nightOverlay.rect(BUILDING.interiorX, floorY(6), BUILDING.interiorRight - BUILDING.interiorX, GROUND_Y - floorY(6)).fill({ color: C.skyNightTop, alpha: 1 });
    this.nightOverlay.alpha = 0;
    this.nightOverlay.eventMode = "none";
    this.drawSky(dubaiHour(new Date()), true);
  }

  fit() {
    const w = this.host.clientWidth || WORLD.w;
    const h = this.host.clientHeight || WORLD.h;
    const wide = w / Math.max(1, h) >= 1.25;
    let scale: number;
    let canvasH: number;
    if (wide) {
      scale = Math.min(w / WORLD.w, h / WORLD.h);
      canvasH = h;
      this.world.scale.set(scale);
      this.world.position.set((w - WORLD.w * scale) / 2, (h - WORLD.h * scale) / 2);
    } else {
      // Narrow screens: zoom on the building and let the page scroll vertically
      const focusW = 1080;
      scale = w / focusW;
      canvasH = Math.round(WORLD.h * scale);
      this.world.scale.set(scale);
      this.world.position.set(-(BUILDING.left - 70) * scale, 0);
    }
    this.host.style.height = wide ? "" : `${canvasH}px`;
    this.app.renderer.resize(w, canvasH);
  }

  private drawSky(hour: number, force = false) {
    const bucket = Math.floor(hour * 12); // every 5 minutes
    if (!force && bucket === this.lastSkyDraw) return;
    this.lastSkyDraw = bucket;
    const s = skyAt(hour);
    this.skyG.clear();
    const grad = new FillGradient({
      type: "linear",
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: s.top },
        { offset: 0.7, color: s.bottom },
        { offset: 1, color: s.horizon },
      ],
      textureSpace: "local",
    });
    this.skyG.rect(0, 0, WORLD.w, GROUND_Y).fill(grad);
    this.stars.alpha = Math.max(0, s.darkness - 0.35) / 0.65;
    this.skyline.glow.alpha = 0.25 + s.darkness * 0.75;
    this.shell.facadeGlow.alpha = 0.15 + s.darkness * 0.85;
    this.nightOverlay.alpha = s.darkness * 0.18;
    if (s.moonT !== null) {
      this.moon.visible = true;
      this.sun.visible = false;
      const t = s.moonT;
      this.moon.position.set(1450 - t * 1300, 250 - Math.sin(t * Math.PI) * 185);
    } else if (s.sunT !== null) {
      this.moon.visible = false;
      this.sun.visible = true;
      const t = s.sunT;
      this.sun.position.set(150 + t * 1300, 250 - Math.sin(t * Math.PI) * 185);
    }
    const night = s.darkness > 0.5;
    if (this.night !== night && this.state) {
      this.night = night;
      this.rebuildFloors(this.state);
    }
  }

  private rebuildFloors(state: TowerState) {
    this.floorsLayer.removeChildren();
    this.platesLayer.removeChildren();
    const night = this.night ?? true;
    for (const f of state.floors) {
      const build = buildFloor({ slug: f.slug, name: f.name, level: f.level, status: f.status, unlockRule: f.unlockRule }, night);
      this.floorsLayer.addChild(build.container);
      const plate = floorPlate(f.name, FLOOR_ACCENT[f.slug] ?? C.stone, f.level);
      plate.on("pointertap", () => this.opts.onSelect?.({ type: "floor", slug: f.slug }));
      this.platesLayer.addChild(plate);
      if (f.status === "locked" && f.unlockRule) this.platesLayer.addChild(lockedLabel(f.unlockRule, f.level));
    }
  }

  // Applies a fresh TowerState: creates sprites, updates poses, schedules lift rides for moves.
  applyState(state: TowerState) {
    const first = !this.state;
    this.state = state;
    this.floorsBySlug = new Map(state.floors.map((f) => [f.slug, f]));
    if (first) {
      this.night = skyAt(dubaiHour(new Date())).darkness > 0.5;
      this.rebuildFloors(state);
    }
    const money = state.simulationMode ? state.money.simulated : state.money.real;
    this.hud.set({ netUsd: money.netUsd, spendTodayUsd: money.spendTodayUsd, capUsd: state.budget.dailyCapUsd, level: state.budget.level, simulated: state.simulationMode });

    for (const f of state.floors) {
      const slots = DESK_SLOTS[f.slug] ?? [];
      let deskIndex = 0;
      for (const a of f.agents) {
        this.agentsBySlug.set(a.slug, a);
        let sprite = this.sprites.get(a.id);
        const isWarden = a.kind === "warden";
        if (!sprite) {
          sprite = new CharacterSprite(a.id, a.name, (a.sprite as Look) ?? { hair: 0, glasses: false, mug: false, slouch: false, coat: isWarden, tone: 0 }, isWarden);
          sprite.level = a.locationLevel;
          const home = this.homeX(a, f.slug, deskIndex, slots);
          sprite.position.set(home, floorY(a.locationLevel));
          sprite.on("pointerover", () => {
            sprite!.filters = [this.outline];
            sprite!.showTag(true);
            this.opts.onHover?.(isWarden ? { type: "warden" } : { type: "agent", id: a.id, slug: a.slug });
          });
          sprite.on("pointerout", () => {
            sprite!.filters = [];
            sprite!.showTag(false);
            this.opts.onHover?.(null);
          });
          sprite.on("pointertap", () => this.opts.onSelect?.(isWarden ? { type: "warden" } : { type: "agent", id: a.id, slug: a.slug }));
          this.charLayer.addChild(sprite);
          this.sprites.set(a.id, sprite);
        }
        sprite.setTag(a.name);
        if (!isWarden && a.kind !== "warden" && a.role !== "builder") deskIndex += 1;
        this.applyAgent(sprite, a, f.slug, isWarden);
      }
    }
  }

  private homeX(a: AgentState, floorSlug: string, deskIndex: number, slots: number[]): number {
    if (a.kind === "warden") return PENTHOUSE.deskX - 120;
    if (a.role === "builder") return WORKSHOP.benchX + 34;
    return slots[deskIndex] ?? BUILDING.interiorX + 100 + deskIndex * 120;
  }

  private applyAgent(sprite: CharacterSprite, a: AgentState, floorSlug: string, isWarden: boolean) {
    // Movement between levels rides the lift. Only Warden moves in Phase 2.
    if (sprite.level !== a.locationLevel && !this.lift.isBusy) {
      const targetX = isWarden && a.status === "helping" ? this.blockedWorkerX(a.locationLevel) + 46 : this.homeXFor(a, floorSlug);
      this.lift.request({ rider: sprite, from: sprite.level, to: a.locationLevel, targetX, charLayer: this.charLayer, onArrive: () => this.applyPose(sprite, a, isWarden) });
      return;
    }
    if (this.lift.isBusy && sprite.parent !== this.charLayer) return; // riding right now
    this.applyPose(sprite, a, isWarden);
  }

  private homeXFor(a: AgentState, floorSlug: string): number {
    const floor = this.floorsBySlug.get(floorSlug);
    const slots = DESK_SLOTS[floorSlug] ?? [];
    const workers = (floor?.agents ?? []).filter((x) => x.kind !== "warden" && x.role !== "builder");
    const index = Math.max(0, workers.findIndex((x) => x.id === a.id));
    return this.homeX(a, floorSlug, index, slots);
  }

  private blockedWorkerX(level: number): number {
    for (const s of this.sprites.values()) {
      if (s.level === level && s.pose === "raise") return s.position.x;
    }
    return BUILDING.interiorX + 300;
  }

  private applyPose(sprite: CharacterSprite, a: AgentState, isWarden: boolean) {
    if (isWarden) {
      if (a.status === "helping") {
        sprite.setPose("stand");
        sprite.setBubble(null);
      } else {
        sprite.setPose("pace");
      }
      return;
    }
    const home = this.homeXFor(a, this.floorSlugOf(a));
    let pose: Pose = "sit_idle";
    switch (a.status) {
      case "working":
        pose = "sit_type";
        break;
      case "blocked":
        pose = "raise";
        break;
      case "paused":
      case "offline":
        pose = "dim";
        break;
      default:
        pose = "sit_idle";
    }
    if (pose === "raise") {
      sprite.position.set(home + 58, floorY(a.locationLevel));
      sprite.setFacing(1);
    } else {
      sprite.position.set(home, floorY(a.locationLevel));
      sprite.setFacing(1);
    }
    sprite.setPose(pose);
    sprite.setBubble(pose === "sit_type" && a.currentTask ? a.currentTask.title : null);
  }

  private floorSlugOf(a: AgentState): string {
    for (const f of this.floorsBySlug.values()) if (f.agents.some((x) => x.id === a.id)) return f.slug;
    return "lobby";
  }

  private tick(dtMs: number) {
    if (this.destroyed) return;
    const dt = Math.min(dtMs, 100);
    this.drawSky(dubaiHour(new Date()));
    this.lift.update(dt);
    this.hud.update(dt);
    for (const s of this.sprites.values()) {
      s.update(dt);
      if (s.isWarden && s.pose === "pace") this.paceWarden(s, dt);
    }
  }

  private paceWarden(s: CharacterSprite, dt: number) {
    const now = performance.now();
    if (now < this.wardenPace.pauseUntil) {
      if (s.pose === "pace") s.setPose("look_out");
      return;
    }
    if (s.pose === "look_out") s.setPose("pace");
    const speed = 34; // px per second, a slow pace with hands behind the back
    s.position.x += this.wardenPace.dir * speed * (dt / 1000);
    s.setFacing(this.wardenPace.dir);
    if (s.position.x > PENTHOUSE.paceMax - 220) {
      this.wardenPace.dir = -1;
      this.wardenPace.pauseUntil = now + 1200 + Math.random() * 1500;
    } else if (s.position.x < PENTHOUSE.paceMin) {
      this.wardenPace.dir = 1;
      this.wardenPace.pauseUntil = now + 2500 + Math.random() * 3000; // looks out of the window
    }
  }

  destroy() {
    this.destroyed = true;
    this.app.destroy(true, { children: true });
  }
}

export function agentLevel(slug: string): number {
  return levelOf(slug);
}
