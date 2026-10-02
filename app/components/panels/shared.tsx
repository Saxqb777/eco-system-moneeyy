"use client";

import { useEffect, useState, type ReactNode } from "react";
import { dubaiParts } from "@/lib/time";

// Shared pieces of the game's panels: the brass framed screen, paper sheets, keys, pills, icons and helpers.

export function usePoll<T>(url: string | null, ms = 5000): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        const body = await res.json();
        if (cancelled) return;
        if (body.ok) {
          setData(body as T);
          setError(null);
        } else setError(body.error ?? "The building did not answer");
      } catch {
        if (!cancelled) setError("No reply from the building");
      }
    };
    void load();
    const id = setInterval(() => void load(), ms);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [url, ms, n]);
  return { data, error, reload: () => setN((x) => x + 1) };
}

export async function post(url: string, body: unknown, method = "POST"): Promise<{ ok: boolean; error?: string; [k: string]: unknown }> {
  try {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return (await res.json()) as { ok: boolean; error?: string };
  } catch {
    return { ok: false, error: "No reply from the building" };
  }
}

export function usd(n: number | null | undefined): string {
  return `${(n ?? 0).toFixed(2)} USD`;
}

export function when(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = dubaiParts(d);
  const today = dubaiParts(now).dayKey === p.dayKey;
  const pad = (x: number) => String(x).padStart(2, "0");
  const hm = `${pad(p.hour)}:${pad(p.minute)}`;
  return today ? hm : `${p.dayKey.slice(5)} ${hm}`;
}

export function since(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "";
  const ms = now.getTime() - new Date(iso).getTime();
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} days`;
}

export function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export const APPROVAL_TYPES: Record<string, string> = {
  outreach_email: "Outreach email",
  public_post: "Public post",
  pull_request: "Pull request",
  spend_increase: "Spend increase",
  floor_unlock: "Floor unlock",
  credential_request: "Credential request",
  decision: "Decision",
};

export function Pill({ status, children }: { status: string; children?: ReactNode }) {
  return <span className={`pill-s ${status}`}>{children ?? titleCase(status)}</span>;
}

export function Sheet({ title, clip, accent, children, className }: { title?: string; clip?: boolean; accent?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`sheet ${clip ? "clip" : ""} ${className ?? ""}`} style={accent ? ({ ["--accent" as string]: accent } as React.CSSProperties) : undefined}>
      {title ? <h3>{title}</h3> : null}
      {children}
    </section>
  );
}

export function Key({ children, onClick, tone, small, disabled, title, type }: { children: ReactNode; onClick?: () => void; tone?: "ok" | "bad" | "plain"; small?: boolean; disabled?: boolean; title?: string; type?: "button" | "submit" }) {
  return (
    <button type={type ?? "button"} className={`key ${tone ?? ""} ${small ? "small" : ""}`} onClick={onClick} disabled={disabled} title={title}>
      {children}
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

// Hand drawn icons in the palette. Never emoji.
const ICON_STYLE = { width: 15, height: 15, display: "inline-block", verticalAlign: "-2px" } as const;

export type IconName = "desk" | "phone" | "clipboard" | "brief" | "coins" | "mail" | "floor" | "tray" | "company" | "chart" | "terminal" | "candle" | "coin" | "mic" | "ledger" | "report";

export function Icon({ name }: { name: IconName }) {
  switch (name) {
    case "terminal":
      return (
        <svg viewBox="0 0 16 16" style={ICON_STYLE} aria-hidden="true">
          <rect x="1.5" y="2.5" width="13" height="10" fill="#07100c" stroke="#c9963b" strokeWidth="1.2" />
          <path d="M4 6 L6.5 8 L4 10" fill="none" stroke="#3ddc84" strokeWidth="1.2" />
          <rect x="7.5" y="9.4" width="4" height="1.2" fill="#ffc857" />
          <rect x="5" y="13" width="6" height="1.2" fill="#8a6424" />
        </svg>
      );
    case "candle":
      return (
        <svg viewBox="0 0 16 16" style={ICON_STYLE} aria-hidden="true">
          <rect x="1.5" y="1.5" width="13" height="13" fill="#07100c" stroke="#c9963b" strokeWidth="1.2" />
          <rect x="4.2" y="3" width="0.8" height="10" fill="#3ddc84" />
          <rect x="3.2" y="5" width="2.8" height="5" fill="#3ddc84" />
          <rect x="7.6" y="4" width="0.8" height="8" fill="#ff5a4f" />
          <rect x="6.6" y="6" width="2.8" height="4" fill="#ff5a4f" />
          <rect x="11" y="3" width="0.8" height="9" fill="#3ddc84" />
          <rect x="10" y="4" width="2.8" height="5" fill="#3ddc84" />
        </svg>
      );
    case "coin":
      return (
        <svg viewBox="0 0 16 16" style={ICON_STYLE} aria-hidden="true">
          <circle cx="8" cy="8" r="6.2" fill="#e0b04a" stroke="#8a6424" strokeWidth="1.2" />
          <circle cx="8" cy="8" r="3.8" fill="none" stroke="#8a6424" strokeWidth="1" />
          <path d="M6.6 5.2 h2 a1.3 1.3 0 0 1 0 2.6 h-2 Z M6.6 7.8 h2.3 a1.3 1.3 0 0 1 0 2.6 h-2.3 Z" fill="none" stroke="#5a3a22" strokeWidth="1" />
        </svg>
      );
    case "mic":
      return (
        <svg viewBox="0 0 16 16" style={ICON_STYLE} aria-hidden="true">
          <rect x="6" y="2" width="4" height="7" rx="2" fill="#c9963b" stroke="#8a6424" strokeWidth="1" />
          <path d="M4.2 7.5 a3.8 3.8 0 0 0 7.6 0" fill="none" stroke="#e0b56a" strokeWidth="1.2" />
          <rect x="7.4" y="11.2" width="1.2" height="2.2" fill="#8a6424" />
          <rect x="5.5" y="13.2" width="5" height="1.2" fill="#8a6424" />
        </svg>
      );
    case "ledger":
      return (
        <svg viewBox="0 0 16 16" style={ICON_STYLE} aria-hidden="true">
          <rect x="3" y="1.5" width="10" height="13" fill="#f3e9d2" stroke="#5a3a22" strokeWidth="1" />
          <rect x="3" y="1.5" width="2" height="13" fill="#8c5a2b" />
          <rect x="6.5" y="4.5" width="5" height="1" fill="#1e1a16" />
          <rect x="6.5" y="7" width="5" height="1" fill="#1e1a16" />
          <rect x="6.5" y="9.5" width="3" height="1" fill="#1a8a4a" />
          <rect x="6.5" y="12" width="4" height="1" fill="#b8322a" />
        </svg>
      );
    case "report":
      return (
        <svg viewBox="0 0 16 16" style={ICON_STYLE} aria-hidden="true">
          <path d="M3 1.5 h7 l3 3 v10 h-10 Z" fill="#f3e9d2" stroke="#5a3a22" strokeWidth="1" />
          <path d="M10 1.5 v3 h3" fill="none" stroke="#5a3a22" strokeWidth="1" />
          <rect x="5" y="7" width="6" height="1" fill="#1e1a16" />
          <rect x="5" y="9.5" width="6" height="1" fill="#1e1a16" />
          <rect x="5" y="12" width="4" height="1" fill="#c9963b" />
        </svg>
      );
    case "chart":
      return (
        <svg viewBox="0 0 16 16" style={ICON_STYLE} aria-hidden="true">
          <rect x="1.5" y="1.5" width="13" height="13" fill="#07100c" stroke="#c9963b" strokeWidth="1.2" />
          <rect x="4" y="6" width="1.6" height="5" fill="#ff5a4f" />
          <rect x="7.2" y="4" width="1.6" height="6" fill="#3ddc84" />
          <rect x="10.4" y="3" width="1.6" height="5" fill="#3ddc84" />
          <path d="M3 12.5 L7 9 L9.5 10 L13 5" fill="none" stroke="#ffc857" strokeWidth="1" />
        </svg>
      );
    case "company":
      return (
        <svg viewBox="0 0 16 16" style={ICON_STYLE} aria-hidden="true">
          <rect x="2" y="2" width="12" height="12" fill="#f3e9d2" stroke="#8c5a2b" strokeWidth="1.2" />
          <rect x="4" y="9" width="2" height="3" fill="#2a9d8f" />
          <rect x="7" y="7" width="2" height="5" fill="#3a86c8" />
          <rect x="10" y="4.5" width="2" height="7.5" fill="#c9963b" />
        </svg>
      );
    case "tray":
      return (
        <svg viewBox="0 0 16 16" style={ICON_STYLE} aria-hidden="true">
          <rect x="4" y="2" width="9" height="6" fill="#f3e9d2" stroke="#8c5a2b" strokeWidth="1" transform="rotate(-6 8 5)" />
          <rect x="3" y="4" width="9" height="6" fill="#fffaf0" stroke="#8c5a2b" strokeWidth="1" />
          <path d="M3 4l4.5 3.5L12 4" fill="none" stroke="#8c5a2b" strokeWidth="1" />
          <path d="M1.5 9h4l1 2h3l1-2h4v5h-13z" fill="#c9963b" stroke="#8a6424" strokeWidth="1" />
        </svg>
      );
    case "phone":
      return (
        <svg viewBox="0 0 16 16" style={ICON_STYLE} aria-hidden="true">
          <path d="M2 4 L5 3 L7 6 L5.5 7.5 C6.5 9.5 7.5 10.5 9.5 11.5 L11 10 L14 12 L13 14 C8 14 2 9 2 4 Z" fill="#c0392b" stroke="#1e1a16" strokeWidth="1" />
        </svg>
      );
    case "clipboard":
      return (
        <svg viewBox="0 0 16 16" style={ICON_STYLE} aria-hidden="true">
          <rect x="3" y="3" width="10" height="12" fill="#f3e9d2" stroke="#8c5a2b" strokeWidth="1.2" />
          <rect x="5.5" y="1.5" width="5" height="3" fill="#c9963b" stroke="#8a6424" strokeWidth="1" />
          <path d="M5 8h6M5 10.5h6" stroke="#6e6455" strokeWidth="1" />
        </svg>
      );
    case "brief":
      return (
        <svg viewBox="0 0 16 16" style={ICON_STYLE} aria-hidden="true">
          <path d="M3 2h8l2 2v10H3z" fill="#f3e9d2" stroke="#8c5a2b" strokeWidth="1.2" />
          <path d="M5 6h6M5 8.5h6M5 11h4" stroke="#6e6455" strokeWidth="1" />
        </svg>
      );
    case "coins":
      return (
        <svg viewBox="0 0 16 16" style={ICON_STYLE} aria-hidden="true">
          <ellipse cx="8" cy="11" rx="5.5" ry="2.5" fill="#c9963b" stroke="#8a6424" strokeWidth="1" />
          <ellipse cx="8" cy="8" rx="5.5" ry="2.5" fill="#e0b56a" stroke="#8a6424" strokeWidth="1" />
          <ellipse cx="8" cy="5" rx="5.5" ry="2.5" fill="#c9963b" stroke="#8a6424" strokeWidth="1" />
        </svg>
      );
    case "mail":
      return (
        <svg viewBox="0 0 16 16" style={ICON_STYLE} aria-hidden="true">
          <rect x="2" y="4" width="12" height="9" fill="#f3e9d2" stroke="#8c5a2b" strokeWidth="1.2" />
          <path d="M2 4l6 5 6-5" fill="none" stroke="#8c5a2b" strokeWidth="1.2" />
        </svg>
      );
    case "floor":
      return (
        <svg viewBox="0 0 16 16" style={ICON_STYLE} aria-hidden="true">
          <rect x="2" y="3" width="12" height="10" fill="#343946" stroke="#c9963b" strokeWidth="1.2" />
          <path d="M2 8h12M6 3v10M10 3v10" stroke="#c9963b" strokeWidth="1" />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 16 16" style={ICON_STYLE} aria-hidden="true">
          <rect x="2" y="7" width="12" height="2.5" fill="#8c5a2b" />
          <rect x="3" y="9.5" width="2" height="4" fill="#5a3a22" />
          <rect x="11" y="9.5" width="2" height="4" fill="#5a3a22" />
          <rect x="5" y="3" width="6" height="4" fill="#7fc8c0" stroke="#1e1a16" strokeWidth="1" />
        </svg>
      );
  }
}

export interface Tab {
  id: string;
  label: string;
  icon: IconName;
  badge?: number;
}

export function Panel({ open, kicker, title, accent, tabs, tab, onTab, onClose, children }: { open: boolean; kicker: string; title: string; accent?: string; tabs?: Tab[]; tab?: string; onTab?: (id: string) => void; onClose: () => void; children: ReactNode }) {
  return (
    <aside className={`panel ${open ? "open" : ""}`} style={{ ["--accent" as string]: accent ?? "#c9963b" } as React.CSSProperties} aria-label={title}>
      <div className="panel-frame">
        <div className="panel-hinge" />
        <header className="panel-head">
          <div className="panel-plate">
            <div className="panel-kicker">{kicker}</div>
            <h2 className="panel-title">{title}</h2>
          </div>
          <button className="panel-close" onClick={onClose} title="Close (Escape)">
            Close
          </button>
        </header>
        {tabs ? (
          <nav className="panel-tabs">
            {tabs.map((t) => (
              <button key={t.id} className={`tab ${tab === t.id ? "on" : ""}`} onClick={() => onTab?.(t.id)}>
                <Icon name={t.icon} /> {t.label}
                {t.badge ? <span className="badge">{t.badge}</span> : null}
              </button>
            ))}
          </nav>
        ) : null}
        <div className="panel-body">{children}</div>
      </div>
    </aside>
  );
}
