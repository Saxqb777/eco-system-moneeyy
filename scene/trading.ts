// Wall Street's director (D075): turns the floor's events into a show. A meeting walks Bull and Bear into the
// pit to argue in their own words and the Chief stamps BUY or PASS; Risk stamps a red VETO; a win rings the
// till and rains coins on the race board; a stop loss sounds the alarm; the bell rings at the US open.
// Between events the crew chatters: the Quant scans, the Hound works the phone, Larry snores.
import type { Container } from "pixi.js";
import type { TradingEvent, TradingStateView } from "@/trading/view";
import type { CharacterSprite } from "./character";
import type { Effects } from "./effects";
import type { TradingProps } from "./floors";
import { BUILDING, TRADING_PIT, TRADING_SEATS } from "./layout";
import type { SoundPack } from "./sound";
import { LED, stampText } from "./trading-props";
import { ease, sequence, tween, wait, type Tween, type TweenRunner } from "./tween";

export interface TradingHost {
  sprite(slug: string): CharacterSprite | undefined;
  restore(s: CharacterSprite): void;
  runner: TweenRunner;
  effects: Effects;
  sound: SoundPack;
  lowEffects(): boolean;
}

const WALK = 95;
const clip = (s: unknown, n: number) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const short = (sym: unknown) => String(sym ?? "").replace("/USD", "");

// Plain lines for quiet moments. No dashes (rule 7).
const CHATTER: Record<string, string[]> = {
  trading_quant: ["Scanning 32 symbols", "Volume looks thin", "Nothing over the bar yet", "Watching the 5 minute bars"],
  trading_news: ["Reading the wires", "Checking the headlines", "Any earnings tonight?", "Watching the Fed calendar"],
  trading_risk: ["Every trade has a stop", "Size small, stay alive", "No borrowing on this floor"],
  trading_runner: ["Stops are in", "Checking the fills", "Order tickets ready"],
  trading_coach: ["Patience pays", "Judge the reason, not the result", "Most signals are noise"],
  trading_bull: ["This market wants higher", "Buy the breakout", "Trend is your friend"],
  trading_bear: ["Something feels off", "Too far, too fast", "Cash is a position too"],
  trading_chief: ["Show me a clean setup", "We beat Larry or we go home"],
};

export class TradingFloor {
  private props: TradingProps | null = null;
  private view: TradingStateView | null = null;
  private lastId: number | null = null;
  private queue: TradingEvent[] = [];
  private busyUntil = 0;
  private chatterAt = 0;
  private larryAt = 0;
  private wallAt = 0;
  private wallIndex = 0;
  // the director's own clock: the sum of frame times, so a slow device slows the show instead of cutting it short
  private t = 0;
  private seq = 0;
  private readonly owners = new WeakMap<CharacterSprite, number>();

  constructor(private readonly host: TradingHost) {}

  // The floor was (re)built, for example at nightfall: new props, same show.
  attach(props: TradingProps | undefined) {
    this.props = props ?? null;
    if (this.props && this.view) this.paint(this.view);
  }

  setView(view: TradingStateView | null | undefined) {
    if (!view) return;
    const now = this.t;
    this.view = view;
    if (this.props) this.paint(view);
    const events = [...view.events].sort((a, b) => a.id - b.id);
    if (this.lastId === null) {
      // first look: replay the latest two so the floor is not still on arrival
      this.lastId = events.length ? events[events.length - 1]!.id : 0;
      this.queue.push(...events.slice(-2));
      this.busyUntil = now + 2500;
      return;
    }
    for (const e of events) if (e.id > this.lastId) this.queue.push(e);
    if (events.length) this.lastId = Math.max(this.lastId, events[events.length - 1]!.id);
    if (this.queue.length > 6) this.queue = this.queue.slice(-6);
  }

  private paint(view: TradingStateView) {
    const p = this.props!;
    p.tape.setItems(view.tape);
    const status = view.status;
    const footer = status ? `PAPER MONEY  ${status.stocksOpen ? "STOCKS OPEN" : "CRYPTO ONLY"}` : "PAPER MONEY";
    p.board.set(view.desks.map((d) => ({ name: d.name, pnlPct: d.pnlPct, status: d.status, hold: d.style === "hold" })), footer);
  }

  update(dt: number) {
    this.t += dt;
    const now = this.t;
    const p = this.props;
    if (!p) return;
    p.tape.update(dt);
    p.board.update(dt);
    p.wall.update(dt);
    if (now > this.wallAt && this.view) {
      this.wallAt = now + 9000;
      const picks = ["SPY", "BTC", "NVDA", "ETH"].map((s) => this.view!.tape.find((t) => t.s === s)).filter((t): t is NonNullable<typeof t> => !!t);
      const t = picks[this.wallIndex++ % Math.max(1, picks.length)];
      if (t) p.wall.setQuote(t.s === "SPY" ? "S&P 500" : t.s === "BTC" ? "BITCOIN" : t.s, t.p, t.chg);
      else p.wall.setQuote("MARKET", null, null);
    }
    if (now < this.busyUntil) return;
    const next = this.queue.shift();
    if (next) {
      this.busyUntil = now + this.play(next, now);
      return;
    }
    if (now > this.chatterAt) {
      this.chatterAt = now + 5000 + Math.random() * 6000;
      this.chatter(now);
    }
    if (now > this.larryAt) {
      this.larryAt = now + 40000 + Math.random() * 30000;
      const larry = this.host.sprite("trading_larry");
      if (larry && !larry.away) this.say(larry, Math.random() < 0.5 ? "Zzz... holding SPY" : "Zzz... buy and hold", 3500, now);
    }
  }

  // Takes a sprite for a while: the state refresh leaves it alone until the show hands it back. The latest
  // holder wins; an older release does nothing.
  private hold(s: CharacterSprite, ms: number): number {
    const tok = ++this.seq;
    this.owners.set(s, tok);
    s.busyUntil = performance.now() + ms * 3 + 3000;
    return tok;
  }

  private release(s: CharacterSprite, tok: number) {
    if (this.owners.get(s) !== tok) return;
    s.busyUntil = 0;
    s.setBubble(null);
    this.host.restore(s);
  }

  // Shows a bubble for a while, then hands the sprite back to what the state says.
  private say(s: CharacterSprite, text: string, ms: number, _now: number, style: "task" | "alert" | "chat" = "chat") {
    const tok = this.hold(s, ms);
    s.setBubble(text, style);
    this.host.runner.add(sequence([() => wait(ms)], () => this.release(s, tok)));
  }

  private cheer(s: CharacterSprite, ms: number) {
    const tok = this.hold(s, ms);
    s.setPose("cheer");
    this.host.runner.add(sequence([() => wait(ms)], () => this.release(s, tok)));
  }

  private walk(s: CharacterSprite, x: number): Tween {
    const startX = s.position.x;
    const y = s.position.y;
    const dist = Math.abs(x - startX);
    if (dist < 2) return wait(1);
    s.setPose("walk");
    s.setFacing(x > startX ? 1 : -1);
    return tween((dist / WALK) * 1000, (t) => s.position.set(startX + (x - startX) * t, y), ease.linear, () => s.setPose("stand"));
  }

  private stamp(text: string, color: number, x: number, y: number) {
    const t = stampText(text, color);
    t.position.set(x, y);
    t.scale.set(0.3);
    t.alpha = 0;
    const layer: Container = this.host.effects.layer;
    layer.addChild(t);
    this.host.runner.add(
      sequence(
        [
          () => tween(260, (u) => {
            t.alpha = u;
            t.scale.set(0.3 + 0.7 * u);
          }, ease.outBack),
          () => wait(1100),
          () => tween(420, (u) => {
            t.alpha = 1 - u;
            t.position.y = y - u * 10;
          }, ease.inOut),
        ],
        () => t.destroy(),
      ),
    );
  }

  private floorFlash(color: number) {
    const p = this.props;
    if (!p || this.host.lowEffects()) return;
    this.host.effects.flash(BUILDING.interiorX, p.top, BUILDING.interiorRight - BUILDING.interiorX, p.floorY - p.top, color);
  }

  private home(slug: string): number {
    return TRADING_SEATS[slug] ?? TRADING_PIT.x;
  }

  // Plays one event. Returns how long the floor is busy with it.
  private play(e: TradingEvent, now: number): number {
    const h = this.host;
    const d = e.data;
    const p = this.props!;
    const stampY = p.floorY - 84;
    switch (e.kind) {
      case "meeting":
        return this.meeting(e, now);
      case "signal": {
        const q = h.sprite("trading_quant");
        if (q) {
          this.say(q, `Signal: ${short(d.symbol)} ${String(d.signal ?? "")} ${d.score ?? ""}`.trim(), 3500, now, "task");
          q.setPose("raise");
        }
        h.sound.blip();
        return 3800;
      }
      case "veto": {
        const r = h.sprite("trading_risk");
        if (r) {
          this.say(r, `VETO ${short(d.symbol)}: ${clip(d.reason, 40)}`, 3600, now, "alert");
          r.setPose("raise");
        }
        this.stamp("VETO", LED.red, TRADING_PIT.x, stampY);
        h.sound.alarm();
        return 4000;
      }
      case "open": {
        const runner = h.sprite("trading_runner");
        const from = h.sprite(d.desk === "quant" ? "trading_quant" : "trading_chief");
        if (from && !h.lowEffects()) h.effects.paperFlight(from.position.x, from.position.y - 40, 1158, p.top + 40, () => p.board.flash());
        if (runner) this.say(runner, `Bought ${short(d.symbol)}, ${Number(d.sizeUsd ?? 0).toFixed(2)} USD`, 3200, now, "task");
        h.sound.till();
        return 3400;
      }
      case "close_win": {
        const runner = h.sprite("trading_runner");
        if (runner) this.say(runner, `${short(d.symbol)}: won ${Number(d.pnlUsd ?? 0).toFixed(2)} USD`, 3500, now, "task");
        if (!h.lowEffects()) for (let i = 0; i < 4; i++) h.runner.add(sequence([() => wait(i * 140)], () => h.effects.coinDrop(1120 + i * 22, p.top + 10, p.top + 62)));
        p.board.flash();
        this.floorFlash(LED.green);
        h.sound.till();
        h.sound.fanfare();
        for (const slug of ["trading_bull", "trading_chief", "trading_coach"]) {
          const s = h.sprite(slug);
          if (s && !s.away) this.cheer(s, 1800);
        }
        return 4000;
      }
      case "close_loss": {
        const runner = h.sprite("trading_runner");
        const bear = h.sprite("trading_bear");
        if (runner) this.say(runner, `${short(d.symbol)}: ${d.reason === "breakeven" ? "out at the entry" : "stopped out"}, lost ${Math.abs(Number(d.pnlUsd ?? 0)).toFixed(2)} USD`, 3500, now, "alert");
        if (bear && !bear.away) h.runner.add(sequence([() => wait(1200)], () => this.say(bear, "Told you so", 2400, this.t)));
        this.floorFlash(LED.red);
        h.sound.alarm();
        return 4200;
      }
      case "bell": {
        const open = d.open === true;
        h.runner.add(tween(1800, (t) => p.bell.swing(t), ease.linear, () => p.bell.swing(1)));
        h.sound.bell();
        this.stamp(open ? "OPENING BELL" : "CLOSING BELL", LED.amber, TRADING_PIT.x, stampY);
        if (open) {
          for (const slug of Object.keys(TRADING_SEATS)) {
            if (slug === "trading_larry") continue;
            const s = h.sprite(slug);
            if (!s || s.away) continue;
            this.cheer(s, 2000);
          }
        }
        return 3600;
      }
      case "news": {
        const hound = h.sprite("trading_news");
        if (hound) {
          const tag = d.sentiment === "bullish" ? "Bullish" : d.sentiment === "bearish" ? "Bearish" : "News";
          this.say(hound, `${tag}: ${clip(d.headline ?? e.message, 54)}`, 4000, now, "task");
          hound.setPose("phone");
        }
        return 4200;
      }
      case "brief": {
        const hound = h.sprite("trading_news");
        if (hound) this.say(hound, `Brief: ${String(d.mood ?? "mixed")}. ${clip(d.headline, 40)}`, 4200, now, "task");
        return 4400;
      }
      case "lesson": {
        const coach = h.sprite("trading_coach");
        if (coach) {
          this.say(coach, `Lesson: ${clip(d.rule ?? e.message, 50)}`, 4000, now, "task");
          coach.setPose("point");
        }
        return 4200;
      }
      case "bench":
      case "freeze": {
        const r = h.sprite("trading_risk");
        if (r) this.say(r, clip(e.message.replace(/^Risk /, ""), 56), 4000, now, "alert");
        h.sound.alarm();
        return 4200;
      }
      case "back":
      case "unfreeze":
      case "quiet": {
        const c = h.sprite("trading_chief");
        if (c) this.say(c, clip(e.message, 56), 4000, now, e.kind === "quiet" ? "alert" : "task");
        return 4200;
      }
      case "larry_buy": {
        const l = h.sprite("trading_larry");
        if (l) this.say(l, "All in on SPY. Wake me in a month", 4000, now, "chat");
        return 4200;
      }
      default:
        return 500;
    }
  }

  // Bull and Bear walk into the pit and argue in their own words; the Chief walks in and decides.
  private meeting(e: TradingEvent, now: number): number {
    const h = this.host;
    const d = e.data;
    const bull = h.sprite("trading_bull");
    const bear = h.sprite("trading_bear");
    const chief = h.sprite("trading_chief");
    const buy = d.decision === "buy";
    const sym = short(d.symbol);
    const stampY = this.props!.floorY - 84;
    if (!bull || !bear || !chief || bull.away || bear.away || chief.away || h.lowEffects()) {
      if (chief) this.say(chief, `${buy ? "BUY" : "PASS"} ${sym}: ${clip(d.reason, 40)}`, 4000, now, "task");
      this.stamp(buy ? "BUY" : "PASS", buy ? LED.green : 0xb8c0c8, TRADING_PIT.x, stampY);
      return 4500;
    }
    const total = 15500;
    const toks = [bull, bear, chief].map((s) => {
      s.setBubble(null);
      return this.hold(s, total);
    });
    const pit = TRADING_PIT.x;
    h.runner.add(this.walk(bull, pit - 28));
    h.runner.add(this.walk(bear, pit + 28));
    const talk = (s: CharacterSprite, face: number, pose: "chat" | "point", text: string, ms: number) => () => {
      s.setFacing(face);
      s.setPose(pose);
      s.setBubble(text, "chat");
      return tween(ms, () => {}, ease.linear, () => {
        s.setBubble(null);
        s.setPose("stand");
      });
    };
    h.runner.add(
      sequence(
        [
          () => wait(1500),
          talk(bull, 1, "chat", `Bull: ${clip(d.bull, 64)}`, 3400),
          talk(bear, -1, "point", `Bear: ${clip(d.bear, 64)}`, 3400),
          () => this.walk(chief, pit),
          () => {
            chief.setFacing(1);
            chief.setPose(buy ? "point" : "stand");
            chief.setBubble(`${buy ? "BUY" : "PASS"} ${sym}. ${clip(d.reason, 46)}`, "task");
            this.stamp(buy ? "BUY" : "PASS", buy ? LED.green : 0xb8c0c8, pit, stampY);
            if (buy) h.sound.fanfare();
            const winner = buy ? bull : bear;
            winner.setPose("cheer");
            return wait(2600);
          },
          () => {
            chief.setBubble(null);
            return wait(200);
          },
          () => {
            h.runner.add(this.walk(bull, this.home("trading_bull")));
            h.runner.add(this.walk(bear, this.home("trading_bear")));
            return this.walk(chief, this.home("trading_chief"));
          },
          () => wait(900),
        ],
        () => [bull, bear, chief].forEach((s, i) => this.release(s, toks[i]!)),
      ),
    );
    return total;
  }

  private chatter(now: number) {
    const h = this.host;
    const v = this.view;
    const pool = Object.keys(CHATTER);
    const slug = pool[Math.floor(Math.random() * pool.length)]!;
    const s = h.sprite(slug);
    if (!s || s.away || s.busyUntil > performance.now()) return;
    let line = CHATTER[slug]![Math.floor(Math.random() * CHATTER[slug]!.length)]!;
    if (slug === "trading_chief" && v?.desks.length) {
      const lead = v.desks[0]!;
      line = Math.random() < 0.5 ? `${lead.name} leads the race` : line;
      if (v.status && !v.status.stocksOpen && v.status.nextOpen && Math.random() < 0.5) {
        const open = new Date(new Date(v.status.nextOpen).getTime() + 4 * 3600_000);
        line = `Stocks open at ${String(open.getUTCHours()).padStart(2, "0")}:${String(open.getUTCMinutes()).padStart(2, "0")} Dubai`;
      }
    }
    if (slug === "trading_news" && v?.brief?.headline && Math.random() < 0.4) line = `Today: ${clip(v.brief.headline, 40)}`;
    if (slug === "trading_quant") h.sound.blip();
    this.say(s, line, 2800, now, "chat");
  }
}
