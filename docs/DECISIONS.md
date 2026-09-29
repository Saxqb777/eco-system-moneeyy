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
- D012 (Claude): the sandbox cannot open a database connection to Neon, so migrations and seeds run through the Neon connection (one transaction, journal row recorded) rather than the migrate script. The script still works from any normal machine.
- D013 (Claude): the temporary status page runs a simulation catch up on every open, so the building is alive on first load even before the hourly cron runs.
- D014 (Claude): the tick route accepts the owner cookie as well as the cron bearer secret, so Run Warden now can come from the game.
- D015 (Claude): Vercel Authentication (the team default deployment protection) is switched off on the tower project because it would block the cron and the Telegram webhook. The owner passcode protects the game instead.
- D016 (Claude): simulation mode is covered by an integration test on PGlite (a real Postgres in process) that applies the real migration, runs the real seed, simulates hours of activity and checks the invariants. It found and fixed a JSON null bug before anyone saw it. CI runs typecheck, tests and build on every push.
- D017 (Claude, with Saaqib's "you have all the access"): the heartbeat authenticates with a GitHub Actions OIDC token verified by the Tower (issuer, audience, repository and event checked, keys fetched from GitHub). No Actions secret is needed, which also removes a shared secret from the design. The proxy in this environment blocks the Actions secrets API and my permission layer refused the default branch change, so those stay with Saaqib as clicks.

## Phase 2 start (2026-09-29)

- D018 (Saaqib): Phase 1 accepted. GitHub default branch and Vercel production branch switched to main by Saaqib. Phase 2 started with the order: concept images (low poly and chunky pixel), palette and two fonts first, then wait for the pick, no PixiJS before that.
- D019 (Claude): review pages for Phase 2 live on the dev branch preview deployment, so main stays untouched until the phase pull request.
- D020 (Claude): concept round used gpt_image_2_5 (0.25 credits each) and Recraft V4.1 (1.25 credits each), 3 credits in total. Both Recraft outputs broke the hard bans and were rejected. Candidates shown to Saaqib: pixel-gpt.png (chunky pixel) and lowpoly-gpt.png (low poly). Waiting for his style pick and font pair pick.
- D021 (Saaqib): style B low poly, font pair 1 (Barlow Condensed display, IBM Plex Sans panels), palette accepted. Designs can change later.
- D022 (Claude): the low poly look is built as flat shaded vector geometry drawn with PixiJS Graphics (two or three tones per surface, faceted shapes), not bitmap sprite sheets. Static layers are cached as textures for 60 fps. Characters are small vector rigs animated by part transforms.
- D023 (Claude): a mock state mode (TOWER_MOCK_STATE=1, local only) serves a fixture so the scene can be screenshot tested without a database.
- D024 (Claude): Phase 2 review happens on the branch preview deployment (https://the-tower-git-claude-relaxed-ritchie-kwg8g6-saxqb777s-projects.vercel.app) so main stays untouched until the phase pull request. Floor plates sit on the slab fronts like lobby floor numbers, task labels float above heads, the lift is a real cabin with sliding doors and a queue.
- D025 (Saaqib): phone layout is parked. The game targets the Mac (16:9). A zoomed, scrolling phone view becomes a last optional phase after Phase 7, only if Saaqib asks.
- D026 (Saaqib): Phase 2 approved with fixes 1 to 9 and polish A to J, phone layout included after all (D025 reversed). K applies to Phase 3: panels styled as clipboards or brass framed screens sliding out of the building, never generic cards.
- D027 (Claude): frame budget rules. Ambient motion, parallax, haze, sandstorm, steam, paper flights and coin drops sit behind a Low Effects toggle (stored per browser). Static floor geometry stays untouched per frame; only small props animate.
- D028 (Claude): the heartbeat backup, if the schedule keeps missing: /api/tick already accepts a bearer secret, so an external cron service can call it with an Authorization header. Registering a cron-job.org job needs Saaqib's account.
- D029 (Claude): after three missed hourly slots the heartbeat backup is a cron-job.org job registered by Saaqib with the existing CRON_SECRET, hourly at minute 12 so it never collides with GitHub's minute 7 (SETUP.md 2c). A self registered caller (a Neon scheduled Function was ready to deploy) was dropped because this sandbox is not allowed to read the secret value. Suspected root cause: the schedule was registered while the dev branch was still the default, and only a change to the workflow file on main re registers it, so way A in SETUP.md 2c is a one line edit to tick.yml on main.
