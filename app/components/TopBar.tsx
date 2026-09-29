"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

function dubaiClock(d: Date): string {
  const local = new Date(d.getTime() + 4 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return `${days[local.getUTCDay()]} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())} Dubai`;
}

export default function TopBar({ simulationMode }: { simulationMode: boolean }) {
  const router = useRouter();
  const [clock, setClock] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    const tick = () => setClock(dubaiClock(new Date()));
    tick();
    const id = setInterval(tick, 10000);
    return () => clearInterval(id);
  }, []);

  async function toggleSim() {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "simulation_mode", value: !simulationMode }) });
      const data = await res.json();
      if (!data.ok) setNote(data.error);
      else router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="topbar">
      <div className="topbar-title">The Tower</div>
      <div className="topbar-clock">{clock}</div>
      <div className="topbar-spacer" />
      {note ? <span className="topbar-note">{note}</span> : null}
      <button className={`stamp-toggle ${simulationMode ? "on" : "off"}`} onClick={() => void toggleSim()} disabled={busy}>
        {simulationMode ? "Simulation on" : "Simulation off"}
      </button>
    </header>
  );
}
