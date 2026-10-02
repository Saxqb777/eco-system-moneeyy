// What the firm learns (D076). Every voice's vote is scored against the trade it voted on, every signal kind's
// win rate is kept, and the numbers feed the Chief, the scanner, the Trading tab and the floor.
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { LEARN } from "@/config/trading";
import type { Db } from "@/db/client";
import { tradingPositions, tradingSignals } from "@/db/schema";
import { getSetting, setSetting } from "@/lib/settings";

// 1 for a right call, 0 for a wrong one, newest last, at most LEARN.trackWindow kept.
export interface VoiceRecord {
  right: number;
  wrong: number;
  recent: number[];
}
export type VoiceRecords = Record<string, VoiceRecord>;

export interface KindRecord {
  wins: number;
  losses: number;
}
export type KindRecords = Record<string, KindRecord>;

export const VOICES_KEY = "trading_voices";
export const KINDS_KEY = "trading_kinds";

// A voice was right when it voted buy on a winner or pass on a loser.
export function voiceRight(vote: string, won: boolean): boolean {
  return vote === "buy" ? won : !won;
}

export async function voiceRecords(db: Db): Promise<VoiceRecords> {
  return getSetting<VoiceRecords>(db, VOICES_KEY, {});
}

export async function kindRecords(db: Db): Promise<KindRecords> {
  return getSetting<KindRecords>(db, KINDS_KEY, {});
}

// The last few calls: how many were right, out of how many.
export function recentScore(r: VoiceRecord | undefined): { right: number; of: number } {
  if (!r) return { right: 0, of: 0 };
  const recent = r.recent.slice(-LEARN.trackWindow);
  return { right: recent.reduce((a, b) => a + b, 0), of: recent.length };
}

// The line the Chief hears. Only voices with a few calls behind them, the best first.
export function trackRecordLine(records: VoiceRecords): string {
  const rows = Object.entries(records)
    .map(([who, r]) => ({ who, ...recentScore(r) }))
    .filter((x) => x.of >= 3)
    .sort((a, b) => b.right / b.of - a.right / a.of);
  if (!rows.length) return "";
  return `Track records (the last ${LEARN.trackWindow} trades each): ${rows.map((x) => `${x.who} right ${x.right} of ${x.of}`).join(", ")}. Weigh a voice by its record, not its volume.`;
}

// A signal kind that keeps losing gets a lower score, one that keeps winning a higher one, once there are enough outcomes.
export function kindBonus(records: KindRecords, kind: string): number {
  const r = records[kind];
  if (!r) return 0;
  const n = r.wins + r.losses;
  if (n < LEARN.minOutcomesForKind) return 0;
  const rate = r.wins / n;
  return Math.round(Math.max(-LEARN.kindBonusMax, Math.min(LEARN.kindBonusMax, (rate - 0.5) * 2 * LEARN.kindBonusMax)));
}

// Scores every closed trade from a signal that has not been scored yet: the room's voices and the signal's kind.
// The marker lives inside the meeting json, so no table changes.
export async function scoreOutcomes(db: Db): Promise<{ scored: number }> {
  const rows = await db
    .select()
    .from(tradingPositions)
    .where(and(eq(tradingPositions.status, "closed"), isNotNull(tradingPositions.signalId), sql`coalesce(${tradingPositions.meeting}->>'scored', '') = ''`))
    .limit(25);
  if (!rows.length) return { scored: 0 };
  const voices = await voiceRecords(db);
  const kinds = await kindRecords(db);
  for (const p of rows) {
    const won = Number(p.pnlUsd) > 0;
    const meeting = (p.meeting ?? {}) as { voices?: Array<{ who?: string; vote?: string }> };
    for (const v of meeting.voices ?? []) {
      if (!v.who || v.who === "Chief" || !v.vote) continue;
      const rec = (voices[v.who] ??= { right: 0, wrong: 0, recent: [] });
      const right = voiceRight(v.vote, won);
      if (right) rec.right += 1;
      else rec.wrong += 1;
      rec.recent = [...rec.recent, right ? 1 : 0].slice(-LEARN.trackWindow);
    }
    if (p.signalId) {
      const [sig] = await db.select({ kind: tradingSignals.kind }).from(tradingSignals).where(eq(tradingSignals.id, p.signalId)).limit(1);
      if (sig) {
        const rec = (kinds[sig.kind] ??= { wins: 0, losses: 0 });
        if (won) rec.wins += 1;
        else rec.losses += 1;
      }
    }
    await db
      .update(tradingPositions)
      .set({ meeting: sql`coalesce(${tradingPositions.meeting}, '{}'::jsonb) || '{"scored": true}'::jsonb` })
      .where(eq(tradingPositions.id, p.id));
  }
  await setSetting(db, VOICES_KEY, voices);
  await setSetting(db, KINDS_KEY, kinds);
  return { scored: rows.length };
}

// The week in numbers for the Sunday memo.
export function learningSummary(voices: VoiceRecords, kinds: KindRecords): string {
  const v = Object.entries(voices)
    .map(([who, r]) => ({ who, ...recentScore(r) }))
    .filter((x) => x.of > 0)
    .sort((a, b) => b.right / b.of - a.right / a.of)
    .map((x) => `${x.who} ${x.right} of ${x.of}`);
  const k = Object.entries(kinds)
    .filter(([, r]) => r.wins + r.losses > 0)
    .map(([kind, r]) => `${kind} ${r.wins} won ${r.losses} lost`);
  return [v.length ? `Voices right: ${v.join(", ")}.` : "No voice has a record yet.", k.length ? `Signal kinds: ${k.join(", ")}.` : "No signal kind has an outcome yet."].join(" ");
}
