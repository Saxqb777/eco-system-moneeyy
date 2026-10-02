import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { clipboardValue } from "@/lib/clipboard";

export const dynamic = "force-dynamic";

// D081: what docledger.site may show as proof: a customer's words and a short recording, once the owner pasted
// them in Setup. Public, no secrets, cached five minutes. The app's sales page reads it from the browser.
export async function GET() {
  let raw = "";
  let video = "";
  try {
    const db = getDb();
    raw = (await clipboardValue(db, "docledger_customer_quote")) ?? "";
    video = (await clipboardValue(db, "docledger_demo_video")) ?? "";
  } catch {
    // no database (mock mode or a cold start without one): the site shows no proof, nothing breaks
  }
  const [text, by] = raw.split("|").map((x) => x.trim());
  return NextResponse.json(
    { quote: text ? { text, by: by ?? "" } : null, video: /^https?:\/\//.test(video) ? video : null, firstMonthFree: true },
    { headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } },
  );
}
