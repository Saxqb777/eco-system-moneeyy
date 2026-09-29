import { getDb } from "@/db/client";
import { mockEnabled, mockState } from "@/lib/mock-state";
import { asBool, getSettings } from "@/lib/settings";
import { getTowerState, type TowerState } from "@/lib/state";
import { runSimulation } from "@/sim/generator";
import TopBar from "./components/TopBar";
import TowerCanvas from "./components/TowerCanvas";

export const dynamic = "force-dynamic";

export default async function GamePage() {
  let state: TowerState;
  let soundEnabled = false;
  if (mockEnabled()) {
    state = mockState();
  } else {
    const db = getDb();
    const settingsMap = await getSettings(db);
    soundEnabled = asBool(settingsMap.sound_enabled, false);
    if (asBool(settingsMap.simulation_mode, true)) {
      await runSimulation(db, new Date(), { maxSlices: 36 }).catch(() => null);
    }
    state = await getTowerState(db);
  }
  return (
    <div className="game">
      <TopBar simulationMode={state.simulationMode} />
      <TowerCanvas initialState={state} soundEnabled={soundEnabled} />
    </div>
  );
}
