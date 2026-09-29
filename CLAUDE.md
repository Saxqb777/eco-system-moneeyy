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
- Phase 1 (skeleton): in progress since 2026-09-29.
- Phase 2 and later: not started.

## Accounts and services seen from this environment (2026-09-29)
- GitHub: Saxqb777. This repo (eco-system-moneeyy) is public and was empty before Phase 0.
- Also on GitHub: Saxqb777/docledger (likely the DocLedger repo) and Saxqb777/deals-program.
- Vercel team: saxqb777s-projects (team_yKuXQ8P3eoGrvRnTWMIqSiGo). No tower project yet. Existing project deals-program.
- Neon org: Saaqib (org-fragrant-rice-50839536), free plan, 10 projects including doc-ledger and deals-program. No tower project yet.
- Higgsfield: basic plan, 70 credits (for concept art in Phase 2).
- Figma: Saaqib Khan's team, starter tier (optional for UI frames).
- Canva connector needs authorization in claude.ai connector settings before it can be used.
- WebFetch cannot reach vercel.com or neon.com from this environment (egress blocked). Use the Vercel and Neon MCP tools instead.

## Conventions once code exists
- pnpm. Next.js 15 App Router. TypeScript strict. Drizzle ORM on Neon Postgres.
- Model names live only in config/models.ts and are switchable per agent.
- Every model call goes through one wrapper that logs agent, model, tokens, cache hits, cost, duration and task id.
- Every side effect checks for an approved approval row first. No exceptions.
- Tests with vitest for budget rules, unlock rules, lift queue, cost math and the simulation generator.
