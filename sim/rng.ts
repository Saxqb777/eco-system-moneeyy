// Small seeded random number generator so simulation is deterministic per slice and agent.

export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rngFor(...parts: (string | number)[]): () => number {
  return mulberry32(hashSeed(parts.join("|")));
}

export function pick<T>(rand: () => number, arr: readonly T[]): T {
  const item = arr[Math.floor(rand() * arr.length)];
  if (item === undefined) throw new Error("pick from empty array");
  return item;
}

export function between(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}
