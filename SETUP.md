# SETUP: everything Saaqib needs to provide

This file mirrors the Warden clipboard (the setup_items table). Status is updated as items arrive.
Since Phase 3 you can paste every item straight into the game: click Warden, open the Setup tab, paste, Save. Secrets are encrypted and never shown again.
Rule: never paste a secret into the repo. Secrets go into the Warden clipboard once Phase 3 is live. Until then, the Vercel environment variables route is used (see the notes per item).

## Status board

| # | Item | Needed for | Needed by | Status |
|---|------|------------|-----------|--------|
| 1 | Answers to docs/QUESTIONS.md | Everything | Phase 1 start | done 2026-09-29 |
| 2 | Nothing: the heartbeat authenticates with a GitHub OIDC token, no secrets needed | Hourly heartbeat | Done | done 2026-09-29, first scheduled run landed 22:55 UTC the same day |
| 2b | Two clicks: GitHub default branch to main, Vercel production branch to main | Pull request flow | Done | done 2026-09-29 by Saaqib |
| 2c | Backup heartbeat: not needed any more, the schedule fires since the Phase 2 merge touched the workflow file on main (first run 2026-09-29 22:55 UTC) | Hourly heartbeat | Done | done 2026-09-29 |
| 3 | Anthropic API key | Leaving simulation mode, every real agent run | Now (Phase 4 is built) | missing |
| 4 | Telegram bot token, then pair your chat with /pair | Warden messages, approvals over Telegram, morning brief | Now (Phase 4 is built) | missing |
| 5 | DocLedger GitHub repo URL and a GitHub token for it | Builder (nightly at 02:00 Dubai, built in Phase 5) | Now | missing (repo likely Saxqb777/docledger, confirm) |
| 6 | Calendar booking link | Chaser demo booking | Now | missing |
| 7 | Resend API key and sending address | Sending approved outreach emails | Now | missing |
| 8 | DocLedger product facts: one paragraph pitch, pricing, your signature block | Writer and Chaser | Now | missing |
| 8b | Resend webhook secret for replies (optional) | Chaser reads replies itself | Optional | missing: without it, forward replies with /reply on Telegram |
| 9 | Affiliate IDs: Amazon.ae tag, Noon, others | Deals Engine going live | Phase 6 | missing |
| 10 | Telegram deals channel handle, bot added as admin | Publisher | Phase 6 | missing |
| 11 | Consulting site URL | Ground floor (locked until unlock rule is met) | Later | missing |

## Steps per item

### 1. Answers to the questions
- Open docs/QUESTIONS.md and reply in chat with the question numbers and your answers. Short answers are fine.

### 2. Heartbeat secrets: none needed
- The tick workflow mints a GitHub OIDC token for each run and the Tower verifies it (issuer GitHub, audience the-tower, repository Saxqb777/eco-system-moneeyy, event schedule or workflow_dispatch). No repository secret to add.
- CRON_SECRET still exists on Vercel as a second door for manual calls.

### 2b. Production branch (two clicks, main exists now)
- GitHub: repo Settings, General, Default branch, switch to main. (My session is not allowed to change repository settings.)
- Vercel: project the-tower, Settings, Git, Production Branch, set to main. Until then production deploys from claude/relaxed-ritchie-kwg8g6, which currently holds the same commit as main.
- If you prefer, make the repo private first. Private repos on GitHub Free get 2,000 Actions minutes a month. My estimate for The Tower is about 1,000 minutes a month.

### 2c. Backup heartbeat (about 3 minutes, pick one or do both)
- What happened: the tick workflow is active on main, but GitHub has not started a single scheduled run (slots 20:07, 21:07 and 22:07 UTC on 2026-09-29 all missed). The schedule was registered while the dev branch was still the default. My nudge commit to main only touched README.md, and GitHub usually re registers schedules only when the workflow file itself changes on the default branch. My session is not allowed to read the CRON_SECRET value, so I cannot register an external caller myself.
- Way A, no secrets (try this first): on GitHub open .github/workflows/tick.yml on main, click the pencil, change the first comment line in any small way (for example add "Re registered on 30 Sep."), commit straight to main. Then wait for the next :07 UTC slot.
- Way B, cron-job.org (works even if GitHub never wakes up):
  1. Vercel: project the-tower, Settings, Environment Variables, find CRON_SECRET, click the eye icon, copy the value. If Vercel refuses to show it, type a new long random value into it, save, redeploy production, and use that new value below.
  2. cron-job.org: create a free account, click Create cronjob.
     - Title: The Tower heartbeat
     - URL: https://the-tower-saxqb777s-projects.vercel.app/api/tick?trigger=cron
     - Schedule: custom, every hour at minute 12 (minute 12, every hour, every day, any timezone).
     - Advanced tab: Request method POST. Headers: add one header with key Authorization and value "Bearer " plus the secret (one space between Bearer and the secret). The alternative header x-tower-key with just the secret as the value works once the Phase 2 pull request is merged.
     - Save, then use the test run button once. A 200 reply with "ok":true and "via":"cron_secret" means it works.
  3. Tell me in chat. I then report the first heartbeat row from the ticks table.
- The free tier stops waiting after 30 seconds. A tick today takes a second or two. I keep ticks short in later phases: the caller only kicks work off, long runs happen in the background.

### 3. Anthropic API key
- console.anthropic.com, API Keys, Create Key. Name it the-tower.
- Add credit (prepaid). The base cap is 1.70 USD a day, so 20 USD covers the first weeks.
- Paste it into the Warden clipboard (Phase 3 and later). Simulation mode turns off only after this key is present and you toggle it.

### 4. Telegram bot token and chat id
- Telegram, BotFather, /newbot, copy the token. Paste it in the game: Warden, Setup tab, Telegram bot token, Save.
- Pair your chat: open your new bot in Telegram and send the /pair line shown under "Your Telegram chat id" in the Setup tab (a six character code). Nobody else can pair, the code lives only in the passcode protected game.
- The webhook registers itself on the next heartbeat (no step for you). From then on: the morning brief at 08:00 Dubai, approvals with Approve and Reject buttons, Warden's replies to your ideas.
- Commands: /status, /brief, /pause <floor>, /resume <floor>, /cap, /run. Any other text is an idea.
- Works in simulation too, so you can try the bot before pasting the Anthropic key. Simulated approvals never ring the phone, only real ones.

### 5. DocLedger repo and token
- Paste the repo URL (https://github.com/Saxqb777/docledger) under "DocLedger GitHub repo URL".
- GitHub, Settings, Developer settings, Fine grained tokens, Generate: only that repository, permissions Contents read and write, Pull requests read and write. Paste it under "GitHub token for the DocLedger repo".
- Builder runs every night at 02:00 Dubai from .github/workflows/builder.yml: top backlog ticket, clone, edit with bash and file tools, run the repo's tests, push branch builder/<ticket>, open a pull request, put a pull_request item on the red phone. Caps 25 tool calls, 0.40 USD, 20 minutes. It never merges. Tickets come from Warden and from your ideas.

### 6. Calendar booking link
- Cal.com, Calendly or a Google appointment page. Paste under "Calendar booking link". Chaser puts it in replies to warm leads.

### 7. Resend
- resend.com, add and verify your sending domain, then API Keys, Create. Paste under "Resend API key". Paste the from address (on that domain) under "Sending address".
- Approved outreach emails are sent by the next heartbeat. Nothing goes out without your Approve.
- Replies, two ways: (a) Resend Receiving: add the MX record for a subdomain, create a webhook for email.received pointing at https://the-tower-saxqb777s-projects.vercel.app/api/email/inbound, paste the signing secret under "Resend webhook secret". (b) Forward by hand on Telegram: /reply Gulf Crescent Freight: their text. Chaser picks it up either way.

### 8. DocLedger product facts
- One paragraph on what DocLedger does for a freight forwarder, the price, and your signature block (name, title, phone). Writer and Chaser quote it, so keep it true.

### 9. Affiliate IDs
- Amazon.ae: affiliate-program.amazon.ae, create an Associates account, copy your tracking tag (looks like name-21).
- Noon and the others usually run through networks (for example ArabClicks or Involve Asia). Tell me which networks you already have and paste the tracking ids or link templates.
- Deals without an affiliate id still post with a plain link. They earn nothing but grow the channel.

### 10. Telegram deals channel
- Create a public channel in Telegram, pick a handle (for example @uaedailydeals).
- Channel settings, Administrators, add your bot with Post messages permission.
- Paste the handle into the clipboard.

### 11. Consulting site URL
- Only needed when Ground floor unlocks (first DocLedger demo booked and budget level 2 or higher).

## What I set up myself (no action from you, but I ask before doing it)
- Neon: the tower database, schema, migrations.
- Vercel: the project, environment variables (DATABASE_URL, CRON_SECRET, OWNER_PASSCODE, SECRETS_KEY, TELEGRAM_WEBHOOK_SECRET), region, function duration.
- GitHub Actions workflow files in this repo.
- The owner passcode for the game UI. I will send it to you in chat once, and you can change it in Vercel env vars any time.
