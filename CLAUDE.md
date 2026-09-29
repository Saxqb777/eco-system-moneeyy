# The Tower: project memory

Read this file first in every session. It is the cross chat memory for this repo.

## What this is
- The Tower is Saaqib's personal AI agent ecosystem: a real money making operation that looks like a tycoon game.
- Warden (the boss agent) runs a building of worker agents. Each floor is a business.
- Saaqib is the owner: he approves, gives ideas and pastes credentials. Everything else runs itself.
- The full brief is in docs/MASTER_PROMPT.md. Read it before writing any code.

## Non negotiable rules (short form, full text in the brief)
1. No external side effects (email, public post, merge, spend, cap raise) without an approved approval queue item.
2. Never exceed the daily API spend cap. Warden pauses floors when the cap hits.
3. Never merge to main in any repo. Builder opens pull requests only.
4. Simulation mode must work with zero API keys.
5. It must look like a real game. A generic AI dashboard look means the phase is rejected.
6. Ask Saaqib when blocked on something only he can provide. Never fake it, never stub it silently. Keep SETUP.md current.
7. No hyphens and no em dashes in UI text or agent output. Colons are fine. Code, URLs, package names and file names keep their hyphens.

## Working agreement with Saaqib
- Chat replies: dead simple, bullets. Explain heavily only when asked or when it really matters.
- Never implement or change anything without a full final confirmation. Propose first, then wait.
- One phase at a time. After each phase: deploy, give the URL, a 5 line summary and what is needed from him. Then stop.
- Development branch: claude/relaxed-ritchie-kwg8g6. Never push anywhere else without permission.

## Where things live
- docs/MASTER_PROMPT.md: the brief, verbatim.
- docs/PLAN.md: phases, architecture, schedules, budget math, design direction, risks.
- docs/DATA_MODEL.md: every table and column.
- docs/QUESTIONS.md: open questions and assumptions. Answers get written next to the question once given.
- docs/DECISIONS.md: decision log. Append only, never rewrite history.
- SETUP.md: everything Saaqib has to provide, with exact steps and current status.

## Status
- Phase 0 (plan): delivered and approved 2026-09-29. Answers in docs/QUESTIONS.md.
- Phase 1 (skeleton): delivered 2026-09-29, accepted by Saaqib (he started Phase 2). main is now the default and production branch. From here on: work on the dev branch, one pull request per phase, never push to main.
- Phase 2 (design): concepts shown 2026-09-29, Saaqib picked style B (low poly) and font pair 1 (Barlow Condensed plus IBM Plex Sans). Step 2 built 2026-09-29 and approved with fixes. Fix and polish batch (lift with landing doors, covered desks, centred labels, bigger Warden, obvious poses, receptionist, penthouse rug, phone zoom, ambient motion, idle variety, paper flights, coin drops, blocked lamp and alert, cap hit amber, level up fanfare, parallax and floor zoom, haze and sandstorm, Warden moods, name plates and quirks from the db, sound pack, Low Effects toggle) delivered for review on the branch preview URL. The old status page moved to /status.
- Phase 3 (panels): not started. Rule from Saaqib: panels are clipboards or brass framed screens sliding out of the building, matching the palette, never generic cards.
- Heartbeat: GitHub has not fired the tick schedule (slots 20:07, 21:07 and 22:07 UTC on 2026-09-29 missed, ticks table empty). /api/tick takes Bearer CRON_SECRET on main and also x-tower-key on the branch. Backup caller needs Saaqib (SETUP.md 2c: one line edit to tick.yml on main, or a cron-job.org job). This sandbox may not read the secret value, so do not try to register a caller yourself. Report the first ticks row when it lands.

## Accounts and services seen from this environment (2026-09-29)
- GitHub: Saxqb777. This repo (eco-system-moneeyy) is public. The proxy authenticates api.github.com calls as Saxqb777 but blocks the Actions secrets endpoints, and repository setting changes (default branch) are refused by the permission layer: ask Saaqib for those.
- Also on GitHub: Saxqb777/docledger (likely the DocLedger repo) and Saxqb777/deals-program.
- Vercel team: saxqb777s-projects (team_yKuXQ8P3eoGrvRnTWMIqSiGo). Tower project: the-tower (prj_c6WtQ5XBWTFdj1Zh3SnmsaayMVRw), region fra1, production URL https://the-tower-saxqb777s-projects.vercel.app
- Neon org: Saaqib (org-fragrant-rice-50839536), free plan. Tower project: the-tower (square-flower-63114503), Frankfurt, database tower, role tower_owner, branch main.
- This sandbox cannot connect to Neon directly (egress). Apply migrations through the Neon MCP run_sql_transaction (split on statement breakpoints) and insert the drizzle journal row by hand. Seed SQL: pnpm exec tsx scripts/seed-sql.ts.
- Higgsfield: basic plan, 70 credits (for concept art in Phase 2).
- Figma: Saaqib Khan's team, starter tier (optional for UI frames).
- Canva connector needs authorization in claude.ai connector settings before it can be used.
- WebFetch cannot reach vercel.com, neon.com or *.vercel.app from this environment (egress blocked). Use the Vercel and Neon MCP tools instead (web_fetch_vercel_url reads deployed pages).
- Secrets for the deployment live in Vercel env vars: DATABASE_URL, CRON_SECRET, OWNER_PASSCODE, SECRETS_KEY, TELEGRAM_WEBHOOK_SECRET. A local copy sits in .env.local (ignored by git) and is regenerated per session if needed from the Vercel project.

## Conventions once code exists
- pnpm. Next.js 15 App Router. TypeScript strict. Drizzle ORM on Neon Postgres.
- Model names live only in config/models.ts and are switchable per agent.
- Every model call goes through one wrapper that logs agent, model, tokens, cache hits, cost, duration and task id.
- Every side effect checks for an approved approval row first. No exceptions.
- Tests with vitest for budget rules, unlock rules, lift queue, cost math and the simulation generator.
- Local visual check: TOWER_MOCK_STATE=1 pnpm dev, then CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome PASSCODE=<passcode> node design/shot.mjs writes design/game-desktop.png and design/game-phone.png. Chromium in this sandbox needs the proxy passed explicitly (the script does it).
