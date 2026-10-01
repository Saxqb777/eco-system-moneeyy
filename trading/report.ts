// Wall Street's words for the owner: the scoreboard, the close report and the weekly report card.
// No dashes anywhere (rule 7): a loss reads "down 0.60 percent", never with a minus sign.
import { and, eq, gte, lt } from "drizzle-orm";
import { CRYPTO_BENCHMARK, START_USD } from "@/config/trading";
import type { Db } from "@/db/client";
import { tradingDesks, tradingPositions } from "@/db/schema";
import { getSetting } from "@/lib/settings";
import { shortSymbol } from "./engine";

export function signedPct(pct: number): string {
  if (Math.abs(pct) < 0.005) return "flat";
  return `${pct > 0 ? "up" : "down"} ${Math.abs(pct).toFixed(2)} percent`;
}

export function signedUsd(v: number): string {
  if (Math.abs(v) < 0.005) return "even";
  return `${v > 0 ? "won" : "lost"} ${Math.abs(v).toFixed(2)} USD`;
}

export interface BoardRow {
  slug: string;
  name: string;
  market: string;
  style: string;
  equityUsd: number;
  pnlPct: number;
  status: string;
}

export function boardRows(desks: Array<typeof tradingDesks.$inferSelect>): BoardRow[] {
  return desks
    .map((d) => {
      const equity = Number(d.equityUsd);
      const start = Number(d.startUsd) || START_USD;
      return { slug: d.slug, name: d.name, market: d.market, style: d.style, equityUsd: equity, pnlPct: ((equity - start) / start) * 100, status: d.status };
    })
    .sort((a, b) => b.pnlPct - a.pnlPct);
}

// Bitcoin held from the day the floor opened: the crypto desk's yardstick.
export async function btcHoldPct(db: Db, lastBtc: number | null): Promise<number | null> {
  const start = await getSetting<{ price: number } | null>(db, "trading_btc_start", null);
  if (!start?.price || !lastBtc) return null;
  return ((lastBtc - start.price) / start.price) * 100;
}

async function tradesBetween(db: Db, from: Date, to: Date) {
  return db
    .select()
    .from(tradingPositions)
    .where(and(eq(tradingPositions.status, "closed"), gte(tradingPositions.closedAt, from), lt(tradingPositions.closedAt, to)));
}

export async function closeReport(db: Db, input: { title: string; from: Date; to: Date; btcPct: number | null; aiCostUsd: number }): Promise<string> {
  const desks = boardRows(await db.select().from(tradingDesks));
  const trades = (await tradesBetween(db, input.from, input.to)).filter((t) => t.signalId || t.thesis);
  const lines = [input.title, ""];
  desks.forEach((d, i) => lines.push(`${i + 1}. ${d.name}: ${d.equityUsd.toFixed(2)} USD, ${signedPct(d.pnlPct)}${d.status !== "live" ? ` (${d.status})` : ""}`));
  if (input.btcPct !== null) lines.push(`Bitcoin held since the start: ${signedPct(input.btcPct)}`);
  lines.push("");
  if (trades.length) {
    const won = trades.filter((t) => Number(t.pnlUsd) > 0).length;
    const best = [...trades].sort((a, b) => Number(b.pnlUsd) - Number(a.pnlUsd))[0]!;
    const worst = [...trades].sort((a, b) => Number(a.pnlUsd) - Number(b.pnlUsd))[0]!;
    lines.push(`Trades closed: ${trades.length} (${won} won, ${trades.length - won} lost or even).`);
    lines.push(`Best: ${shortSymbol(best.symbol)}, ${signedUsd(Number(best.pnlUsd))}. Worst: ${shortSymbol(worst.symbol)}, ${signedUsd(Number(worst.pnlUsd))}.`);
  } else lines.push("No trades closed.");
  lines.push(`AI cost: ${input.aiCostUsd.toFixed(2)} USD. Paper money only, nothing real was bought.`);
  return lines.join("\n");
}

export { CRYPTO_BENCHMARK };
