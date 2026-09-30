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
- Phase 2 merged to main by Saaqib 2026-09-29 (pull request 1). Production runs the game.
- Phase 3 (panels): built 2026-09-29 on the dev branch, reviewed by nobody yet (Saaqib slept): brass framed screens on a hinge sliding out of the building (character, floor, Warden with tabs Office, Approvals, Setup, Brief, Budget, Ideas), editable name plates, approve and reject with feedback, setup clipboard with paste boxes, ideas mail slot, pause and resume, deep links via ?panel=. APIs: /api/agents/[id], /api/floors/[slug], /api/warden. Waiting for Saaqib's review on the branch preview, then one pull request.
- Phase 4 (Warden real): built 2026-09-30 on the dev branch, tested with fakes (no key): agents/client.ts wrapper with cost logging, agents/batches.ts, warden/{snapshot,prompt,decide,apply}.ts, lib/approvals.ts (raise plus decide, shared by panel, Telegram and simulation), lib/telegram.ts and lib/telegram-inbound.ts (pairing code, buttons, feedback, commands, ideas, queue with retries, webhook self registration), lib/budget.ts weekly review, warden/tick.ts eight steps. Saaqib's instruction 2026-09-29 night: keep building every phase without waiting; one pull request at the end. Needs from him to go real: Anthropic key, Telegram token plus /pair.
- Phase 5 (Floor 3 live): built 2026-09-30 on the dev branch, tested with fakes: agents/playbooks.ts (find_leads, qualify_lead, draft_outreach, follow_up), agents/workers.ts (batch submit inside the floor's share of the cap, results absorbed, tasks wait in review), agents/pipeline.ts (daily task creation, approved email sending, stale review acceptance, unlock items), lib/email.ts (Resend send, inbound webhook, reply matching), Telegram /reply, lib/builder.ts plus /api/builder plus scripts/builder.ts plus builder.yml (nightly, OIDC). Needs from him: repo URL and token, calendar link, Resend key and address, product facts.
- Phase 6 (Floor 2 live): built 2026-09-30 on the dev branch, tested with fakes: agents/deals-playbooks.ts (find_deals with web fetch, write_post), agents/deals.ts (daily scout, editor posts, scheduled publishing to the channel, click tracking, subscriber refresh), lib/affiliate.ts, public /deals page and /go/[code]. Needs from him: Amazon.ae tag (optional others), channel handle with the bot as admin.
- Phase 7: unlock items, Monday target notes and budget dynamics are in the pipeline and Warden (D041). Phases 3 to 7 sit on the dev branch in pull request 2 (https://github.com/Saxqb777/eco-system-moneeyy/pull/2) for Saaqib to merge (D042). Branch preview: https://the-tower-git-claude-relaxed-ritchie-kwg8g6-saxqb777s-projects.vercel.app Next session: read his notes, fix, then wait for keys. Simulation keeps running in production until the Anthropic key is pasted and simulation is switched off.
- Heartbeat: working since the Phase 2 merge touched tick.yml on main. First scheduled run 2026-09-29 22:55 UTC, first ticks row at 22:55:20 (trigger cron, done). GitHub delays slots by up to an hour under load, that is normal. /api/tick takes Bearer CRON_SECRET or x-tower-key too. This sandbox may not read secret values from .env.local: never try.

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
- Local visual check: TOWER_MOCK_STATE=1 OWNER_PASSCODE=towermock pnpm dev (the override means no real secret is read), then CHROMIUM_PATH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome PASSCODE=towermock node design/shot.mjs writes design/game-desktop.png, design/game-phone.png and the panel-*.png shots. Chromium in this sandbox needs the proxy passed explicitly (the script does it). The sandbox permission layer refuses reading secret values from .env.local: never try, use overrides.
