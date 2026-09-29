# Questions and assumptions (Phase 0)

Answer in chat with the number and a short reply. I will write the answers here and log decisions in docs/DECISIONS.md.

## Questions that block Phase 1

1. Branches and production. The repo has no main branch yet. I work on claude/relaxed-ritchie-kwg8g6 and never merge to main myself. My recommendation: I push the Phase 1 skeleton as the first commit on main (one time, to create it), then every phase is a pull request from my branch that you merge after review. Vercel production follows main, and each push to my branch gets a preview URL for review. Alternative: Vercel production follows my branch directly and main is never used. Which one?

2. Warden cadence and cost. Recommendation: the six scheduled runs a day go through the Batch API (results usually within minutes, worst case an hour or more), instant synchronous runs happen when you paste the key, send an idea, press Run Warden now, or a worker gets blocked, and the morning brief is built from data with no model call. Estimated 6 to 8 USD a month. Alternative: everything synchronous, about 14 USD a month, faster reactions. Which one?

3. Builder inside a nightly GitHub Actions job (free on this public repo, has git, node and tests) instead of Vercel. Per ticket caps: 25 tool calls, 0.40 USD, 20 minutes. OK?

4. Auth. A single owner passcode in front of the game and its API, so only you can approve items or paste credentials. Public pages stay public (deals page, click links). OK?

5. Secrets. Pasted credentials stored encrypted in Neon with a key that lives only in Vercel env vars. The UI never shows a stored secret again. OK? Alternative: I set each one as a Vercel env var for you, which needs a redeploy every time.

6. Prompt caching on Warden. The brief says cache every system prompt. For workers and Builder it saves money. For Warden's scheduled runs, 4 hours apart, the 5 minute cache expires between runs and the write costs 25 percent more than plain input. Recommendation: cache on for workers, Builder and instant Warden runs, off for Warden's scheduled batch runs. OK, or keep it on everywhere as written?

7. Repo visibility. This repo is public. Playbooks and prompts will be readable by anyone. Secrets are never in the repo. Public keeps GitHub Actions minutes unlimited. Private gives 2,000 minutes a month on GitHub Free, and my estimate is about 1,000 a month. Keep public, or make it private?

## Questions I need answered before the phase that uses them

8. DocLedger repo (Phase 5). I found https://github.com/Saxqb777/docledger and a Neon project named doc-ledger. Is that the repo Builder should work on? What is its stack and how do its tests run?

9. Deals site (Phase 6). I found a deals-program repo, a deals-program Vercel project and a deals-program Neon project. Should Publisher update that existing site, or should I build the deals page inside The Tower at /deals? Recommendation: inside The Tower, unless deals-program already works and has traffic.

10. Affiliate programs (Phase 6). Which do you have today? Amazon.ae Associates tag, Noon (through which network), Sharaf DG, Carrefour, Talabat. Deals without an id post with plain links and earn nothing. OK as a start?

11. Reply handling for Chaser (Phase 5). Resend inbound email on a subdomain (one MX record) so Chaser reads replies itself, or you forward replies to Warden on Telegram by hand. Which one?

12. Building levels. I read the brief as Lobby at the bottom, then Ground (Service Marketing, locked), Floor 1 (Content Farm, locked), Floor 2 (Deals), Floor 3 (DocLedger), Penthouse (Warden) with the roof counters above it. Six levels including the Penthouse, which matches 5 levels plus roof. Correct?

13. Vercel Hobby terms limit commercial use. Fine to start on Hobby, but a Pro plan (about 20 USD a month) may be needed once money is real. Acknowledge, or move to Pro from the start?

14. Hyphen rule scope. No hyphens or em dashes in UI text and agent output. Code, URLs, package names, file names and technical ids keep their hyphens. Correct?

15. Higgsfield concept images (Phase 2). You have 70 credits on the basic plan. I will check the per image cost first and generate the two concept images only if it fits. If not, I draw them as SVG. OK?

16. Timezone and week. Dubai time for everything, weeks start Monday, the budget review runs every 7 days from launch day. OK?

## Assumptions I am making unless you say otherwise

- A1. One Neon project named the-tower in Frankfurt, one database, created by me after your yes. Your Neon free plan allows 100 projects, so no clean up is needed.
- A2. Vercel functions in Frankfurt (fra1). Fluid compute on, tick route at the plan maximum duration.
- A3. Everything in Dubai time (Asia/Dubai, no daylight saving).
- A4. The game UI is English only.
- A5. Nothing is sent, posted, merged or spent until Phase 4 at the earliest, and only through approved items.
- A6. Money is shown in USD on the roof. AED amounts are stored next to the USD value where they exist.
- A7. The temporary status page in Phase 1 is throwaway. The real game view is Phase 2.
- A8. Names of the workers: Warden is fixed. Workers start with role names (Scout, Analyst, Writer, Chaser, Builder, Editor, Publisher) and you can rename them inline.

## Facts I checked on your accounts (2026-09-29)

- GitHub: Saxqb777. This repo is public and was empty. Repos docledger and deals-program exist.
- Vercel: team saxqb777s-projects with 11 projects, none named tower. deals-program exists.
- Neon: org Saaqib on the free plan, 10 projects (doc-ledger, deals-program and others). Free plan limit is 100 projects.
- Higgsfield: basic plan, 70 credits. Recraft V4.1 is available and accepts a fixed palette, good for consistent concept art.
- Figma: your team on the starter tier, admin access. Optional for UI frames.
- Canva: the connector needs authorization in claude.ai connector settings before I can use it. Not needed for the plan.
- Model prices from the Claude API reference: Opus 5.5 at 4 and 20 USD per million tokens, Sonnet 5.5 at 2 and 10, Batch API at half price, web search at 0.01 USD per search.

## Answers

Given by Saaqib on 2026-09-29: all recommendations accepted, assumptions A1 to A8 accepted, Phase 1 started.

1. Create main once with the Phase 1 skeleton, then one pull request per phase that Saaqib merges. Production follows main.
2. Warden: batch for the six scheduled runs, instant runs when Saaqib acts, morning brief built from data.
3. Builder in a nightly GitHub Actions job. Caps per ticket: 25 tool calls, 0.40 USD, 20 minutes.
4. Single owner passcode on the game and its API.
5. Pasted keys stored encrypted in Neon, never shown again.
6. Prompt caching off for Warden's scheduled runs, on everywhere else.
7. Repo stays public for now. May flip to private later.
8. DocLedger repo is Saxqb777/docledger. Confirm stack and tests at Phase 5.
9. Deals page lives inside The Tower at /deals.
10. Start with the Amazon.ae tag. Other stores post plain links until ids exist.
11. Resend inbound for replies if the MX record can be added, else Saaqib forwards replies by hand. Decide at Phase 5.
12. Levels: Lobby, Ground, Floor 1, Floor 2, Floor 3, Penthouse, roof counters on top.
13. Start on Vercel Hobby. Move to Pro when money is real.
14. Hyphen rule covers UI text and agent output only. Code, URLs and file names keep hyphens.
15. Check the Higgsfield credit cost first, then generate the two concept images or draw them as SVG.
16. Dubai time, weeks start Monday, budget review every 7 days from launch.
