"use client";

import { useEffect, useState } from "react";
import type { WardenSummary } from "@/lib/detail";
import type { TowerState } from "@/lib/state";
import type { TowerScene } from "@/scene/TowerScene";
import { CharacterBody } from "./CharacterPanel";
import { FloorBody } from "./FloorPanel";
import { MailboxTab } from "./MailboxTab";
import { Panel, usePoll, type Tab } from "./shared";
import { ApprovalsTab, BriefTab, BudgetTab, IdeasTab, SetupTab, WardenControls } from "./WardenTabs";
import { CompanyTab } from "./CompanyTab";
import { TradingTab } from "./TradingTab";

export type WardenTab = "office" | "company" | "approvals" | "mailbox" | "setup" | "brief" | "budget" | "ideas";
export type PanelSel = { type: "agent"; id: string } | { type: "floor"; slug: string } | { type: "warden"; tab: WardenTab };

const WARDEN_TABS: WardenTab[] = ["office", "company", "approvals", "mailbox", "setup", "brief", "budget", "ideas"];

export function parsePanelParam(raw: string | null, state: TowerState): PanelSel | null {
  if (!raw) return null;
  const [kind, arg] = raw.split(":");
  if (kind === "warden") return { type: "warden", tab: WARDEN_TABS.includes(arg as WardenTab) ? (arg as WardenTab) : "office" };
  if (kind === "floor" && arg) return { type: "floor", slug: arg };
  if (kind === "agent" && arg) {
    for (const f of state.floors) {
      const a = f.agents.find((x) => x.id === arg || x.slug === arg);
      if (a) return a.kind === "warden" ? { type: "warden", tab: "office" } : { type: "agent", id: a.id };
    }
  }
  return null;
}

// Decides which panel to show for a selection and keeps the Warden tabs.
export function PanelHost({ sel, open, state, scene, onClose, onNavigate }: { sel: PanelSel; open: boolean; state: TowerState; scene: TowerScene | null; onClose: () => void; onNavigate: (sel: PanelSel) => void }) {
  if (sel.type === "agent") {
    let agent: TowerState["floors"][number]["agents"][number] | undefined;
    let floor: TowerState["floors"][number] | undefined;
    for (const f of state.floors) {
      const a = f.agents.find((x) => x.id === sel.id);
      if (a) {
        agent = a;
        floor = f;
      }
    }
    return (
      <Panel open={open} kicker={floor ? `${floor.name}, level ${floor.level}` : "Worker"} title={agent?.name ?? "Worker"} accent={floor?.accent} onClose={onClose}>
        <CharacterBody agentId={sel.id} scene={scene} onFloor={(slug) => onNavigate({ type: "floor", slug })} />
      </Panel>
    );
  }
  if (sel.type === "floor" && sel.slug === "trading") return <TradingPanel open={open} state={state} onClose={onClose} onNavigate={onNavigate} />;
  if (sel.type === "floor") {
    const floor = state.floors.find((f) => f.slug === sel.slug);
    return (
      <Panel open={open} kicker={floor ? `Level ${floor.level}, ${floor.status}` : "Floor"} title={floor?.name ?? sel.slug} accent={floor?.accent} onClose={onClose}>
        <FloorBody
          slug={sel.slug}
          onAgent={(id) => {
            const a = state.floors.flatMap((f) => f.agents).find((x) => x.id === id);
            onNavigate(a?.kind === "warden" ? { type: "warden", tab: "office" } : { type: "agent", id });
          }}
          onSetup={() => onNavigate({ type: "warden", tab: "setup" })}
        />
      </Panel>
    );
  }
  return <WardenPanel open={open} tab={sel.tab} state={state} scene={scene} onClose={onClose} onNavigate={onNavigate} />;
}

// Wall Street (D075): the race first, the floor's crew and money one tab over.
function TradingPanel({ open, state, onClose, onNavigate }: { open: boolean; state: TowerState; onClose: () => void; onNavigate: (sel: PanelSel) => void }) {
  const [tab, setTab] = useState<"race" | "floor">("race");
  const floor = state.floors.find((f) => f.slug === "trading");
  const tabs: Tab[] = [
    { id: "race", label: "Trading", icon: "chart" },
    { id: "floor", label: "Floor", icon: "floor" },
  ];
  return (
    <Panel open={open} kicker={floor ? `Level ${floor.level}, paper money` : "Wall Street"} title={floor?.name ?? "Wall Street"} accent={floor?.accent} tabs={tabs} tab={tab} onTab={(id) => setTab(id as "race" | "floor")} onClose={onClose}>
      {tab === "race" ? <TradingTab /> : null}
      {tab === "floor" ? (
        <FloorBody
          slug="trading"
          onAgent={(id) => onNavigate({ type: "agent", id })}
          onSetup={() => onNavigate({ type: "warden", tab: "setup" })}
        />
      ) : null}
    </Panel>
  );
}

function WardenPanel({ open, tab, state, scene, onClose, onNavigate }: { open: boolean; tab: WardenTab; state: TowerState; scene: TowerScene | null; onClose: () => void; onNavigate: (sel: PanelSel) => void }) {
  const warden = state.floors.flatMap((f) => f.agents).find((a) => a.kind === "warden");
  const penthouse = state.floors.find((f) => f.slug === "penthouse");
  const summary = usePoll<{ warden: WardenSummary }>("/api/warden", 10000);
  const [pendingCount, setPendingCount] = useState(state.pendingApprovals);
  useEffect(() => setPendingCount(summary.data?.warden.pendingApprovals ?? state.pendingApprovals), [summary.data, state.pendingApprovals]);
  const missing = summary.data?.warden.missingSetup.length;
  const mail = usePoll<{ counts: { hot: number; waiting: number } }>(open ? "/api/mailbox?filter=hot" : null, 30000);
  const hot = mail.data?.counts.hot;
  const tabs: Tab[] = [
    { id: "office", label: "Office", icon: "desk" },
    { id: "company", label: "Company", icon: "company" },
    { id: "approvals", label: "Approvals", icon: "phone", badge: pendingCount || undefined },
    { id: "mailbox", label: "Mailbox", icon: "tray", badge: hot || undefined },
    { id: "setup", label: "Setup", icon: "clipboard", badge: missing || undefined },
    { id: "brief", label: "Brief", icon: "brief" },
    { id: "budget", label: "Budget", icon: "coins" },
    { id: "ideas", label: "Ideas", icon: "mail" },
  ];
  const kicker = tab === "company" ? "DocLedger HQ" : tab === "approvals" ? "The red phone" : tab === "mailbox" ? "The mail room" : tab === "setup" ? "The clipboard" : tab === "ideas" ? "The mail slot" : tab === "brief" ? "Morning brief" : tab === "budget" ? "Spend cap and level" : "Penthouse";
  return (
    <Panel open={open} kicker={kicker} title={warden?.name ?? "Warden"} accent={penthouse?.accent} tabs={tabs} tab={tab} onTab={(id) => onNavigate({ type: "warden", tab: id as WardenTab })} onClose={onClose}>
      {tab === "office" && warden ? (
        <>
          <WardenControls warden={summary.data?.warden ?? null} />
          <CharacterBody agentId={warden.id} scene={scene} onFloor={(slug) => onNavigate({ type: "floor", slug })} />
        </>
      ) : null}
      {tab === "company" ? <CompanyTab onApprovals={() => onNavigate({ type: "warden", tab: "approvals" })} /> : null}
      {tab === "approvals" ? <ApprovalsTab onChanged={summary.reload} /> : null}
      {tab === "mailbox" ? <MailboxTab onApprovals={() => onNavigate({ type: "warden", tab: "approvals" })} /> : null}
      {tab === "setup" ? <SetupTab /> : null}
      {tab === "brief" ? <BriefTab warden={summary.data?.warden ?? null} /> : null}
      {tab === "budget" ? <BudgetTab warden={summary.data?.warden ?? null} onChanged={summary.reload} /> : null}
      {tab === "ideas" ? <IdeasTab /> : null}
    </Panel>
  );
}
