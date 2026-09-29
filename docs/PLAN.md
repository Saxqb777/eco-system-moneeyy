# The Tower: build plan (Phase 0)

Date: 2026-09-29. Status: proposal. Nothing is built yet. Waiting for Saaqib's approval and the answers in docs/QUESTIONS.md before Phase 1.

## 1. Summary in ten lines

- One Next.js 15 app on Vercel Hobby holds the game, the API, the Telegram webhook and the public deals page.
- Neon Postgres via Drizzle holds everything. Every model call, every cost and every revenue entry is a row.
- One heartbeat route, /api/tick, does all scheduled work in short idempotent steps. GitHub Actions cron hits it every hour.
- Worker agents run through the Claude Batch API at half price. Their results come back on the next tick.
- Warden runs on Opus 5.5. Scheduled runs go through Batch to fit the budget. Instant runs happen when Saaqib acts.
- Builder runs inside a nightly GitHub Actions job because it needs git, node and a test run. It only opens pull requests.
- The approval queue is one table. Every side effect checks it first. Telegram inline buttons write to the same table.
- Simulation mode is real rows marked simulated, made by a seeded generator, so panels, lift and counters work with zero keys.
- The scene is PixiJS v8 with original sprites. Two style concepts come before Phase 2 and Saaqib picks one.
- Budget at launch: about 0.93 USD a day estimated against the 1.70 USD cap. Details in section 4.

## 2. Stack and folders

- Next.js 15 App Router, React 19, TypeScript strict, pnpm. Deployed on Vercel Hobby, functions in Frankfurt (fra1), the closest region to Dubai.
- Neon Postgres, Frankfurt (eu-central-1), Drizzle ORM, @neondatabase/serverless driver. Migrations in /db/migrations.
- @anthropic-ai/sdk. Models only in /config/models.ts: Warden claude-opus-5-5, workers and Builder claude-sonnet-5-5. Prices for cost math live in the same file.
- PixiJS v8 plus pixi-filters for the hover outline. Client only component, no server rendering of the canvas.
- Telegram Bot API over plain HTTPS. Resend SDK for email. Google Fonts through next/font.
- Tests: vitest for budget rules, unlock rules, lift queue, cost math and the simulation generator. One Playwright smoke test that loads the game.

Folders, as the brief asks: /app, /agents, /warden, /scene, /sim, /db, /scripts, /config, /design, /docs.

Inside /agents: one folder per agent, for example /agents/docledger/scout with prompt.md (system prompt), tools.ts (tool definitions), playbook.ts (daily quotas, steps, output schema) and target.ts (the metric it is measured on).

## 3. Runtime design

### 3.1 The heartbeat (tick)

- GitHub Actions workflow tick.yml runs every hour at minute 7 (UTC) and calls GET /api/tick with a bearer CRON_SECRET. A second schedule at 03:55 UTC lands the morning brief right on 08:00 Dubai.
- The tick does bounded work in a fixed order. Each step is idempotent, so a repeated or delayed tick is harmless.
  1. Collect: for every open batch, ask Anthropic if it ended. If yes, read results, write task outputs, log agent_runs and budget_ledger rows, mark the batch collected.
  2. Advance: move tasks along their pipeline (for example scout output becomes analyst input), create follow up tasks, expire stale ones.
  3. Guard: compute today's spend per floor. Pause floors at the daily cap. Throttle any floor above 40 percent of the cap on its own (it gets no new tasks until tomorrow).
  4. Warden: if a scheduled run is due (every 4 hours, Dubai time) build the state snapshot and submit the Warden request.
  5. Apply: execute Warden decisions that have arrived (assignments, rejections with reasons, strategy notes, idea replies, reallocations, approval items to raise).
  6. Submit: turn all queued worker tasks into one batch, respecting the remaining floor budget, and submit it.
  7. Deliver: send queued outbound messages (Telegram brief, approval notices, replies) whose send time has passed.
  8. Simulation: when simulation mode is on, run the generator for the elapsed time so history stays continuous even when nobody is watching.
- The tick can also be triggered by the app itself, not only by cron: when the API key is pasted (so Warden speaks within 5 minutes), when Saaqib presses Run Warden now, when an idea arrives on Telegram, and when a worker raises a hand (blocked).
- Vercel function limits: the tick uses the plan maximum duration (300 seconds on Hobby with Fluid compute, to confirm at project creation). Every step is designed to finish in seconds because the heavy model work is asynchronous through Batch. The only long call is an instant Warden run (about 1 to 3 minutes), which streams to avoid idle timeouts.

### 3.2 Warden

- One structured decision per run, no tool loop. Code gathers the state (floors, targets, queue, finished work to review, spend, approvals, ideas, blockers) into a compact snapshot of at most about 4k tokens. Opus 5.5 returns one JSON object validated against a schema: assignments, reviews with scores and reasons, reassignments, strategy notes per floor, budget reallocation, idea actions, messages to Saaqib, approval items to raise.
- Code executes the decisions. This keeps Warden cheap, auditable (the snapshot and the decisions are stored in warden_runs) and deterministic to replay.
- Two modes, same prompt: batch for the six scheduled runs a day, sync for instant runs (setup complete, Run Warden now, new idea, blocked worker). Instant runs are rate limited to one per hour per trigger type.
- Quality review: finished worker outputs are scored 1 to 10 with a reason. Below 6 means rejected and requeued with the feedback attached. Review scores feed the character stats.
- Weekly target check: every Monday 08:00 Dubai, Warden compares each floor's weekly actual to the target and writes a strategy note on the floor when it missed.
- Morning brief at 08:00 Dubai: built by code from the ledger and the queue (money in, money out, what needs Saaqib, one line per floor). Warden's own words come from the latest strategy notes and decisions, so it reads as Warden without a model call.
- Blocked workers: when a task becomes blocked, code sets the worker to blocked, records a help_requested event, and moves Warden (status riding, then helping, location set to that floor). That is the real state change; the scene animates the lift ride from it. An instant Warden run then decides: reassign, give the missing input, or raise a decision item for Saaqib.

### 3.3 Workers and the batch pipeline

- A worker task is a row in tasks. The submit step turns queued tasks into batch requests: cached system prompt, playbook, the task input, and a JSON schema for the output (structured outputs). No forced tool choice, since the 5.5 models reject it.
- Web search uses the server side web_search tool with a hard max_uses per request and a per floor daily search cap from the playbook. Search counts come back in usage and are billed at 0.01 USD each.
- Every result is logged: agent, model, input tokens, output tokens, cache read tokens, cache write tokens, searches, cost, duration, task id, batch id.
- Batch timing: most batches finish inside an hour, worst case 24 hours. Tasks show the status in batch on the floor panel while they wait.

### 3.4 Builder

- Runs in builder.yml, a nightly GitHub Actions job at 02:00 Dubai. Free on this public repo.
- Steps: fetch the top open ticket from the Tower API, clone the DocLedger repo, run a Sonnet 5.5 tool loop with bash and file edit tools scoped to that checkout, run the repo's tests, push branch builder/<ticket>, open a pull request through the GitHub API, post the summary and the Vercel preview link as a pull_request approval item. Never merges. Never touches main.
- Hard limits per ticket: 25 tool calls, 0.40 USD, 20 minutes. If the limit hits, the job stops, marks the ticket failed with the reason, and Warden sees it in the morning.
- Why not on Vercel: functions have no shell, no git and a 5 minute ceiling.

### 3.5 Telegram

- Webhook mode: Telegram posts updates to /api/telegram with a secret token header. Only Saaqib's chat id is accepted, everything else is ignored.
- Approvals: each pending item is sent with two inline buttons, Approve and Reject. Reject asks for one line of feedback as the next message. Both paths write to the approvals table, the same rows the game panel shows.
- Ideas: any plain text message from Saaqib becomes an ideas row, gets an instant acknowledgement, and Warden replies with what it will do after its next run (instant run if within the hourly limit).
- Commands: /status, /brief, /pause <floor>, /resume <floor>, /cap (shows the cap and level).
- Outbound messages go through a messages_out queue delivered by the tick, so a failed send is retried and never duplicated.

### 3.6 Approvals

- One table, one panel, one Telegram flow. Types: outreach_email, public_post, pull_request, spend_increase, floor_unlock, credential_request, decision.
- Every side effect function (send email, post to channel, raise cap, unlock floor) takes an approval id and checks status approved before doing anything. There is no code path that sends without an approval row.
- Rejected items return to the owning agent as a requeued task carrying the feedback.
- Deals Engine auto approve: after 14 days of posts, Warden may raise a decision item asking to auto approve that floor. If approved, public_post items for that floor are auto approved by code and still logged.

### 3.7 Simulation mode

- Setting simulation_mode plus a toggle in the top bar. Default on. It can only be switched off when the Anthropic key is present.
- A seeded generator (/sim) creates believable tasks from each floor's playbook with 3 word labels, realistic durations, outcomes (done, rejected, blocked), fake leads with plausible UAE company names, fake approvals, fake posts and occasional fake commissions. Every row is marked simulated.
- While the game is open, the client asks /api/sim/tick every 20 seconds so the building is always moving. The hourly cron tick fills the gaps when nobody watches.
- Fake money renders in a different color with a SIMULATED stamp on the roof counter and the petty cash counter. Real counters only ever sum rows where simulated is false.
- Turning simulation off hides simulated rows from counters and panels. A Clear simulation data button deletes them.
- No API calls happen in simulation mode. The setup clipboard still shows what is missing.

### 3.8 Auth and secrets

- The game and its API sit behind an owner passcode (OWNER_PASSCODE env var, signed HttpOnly cookie). Public routes: /deals, /go/<code>, /api/telegram (secret header), /api/tick (bearer secret), /api/health.
- Pasted credentials are encrypted with AES 256 GCM using SECRETS_KEY (only in Vercel env vars) and stored in setup_items. The UI shows presence and the last 4 characters, never the value.
- The Builder job fetches what it needs (Anthropic key, DocLedger token) from an internal Tower endpoint authenticated with CRON_SECRET, so Saaqib pastes each secret exactly once.

### 3.9 Schedules (Dubai time, UTC plus 4)

| When | What |
|------|------|
| Every hour at :07 | Heartbeat tick |
| 00:00, 04:00, 08:00, 12:00, 16:00, 20:00 | Warden scheduled runs (batch) |
| 07:00 | DocLedger Scout submitted, Analyst follows on the next ticks, Writer drafts land in the approval queue by early afternoon |
| 08:00 | Morning brief on Telegram |
| 09:00 | Deals Scout, then Editor. Posts spread from 10:00 to 22:00, ten a day |
| 02:00 | Builder nightly ticket |
| Monday 08:00 | Weekly target review and strategy notes |
| Every 7 days from launch | Budget review: raise, hold or drop the level |

## 4. Budget math

Prices in USD per million tokens (from the Claude API reference, 2026-09).

| Model | Input | Output | Cache read | Batch input | Batch output |
|-------|-------|--------|------------|-------------|--------------|
| claude-opus-5-5 | 4.00 | 20.00 | 0.20 | 2.00 | 10.00 |
| claude-sonnet-5-5 | 2.00 | 10.00 | 0.20 | 1.00 | 5.00 |

Web search: 10 USD per 1,000 searches, so 0.01 USD each. Cache writes cost 1.25 times input for the 5 minute window.

Estimated spend per day once Floors 2 and 3 are live:

| Item | Assumption | USD a day | USD a month | Guide a month |
|------|------------|-----------|-------------|---------------|
| Warden scheduled | 6 batch runs, 10k in, 1.2k out | 0.19 | 5.8 | 6 |
| Warden instant | about 1 sync run a day | 0.08 | 2.4 | (inside Warden) |
| DocLedger Scout | 1 run, 5 searches | 0.09 | 2.7 | |
| DocLedger Analyst | 15 in, 5 out, 5 searches | 0.08 | 2.4 | |
| DocLedger Writer | 5 drafts | 0.03 | 0.9 | |
| DocLedger Chaser | follow ups and replies | 0.02 | 0.6 | 9 (floor) |
| Deals Scout | 20 deals, pages fetched directly | 0.11 | 3.3 | |
| Deals Editor | 10 posts | 0.03 | 0.9 | 9 (floor) |
| Builder | 1 ticket, capped at 0.40 | 0.36 | 10.8 | 12 |
| Web search | about 12 a day | 0.12 | 3.6 | 9 |
| Total | | 1.11 | 33 | 50 |

- The base cap is 1.70 USD a day. The estimate leaves about a third as headroom. Warden may move the guide amounts around inside the cap.
- The 40 percent throttle: no floor may spend more than 0.68 USD a day on its own. Builder at 0.36 is the closest.
- Budget level review every 7 days: verified revenue at least 2x spend raises the cap 25 percent (level plus 1) up to the 5 USD ceiling. Revenue below 1x spend for 2 weeks in a row drops one level. Verified means confirmed commissions or paid invoices only. Anything past the ceiling is a spend_increase approval item.
- Caching note: the brief asks for prompt caching on every system prompt. It pays off for workers and Builder, where many requests share a prompt within minutes. Warden's scheduled runs are 4 hours apart, so the 5 minute cache expires between them and the write costs 25 percent more than plain input on that one request. See question 6 in docs/QUESTIONS.md.

## 5. Design direction

The full palette, type scale, sprite sheet and concept images will live in /design. This section fixes the direction so Phase 2 has a target.

### 5.1 Camera and building

- Side cutaway with the front wall removed, slight isometric depth on desks and props, one building on a dark warm sky.
- Levels from bottom to top: Lobby (reception, lift doors, petty cash counter), Ground (Service Marketing, locked), Floor 1 (Content Farm, locked), Floor 2 (Deals Engine), Floor 3 (DocLedger Sales with the Workshop wing for Builder), Penthouse (Warden's office). The roof above the Penthouse carries the money counter, the spend counter, the budget level meter and the ideas mail slot.
- The lift shaft runs the full height on the left. The cabin is a real sprite with doors that open and close and a queue.
- Design resolution 1600 by 900 scaled to fit. On narrow screens the canvas becomes taller than the viewport and scrolls vertically.

### 5.2 Style: two options, Saaqib picks

- Option A, chunky pixel: 32 pixel base unit, 3 to 4 tone shading, crisp nearest neighbour scaling, hand placed props. Reads as a game at once, sprites with variations are cheap to author, runs at 60 fps easily. My recommendation.
- Option B, low poly flat: flat shaded facets in vector shapes rendered to textures, soft ambient occlusion baked into the sprites. Looks calmer and more modern, but 2D low poly can drift toward generic flat illustration and needs more art time per prop.
- Two concept images, one per option, generated with Higgsfield (Recraft V4.1 accepts a fixed palette) or drawn as SVG if credits run short. Shown before Phase 2 starts.

### 5.3 Palette (draft, swatches in Phase 2)

| Use | Color |
|-----|-------|
| Night sky | #0E1422 to #1B2438 with a dim warm band at the horizon #3A2A24 |
| Day sky | #7FB2D9 to a hazy #E8D6B3 horizon |
| Building shell | charcoal #262A33, brass #C9963B, brass shadow #8A6424 |
| Wood | #8C5A2B, dark #5A3A22 |
| Window glow | #F2B86C, interior light #FFD9A0 |
| Penthouse accent | brass gold #D4A537 |
| Floor 3 DocLedger | teal #2A9D8F |
| Floor 2 Deals | orange #F08A24 |
| Floor 1 Content | green #5FA55A |
| Ground Service | rose #C94F7C |
| Lobby | stone #9C8F7A |
| Real money | brass gold #E0B04A |
| Simulated money | blueprint blue #5DA9E9 with a SIMULATED stamp |
| Panel paper | #F3E9D2 on a wood frame, ink #1E1A16, muted #6E6455 |

No purple to blue gradients anywhere. No glassmorphism, no glowing orbs, no floating chat bubbles as decoration, no emoji as icons.

### 5.4 Type (two pairs, Saaqib picks)

- Pair 1: Barlow Condensed (condensed grotesque) for the title and floor names, IBM Plex Sans for panels.
- Pair 2: Zilla Slab (slab) for the title and floor names, Nunito Sans for panels.
- If Option A pixel wins, a pixel display face such as Silkscreen can be offered for the title only, with the chosen panel face unchanged.

### 5.5 Characters and motion

- Workers: small corporate types, 32 by 48 pixel sprites built from layers: body, hair (6 styles), glasses, mug, and a slouch pose for one worker per floor. Animations: sit, sip, stretch, type with a paper bubble showing a 3 word task label, raise hand and look up when blocked, walk with a bob, ride the lift.
- Warden: bigger, long coat, paces the Penthouse with hands behind the back, looks out of the window now and then, rides the lift down and stands beside a blocked worker.
- Sprite sheet: generated by a script in /design from layered definitions into one PNG atlas plus JSON, so variations stay consistent and original.
- Day and night follow Asia/Dubai: sky keyframes at 05:30, 07:00, 12:00, 17:30, 19:00 and 22:00, interior lights on from 18:00 to 07:00, a sun and moon path.
- Everything eases: panels slide, counters tick up, lift doors open and close, hover shows a soft outline and a name tag.
- Sound off by default: a click and a lift chime made with WebAudio, no audio files.

### 5.6 Panels

- Game framed panels in the same palette: paper on wood with brass corners. Slide in from the right.
- Character panel: editable name saved to the database, avatar, floor, status, current task with a live log stream, task history with timestamps and outputs, tokens and cost today, stats (tasks done, success rate, average review score).
- Floor panel: goal metric, weekly target versus actual, active tasks, blockers, revenue from this floor, Warden strategy note, pause and resume.
- Warden panel: worker panel plus tabs for approvals (the red phone), setup (the clipboard), daily brief, spend cap and budget level, ideas inbox (the mail slot).

## 6. Phases

Each phase ends with a deploy, the URL, a 5 line summary and what is needed from Saaqib. Then stop and wait.

### Phase 1: Skeleton
- Create the Next.js app, Drizzle schema (all tables in docs/DATA_MODEL.md), migrations and seed data (floors, agents, setup items, settings).
- Create the Neon project the-tower in Frankfurt and the Vercel project the-tower linked to this repo. Set env vars. Function region fra1.
- API routes: /api/tick, /api/state, /api/sim/tick, /api/settings, /api/setup, /api/approvals, /api/ideas, /api/telegram (stores updates only), /api/health.
- Simulation generator working end to end, writing simulated rows.
- GitHub Actions: tick.yml (hourly) and builder.yml (present but disabled until Phase 5).
- A temporary plain status page that lists floors, agents and the last ticks, clearly marked as temporary, so the data flow can be checked. The game view comes in Phase 2.
- Needs from Saaqib: answers to the questions, the two GitHub Actions secrets, and the branch decision (question 1).

### Phase 2: Design
- Two concept images, palette swatches, font specimens. Wait for the pick.
- Sprite sheet, props, lift, building shell, day and night cycle, hover and click hit areas.
- The PixiJS building running on simulation data: all floors, locked floors with dust sheets and padlocks, lift rides, blocked hands, Warden pacing.
- Stop for a visual review. Iterate until Saaqib says it looks like a game.

### Phase 3: Panels
- Character, floor and Warden panels. Editable names. Approval queue UI with approve, reject and feedback. Setup clipboard with paste boxes and status. Ideas inbox. Top bar with the simulation toggle.
- Needs from Saaqib: nothing new, but this is when the clipboard can take real keys.

### Phase 4: Warden real
- The model wrapper with cost logging. Warden decision loop with structured output, batch and sync modes. Budget ledger, daily cap, 40 percent throttle, pause on cap.
- Telegram bot: webhook, approvals with inline buttons, ideas, commands, morning brief at 08:00 Dubai, instant Warden run within 5 minutes of the key being pasted.
- Needs from Saaqib: Anthropic key, Telegram token and chat id.

### Phase 5: Floor 3 live
- DocLedger agents with playbooks and output schemas: Scout, Analyst, Writer, Chaser. Leads pipeline on the floor panel. Resend sending after approval. Reply handling. Demo booking link.
- Builder in GitHub Actions against the DocLedger repo with the pull request flow and approval items.
- Needs from Saaqib: DocLedger repo confirmation and token, product facts, calendar link, Resend key and domain.

### Phase 6: Floor 2 live
- Deals agents: Scout fetching store pages directly with web search fallback, Editor, Publisher. Telegram channel posting after approval. The /deals page. Click tracking through /go/<code>. Auto approve request after 14 days.
- Needs from Saaqib: affiliate ids, channel handle with the bot as admin.

### Phase 7: Budget dynamics and polish
- Weekly budget review, level up and down, ceiling approval item. Unlock logic for Floor 1 and Ground with the floor_unlock approval item. Sound. Tests. README. Performance pass for 60 fps.

### Phase 8 (optional, last): phone layout
- Zoomed building that scrolls on phones. Parked by Saaqib on 2026-09-29, only if asked.

## 7. Risks and how they are handled

- Store pages may block server fetches (Amazon.ae, Noon). Fallback order: fetch from Vercel, fetch from the GitHub Actions runner, web search. Deals still post with plain links when no affiliate id exists.
- Affiliate programs for Noon, Sharaf DG, Carrefour and Talabat usually run through networks. Without ids those posts earn nothing but grow the channel. Warden reports this in the brief.
- Vercel Hobby terms limit commercial use. Fine to start, but a Pro plan may become necessary when revenue is real. Flagged in the questions.
- Cold outreach deliverability: new domain, low volume (5 a day), SPF and DKIM through Resend, a plain opt out line in every email.
- Batch delays up to 24 hours are rare but possible. Tasks show in batch and Warden sees the age of open batches.
- GitHub cron can start late by minutes at busy times. The tick tolerates it, and the brief schedule has a dedicated early trigger.
- Builder cost is the least predictable line. Hard caps per ticket and small tickets keep it inside 12 USD a month.
- Neon free plan: 100 projects, 100 compute hours per project a month, 0.5 GB storage. Plenty for this, and scale to zero keeps compute near zero.

## 8. What happens in Saaqib's accounts (each needs a yes before I do it)

- Neon: create project the-tower (Frankfurt), one database, one role, run migrations.
- Vercel: create project the-tower from this repo, set env vars, set region fra1, set function duration.
- GitHub: workflow files in this repo. Secrets must be added by Saaqib (see SETUP.md).
- Nothing else. No emails, posts, spend or merges happen without an approval row.
