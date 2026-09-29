"use client";

import { useEffect, useRef, useState } from "react";
import type { TowerState } from "@/lib/state";
import type { Selection, TowerScene } from "@/scene/TowerScene";

interface Props {
  initialState: TowerState;
}

// Mounts the PixiJS building, polls the state, and keeps the simulation moving while the tab is open.
export default function TowerCanvas({ initialState }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<TowerScene | null>(null);
  const [state, setState] = useState<TowerState>(initialState);
  const [hover, setHover] = useState<Selection | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;
    (async () => {
      const mod = await import("@/scene/TowerScene");
      if (cancelled) return;
      const scene = await mod.TowerScene.create(host, {
        onHover: setHover,
        onSelect: (sel) => setPicked(describe(sel, state)),
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
    })();
    return () => {
      cancelled = true;
      sceneRef.current?.destroy();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const poll = setInterval(async () => {
      try {
        const res = await fetch("/api/state", { cache: "no-store" });
        const data = await res.json();
        if (data.ok) {
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

  return (
    <div className="stage">
      <div ref={hostRef} className="stage-host" />
      {!ready ? <div className="stage-loading">Lights coming on</div> : null}
      {hover ? <div className="stage-hover">{describe(hover, state)}</div> : null}
      {picked ? (
        <div className="stage-toast" onClick={() => setPicked(null)}>
          {picked}. Panels arrive in Phase 3.
        </div>
      ) : null}
    </div>
  );
}

function describe(sel: Selection, state: TowerState): string {
  if (sel.type === "warden") return "Warden: penthouse";
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
