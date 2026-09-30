// The Tower's clock, deployed as a Neon Function (slug "heartbeat") on the Tower's Neon branch.
// A Neon schedule trigger calls it every 15 minutes (3,18,33,48 * * * *, UTC), even while the database
// sleeps. It knocks on the Tower's public /api/heartbeat, which runs a tick only when the last scheduled
// one is 10 minutes old. No secrets live here. Redeploy: see docs/DECISIONS.md D058.
const TOWER_URL = (process.env.TOWER_URL || "https://the-tower-saxqb777s-projects.vercel.app").replace(/\/$/, "");

export default {
  async fetch(request) {
    let scheduledAt = "manual";
    try {
      const body = await request.json();
      scheduledAt = body?.data?.scheduled_at ?? scheduledAt;
    } catch {
      // a plain call without a trigger body
    }
    try {
      const res = await fetch(`${TOWER_URL}/api/heartbeat?via=neon`, {
        method: "POST",
        headers: { "user-agent": "tower-heartbeat-neon" },
        signal: AbortSignal.timeout(25_000),
      });
      const text = (await res.text()).slice(0, 300);
      console.log(`heartbeat ${scheduledAt}: ${res.status} ${text}`);
      return Response.json({ ok: res.ok, status: res.status, body: text });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`heartbeat ${scheduledAt} failed: ${message}`);
      return Response.json({ ok: false, error: message }, { status: 502 });
    }
  },
};
