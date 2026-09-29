export function formatUsdCompact(n: number): string {
  if (Math.abs(n) >= 10000) return `${(n / 1000).toFixed(1)}k`;
  return n.toFixed(2);
}
