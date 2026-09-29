# Decision log

Append only. Newest entries at the bottom. Each entry: id, date, decision, who decided, why.

## Phase 0 (2026-09-29)

- D001 (Claude, proposal): the plan lives in the repo as docs so every future session can read it. Cross chat memory is CLAUDE.md plus the docs folder.
- D002 (Claude, proposal, needs Saaqib): scheduled Warden runs go through the Claude Batch API to fit the 6 USD monthly Warden allocation. Instant synchronous runs happen when Saaqib pastes the API key, sends an idea, or presses Run Warden now.
- D003 (Claude, proposal, needs Saaqib): Builder runs inside a nightly GitHub Actions job, not on Vercel, because it needs git, node and a test run.
- D004 (Claude, proposal, needs Saaqib): the game UI sits behind a single owner passcode so only Saaqib can approve items or paste credentials.
- D005 (Claude, proposal, needs Saaqib): pasted credentials are stored encrypted in Neon (AES 256 GCM with a key held only in Vercel env vars). The UI never shows a stored secret again, only presence and the last 4 characters.
- D006 (Claude, proposal, needs Saaqib): the morning brief is built from data by code, not by a model call, so it costs nothing and always arrives.
- D007 (Claude, proposal, needs Saaqib): the levels are Lobby, Ground, Floor 1, Floor 2, Floor 3, Penthouse, with the roof counters above the Penthouse.

## Phase 1 start (2026-09-29)

- D008 (Saaqib): all Phase 0 recommendations accepted, questions 1 to 16 answered as recommended (see docs/QUESTIONS.md), assumptions A1 to A8 accepted.
- D009 (Saaqib): main is created once with the Phase 1 skeleton. After that, one pull request per phase, merged by Saaqib. Production follows main.
- D010 (Saaqib): the repo stays public for now.
- D011 (Claude, with Saaqib's yes): no Tailwind. Plain CSS with palette tokens so panels feel like the game's own UI, not a component library.
