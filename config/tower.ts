// Seed definitions for the building: floors, agents, setup items and default settings.
// Levels from the bottom: 0 Lobby, 1 Ground, 2 Floor 1, 3 Floor 2, 4 Floor 3, 5 Penthouse.

// archived: a closed business, kept in the database but not shown anywhere (the Deals Engine since 2026-09-30).
export type FloorStatus = "locked" | "live" | "paused" | "archived";

export interface FloorDef {
  slug: string;
  name: string;
  level: number;
  accent: string;
  goalMetric: string;
  weeklyTarget: number;
  targetUnit: string;
  status: FloorStatus;
  unlockRule: string | null;
  unlockCondition: Record<string, number> | null;
  niche: string | null;
  nextNiches: string[];
  monthlyGuideUsd: number;
  isBusiness: boolean;
}

export const FLOORS: FloorDef[] = [
  {
    slug: "penthouse",
    name: "Penthouse",
    level: 5,
    accent: "#D4A537",
    goalMetric: "tower net earnings",
    weeklyTarget: 0,
    targetUnit: "USD",
    status: "live",
    unlockRule: null,
    unlockCondition: null,
    niche: null,
    nextNiches: [],
    monthlyGuideUsd: 6,
    isBusiness: false,
  },
  {
    slug: "docledger",
    name: "DocLedger Sales",
    level: 4,
    accent: "#2A9D8F",
    goalMetric: "demos booked",
    weeklyTarget: 1,
    targetUnit: "demos",
    status: "live",
    unlockRule: null,
    unlockCondition: null,
    niche: "freight forwarders worldwide",
    nextNiches: ["customs brokers", "small 3PLs", "food and beverage distributors", "trading companies with import volume"],
    monthlyGuideUsd: 9,
    isBusiness: true,
  },
  // DocLedger's second floor (D065): the people who grow the company around the sales team.
  {
    slug: "growth",
    name: "DocLedger Growth",
    level: 3,
    accent: "#3A86C8",
    goalMetric: "paying customers",
    weeklyTarget: 1,
    targetUnit: "customers",
    status: "live",
    unlockRule: null,
    unlockCondition: null,
    niche: "growth, partners, product, marketing, customer success, finance",
    nextNiches: [],
    monthlyGuideUsd: 9,
    isBusiness: true,
  },
  // Closed by the owner on 2026-09-30 (D064, D065): archived, its code and data kept.
  {
    slug: "deals",
    name: "Deals Engine",
    level: 3,
    accent: "#F08A24",
    goalMetric: "channel subscribers",
    weeklyTarget: 75,
    targetUnit: "subscribers",
    status: "archived",
    unlockRule: null,
    unlockCondition: null,
    niche: "UAE online deals",
    nextNiches: [],
    monthlyGuideUsd: 9,
    isBusiness: true,
  },
  {
    slug: "content",
    name: "Content Farm",
    level: 2,
    accent: "#5FA55A",
    goalMetric: "videos published",
    weeklyTarget: 0,
    targetUnit: "videos",
    status: "locked",
    unlockRule: "Unlocks when tower net earnings pass 100 USD and budget level is 2 or higher",
    unlockCondition: { net_usd_min: 100, budget_level_min: 2 },
    niche: null,
    nextNiches: [],
    monthlyGuideUsd: 0,
    isBusiness: true,
  },
  {
    slug: "service",
    name: "Service Marketing",
    level: 1,
    accent: "#C94F7C",
    goalMetric: "consulting enquiries",
    weeklyTarget: 0,
    targetUnit: "enquiries",
    status: "locked",
    unlockRule: "Unlocks after the first DocLedger demo is booked and budget level is 2 or higher",
    unlockCondition: { docledger_demos_min: 1, budget_level_min: 2 },
    niche: null,
    nextNiches: [],
    monthlyGuideUsd: 0,
    isBusiness: true,
  },
  {
    slug: "lobby",
    name: "Lobby",
    level: 0,
    accent: "#9C8F7A",
    goalMetric: "petty cash",
    weeklyTarget: 0,
    targetUnit: "USD",
    status: "live",
    unlockRule: null,
    unlockCondition: null,
    niche: null,
    nextNiches: [],
    monthlyGuideUsd: 0,
    isBusiness: false,
  },
];

export interface AgentDef {
  slug: string;
  floorSlug: string;
  name: string;
  role: string;
  kind: "warden" | "worker" | "builder";
  modelKey: "warden" | "worker" | "builder";
  playbookKey: string;
  sprite: { hair: number; glasses: boolean; mug: boolean; slouch: boolean; coat: boolean; tone: number; mugColor: string; quirk: string };
}

export const AGENTS: AgentDef[] = [
  { slug: "warden", floorSlug: "penthouse", name: "Warden", role: "warden", kind: "warden", modelKey: "warden", playbookKey: "warden", sprite: { hair: 0, glasses: false, mug: false, slouch: false, coat: true, tone: 0, mugColor: "#2B2F3A", quirk: "window" } },
  { slug: "docledger_scout", floorSlug: "docledger", name: "Scout", role: "scout", kind: "worker", modelKey: "worker", playbookKey: "docledger.scout", sprite: { hair: 1, glasses: false, mug: true, slouch: false, coat: false, tone: 1, mugColor: "#C9963B", quirk: "stretch" } },
  { slug: "docledger_analyst", floorSlug: "docledger", name: "Analyst", role: "analyst", kind: "worker", modelKey: "worker", playbookKey: "docledger.analyst", sprite: { hair: 2, glasses: true, mug: false, slouch: false, coat: false, tone: 2, mugColor: "#2A9D8F", quirk: "spin" } },
  { slug: "docledger_writer", floorSlug: "docledger", name: "Writer", role: "writer", kind: "worker", modelKey: "worker", playbookKey: "docledger.writer", sprite: { hair: 3, glasses: false, mug: true, slouch: false, coat: false, tone: 3, mugColor: "#F3E9D2", quirk: "cooler" } },
  { slug: "docledger_chaser", floorSlug: "docledger", name: "Chaser", role: "chaser", kind: "worker", modelKey: "worker", playbookKey: "docledger.chaser", sprite: { hair: 4, glasses: true, mug: true, slouch: true, coat: false, tone: 1, mugColor: "#C94F7C", quirk: "nap" } },
  { slug: "docledger_builder", floorSlug: "docledger", name: "Builder", role: "builder", kind: "builder", modelKey: "builder", playbookKey: "docledger.builder", sprite: { hair: 5, glasses: true, mug: false, slouch: false, coat: false, tone: 2, mugColor: "#5DA9E9", quirk: "chat" } },
  // DocLedger Growth floor (D065)
  { slug: "growth_lead", floorSlug: "growth", name: "Growth", role: "head of growth", kind: "worker", modelKey: "worker", playbookKey: "docledger.growth", sprite: { hair: 6, glasses: false, mug: true, slouch: false, coat: false, tone: 2, mugColor: "#3A86C8", quirk: "window" } },
  { slug: "growth_partners", floorSlug: "growth", name: "Partners", role: "partnerships", kind: "worker", modelKey: "worker", playbookKey: "docledger.partners", sprite: { hair: 1, glasses: true, mug: false, slouch: false, coat: false, tone: 0, mugColor: "#D4A537", quirk: "chat" } },
  { slug: "growth_product", floorSlug: "growth", name: "Product", role: "product manager", kind: "worker", modelKey: "worker", playbookKey: "docledger.product", sprite: { hair: 3, glasses: true, mug: true, slouch: false, coat: false, tone: 1, mugColor: "#5DA9E9", quirk: "spin" } },
  { slug: "growth_marketer", floorSlug: "growth", name: "Marketer", role: "marketer", kind: "worker", modelKey: "worker", playbookKey: "docledger.marketer", sprite: { hair: 4, glasses: false, mug: true, slouch: false, coat: false, tone: 3, mugColor: "#C94F7C", quirk: "cooler" } },
  { slug: "growth_success", floorSlug: "growth", name: "Success", role: "customer success", kind: "worker", modelKey: "worker", playbookKey: "docledger.success", sprite: { hair: 2, glasses: false, mug: false, slouch: false, coat: false, tone: 2, mugColor: "#5FA55A", quirk: "stretch" } },
  { slug: "growth_finance", floorSlug: "growth", name: "Finance", role: "finance", kind: "worker", modelKey: "worker", playbookKey: "docledger.finance", sprite: { hair: 0, glasses: true, mug: true, slouch: true, coat: false, tone: 1, mugColor: "#2B2F3A", quirk: "nap" } },
  { slug: "deals_scout", floorSlug: "deals", name: "Scout", role: "scout", kind: "worker", modelKey: "worker", playbookKey: "deals.scout", sprite: { hair: 2, glasses: false, mug: false, slouch: false, coat: false, tone: 3, mugColor: "#F08A24", quirk: "cooler" } },
  { slug: "deals_editor", floorSlug: "deals", name: "Editor", role: "editor", kind: "worker", modelKey: "worker", playbookKey: "deals.editor", sprite: { hair: 0, glasses: true, mug: true, slouch: false, coat: false, tone: 0, mugColor: "#5FA55A", quirk: "spin" } },
  { slug: "deals_publisher", floorSlug: "deals", name: "Publisher", role: "publisher", kind: "worker", modelKey: "worker", playbookKey: "deals.publisher", sprite: { hair: 3, glasses: false, mug: true, slouch: true, coat: false, tone: 2, mugColor: "#E0B04A", quirk: "stretch" } },
];

export interface SetupItemDef {
  key: string;
  label: string;
  howTo: string;
  kind: "secret" | "text" | "url";
  requiredFor: string[];
  sort: number;
}

export const SETUP_ITEMS: SetupItemDef[] = [
  { key: "anthropic_api_key", label: "Anthropic API key", howTo: "console.anthropic.com, API Keys, Create Key. Required to leave simulation.", kind: "secret", requiredFor: ["real_mode"], sort: 1 },
  { key: "telegram_bot_token", label: "Telegram bot token", howTo: "Telegram, BotFather, /newbot, copy the token. Required for reports.", kind: "secret", requiredFor: ["telegram"], sort: 2 },
  { key: "telegram_chat_id", label: "Your Telegram chat id", howTo: "Message your bot once, then Warden reads the chat id from the first message. Or paste it here.", kind: "text", requiredFor: ["telegram"], sort: 3 },
  { key: "docledger_repo_url", label: "DocLedger GitHub repo URL", howTo: "The repository Builder works on: the live DocLedger app, https://github.com/Saxqb777/Petty-Cash-", kind: "url", requiredFor: ["builder"], sort: 4 },
  { key: "docledger_github_token", label: "GitHub token for the DocLedger repo", howTo: "github.com, Settings, Developer settings, Fine grained tokens: only the Petty-Cash- repo, Contents and Pull requests read and write. Builder never merges.", kind: "secret", requiredFor: ["builder"], sort: 5 },
  { key: "calendar_link", label: "Calendar booking link", howTo: "Cal.com, Calendly or Google appointment page. Chaser sends it to book demos.", kind: "url", requiredFor: ["docledger"], sort: 6 },
  { key: "resend_api_key", label: "Resend API key", howTo: "resend.com, verify your sending domain, then API Keys, Create. Needed to send approved emails.", kind: "secret", requiredFor: ["email"], sort: 7 },
  { key: "resend_from", label: "Sending address", howTo: "An address on the domain you verified in Resend, for example you@yourdomain.com", kind: "text", requiredFor: ["email"], sort: 8 },
  { key: "resend_webhook_secret", label: "Resend webhook secret (replies)", howTo: "Optional. Resend, Receiving, add your domain's MX record, then Webhooks, add https://the-tower-saxqb777s-projects.vercel.app/api/email/inbound for email.received and paste the signing secret (starts with whsec_). Without it, forward replies with /reply on Telegram.", kind: "secret", requiredFor: [], sort: 15 },
  { key: "docledger_product_facts", label: "DocLedger price and signature block", howTo: "Your price line (for example 99 USD a month per company, first month free) and the signature Writer signs with: name, title, phone. The product story itself is in the repo (config/docledger.ts).", kind: "text", requiredFor: ["docledger"], sort: 9 },
  { key: "affiliate_amazon_ae", label: "Amazon.ae Associates tag", howTo: "affiliate-program.amazon.ae, Associates account, copy the tracking tag (looks like name-21).", kind: "text", requiredFor: ["deals"], sort: 10 },
  { key: "affiliate_noon", label: "Noon affiliate id", howTo: "Usually through a network such as ArabClicks or Involve Asia. Paste the tracking id or link template.", kind: "text", requiredFor: [], sort: 11 },
  { key: "affiliate_other", label: "Other affiliate ids", howTo: "Sharaf DG, Carrefour, Talabat: paste ids or link templates if you have them. Optional.", kind: "text", requiredFor: [], sort: 12 },
  { key: "deals_channel", label: "Telegram deals channel handle", howTo: "Create a public channel, add your bot as admin with Post messages, paste the handle like @uaedailydeals.", kind: "text", requiredFor: ["deals"], sort: 13 },
  { key: "consulting_site_url", label: "Consulting site URL", howTo: "Only needed when the Ground floor unlocks.", kind: "url", requiredFor: ["service"], sort: 14 },
  { key: "business_address", label: "Business postal address (optional)", howTo: "DocLedger emails worldwide. US law asks for a postal address under the signature of a business email, so the Scout skips US companies until one is here. Paste the address to print under your signature, for example your company address.", kind: "text", requiredFor: [], sort: 18 },
  { key: "x_credentials", label: "X account for deal posts (optional)", howTo: "Growth: every approved deal also goes to your X account. developer.x.com, create a project and an app with Read and write, then Keys and tokens. Paste four values separated by spaces, in this order: API Key, API Key Secret, Access Token, Access Token Secret.", kind: "secret", requiredFor: [], sort: 16 },
  { key: "facebook_page", label: "Facebook Page for deal posts (optional)", howTo: "Growth: every approved deal also goes to your Facebook Page. Create a Page for the deals, a Meta app with pages_manage_posts, and a Page access token that does not expire. Paste the Page ID and the token separated by a space.", kind: "secret", requiredFor: [], sort: 17 },
];

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  simulation_mode: true,
  daily_cap_usd: 1.7,
  hard_ceiling_usd: 5,
  budget_level: 1,
  timezone: "Asia/Dubai",
  warden_interval_hours: 4,
  brief_hour_local: 8,
  sound_enabled: false,
  allocation_guide_usd: { warden: 6, growth: 9, docledger: 9, builder: 12, web_search: 9, buffer: 5 },
  // Share of the daily cap one business floor may use before it waits for tomorrow (D065). DocLedger's two
  // floors together get 80 percent; any other floor 40 percent.
  floor_share: { docledger: 0.55, growth: 0.25 },
  model_overrides: {},
  launch_date: null,
  sim_cursor: null,
};

// Which setup keys must be present for a floor to leave the greyed state.
export const FLOOR_REQUIREMENTS: Record<string, string[]> = {
  docledger: ["calendar_link", "docledger_product_facts", "resend_api_key", "resend_from"],
  growth: [],
  deals: ["affiliate_amazon_ae", "deals_channel"],
  content: [],
  service: ["consulting_site_url"],
  penthouse: [],
  lobby: [],
};
