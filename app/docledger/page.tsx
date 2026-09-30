import type { Metadata } from "next";
import { DOCLEDGER } from "@/config/docledger";
import { getDb } from "@/db/client";
import { clipboardValue } from "@/lib/clipboard";
import { mockEnabled } from "@/lib/mock-state";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Doc Ledger: receipts into accounts",
  description: "Photograph shipping bills, fuel receipts and petty cash. Doc Ledger reads them, a person checks them, your books are done. Your own document types, any currency. First month free.",
};

interface PageWords {
  headline: string;
  subheadline: string;
  points: string[];
  cta: string;
}

// What the page needs from the Tower: the Marketer's latest page words, the calendar and the founder's address.
async function loadSite(): Promise<{ words: PageWords | null; calendar: string | null; email: string | null; address: string | null }> {
  if (mockEnabled()) return { words: null, calendar: "https://cal.com/example/15min", email: "saaqib@docledger.site", address: null };
  try {
    const db = getDb();
    const s = await getSettings(db);
    const pack = s.docledger_marketing as { page?: PageWords } | null;
    const from = await clipboardValue(db, "resend_from");
    return {
      words: pack?.page?.headline ? pack.page : null,
      calendar: await clipboardValue(db, "calendar_link"),
      email: from?.match(/[^\s<>]+@[^\s<>]+/)?.[0] ?? null,
      address: await clipboardValue(db, "business_address"),
    };
  } catch {
    return { words: null, calendar: null, email: null, address: null };
  }
}

// docledger.site: the company's own page (D067). Public. The Marketer's words lead when he has written them.
export default async function DocLedgerSite() {
  const { words, calendar, email, address } = await loadSite();
  const headline = words?.headline || "Receipts into accounts";
  const sub = words?.subheadline || "Photograph the bill. Doc Ledger reads it, a person checks it, and it is in your books.";
  const points = words?.points?.length ? words.points : ["Every charge line, BL and container number read for you", "Foreign currency fixed at the rate of the day it was spent", "Your own document types when ours do not fit"];
  return (
    <main className="preview site">
      <header className="preview-head">
        <div className="preview-kicker">Doc Ledger</div>
        <h1>{headline}</h1>
        <p className="preview-intro">{sub}</p>
        <ul className="site-points">
          {points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <div className="site-cta">
          {calendar ? (
            <a className="key" href={calendar}>
              {words?.cta || "Book 15 minutes"}
            </a>
          ) : null}
          {email ? (
            <a className="key plain" href={`mailto:${email}?subject=${encodeURIComponent("Doc Ledger free month")}`}>
              Write to us
            </a>
          ) : null}
        </div>
        <p className="site-free">The first month is free, set up around your own documents.</p>
      </header>

      <section className="preview-sheet">
        <h2>The month end we take away</h2>
        <ul className="preview-points">
          {DOCLEDGER.pains.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </section>

      <section className="preview-sheet">
        <h2>How it works</h2>
        <ol className="preview-points">
          <li>Your staff photograph the bill, the receipt or the invoice.</li>
          <li>Doc Ledger reads the vendor, amount, date, currency, category and every line you care about.</li>
          <li>A person checks the fields against the photo and saves. Duplicates are stopped before they reach your books.</li>
        </ol>
      </section>

      <section className="preview-sheet">
        <h2>Your own document types</h2>
        <p>{DOCLEDGER.publicCopy.ownTypes}</p>
      </section>

      <section className="preview-sheet">
        <h2>Built for</h2>
        <p>{DOCLEDGER.publicCopy.builtFor}</p>
      </section>

      <section className="preview-sheet">
        <h2>Built on your terms</h2>
        <p>{DOCLEDGER.publicCopy.onYourTerms}</p>
      </section>

      <footer className="preview-foot">
        <p className="preview-close">{DOCLEDGER.closingLine}</p>
        {calendar ? (
          <a className="key" href={calendar}>
            Book 15 minutes
          </a>
        ) : null}
        <p className="site-small">
          Doc Ledger{email ? `, ${email}` : ""}
          {address ? `, ${address}` : ""}
        </p>
      </footer>
    </main>
  );
}
