// Orchestrates the building: sky, shell, floors, characters, lift, counters, effects, camera and sound.
import { Application, Container, FillGradient, Graphics, Rectangle } from "pixi.js";
import { OutlineFilter } from "pixi-filters";
import type { TowerState } from "@/lib/state";
import { buildMoon, buildShell, buildSkyline, buildStars, buildSun, type Shell, type Skyline } from "./building";
import { CharacterSprite, type Look, type Pose } from "./character";
import { Ambient, Effects } from "./effects";
import { buildFloor, type FloorBuild } from "./floors";
import { OfficeLife } from "./life";
import { Street } from "./street";
import { NewsSign } from "./news";
import { RunBanner } from "./banner";
import { TradingFloor } from "./trading";
import type { MonitorProp } from "./props";
import type { RunReport } from "@/lib/run-summary";
import { floorPlate, lockedLabel, RoofHud } from "./hud";
import { BUILDING, DESK_SLOTS, GROUND_Y, LIFT_DOOR_X, PENTHOUSE, ROOF_Y, TRADING_SEATS, WORKSHOP, WORLD, floorY } from "./layout";
import { C, FLOOR_ACCENT } from "./palette";
import { Lift } from "./lift";
import { namePlate, speakerSwitch } from "./props";
import { dubaiHour, hazeAt, sandstormAt, skyAt } from "./sky";
import { SoundPack } from "./sound";
import { ease, tween, TweenRunner, wait, type Tween } from "./tween";

export type Selection = { type: "agent"; id: string; slug: string } | { type: "floor"; slug: string } | { type: "warden" } | { type: "ideas" };

export interface SceneOptions {
  onSelect?: (sel: Selection) => void;
  onHover?: (sel: Selection | null) => void;
  onSoundToggle?: (on: boolean) => void;
  lowEffects?: boolean;
  soundEnabled?: boolean;
}

type AgentState = TowerState["floors"][number]["agents"][number];
type FloorState = TowerState["floors"][number];

const NET_COUNTER = { x: 690, y: ROOF_Y - 50, w: 250, h: 70, left: 560, top: ROOF_Y - 88 };
const CASH_COUNTER = { x: 980, top: floorY(0) - 118, land: floorY(0) - 66 };

export class TowerScene {
  readonly app: Application;
  private readonly host: HTMLElement;
  private readonly world = new Container();
  private readonly skyG = new Graphics();
  private readonly stars = buildStars();
  private readonly moon = buildMoon();
  private readonly sun = buildSun();
  private readonly skyline: Skyline = buildSkyline();
  private readonly shell: Shell;
  private readonly floorsLayer = new Container();
  private readonly deskLayer = new Container();
  private readonly charLayer = new Container();
  // Desk fronts, over the seated workers: they sit behind their desks with only the chest up showing.
  private readonly deskFrontLayer = new Container();
  private readonly tintLayer = new Container();
  private readonly lift = new Lift();
  private readonly hud = new RoofHud();
  private readonly platesLayer = new Container();
  private readonly nightOverlay = new Graphics();
  private readonly hazeOverlay = new Graphics();
  private readonly sandOverlay = new Graphics();
  private readonly effects = new Effects();
  private ambient: Ambient;
  private readonly sound = new SoundPack();
  private speaker = new Graphics();
  private readonly sprites = new Map<string, CharacterSprite>();
  private readonly plates = new Map<string, { node: Container; name: string }>();
  private floorBuilds = new Map<string, FloorBuild>();
  private floorsBySlug = new Map<string, FloorState>();
  private agentsById = new Map<string, AgentState>();
  private prev: { tasksDone: Map<string, number>; revenue: number; level: number; net: number } | null = null;
  private night: boolean | null = null;
  private lastSkyDraw = -1;
  private state: TowerState | null = null;
  private wardenPace = { dir: 1, pauseUntil: 0, mode: "calm" as "calm" | "fast" };
  private opts: SceneOptions;
  private destroyed = false;
  private lowEffects: boolean;
  private readonly outline = new OutlineFilter({ thickness: 2, color: C.glow, alpha: 0.9 });
  private readonly runner = new TweenRunner();
  private readonly life: OfficeLife;
  private readonly street = new Street();
  private readonly news = new NewsSign();
  private readonly banner = new RunBanner();
  private readonly trading: TradingFloor;
  private screensAt = 0;
  private readonly screenLit = new Map<MonitorProp, boolean>();
  private clockAt = 0;
  private base = { scale: 1, x: 0, y: 0, wide: true, w: WORLD.w, h: WORLD.h };
  private cam = { zoom: 1, cx: WORLD.w / 2, cy: WORLD.h / 2, focused: null as number | null };
  private camTween: Tween | null = null;
  private pan = { active: false, startX: 0, startWorldX: 0 };
  private lowBanner: Container | null = null;
  private inset = 0; // screen pixels a panel takes on the right, the building slides over to stay in view
  private insetGen = 0;
  private selectedId: string | null = null;

  private constructor(app: Application, host: HTMLElement, opts: SceneOptions) {
    this.app = app;
    this.host = host;
    this.opts = opts;
    this.lowEffects = !!opts.lowEffects;
    this.shell = buildShell();
    this.ambient = new Ambient([], this.skyline.glowNear, () => this.night ?? true);
    this.ambient.setCityCells(this.skyline.cells);
    this.life = new OfficeLife({
      sprites: this.sprites,
      agent: (id) => this.agentsById.get(id),
      floors: () => [...this.floorsBySlug.values()],
      build: (slug) => this.floorBuilds.get(slug),
      homeX: (a, slug) => this.homeX(a, slug),
      restore: (sprite) => this.restoreSprite(sprite),
      lift: this.lift,
      charLayer: this.charLayer,
      runner: this.runner,
    });
    this.trading = new TradingFloor({
      sprite: (slug) => this.spriteBySlug(slug),
      restore: (sprite) => this.restoreSprite(sprite),
      runner: this.runner,
      effects: this.effects,
      sound: this.sound,
      lowEffects: () => this.lowEffects,
    });
  }

  private spriteBySlug(slug: string): CharacterSprite | undefined {
    for (const a of this.agentsById.values()) if (a.slug === slug) return this.sprites.get(a.id);
    return undefined;
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
      await Promise.all([document.fonts.load('700 20px "Barlow Condensed"'), document.fonts.load('600 14px "IBM Plex Sans"')]);
    } catch {
      // fonts fall back, the scene still renders
    }
    host.appendChild(app.canvas);
    const scene = new TowerScene(app, host, opts);
    scene.build();
    scene.fit();
    scene.sound.setEnabled(!!opts.soundEnabled);
    app.ticker.add((ticker) => scene.tick(ticker.deltaMS));
    return scene;
  }

  private build() {
    this.world.addChild(
      this.skyG, this.stars, this.moon, this.sun, this.street.sky,
      this.skyline.far, this.skyline.near,
      this.shell.back, this.street.facade, this.news.container, this.lift.back, this.floorsLayer, this.charLayer, this.deskFrontLayer, this.deskLayer, this.ambient.layer,
      this.tintLayer, this.lift.container, this.shell.front, this.platesLayer, this.street.layer,
      this.nightOverlay, this.hazeOverlay, this.sandOverlay, this.effects.layer, this.hud.container, this.banner.container, this.speaker,
    );
    this.app.stage.addChild(this.world);
    this.charLayer.sortableChildren = true;
    this.hud.onIdeas = () => this.opts.onSelect?.({ type: "ideas" });
    this.nightOverlay.rect(BUILDING.interiorX, ROOF_Y, BUILDING.interiorRight - BUILDING.interiorX, GROUND_Y - ROOF_Y).fill(C.skyNightTop);
    this.nightOverlay.alpha = 0;
    this.nightOverlay.eventMode = "none";
    this.hazeOverlay.rect(0, 0, WORLD.w, GROUND_Y).fill(0xe0c08a);
    this.hazeOverlay.alpha = 0;
    this.hazeOverlay.eventMode = "none";
    this.sandOverlay.rect(0, 0, WORLD.w, WORLD.h).fill(0xc9a15e);
    this.sandOverlay.alpha = 0;
    this.sandOverlay.eventMode = "none";
    this.lift.onChime = () => this.sound.liftChime();
    this.effects.onCoin = () => this.sound.coinClink();
    this.drawSpeaker();
    this.drawSky(dubaiHour(new Date()), true);
    // pan by dragging on narrow screens
    const canvas = this.app.canvas;
    canvas.addEventListener("pointerdown", (e) => {
      if (this.base.wide) return;
      this.pan = { active: true, startX: e.clientX, startWorldX: this.world.position.x };
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.pan.active) return;
      const x = this.pan.startWorldX + (e.clientX - this.pan.startX);
      this.world.position.x = this.clampPanX(x);
      this.applyParallax();
    });
    const end = () => (this.pan.active = false);
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("pointerleave", end);
  }

  private drawSpeaker() {
    this.speaker.removeChildren();
    const g = speakerSwitch(BUILDING.right - 20, ROOF_Y - 10, this.sound.enabled);
    g.eventMode = "static";
    g.cursor = "pointer";
    g.on("pointertap", () => this.setSound(!this.sound.enabled, true));
    this.speaker.addChild(g);
  }

  setSound(on: boolean, fromUser = false) {
    this.sound.setEnabled(on);
    this.drawSpeaker();
    if (fromUser) this.opts.onSoundToggle?.(on);
  }

  setLowEffects(on: boolean) {
    this.lowEffects = on;
    this.ambient.layer.visible = !on;
    this.street.layer.visible = !on;
    this.street.sky.visible = !on;
    if (on) this.street.facade.visible = false;
    if (on) {
      this.hazeOverlay.alpha = 0;
      this.sandOverlay.alpha = 0;
      this.skyline.far.position.set(0, 0);
      this.skyline.near.position.set(0, 0);
    }
  }

  // Fits the world to the host. Wide screens see the whole tower. Narrow screens get a zoomed
  // building that scrolls vertically with the page and pans sideways by dragging.
  fit() {
    const w = this.host.clientWidth || WORLD.w;
    const h = this.host.clientHeight || WORLD.h;
    const wide = w / Math.max(1, h) >= 1.25;
    if (wide) {
      const scale = Math.min(w / WORLD.w, h / WORLD.h);
      this.base = { scale, x: (w - WORLD.w * scale) / 2, y: (h - WORLD.h * scale) / 2, wide, w, h };
      this.host.style.height = "";
      this.app.renderer.resize(w, h);
    } else {
      const scale = w / 480;
      const canvasH = Math.round((WORLD.h - 40) * scale);
      this.base = { scale, x: w / 2 - 800 * scale, y: -40 * scale, wide, w, h: canvasH };
      this.host.style.height = `${canvasH}px`;
      this.app.renderer.resize(w, canvasH);
    }
    this.cam = { zoom: 1, cx: WORLD.w / 2, cy: WORLD.h / 2, focused: null };
    this.applyCamera();
  }

  private clampPanX(x: number): number {
    const s = this.world.scale.x;
    const minX = this.base.w - (BUILDING.right + 90) * s;
    const maxX = -(BUILDING.left - 90) * s;
    return Math.max(minX, Math.min(maxX, x));
  }

  private applyCamera() {
    const s = this.base.scale * this.cam.zoom;
    this.world.scale.set(s);
    const inset = this.base.wide ? this.inset : 0;
    if (this.cam.zoom === 1) {
      this.world.position.set(this.base.x - inset / 2, this.base.y);
    } else {
      const cx = (this.base.w - inset) / 2;
      const cy = this.base.h / 2;
      this.world.position.set(cx - this.cam.cx * s, cy - this.cam.cy * s);
    }
    this.applyParallax();
  }

  // A panel opened or closed on the right: ease the building over so it stays in view.
  setInset(px: number) {
    const from = this.inset;
    const gen = ++this.insetGen; // a newer call takes over, the older tween goes quiet
    this.runner.add(tween(420, (t) => {
      if (gen !== this.insetGen) return;
      this.inset = from + (px - from) * t;
      this.applyCamera();
    }, ease.inOut));
  }

  // Keeps the outline and name tag on the character whose panel is open.
  highlightAgent(id: string | null) {
    const prev = this.selectedId ? this.sprites.get(this.selectedId) : undefined;
    this.selectedId = id;
    if (prev) {
      prev.filters = [];
      prev.showTag(false);
    }
    const next = id ? this.sprites.get(id) : undefined;
    if (next) {
      next.filters = [this.outline];
      next.showTag(true);
    }
  }

  // A standing portrait of one character, rendered off screen for the panel.
  async portrait(agentId: string): Promise<string | null> {
    const a = this.agentsById.get(agentId);
    if (!a || this.destroyed) return null;
    const isWarden = a.kind === "warden";
    const frame = new Container();
    const rig = new CharacterSprite(a.id, a.name, (a.sprite as Look) ?? { hair: 0, glasses: false, mug: false, slouch: false, coat: isWarden, tone: 0 }, isWarden);
    rig.setPose("stand");
    rig.showTag(false);
    rig.position.set(40, 94);
    frame.addChild(rig);
    try {
      return await this.app.renderer.extract.base64({ target: frame, frame: new Rectangle(0, 0, 80, 100), resolution: 3 });
    } catch {
      return null;
    } finally {
      frame.destroy({ children: true });
    }
  }

  private applyParallax() {
    if (this.lowEffects) return;
    const s = this.world.scale.x;
    const dx = (this.world.position.x - this.base.x) / s;
    const dy = (this.world.position.y - this.base.y) / s;
    this.skyline.far.position.set(-dx * 0.55, -dy * 0.35);
    this.skyline.near.position.set(-dx * 0.3, -dy * 0.2);
  }

  // Click a floor plate: the camera eases in on that floor. Click again or press Escape to return.
  focusFloor(level: number | null) {
    if (level === this.cam.focused) level = null;
    const from = { zoom: this.cam.zoom, cx: this.cam.cx, cy: this.cam.cy };
    const to = level === null
      ? { zoom: 1, cx: WORLD.w / 2, cy: WORLD.h / 2 }
      : { zoom: this.base.wide ? 1.55 : 1.25, cx: (BUILDING.left + BUILDING.right) / 2, cy: floorY(level) - 56 };
    this.cam.focused = level;
    this.camTween = tween(650, (t) => {
      this.cam.zoom = from.zoom + (to.zoom - from.zoom) * t;
      this.cam.cx = from.cx + (to.cx - from.cx) * t;
      this.cam.cy = from.cy + (to.cy - from.cy) * t;
      this.applyCamera();
    }, ease.inOut, () => (this.camTween = null));
  }

  private nudge() {
    const start = this.cam.zoom;
    this.runner.add(tween(420, (t) => {
      this.cam.zoom = start + Math.sin(t * Math.PI) * 0.025;
      this.applyCamera();
    }, ease.linear));
  }

  private drawSky(hour: number, force = false) {
    const bucket = Math.floor(hour * 12);
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
    this.skyline.glowFar.alpha = 0.25 + s.darkness * 0.75;
    this.skyline.glowNear.alpha = 0.25 + s.darkness * 0.75;
    this.shell.facadeGlow.alpha = 0.15 + s.darkness * 0.85;
    this.nightOverlay.alpha = s.darkness * 0.18;
    if (!this.lowEffects) {
      this.hazeOverlay.alpha = hazeAt(hour);
      this.sandOverlay.alpha = this.state ? sandstormAt(this.state.dubai.dayKey, hour) : 0;
    }
    if (s.moonT !== null) {
      this.moon.visible = true;
      this.sun.visible = false;
      const t = s.moonT;
      this.moon.position.set(1450 - t * 1300, 230 - Math.sin(t * Math.PI) * 200);
    } else if (s.sunT !== null) {
      this.moon.visible = false;
      this.sun.visible = true;
      const t = s.sunT;
      this.sun.position.set(150 + t * 1300, 230 - Math.sin(t * Math.PI) * 200);
    }
    const night = s.darkness > 0.5;
    if (this.night !== night && this.state) {
      this.night = night;
      this.rebuildFloors(this.state);
    }
  }

  private rebuildFloors(state: TowerState) {
    this.floorsLayer.removeChildren();
    this.deskFrontLayer.removeChildren();
    this.platesLayer.removeChildren();
    this.tintLayer.removeChildren();
    this.floorBuilds.clear();
    const night = this.night ?? true;
    for (const f of state.floors) {
      const build = buildFloor({ slug: f.slug, name: f.name, level: f.level, status: f.status, unlockRule: f.unlockRule }, night);
      this.floorsLayer.addChild(build.container);
      this.deskFrontLayer.addChild(build.front);
      this.tintLayer.addChild(build.tint);
      if (build.board && f.board) build.board.set(f.board);
      this.floorBuilds.set(f.slug, build);
      const plate = floorPlate(f.name, FLOOR_ACCENT[f.slug] ?? C.stone, f.level);
      plate.on("pointertap", () => {
        this.focusFloor(f.level);
        this.opts.onSelect?.({ type: "floor", slug: f.slug });
      });
      this.platesLayer.addChild(plate);
      if (f.status === "locked" && f.unlockRule) this.platesLayer.addChild(lockedLabel(f.unlockRule, f.level));
    }
    this.ambient.setFloors([...this.floorBuilds.values()]);
    this.trading.attach(this.floorBuilds.get("trading")?.trading);
    // desk lamps follow the current blocked state
    for (const a of this.agentsById.values()) this.setDeskLamp(a);
  }

  private floorSlugOf(a: AgentState): string {
    for (const f of this.floorsBySlug.values()) if (f.agents.some((x) => x.id === a.id)) return f.slug;
    return "lobby";
  }

  private homeX(a: AgentState, floorSlug: string): number {
    if (a.kind === "warden") return PENTHOUSE.deskX - 200;
    if (a.role === "builder") return WORKSHOP.benchX + 34;
    if (floorSlug === "trading" && TRADING_SEATS[a.slug] !== undefined) return TRADING_SEATS[a.slug]!;
    const floor = this.floorsBySlug.get(floorSlug);
    const slots = DESK_SLOTS[floorSlug] ?? [];
    const workers = (floor?.agents ?? []).filter((x) => x.kind !== "warden" && x.role !== "builder");
    const index = Math.max(0, workers.findIndex((x) => x.id === a.id));
    return slots[index] ?? BUILDING.interiorX + 100 + index * 120;
  }

  private setDeskLamp(a: AgentState) {
    const slug = this.floorSlugOf(a);
    const build = this.floorBuilds.get(slug);
    if (!build || a.kind === "warden" || a.role === "builder") return;
    const lamp = build.lamps.get(this.homeX(a, slug));
    lamp?.setOn(a.status === "blocked");
  }

  private ensurePlate(a: AgentState, floorSlug: string) {
    if (a.kind === "warden" || a.role === "builder") return;
    const existing = this.plates.get(a.id);
    if (existing && existing.name === a.name) return;
    existing?.node.destroy();
    const node = namePlate(this.homeX(a, floorSlug) - 22, floorY(a.locationLevel) - 21, a.name);
    this.deskLayer.addChild(node);
    this.plates.set(a.id, { node, name: a.name });
  }

  // Applies a fresh TowerState: creates sprites, updates poses, schedules lift rides, fires event effects.
  applyState(state: TowerState) {
    const first = !this.state;
    this.state = state;
    this.floorsBySlug = new Map(state.floors.map((f) => [f.slug, f]));
    if (first) {
      this.night = skyAt(dubaiHour(new Date())).darkness > 0.5;
      this.rebuildFloors(state);
    }
    const money = state.simulationMode ? state.money.simulated : state.money.real;
    this.news.setNews(this.newsLines(state, money.spendTodayUsd));
    this.hud.set({ netUsd: money.netUsd, spendTodayUsd: money.spendTodayUsd, capUsd: state.budget.dailyCapUsd, level: state.budget.level, simulated: state.simulationMode });

    const tasksDone = new Map<string, number>();
    for (const f of state.floors) {
      const capHit = f.status === "paused" && !!f.pausedReason && /cap/i.test(f.pausedReason);
      const build = this.floorBuilds.get(f.slug);
      if (build) build.tint.alpha = capHit ? 0.22 : 0;
      if (build?.board && f.board) build.board.set(f.board);
      for (const a of f.agents) {
        this.agentsById.set(a.id, a);
        tasksDone.set(a.id, a.stats.tasksDone);
        let sprite = this.sprites.get(a.id);
        const isWarden = a.kind === "warden";
        if (!sprite) {
          sprite = new CharacterSprite(a.id, a.name, (a.sprite as Look) ?? { hair: 0, glasses: false, mug: false, slouch: false, coat: isWarden, tone: 0 }, isWarden);
          sprite.level = a.locationLevel;
          sprite.position.set(this.homeX(a, f.slug), floorY(a.locationLevel));
          const sp = sprite;
          sprite.on("pointerover", () => {
            sp.filters = [this.outline];
            sp.showTag(true);
            this.opts.onHover?.(isWarden ? { type: "warden" } : { type: "agent", id: a.id, slug: a.slug });
          });
          sprite.on("pointerout", () => {
            const keep = this.selectedId === a.id;
            sp.filters = keep ? [this.outline] : [];
            sp.showTag(keep);
            this.opts.onHover?.(null);
          });
          sprite.on("pointertap", () => this.opts.onSelect?.(isWarden ? { type: "warden" } : { type: "agent", id: a.id, slug: a.slug }));
          this.charLayer.addChild(sprite);
          this.sprites.set(a.id, sprite);
        }
        sprite.setTag(a.name);
        this.ensurePlate(a, f.slug);
        this.setDeskLamp(a);
        this.applyAgent(sprite, a, f.slug, isWarden, capHit);
        sprite.setBulb((a.waitingOnOwner ?? 0) > 0);
        // finished tasks fly to the roof
        const before = this.prev?.tasksDone.get(a.id);
        if (before !== undefined && a.stats.tasksDone > before) {
          if (!this.lowEffects) this.effects.paperFlight(sprite.position.x, sprite.position.y - sprite.bodyHeight, NET_COUNTER.x, NET_COUNTER.y, () => this.effects.flash(NET_COUNTER.left, NET_COUNTER.top, NET_COUNTER.w, NET_COUNTER.h));
          if (!isWarden) this.life.cheer(sprite, performance.now());
        }
      }
    }
    // Wall Street's show follows its own feed (D075)
    this.trading.setView(state.trading);
    // lift indicator blinks for a floor with a blocked worker
    const blocked = state.floors.find((f) => f.agents.some((a) => a.status === "blocked"));
    this.lift.setHighlight(blocked && !this.wardenIsHelping(state) ? blocked.level : null);
    // money and level events
    if (this.prev) {
      if (money.verifiedRevenueUsd > this.prev.revenue + 0.001 && !this.lowEffects) this.effects.coinDrop(CASH_COUNTER.x, CASH_COUNTER.top, CASH_COUNTER.land);
      if (state.budget.level > this.prev.level) {
        this.sound.fanfare();
        this.nudge();
        this.effects.flash(1030, ROOF_Y - 62, 200, 50);
      }
      if (Math.abs(money.netUsd - this.prev.net) > 0.001) this.effects.flash(NET_COUNTER.left, NET_COUNTER.top, NET_COUNTER.w, NET_COUNTER.h);
    }
    this.prev = { tasksDone, revenue: money.verifiedRevenueUsd, level: state.budget.level, net: money.netUsd };
    this.wardenPace.mode = state.floors.some((f) => f.behindTarget && f.status !== "locked") ? "fast" : "calm";
  }

  private wardenIsHelping(state: TowerState): boolean {
    return state.floors.some((f) => f.agents.some((a) => a.kind === "warden" && a.status === "helping"));
  }

  private applyAgent(sprite: CharacterSprite, a: AgentState, floorSlug: string, isWarden: boolean, capHit: boolean) {
    if (sprite.away) return; // on an errand: office life hands it back when it returns
    if (sprite.level !== a.locationLevel && !this.lift.isBusy) {
      const targetX = isWarden && a.status === "helping" ? this.blockedWorkerX(a.locationLevel) + 52 : this.homeX(a, floorSlug);
      sprite.busyUntil = performance.now() + 30000;
      this.lift.request({ rider: sprite, from: sprite.level, to: a.locationLevel, targetX, charLayer: this.charLayer, onArrive: () => {
        sprite.busyUntil = 0;
        this.applyPose(sprite, a, isWarden, capHit);
      } });
      return;
    }
    if (this.lift.isBusy && sprite.parent !== this.charLayer) return;
    if (sprite.busyUntil > performance.now()) return; // mid gesture, the director restores the pose after
    this.applyPose(sprite, a, isWarden, capHit);
  }

  private blockedWorkerX(level: number): number {
    for (const s of this.sprites.values()) if (s.level === level && s.pose === "raise") return s.position.x;
    return BUILDING.interiorX + 300;
  }

  private applyPose(sprite: CharacterSprite, a: AgentState, isWarden: boolean, capHit: boolean) {
    if (isWarden) {
      if (a.status === "helping") {
        sprite.setPose("stand");
        sprite.setBubble(null);
      } else if (sprite.pose !== "pace" && sprite.pose !== "look_out" && sprite.pose !== "coffee") {
        sprite.setPose("pace");
      }
      return;
    }
    const home = this.homeX(a, this.floorSlugOf(a));
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
        pose = capHit ? "feet_up" : "dim";
        break;
      default:
        pose = capHit ? "feet_up" : "sit_idle";
    }
    // Lazy Larry holds the index and sleeps through everything; the Strategist stands in the pit by the big screen
    if (a.slug === "trading_larry" && pose !== "dim") pose = "asleep";
    if (a.slug === "trading_strategist") pose = "stand";
    sprite.position.set(pose === "raise" ? home + 58 : home, floorY(a.locationLevel));
    sprite.setFacing(1);
    sprite.setPose(pose);
    if (pose === "sit_type" && a.currentTask) sprite.setBubble(a.currentTask.title, "task");
    else if (pose === "raise") sprite.setBubble("Need help", "alert");
    else sprite.setBubble(null);
  }

  // Puts a sprite back to what the state says: its desk, its pose, its task label.
  private restoreSprite(sprite: CharacterSprite) {
    const a = this.agentsById.get(sprite.agentId);
    if (!a) return;
    const slug = this.floorSlugOf(a);
    const f = this.floorsBySlug.get(slug);
    const capHit = !!f && f.status === "paused" && !!f.pausedReason && /cap/i.test(f.pausedReason);
    this.applyAgent(sprite, a, slug, sprite.isWarden, capHit);
  }

  // What the LED sign in the plaza scrolls: the latest things the floors did, then today's spend.
  private newsLines(state: TowerState, spendTodayUsd: number): string[] {
    const lines = state.recentEvents
      .filter((e) => e.type !== "log" || /back at work|found|drafted|sent|replied|approved/i.test(e.message))
      .slice(0, 8)
      .map((e) => e.message);
    lines.push(`Spend today ${spendTodayUsd.toFixed(2)} of ${state.budget.dailyCapUsd.toFixed(2)} USD`);
    if (state.pendingApprovals) lines.push(`${state.pendingApprovals} waiting on the red phone`);
    return lines;
  }

  // The owner pressed Run the Tower now: a bell, the lights come up floor by floor, the Warden calls
  // everyone and heads down, and the banner says the Tower is working.
  runStarted() {
    if (this.destroyed) return;
    this.sound.bell();
    this.banner.showWorking();
    this.life.runStarted(performance.now());
    if (this.lowEffects || !this.state) return;
    const floors = [...this.state.floors].filter((f) => f.status !== "locked").sort((a, b) => a.level - b.level);
    floors.forEach((f, i) => {
      this.runner.add(this.sequenceOf([() => wait(120 + i * 150)], () => {
        const y = floorY(f.level);
        this.effects.flash(BUILDING.interiorX, y - 106, BUILDING.interiorRight - BUILDING.interiorX, 106, C.interiorLight);
      }));
    });
  }

  // The run came back: the banner says what happened, in the same words as the panel.
  runFinished(report: RunReport) {
    if (this.destroyed) return;
    this.banner.show(report.headline, report.sub, report.capped ? "cap" : /at work|back at work/.test(report.headline) ? "work" : "info");
    if (report.capped) this.life.runCapped(performance.now());
    else if (/at work/.test(report.headline)) this.sound.fanfare();
  }

  private sequenceOf(steps: Array<() => { update(dt: number): boolean }>, onDone: () => void) {
    let index = 0;
    let current: { update(dt: number): boolean } | null = null;
    return {
      update: (dt: number) => {
        if (!current) {
          const step = steps[index];
          if (!step) { onDone(); return true; }
          current = step();
        }
        if (current.update(dt)) {
          current = null;
          index += 1;
          if (index >= steps.length) { onDone(); return true; }
        }
        return false;
      },
    };
  }

  // Each desk's monitor follows its worker: dark when the floor is paused or the worker is away from
  // work, lit at the desk, and scrolling while the hands are on the keys.
  private updateScreens(now: number) {
    if (now < this.screensAt) return;
    this.screensAt = now + 240;
    for (const [id, s] of this.sprites) {
      const a = this.agentsById.get(id);
      if (!a || s.isWarden || a.role === "builder") continue;
      const slug = this.floorSlugOf(a);
      const f = this.floorsBySlug.get(slug);
      const m = this.floorBuilds.get(slug)?.monitorAt.get(this.homeX(a, slug));
      if (!m || !f) continue;
      if (s.keysActive) {
        m.redraw(Math.floor(Math.random() * 1e9), true);
        this.screenLit.set(m, true);
        continue;
      }
      const lit = f.status === "live" && a.status !== "paused" && a.status !== "offline";
      if (this.screenLit.get(m) !== lit) {
        m.redraw(id.length * 7919, lit);
        this.screenLit.set(m, lit);
      }
    }
  }

  private updateClocks(now: number) {
    if (now < this.clockAt) return;
    this.clockAt = now + 1000;
    const d = new Date(Date.now() + 4 * 3600 * 1000);
    for (const b of this.floorBuilds.values()) for (const c of b.clocks) c.set(d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
  }

  private tick(dtMs: number) {
    if (this.destroyed) return;
    const dt = Math.min(dtMs, 100);
    const now = performance.now();
    this.drawSky(dubaiHour(new Date()));
    this.lift.update(dt);
    this.hud.update(dt);
    this.effects.update(dt);
    this.runner.update(dt);
    if (this.camTween && this.camTween.update(dt)) this.camTween = null;
    let typing = 0;
    for (const s of this.sprites.values()) {
      s.update(dt);
      if (s.keysActive) typing += 1;
      if (s.isWarden && !s.away && (s.pose === "pace" || s.pose === "look_out" || s.pose === "coffee")) this.paceWarden(s, dt, now);
    }
    for (const b of this.floorBuilds.values()) for (const e of b.extras) e.update(dt);
    // visitors and anyone else office life put in the building
    for (const child of this.charLayer.children) if (child instanceof CharacterSprite && !this.sprites.has(child.agentId)) child.update(dt);
    this.life.update(now);
    this.updateScreens(now);
    this.updateClocks(now);
    this.news.update(dt);
    this.banner.update(dt);
    this.trading.update(dt);
    if (!this.lowEffects) {
      const hour = dubaiHour(new Date());
      this.street.update(dt, { day: hour >= 7 && hour < 17.5, night: (this.night ?? false) });
    }
    this.sound.keys(typing, now);
    if (!this.lowEffects) {
      const mugs: { x: number; y: number }[] = [];
      for (const [id, s] of this.sprites) {
        const a = this.agentsById.get(id);
        if (!a || !s.look.mug || s.pose === "walk" || s.pose === "raise") continue;
        mugs.push({ x: s.position.x - 26, y: s.position.y - 44 });
      }
      this.ambient.update(dt, mugs);
    }
  }

  private paceWarden(s: CharacterSprite, dt: number, now: number) {
    if (now < this.wardenPace.pauseUntil) return;
    if (s.pose !== "pace") s.setPose("pace");
    const fast = this.wardenPace.mode === "fast";
    const speed = fast ? 44 : 22;
    s.position.x += this.wardenPace.dir * speed * (dt / 1000);
    s.setFacing(this.wardenPace.dir);
    if (s.position.x > PENTHOUSE.paceMax) {
      this.wardenPace.dir = -1;
      this.wardenPace.pauseUntil = now + (fast ? 400 : 1500);
    } else if (s.position.x < PENTHOUSE.paceMin) {
      this.wardenPace.dir = 1;
      // at the window: a long look when things are tense, a coffee when the floors are ahead
      const pause = fast ? 1800 : 4500 + Math.random() * 3000;
      this.wardenPace.pauseUntil = now + pause;
      s.setPose(fast ? "look_out" : "coffee");
    }
  }

  destroy() {
    this.destroyed = true;
    this.sound.setEnabled(false);
    this.app.destroy(true, { children: true });
  }
}

export const liftDoorX = LIFT_DOOR_X;
