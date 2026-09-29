# MASTER PROMPT: THE TOWER

Verbatim copy of Saaqib's brief, received 2026-09-29. This is the source of truth. Do not edit it; log changes of intent in docs/DECISIONS.md.

---

You are building The Tower, a personal AI agent ecosystem for Saaqib. It is a real, money making operation dressed as a tycoon style game. A boss agent called Warden runs a building of worker agents. Each floor is a business. Saaqib is the owner: he approves, gives ideas, and pastes credentials. Everything else runs itself.

Read this whole file before writing any code. Then propose a build plan in phases and wait for approval before Phase 1. After that, complete one phase at a time and stop for review after each.

## 1. Non negotiable rules

1. Never make external side effects (send email, post publicly, merge code, spend money, raise budget) without an approved item in the approval queue.
2. Never exceed the daily API spend cap. Warden pauses floors when the cap hits.
3. Never merge to main in any repo. Builder opens pull requests only.
4. Simulation mode must work with zero API keys. The whole building must be watchable before Saaqib pays for anything.
5. Design: this must look like a real game. See section 8. If you produce a generic AI dashboard look, the phase is rejected.
6. Ask Saaqib when you are blocked on something only he can provide. Do not fake it, do not stub it silently. Keep a SETUP.md of everything he needs to give you.
7. Writing style everywhere in the UI and agent output: no hyphens, no em dashes. Colons are fine.

## 2. Stack

- Next.js 15, App Router, TypeScript, deployed on Vercel Hobby (Saaqib's Vercel connection is available to you)
- Neon Postgres via Drizzle ORM (Neon connection is available to you)
- Claude API via @anthropic-ai/sdk. Warden: claude-opus-5-5. Workers and Builder: claude-sonnet-5-5. Use prompt caching on every system prompt. Use the Batch API for any run that is not user facing.
- Scheduler: GitHub Actions cron (Vercel Hobby cron is daily only, not enough). Each cron hits an authenticated /api/tick route.
- Telegram bot for Warden to Saaqib messaging (Saaqib will create the bot and paste the token)
- Resend for outbound email drafts sent after approval
- Building scene: PixiJS v8 with custom sprites. Not DOM divs. Not Tailwind cards pretending to be a game.
- Model names are config, one place in /config/models.ts, switchable per agent.

## 3. Architecture

- /app: Next.js UI and API routes
- /agents: one folder per agent with system prompt, tools, playbook, target
- /warden: the loop, budget rules, allocation, reporting
- /scene: PixiJS building, sprites, animation, lift, day night cycle
- /sim: simulation mode fake task generator and fake money
- /db: Drizzle schema and migrations
- /scripts: crons and one off tools

Core tables: agents, floors, tasks, task_events (append only log), approvals, budget_ledger (every API call cost, every revenue entry), revenue, leads, deals, tickets, ideas, settings, setup_items.

Every agent run must log: agent, model, input tokens, output tokens, cache hits, cost in USD, duration, task id. This feeds the money counters.

## 4. The building

Top to bottom. Every floor has a slug, a name, a color accent, a goal metric, a weekly target, a status (locked, live, paused), and an unlock rule.

Penthouse: Warden. One big office. Approval queue as a red phone on the desk. Setup panel as a clipboard on the desk. Ideas inbox as a mail slot.

Floor 3: DocLedger Sales, live at launch. Workers: Scout, Analyst, Writer, Chaser, plus a Workshop wing with Builder.
- Scout: find 15 UAE freight forwarders, customs brokers and small 3PLs a day. Web search capped. Log to leads table.
- Analyst: qualify to 5 a day, find decision maker, score 1 to 10, write why.
- Writer: personalised outreach per qualified lead. Goes to approval queue. Never sends itself.
- Chaser: follow up sequences after approval, reply handling, book demos into Saaqib's calendar link.
- Builder: one ticket a night on the DocLedger repo (Saaqib will provide the repo). Branch, code, tests, pull request, Vercel preview. Summary to approval queue. Never touches main.
- Floor target: 3 demos booked in month 1, first paying client in month 2.
- Niche rule: freight forwarders first. Warden keeps a next niche list and opens a new one only after 3 paying clients.

Floor 2: Deals Engine, live at launch once affiliate IDs are pasted. Workers: Scout, Editor, Publisher.
- Scout: 20 real UAE deals a day from Amazon.ae, Noon, Sharaf DG, Carrefour, Talabat. Fetch pages directly, web search only as fallback.
- Editor: 10 short posts a day with affiliate links. Direct, no fluff, no emojis spam.
- Publisher: schedule to the Telegram channel and update the deals site. Track clicks. Posts go through approval queue for the first 2 weeks, then Warden can request auto approve for this floor.
- Floor target: 300 subscribers month 1, first confirmed commission month 2.

Floor 1: Content Farm, locked. Unlock rule: tower net earnings above 100 USD and budget level 2 or higher. Workers to be defined at unlock: Researcher, Scriptwriter, Producer, Publisher.

Ground: Service Marketing for Saaqib's consulting site, locked. Unlock rule: first DocLedger demo booked and budget level 2 or higher. Workers to be defined at unlock: Author, Ranker, Broadcaster, Greeter.

Lobby: reception desk, lift shaft running full height, petty cash counter showing real revenue and spend.

Locked floors render dark with dust sheets over desks, a padlock on the floor plate, and a label with the unlock rule. Warden can walk through them.

## 5. Warden

Runs every 4 hours by default (6 a day). Each run:
1. Read all floor states, task queue, budget ledger, approvals, ideas inbox.
2. Assign tasks to workers based on playbooks and targets.
3. Review finished work. Reject and reassign if quality is low. Log the reason.
4. Check spend vs cap. Throttle any floor above 40 percent of daily cap alone.
5. Turn new ideas from Saaqib into tickets, assign a floor, reply on Telegram with what it will do.
6. If a floor missed its weekly target, change tactics and write a strategy note visible on the floor panel.
7. Send the morning brief on Telegram at 08:00 Dubai time: money in, money out, what needs Saaqib, one line per floor.

Warden must be able to ride the lift to a floor when a worker raises a hand (blocked status). That is a real state change, not just animation.

## 6. Budget rules

- Base cap: 1.70 USD per day. Hard ceiling: 5 USD per day, editable by Saaqib only.
- Monthly allocation guide: Warden 6, Deals Engine 9, DocLedger Sales 9, Builder 12, web search 9, buffer 5. Warden may reallocate inside the cap.
- Every 7 days: if verified revenue is at least 2x API spend for the week, raise the cap 25 percent up to the ceiling. If revenue below 1x spend for 2 weeks in a row, drop one step. Budget level is an integer shown on the roof.
- Verified revenue means confirmed commissions or paid invoices, never clicks or estimates.
- Raising past the ceiling is an approval item.

## 7. Approval queue

One table, one UI panel, one Telegram flow. Item types: outreach_email, public_post, pull_request, spend_increase, floor_unlock, credential_request, decision. Each item has: summary in plain English, the full content, preview link if any, risk note, approve and reject buttons, a text box for feedback on reject. Rejected items go back to the agent with the feedback. Telegram: inline buttons approve and reject for each item.

## 8. Design: this is the part that matters most

Goal: it should look like a real tycoon game screenshot. Think of the feeling of Two Point Hospital, Game Dev Tycoon, Project Highrise, Fallout Shelter: an isometric or side cutaway building with the front wall removed, tiny characters at desks, warm lighting, hand placed props. Reference those for feel only, do not copy any asset, character or logo.

Hard bans: no purple to blue gradients, no glassmorphism, no glowing orbs, no floating chat bubbles as decoration, no Inter or generic system fonts as the display face, no stock illustration people, no emoji as icons, no default shadcn look for the game view. Panels can use a clean UI but must feel like the game's own UI, with the same palette and a game style frame.

Direction:
- Camera: side cutaway of a 5 level building plus roof, slight isometric depth, front wall removed. Fits a 16:9 viewport, scrolls vertically on small screens.
- Style: low poly or chunky pixel with clean edges. Pick one and commit. Propose both as quick concept images before Phase 2 and let Saaqib choose.
- Palette: dark warm background (deep navy or charcoal with warm ambient light), one accent color per floor, brass and wood tones in the building, warm window glow. Night follows Dubai time, with a day and night cycle changing the sky and interior lights.
- Type: one characterful display face for the title and floor names (a condensed grotesque or a slab), one clean readable face for panels. Load from Google Fonts. No Inter, no Roboto.
- Characters: workers are small corporate types with visible personality: different hair, glasses, coffee mugs, one always slouching. Idle: sit, sip coffee, stretch. Working: type with a small paper speech bubble showing a 3 word task label. Blocked: raise hand and look up toward the penthouse. Warden: bigger, long coat, paces the penthouse, hands behind back, occasionally looks out the window. When helping, rides the lift down and stands beside the worker.
- Lift: real cabin in a shaft, doors open and close, workers and Warden ride it when reassigned or asked for help. Queue if busy.
- Roof: big money counter (net), smaller spend counter, budget level bar drawn like a tycoon upgrade meter, an ideas mail slot.
- Locked floors: dark, dust sheets, padlock, unlock rule label.
- Sound: optional, off by default, small clicks and a lift chime.
- Interactions: hover highlights a character with a soft outline and name tag. Click a character: side panel slides in from the right with name (editable inline, saved to db), avatar, floor, status, current task with live log stream, task history with timestamps and outputs, tokens and cost today, stats (tasks done, success rate, average review score). Click a floor plate: floor panel with goal metric, weekly target vs actual, active tasks, blockers, revenue from this floor, Warden strategy note, pause and resume. Click Warden: worker panel plus approval queue, setup panel, daily brief, spend cap, budget level, ideas inbox.
- Motion: everything eases. Panels slide, counters tick up, characters walk with a simple bob. 60fps on a MacBook.

Asset pipeline: you may use any tool available to you to make this look good: Figma via MCP for layout and UI frames, Higgsfield or any image generation connection for concept art and sprite sheets, or hand drawn SVG converted to sprites. If you need access to a tool you do not have, ask Saaqib. Generate original assets only. Keep a /design folder with the palette, type scale, sprite sheet, and concept images so the look stays consistent.

Before Phase 2 you must show Saaqib: 2 concept images of the building in the two style options, the palette, the two fonts. Wait for his pick.

## 9. Simulation mode

Toggle in settings and in the UI top bar. When on: fake task generator creates believable tasks per playbook, fake outcomes, fake money that is clearly labelled SIMULATED in a different color. All animations, panels, lift, approvals work. Warden setup panel still shows what is missing. No API calls. Default on until API key is present.

## 10. Setup and onboarding

On first load, Warden's clipboard lists setup_items with status, one line how to get it, and a paste box:
- Anthropic API key (required to leave simulation)
- Telegram bot token and Saaqib's chat id (required for reports)
- DocLedger GitHub repo URL (required for Builder)
- Calendar booking link (required for Chaser)
- Affiliate IDs: Amazon.ae, Noon, others (required for Deals Engine to go live)
- Resend API key and sending domain (required to send approved emails)
- Telegram deals channel handle
Floors stay greyed until their required items are present. Keep SETUP.md in the repo mirroring this list with exact steps.

## 11. Phases

Phase 0: Plan. Read this file, propose a detailed plan and a data model, list questions. Stop.
Phase 1: Skeleton. Next.js, Neon schema, settings, simulation mode data, API routes, GitHub Actions cron file. Deploy to Vercel. Stop.
Phase 2: Design. Concept images, palette, fonts, sprite sheet, then the PixiJS building in simulation mode with all floors, lift, characters, day night cycle. Stop for a visual review. Iterate until Saaqib says it looks like a game.
Phase 3: Panels. Character, floor and Warden panels, editable names, approval queue UI, setup clipboard, ideas inbox. Stop.
Phase 4: Warden real. Warden loop with Opus, budget ledger, spend cap, Telegram bot, morning brief, approval flow over Telegram. Stop.
Phase 5: Floor 3 live. DocLedger Sales agents, leads pipeline, Builder with pull request flow against the DocLedger repo. Stop.
Phase 6: Floor 2 live. Deals Engine agents, Telegram channel publishing, deals site, click tracking. Stop.
Phase 7: Budget dynamics, floor unlock logic, polish, sound, tests, README. Stop.

After each phase: deploy, give Saaqib the URL, a 5 line summary, and what you need from him. Then wait.

## 12. Definition of done for the whole project

- Saaqib can open the URL, watch the building run in simulation, click anything and get a real panel.
- He pastes the API key and Telegram token, Warden messages him within 5 minutes with a plan.
- Two floors run daily on their playbooks within the spend cap, every cost logged.
- Nothing external happens without his tap.
- It looks like a game he would screenshot and send to a friend.
