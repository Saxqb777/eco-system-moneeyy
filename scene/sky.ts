// Sky colours by Dubai time. Keyframes are interpolated, so dawn and dusk sweep smoothly.
import { C, mix } from "./palette";

export interface SkyState {
  top: number;
  bottom: number;
  horizon: number; // warm band colour at the horizon
  darkness: number; // 0 day to 1 night, drives stars, window glow and interior lights
  sunT: number | null; // 0 to 1 across the sky during the day
  moonT: number | null; // 0 to 1 across the sky during the night
}

interface Key {
  h: number;
  top: number;
  bottom: number;
  horizon: number;
  darkness: number;
}

const KEYS: Key[] = [
  { h: 0, top: C.skyNightTop, bottom: C.skyNightBottom, horizon: C.horizonNight, darkness: 1 },
  { h: 5, top: C.skyNightTop, bottom: C.skyNightBottom, horizon: C.horizonNight, darkness: 1 },
  { h: 6.2, top: C.skyDawnTop, bottom: C.skyDawnBottom, horizon: 0xf0b070, darkness: 0.55 },
  { h: 7.5, top: C.skyDayTop, bottom: C.skyDayBottom, horizon: 0xe8d6b3, darkness: 0 },
  { h: 16.5, top: C.skyDayTop, bottom: C.skyDayBottom, horizon: 0xe8d6b3, darkness: 0 },
  { h: 18, top: C.skyDuskTop, bottom: C.skyDuskBottom, horizon: 0xf08a24, darkness: 0.5 },
  { h: 19.3, top: C.skyNightTop, bottom: C.skyNightBottom, horizon: C.horizonNight, darkness: 1 },
  { h: 24, top: C.skyNightTop, bottom: C.skyNightBottom, horizon: C.horizonNight, darkness: 1 },
];

export function skyAt(dubaiHour: number): SkyState {
  const h = ((dubaiHour % 24) + 24) % 24;
  let a = KEYS[0]!;
  let b = KEYS[KEYS.length - 1]!;
  for (let i = 0; i < KEYS.length - 1; i++) {
    const k0 = KEYS[i]!;
    const k1 = KEYS[i + 1]!;
    if (h >= k0.h && h <= k1.h) {
      a = k0;
      b = k1;
      break;
    }
  }
  const t = b.h === a.h ? 0 : (h - a.h) / (b.h - a.h);
  const dayStart = 6.2;
  const dayEnd = 18.3;
  const isDay = h >= dayStart && h <= dayEnd;
  return {
    top: mix(a.top, b.top, t),
    bottom: mix(a.bottom, b.bottom, t),
    horizon: mix(a.horizon, b.horizon, t),
    darkness: a.darkness + (b.darkness - a.darkness) * t,
    sunT: isDay ? (h - dayStart) / (dayEnd - dayStart) : null,
    moonT: isDay ? null : h > dayEnd ? (h - dayEnd) / (24 - dayEnd + dayStart) : (h + 24 - dayEnd) / (24 - dayEnd + dayStart),
  };
}

// Fractional Dubai hour from a UTC date.
export function dubaiHour(d: Date): number {
  const ms = d.getTime() + 4 * 60 * 60 * 1000;
  const local = new Date(ms);
  return local.getUTCHours() + local.getUTCMinutes() / 60 + local.getUTCSeconds() / 3600;
}
