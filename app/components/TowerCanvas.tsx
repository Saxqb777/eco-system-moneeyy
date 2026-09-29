"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TowerState } from "@/lib/state";
import type { Selection, TowerScene } from "@/scene/TowerScene";
import { PanelHost, parsePanelParam, type PanelSel } from "./panels/PanelHost";

interface Props {
  initialState: TowerState;
  soundEnabled: boolean;
}

const LOW_KEY = "tower_low_effects";
const PANEL_W = 470;
const SLIDE_MS = 340;

// Mounts the PixiJS building, polls the state, keeps the simulation moving while the tab is open,
// and opens the brass framed panels when something in the building is clicked.
export default function TowerCanvas({ initialState, soundEnabled }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TowerScene | null>(null);
  const stateRef = useRef<TowerState>(initialState);
  const [state, setState] = useState<TowerState>(initialState);
  const [hover, setHover] = useState<Selection | null>(null);
  const [ready, setReady] = useState(false);
  const [low, setLow] = useState(false);
  const [panel, setPanel] = useState<PanelSel | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);

  const openPanel = useCallback((sel: PanelSel) => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setPanel(sel);
    window.requestAnimationFrame(() => setPanelOpen(true));
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setPanel(null);
      closeTimer.current = null;
    }, SLIDE_MS);
  }, []);

  const select = useCallback(
    (sel: Selection) => {
      if (sel.type === "agent") openPanel({ type: "agent", id: sel.id });
      else if (sel.type === "floor") openPanel({ type: "floor", slug: sel.slug });
      else if (sel.type === "ideas") openPanel({ type: "warden", tab: "ideas" });
      else openPanel({ type: "warden", tab: "office" });
    },
    [openPanel],
  );

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;
    let lowInitial = false;
    try {
      lowInitial = window.localStorage.getItem(LOW_KEY) === "1";
    } catch {
      lowInitial = false;
    }
    setLow(lowInitial);
    (async () => {
      const mod = await import("@/scene/TowerScene");
      if (cancelled) return;
      const scene = await mod.TowerScene.create(host, {
        onHover: setHover,
        onSelect: select,
        onSoundToggle: (on) => {
          fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "sound_enabled", value: on }) }).catch(() => null);
        },
        lowEffects: lowInitial,
        soundEnabled,
      });
      if (cancelled) {
        scene.destroy();
        return;
      }
      sceneRef.current = scene;
      scene.applyState(initialState);
      setReady(true);
      const onResize = () => scene.fit();
      window.addEventListener("resize", onResize);
      // Deep link: ?panel=warden:approvals, floor:docledger, agent:docledger_scout
      const wanted = parsePanelParam(new URLSearchParams(window.location.search).get("panel"), initialState);
      if (wanted) openPanel(wanted);
    })();
    return () => {
      cancelled = true;
      sceneRef.current?.destroy();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Escape closes the panel first, then the floor zoom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (panel) closePanel();
      else sceneRef.current?.focusFloor(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panel, closePanel]);

  // The building slides over and the chosen character keeps its outline while a panel is open.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setInset(panel && panelOpen ? PANEL_W : 0);
    const wardenId = stateRef.current.floors.flatMap((f) => f.agents).find((a) => a.kind === "warden")?.id ?? null;
    scene.highlightAgent(panel?.type === "agent" ? panel.id : panel?.type === "warden" && panel.tab === "office" ? wardenId : null);
  }, [panel, panelOpen, ready]);

  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        const data = await res.json();
        if (data.ok) {
          stateRef.current = data.state;
          setState(data.state);
          sceneRef.current?.applyState(data.state);
        }
      } catch {
        // keep the last state
      }
    }, 5000);
    return () => clearInterval(poll);
  }, []);

  useEffect(() => {
    if (!state.simulationMode) return;
    const sim = setInterval(() => {
      fetch("/api/sim/tick", { method: "POST" }).catch(() => null);
    }, 20000);
    return () => clearInterval(sim);
  }, [state.simulationMode]);

  function toggleLow() {
    const next = !low;
    setLow(next);
    try {
      window.localStorage.setItem(LOW_KEY, next ? "1" : "0");
    } catch {
      // storage may be blocked
    }
    sceneRef.current?.setLowEffects(next);
  }

  return (
    <div className="stage">
      <div ref={hostRef} className="stage-host" />
      {!ready ? <div className="stage-loading">Lights coming on</div> : null}
      <button className={`fx-toggle ${low ? "on" : ""}`} onClick={toggleLow} title="Turns off ambient motion and parallax for weaker machines">
        {low ? "Low effects: on" : "Low effects: off"}
      </button>
      {hover && !panel ? <div className="stage-hover">{describe(hover, state)}</div> : null}
      {panel ? <PanelHost sel={panel} open={panelOpen} state={state} scene={ready ? sceneRef.current : null} onClose={closePanel} onNavigate={openPanel} /> : null}
    </div>
  );
}

function describe(sel: Selection, state: TowerState): string {
  if (sel.type === "warden") return "Warden: penthouse";
  if (sel.type === "ideas") return "Ideas: the mail slot";
  if (sel.type === "floor") {
    const f = state.floors.find((x) => x.slug === sel.slug);
    return f ? `${f.name}: ${f.status}` : sel.slug;
  }
  for (const f of state.floors) {
    const a = f.agents.find((x) => x.id === sel.id);
    if (a) return `${a.name}, ${a.role}: ${a.status}${a.currentTask ? `, ${a.currentTask.title}` : ""}`;
  }
  return sel.slug;
}
