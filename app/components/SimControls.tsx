"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

// Temporary controls for the Phase 1 status page. In simulation mode the page asks the server
// for a simulation step every 20 seconds, the same rhythm the game will use.
export default function SimControls({ simulationMode }: { simulationMode: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<string>("");

  async function step() {
    setBusy(true);
    try {
      const res = await fetch("/api/sim/tick", { method: "POST" });
      const data = await res.json();
      setLast(data.ok ? `${data.summary.slices} slices, ${data.summary.tasksStarted} started, ${data.summary.tasksFinished} finished` : `error: ${data.error}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!simulationMode) return;
    const id = setInterval(() => void step(), 20_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulationMode]);

  async function toggleSim() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "simulation_mode", value: !simulationMode }) });
      const data = await res.json();
      if (!data.ok) setLast(data.error);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bar">
      <button onClick={() => void step()} disabled={busy}>Run simulation step</button>
      <button className="secondary" onClick={() => void toggleSim()} disabled={busy}>
        {simulationMode ? "Simulation: ON" : "Simulation: OFF"}
      </button>
      <span className="note">{last}</span>
    </div>
  );
}
