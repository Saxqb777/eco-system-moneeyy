// Small easing helpers. Everything in the scene eases.

export const ease = {
  linear: (t: number) => t,
  inOut: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  out: (t: number) => 1 - Math.pow(1 - t, 3),
  in: (t: number) => t * t * t,
  outBack: (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2),
};

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export interface Tween {
  update(dtMs: number): boolean; // returns true when done
}

export function tween(durationMs: number, onUpdate: (t: number) => void, easing: (t: number) => number = ease.inOut, onDone?: () => void): Tween {
  let elapsed = 0;
  let done = false;
  return {
    update(dt) {
      if (done) return true;
      elapsed += dt;
      const t = clamp01(elapsed / durationMs);
      onUpdate(easing(t));
      if (t >= 1) {
        done = true;
        onDone?.();
      }
      return done;
    },
  };
}

// Runs tweens in sequence, then calls done.
export function sequence(steps: Array<() => Tween>, onDone?: () => void): Tween {
  let index = 0;
  let current: Tween | null = null;
  return {
    update(dt) {
      if (index >= steps.length) return true;
      if (!current) {
        const step = steps[index];
        if (!step) return true;
        current = step();
      }
      if (current.update(dt)) {
        current = null;
        index += 1;
        if (index >= steps.length) {
          onDone?.();
          return true;
        }
      }
      return false;
    },
  };
}

export function wait(ms: number): Tween {
  return tween(ms, () => {}, ease.linear);
}

export class TweenRunner {
  private list: Tween[] = [];
  add(t: Tween) {
    this.list.push(t);
    return t;
  }
  update(dtMs: number) {
    if (!this.list.length) return;
    this.list = this.list.filter((t) => !t.update(dtMs));
  }
  get size() {
    return this.list.length;
  }
}
