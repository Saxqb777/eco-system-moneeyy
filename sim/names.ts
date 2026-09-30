// Fictional names for simulation mode. Nothing here is a real company or person.

export const COMPANY_PREFIX = [
  "Gulf Crescent", "Al Noor", "Jebel Blue", "Desert Wind", "Blue Anchor", "Falcon Bay", "Marina Line",
  "Oasis Trade", "Pearl Route", "Horizon Cargo", "Barakah", "Zayed Bay", "Sahara Bridge", "Corniche", "Palm Meridian",
];

export const COMPANY_SUFFIX: Record<string, string[]> = {
  freight_forwarder: ["Freight", "Logistics", "Shipping LLC", "Cargo Services"],
  customs_broker: ["Customs Brokers", "Clearing Services", "Trade Documentation"],
  small_3pl: ["3PL", "Fulfilment", "Warehousing"],
};

export const SEGMENTS = ["freight_forwarder", "freight_forwarder", "customs_broker", "small_3pl"];
export const CITIES = ["Dubai", "Dubai", "Jebel Ali", "Sharjah", "Abu Dhabi", "Ajman"];

export const FIRST_NAMES = ["Ahmed", "Fatima", "Rashid", "Priya", "Imran", "Sara", "Omar", "Neha", "Yusuf", "Layla", "Vikram", "Mariam", "Tariq", "Anita"];
export const LAST_NAMES = ["Al Mansoori", "Khan", "Sharma", "Haddad", "Fernandes", "Al Zaabi", "Nair", "Hussain", "Rahman", "Dsouza", "Qureshi", "Menon"];
export const TITLES = ["Operations Manager", "Managing Director", "Head of Documentation", "Finance Manager", "General Manager", "Customs Lead"];

export const PRODUCTS = [
  "Anker 20000mAh power bank", "Samsung 32 inch monitor", "Philips air fryer 6L", "Logitech MX Master 3S", "Sony WH 1000XM5 headphones",
  "Instant Pot Duo 7 in 1", "Dyson V12 vacuum", "Apple AirPods 4", "Kindle Paperwhite", "Nescafe Gold 200g twin pack",
  "Huggies size 4 box", "Tefal 5 piece cookware set", "Xiaomi robot vacuum S20", "LG 55 inch 4K TV", "Braun Series 9 shaver",
];
export const STORES = ["amazon_ae", "amazon_ae", "noon", "sharaf_dg", "carrefour", "talabat"];
export const STORE_LABEL: Record<string, string> = {
  amazon_ae: "Amazon.ae",
  noon: "Noon",
  sharaf_dg: "Sharaf DG",
  carrefour: "Carrefour",
  talabat: "Talabat",
};

export const TICKET_TITLES = [
  "Fix invoice export", "Add PDF import", "Speed up search", "Improve login page", "Add HS code lookup",
  "Fix date picker", "Add bulk upload", "Tidy settings page", "Add audit trail", "Fix mobile layout",
];

export const BLOCK_REASONS: { reason: string; needsOwner: boolean }[] = [
  { reason: "Need the calendar link to book the demo", needsOwner: true },
  { reason: "Store page blocked the fetch, need a fallback", needsOwner: false },
  { reason: "Lead has no public email, need a different contact", needsOwner: false },
  { reason: "Waiting for the affiliate id before adding links", needsOwner: true },
  { reason: "Repo tests failed on main, need a decision", needsOwner: false },
];

export const REJECT_REASONS = [
  "Too generic, no reference to the lead's own business",
  "Score reason does not match the evidence",
  "Post reads like an advert, cut the fluff",
  "Missing the price drop, only lists the product",
  "Follow up sent too soon after the first email",
];

export const STRATEGY_NOTES: Record<string, string[]> = {
  docledger: [
    "Freight forwarders in Jebel Ali answer faster than Sharjah. Shift Scout there this week.",
    "Emails that mention customs documentation delays get replies. Writer leads with that.",
    "Two demos slipped. Chaser books the slot in the first reply, no back and forth.",
  ],
  growth: [
    "Accounting firms that serve forwarders answer partner emails. Partners doubles down there.",
    "Replies ask about PDF bills from shipping lines. Product puts it at the top of the roadmap.",
    "Subject lines naming the port get more replies. Growth runs that test for two weeks.",
  ],
  deals: [
    "Electronics deals above 30 percent off get the clicks. Scout filters for those first.",
    "Posts after 20:00 Dubai do better. Publisher moves half the slots to the evening.",
    "Grocery deals earn nothing. Drop them until Carrefour affiliate is live.",
  ],
};

export const WARDEN_SUMMARIES = [
  "Reviewed the queue, reassigned two stale tasks, spend is inside the cap.",
  "Approved quality on most work. Rejected one outreach draft for being generic.",
  "Floor 2 is ahead of pace. Floor 3 needs more qualified leads, Scout gets a bigger quota tomorrow.",
  "No blockers open. Builder ticket queued for tonight.",
  "One worker raised a hand. Went down, unblocked it, back in the office.",
];
