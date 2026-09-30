// Simulation playbooks: what each worker does in a day and how it looks in the building.
// The real playbooks (Phase 5 and 6) live under /agents. These only drive simulation mode.

export interface SimPlaybook {
  kind: string;
  labels: string[]; // 3 word task labels shown in the paper bubble
  perDay: number;
  durationMin: [number, number];
  nightOwl?: boolean; // Builder works at night
  searches?: [number, number];
}

export const SIM_PLAYBOOKS: Record<string, SimPlaybook> = {
  "docledger.scout": { kind: "find_leads", labels: ["Find freight forwarders", "Scan customs brokers", "List small 3PLs"], perDay: 3, durationMin: [10, 25], searches: [2, 5] },
  "docledger.analyst": { kind: "qualify_lead", labels: ["Score new lead", "Find decision maker", "Qualify prospect fit"], perDay: 5, durationMin: [8, 15], searches: [0, 2] },
  "docledger.writer": { kind: "draft_outreach", labels: ["Draft outreach email", "Personalise the pitch", "Write follow up"], perDay: 5, durationMin: [10, 20] },
  "docledger.chaser": { kind: "follow_up", labels: ["Chase warm reply", "Book demo slot", "Send follow up"], perDay: 3, durationMin: [5, 12] },
  "docledger.builder": { kind: "build_ticket", labels: ["Fix invoice export", "Add PDF import", "Speed up search"], perDay: 1, durationMin: [40, 90], nightOwl: true },
  "docledger.growth": { kind: "growth_ideas", labels: ["Study the funnel", "Pitch three ideas", "Review experiments"], perDay: 2, durationMin: [10, 20], searches: [0, 2] },
  "docledger.partners": { kind: "find_partners", labels: ["Find accounting partners", "Draft partner email", "Map freight associations"], perDay: 2, durationMin: [10, 20], searches: [1, 3] },
  "docledger.product": { kind: "product_review", labels: ["Read the replies", "Update the roadmap", "Write a ticket"], perDay: 2, durationMin: [8, 15] },
  "docledger.marketer": { kind: "marketing_pack", labels: ["Write LinkedIn post", "Draft listing text", "Write web page copy"], perDay: 2, durationMin: [8, 15] },
  "docledger.success": { kind: "success_email", labels: ["Welcome a trial", "Check in with a customer", "Prepare paid offer"], perDay: 2, durationMin: [5, 10] },
  "docledger.finance": { kind: "founder_report", labels: ["Count the funnel", "Cost per lead", "Weekly founder report"], perDay: 1, durationMin: [5, 10] },
  "deals.scout": { kind: "find_deals", labels: ["Scan Amazon deals", "Check Noon prices", "Fetch Sharaf DG"], perDay: 4, durationMin: [10, 20], searches: [0, 1] },
  "deals.editor": { kind: "write_post", labels: ["Write deal post", "Edit the headline", "Add affiliate link"], perDay: 10, durationMin: [5, 12] },
  "deals.publisher": { kind: "publish_post", labels: ["Publish deal post", "Update deals site", "Track post clicks"], perDay: 10, durationMin: [3, 8] },
};
