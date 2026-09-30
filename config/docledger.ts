// What the DocLedger Sales floor knows about the product and how it sells it. Saaqib's brief, 2026-09-30.
// The workers quote from here; the price line and the signature block come from the clipboard (only he knows them).

export const DOCLEDGER = {
  name: "Doc Ledger",
  oneLine: "Doc Ledger turns receipts into accounts.",
  paragraph:
    "Doc Ledger turns receipts into accounts. Staff photograph a bill, AI extracts the vendor, amount, date, currency and category, and a person confirms it before it is saved. Built for the documents finance actually deals with: customs and freight invoices with every charge line itemised, fuel receipts, and multi currency spending converted and fixed at the moment of entry. Each company runs in its own isolated workspace with its own people, roles, categories and exchange rates, and defines its own document types when the standard ones do not fit.",
  pains: [
    "Month end: an envelope of receipts and someone retyping them into a spreadsheet.",
    "Shipping bills are the worst of it: every charge line, BL number and container number keyed by hand.",
    "Fuel receipts with litres, odometer and plate, typed one by one.",
    "Foreign currency spend converted at the wrong rate, or not at all.",
    "Duplicate receipts reaching the books.",
  ],
  differentiator:
    "Your company files things your own way, so you define your own document types. Name the fields you need, describe what the document looks like, and it reads for those instead of ours. Most expense tools give fixed fields and a category dropdown. This one lets a customer define a document type and tell the extraction what to look for, in plain English.",
  builtInTypes: "The three built in document types came from a UAE food and beverage group: general petty cash, fuel, and shipping line bills.",
  idealCustomer:
    "Finance teams anywhere in the world that key shipping bills, fuel receipts and petty cash by hand: freight forwarders and customs brokers first, then food and beverage distributors, trading companies with their own fleets, and small third party logistics firms. Two to two hundred staff. It is software, so the country does not matter; multi currency matters more the more borders they cross. Couriers, airlines and shipping lines are not a fit.",
  builtToTheirTerms:
    "Whatever their paperwork looks like, Doc Ledger is shaped to it: their own document types, fields, categories, currencies and rates. If they need something it does not do yet, we build it for them on their terms, usually within days. Say that plainly when they describe a document or a workflow we have not seen.",
  subjectExamples: ["Your petty cash, without the retyping", "Receipts to spreadsheet, minus the spreadsheet", "40 shipping bills a month, keyed by hand?"],
  emailExample: `Hi [Name],
Most finance teams end the month the same way: an envelope of receipts, and someone retyping them into a spreadsheet. Shipping bills are the worst of it, because every charge line, BL number and container number gets keyed by hand.
Doc Ledger takes the typing out. Your staff photograph the receipt, the system reads it and fills in the fields, and a person checks the result and saves it. Finance exports a finished four sheet workbook instead of building one.
It handles what generic expense apps do not: freight invoices with itemised charges, fuel receipts with litres, odometer and plate, foreign currency converted at the rate on the day it was spent, and duplicate receipts rejected before they reach your books.
Your company files things your own way, so you define your own document types. Name the fields you need, describe what the document looks like, and it reads for those instead of ours.
Worth fifteen minutes to show you?
[Your name]`,
  emailRules: [
    "About 150 to 180 words. No adjectives doing the selling.",
    "The first sentence describes their Tuesday (their month end, their paperwork), never our product.",
    "The differentiator (their own document types) is the last thing before the ask, so it stays in mind.",
    "Never say AI in the subject line. The pain is the retyping; AI is how it is solved, not what is sold.",
    "Subject under 8 words, plain, no clickbait, no exclamation marks, no emojis, no bullet lists.",
    "One specific detail about their company in the first two sentences, from the research, never invented.",
    "End with the signature block from the clipboard and one plain opt out line: Reply stop and I will not write again.",
  ],
  replyWalkthrough: [
    "How it works: pick the type of document, drop in a photo or PDF, wait a few seconds. The extracted fields appear beside the document itself so the reviewer compares the two without switching windows. Anything the system was unsure about is marked, and the total on a shipping bill is built from the charge lines so it cross checks against the invoice. Save, and it is in the ledger.",
    "How it is organised: each company is a separate workspace, nobody outside it sees anything. Four roles: members record expenses, finance can delete records, export and set exchange rates, admins approve who joins and control the document types, and an owner holds it all. People request access and an admin approves them.",
    "How it is shaped to them: the three built in types came from a UAE food and beverage group (petty cash, fuel, shipping line bills). A different business in a different country has different paperwork, so there is a builder: name a new document type, add the fields you want, write a sentence or two telling the system what the document is and what to look for. Hotel folios with check in dates, contractor invoices with PO numbers, lab supply orders with batch codes. Categories, business units, currencies and rates are all theirs to set, and anything missing we build for them on their terms. Lead the second contact with this, a competitor cannot answer it quickly.",
  ],
  closingLine: "Every finance team has someone whose job is partly retyping what is already written on a piece of paper. This gives you that person back.",
  followUpAngles: [
    "Fuel receipts: litres, odometer and plate read off the receipt, no typing.",
    "Foreign currency: converted at the rate on the day it was spent, fixed at entry.",
    "Duplicates: the same receipt submitted twice is rejected before it reaches the books.",
    "Shipping bills: the total is built from the charge lines and cross checks against the invoice.",
    "Their own document types: name the fields, describe the document, it reads for those.",
  ],
} as const;

// One block for system prompts.
// What Partners offers a firm that refers clients. No number here on purpose: the founder sets the share on the call.
// Change this line when he decides the terms.
export const PARTNER_OFFER =
  "Doc Ledger rewards partners who refer clients with a share of the monthly fee for every client they bring, and their clients get the first month free. The exact share is agreed with the founder on a short call.";

export function docledgerKnowledge(): string {
  return [
    `Product: ${DOCLEDGER.paragraph}`,
    `Who buys it: ${DOCLEDGER.idealCustomer}`,
    `Pains it removes: ${DOCLEDGER.pains.join(" ")}`,
    `The strongest card: ${DOCLEDGER.differentiator}`,
    `Built on their terms: ${DOCLEDGER.builtToTheirTerms}`,
    DOCLEDGER.builtInTypes,
  ].join("\n");
}
