import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { DOCLEDGER } from "@/config/docledger";
import { getDb } from "@/db/client";
import { leads } from "@/db/schema";
import { clipboardValue } from "@/lib/clipboard";

export const dynamic = "force-dynamic";

export interface LeadPreview {
  headline: string;
  intro: string;
  points: string[];
  sampleDocument: string;
  sampleFields: Array<{ field: string; value: string }>;
}

// A two minute preview made for one company, linked from Writer's first email. Public, no simulated rows.
export default async function PreviewPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^[a-z0-9]{4,12}$/.test(code)) notFound();
  const db = getDb();
  const [lead] = await db.select().from(leads).where(eq(leads.previewCode, code)).limit(1);
  if (!lead || lead.simulated || !lead.preview) notFound();
  const p = lead.preview as LeadPreview;
  const calendar = await clipboardValue(db, "calendar_link");
  const dm = (lead.decisionMaker ?? {}) as Record<string, unknown>;
  const name = typeof dm.name === "string" && dm.name ? dm.name.split(" ")[0] : null;
  return (
    <main className="preview">
      <header className="preview-head">
        <div className="preview-kicker">Doc Ledger, made for {lead.company}</div>
        <h1>{p.headline}</h1>
        <p className="preview-intro">{name ? `${name}, ` : ""}{p.intro}</p>
      </header>
      <section className="preview-sheet">
        <h2>What your month end looks like with it</h2>
        <ol className="preview-points">
          {p.points.map((pt, i) => (
            <li key={i}>{pt}</li>
          ))}
        </ol>
      </section>
      <section className="preview-sheet preview-sample">
        <h2>One of your documents, read for you</h2>
        <div className="preview-doc">
          <div className="preview-doc-name">{p.sampleDocument}</div>
          <dl className="kv">
            {p.sampleFields.map((f) => (
              <PreviewField key={f.field} field={f.field} value={f.value} />
            ))}
          </dl>
          <div className="preview-note">A person checks these against the photo, then saves. Fields you do not need are gone, fields we do not have you can add.</div>
        </div>
      </section>
      <section className="preview-sheet">
        <h2>Your own document types</h2>
        <p>{DOCLEDGER.differentiator}</p>
      </section>
      <footer className="preview-foot">
        <p className="preview-close">{DOCLEDGER.closingLine}</p>
        {calendar ? (
          <a className="key" href={calendar}>
            Book 15 minutes
          </a>
        ) : (
          <p>Reply to the email with two times that suit you.</p>
        )}
      </footer>
    </main>
  );
}

function PreviewField({ field, value }: { field: string; value: string }) {
  return (
    <>
      <dt>{field}</dt>
      <dd>{value}</dd>
    </>
  );
}
