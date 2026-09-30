// DocLedger sells worldwide. This file knows where the Scout looks, when an email may land in someone's inbox
// (their business hours, their weekend), and which countries need something first before we write to them.
import type { Db } from "@/db/client";
import { clipboardValue } from "@/lib/clipboard";
import { getSettings } from "@/lib/settings";

// UTC offset in hours (standard time; the 09:00 to 16:00 window absorbs daylight saving) and weekend days (0 Sunday).
const ZONES: Record<string, { offset: number; weekend: number[] }> = {
  AE: { offset: 4, weekend: [6, 0] },
  SA: { offset: 3, weekend: [5, 6] },
  QA: { offset: 3, weekend: [5, 6] },
  KW: { offset: 3, weekend: [5, 6] },
  BH: { offset: 3, weekend: [5, 6] },
  OM: { offset: 4, weekend: [5, 6] },
  JO: { offset: 3, weekend: [5, 6] },
  EG: { offset: 2, weekend: [5, 6] },
  TR: { offset: 3, weekend: [6, 0] },
  GB: { offset: 0, weekend: [6, 0] },
  IE: { offset: 0, weekend: [6, 0] },
  PT: { offset: 0, weekend: [6, 0] },
  NL: { offset: 1, weekend: [6, 0] },
  BE: { offset: 1, weekend: [6, 0] },
  FR: { offset: 1, weekend: [6, 0] },
  ES: { offset: 1, weekend: [6, 0] },
  IT: { offset: 1, weekend: [6, 0] },
  CH: { offset: 1, weekend: [6, 0] },
  PL: { offset: 1, weekend: [6, 0] },
  SE: { offset: 1, weekend: [6, 0] },
  DK: { offset: 1, weekend: [6, 0] },
  NO: { offset: 1, weekend: [6, 0] },
  FI: { offset: 2, weekend: [6, 0] },
  ZA: { offset: 2, weekend: [6, 0] },
  NG: { offset: 1, weekend: [6, 0] },
  KE: { offset: 3, weekend: [6, 0] },
  IN: { offset: 5.5, weekend: [0] },
  PK: { offset: 5, weekend: [0] },
  LK: { offset: 5.5, weekend: [6, 0] },
  BD: { offset: 6, weekend: [5, 6] },
  SG: { offset: 8, weekend: [6, 0] },
  MY: { offset: 8, weekend: [6, 0] },
  HK: { offset: 8, weekend: [6, 0] },
  PH: { offset: 8, weekend: [6, 0] },
  ID: { offset: 7, weekend: [6, 0] },
  TH: { offset: 7, weekend: [6, 0] },
  VN: { offset: 7, weekend: [6, 0] },
  JP: { offset: 9, weekend: [6, 0] },
  KR: { offset: 9, weekend: [6, 0] },
  AU: { offset: 10, weekend: [6, 0] },
  NZ: { offset: 12, weekend: [6, 0] },
  US: { offset: -5, weekend: [6, 0] },
  MX: { offset: -6, weekend: [6, 0] },
  BR: { offset: -3, weekend: [6, 0] },
};

// Where the Scout looks, one region a day in turn, unless Warden gives a focus.
export const REGIONS = [
  "the United Kingdom and Ireland",
  "Australia and New Zealand",
  "Singapore, Malaysia and Hong Kong",
  "Saudi Arabia, Qatar, Oman, Bahrain, Kuwait and the UAE",
  "India and Sri Lanka",
  "the United States",
  "South Africa, Kenya and Nigeria",
  "the Netherlands, Belgium and the Nordic countries",
];

// Cold business email needs prior consent in these countries (Canada's CASL, Germany's UWG), so we do not write first.
export const DEFAULT_SKIP_COUNTRIES = ["CA", "DE"];

export function normaliseCountry(v: string | null | undefined): string {
  const c = (v ?? "").trim().toUpperCase();
  if (c === "UK") return "GB";
  if (c === "UAE") return "AE";
  if (c === "USA") return "US";
  return /^[A-Z]{2}$/.test(c) ? c : "";
}

export function localTime(country: string, now: Date): { hour: number; weekday: number } {
  const z = ZONES[normaliseCountry(country)] ?? { offset: 0, weekend: [6, 0] };
  const local = new Date(now.getTime() + z.offset * 3600 * 1000);
  return { hour: local.getUTCHours() + local.getUTCMinutes() / 60, weekday: local.getUTCDay() };
}

// 09:00 to 16:00 on the recipient's working days.
export function inBusinessHours(country: string, now: Date): boolean {
  const z = ZONES[normaliseCountry(country)] ?? { offset: 0, weekend: [6, 0] };
  const t = localTime(country, now);
  return !z.weekend.includes(t.weekday) && t.hour >= 9 && t.hour < 16;
}

export function regionFor(now: Date): string {
  const day = Math.floor(now.getTime() / (24 * 3600 * 1000));
  return REGIONS[day % REGIONS.length]!;
}

// Countries the Scout must leave out right now, with the reason, so Warden and the owner see why.
export async function skippedCountries(db: Db): Promise<Record<string, string>> {
  const s = await getSettings(db);
  const list = Array.isArray(s.docledger_skip_countries) ? (s.docledger_skip_countries as string[]) : DEFAULT_SKIP_COUNTRIES;
  const out: Record<string, string> = {};
  for (const c of list) out[normaliseCountry(c)] = "cold email needs prior consent there";
  if (!(await clipboardValue(db, "business_address"))) out.US = "US law needs a postal address in the signature: paste one on the clipboard";
  return out;
}
