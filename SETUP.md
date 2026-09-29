# SETUP: everything Saaqib needs to provide

This file mirrors the Warden clipboard (the setup_items table). Status is updated as items arrive.
Rule: never paste a secret into the repo. Secrets go into the Warden clipboard once Phase 3 is live. Until then, the Vercel environment variables route is used (see the notes per item).

## Status board

| # | Item | Needed for | Needed by | Status |
|---|------|------------|-----------|--------|
| 1 | Answers to docs/QUESTIONS.md | Everything | Phase 1 start | done 2026-09-29 |
| 2 | GitHub Actions secrets in this repo: CRON_SECRET and TOWER_URL | Hourly heartbeat | Now (Phase 1 is deployed) | missing |
| 3 | Anthropic API key | Leaving simulation mode, every real agent run | Phase 4 | missing |
| 4 | Telegram bot token and your chat id | Warden messages, approvals over Telegram, morning brief | Phase 4 | missing |
| 5 | DocLedger GitHub repo URL and a GitHub token for it | Builder | Phase 5 | missing (repo likely Saxqb777/docledger, confirm) |
| 6 | Calendar booking link | Chaser demo booking | Phase 5 | missing |
| 7 | Resend API key and verified sending domain | Sending approved outreach emails | Phase 5 | missing |
| 8 | DocLedger product facts: one paragraph pitch, pricing, your signature block | Writer and Chaser | Phase 5 | missing |
| 9 | Affiliate IDs: Amazon.ae tag, Noon, others | Deals Engine going live | Phase 6 | missing |
| 10 | Telegram deals channel handle, bot added as admin | Publisher | Phase 6 | missing |
| 11 | Consulting site URL | Ground floor (locked until unlock rule is met) | Later | missing |

## Steps per item

### 1. Answers to the questions
- Open docs/QUESTIONS.md and reply in chat with the question numbers and your answers. Short answers are fine.

### 2. GitHub Actions secrets (I cannot set these for you)
- CRON_SECRET is already set on Vercel. Copy its value from the Vercel dashboard: project the-tower, Settings, Environment Variables, CRON_SECRET, reveal. (I also sent it once in chat.)
- In GitHub: repo Settings, Secrets and variables, Actions, New repository secret.
- Add CRON_SECRET (that value) and TOWER_URL = https://the-tower-saxqb777s-projects.vercel.app (no trailing slash).
- Then Actions, tick, Run workflow, to confirm it turns green. From then on it runs every hour.

### 2b. Production branch (one click, after main exists)
- Vercel created the project before main existed, so its production branch is claude/relaxed-ritchie-kwg8g6 for now.
- Once main exists (I create it with the Phase 1 skeleton): Vercel, project the-tower, Settings, Git, Production Branch, set to main. GitHub: repo Settings, General, Default branch, set to main.
- If you prefer, make the repo private first. Private repos on GitHub Free get 2,000 Actions minutes a month. My estimate for The Tower is about 1,000 minutes a month.

### 3. Anthropic API key
- console.anthropic.com, API Keys, Create Key. Name it the-tower.
- Add credit (prepaid). The base cap is 1.70 USD a day, so 20 USD covers the first weeks.
- Paste it into the Warden clipboard (Phase 3 and later). Simulation mode turns off only after this key is present and you toggle it.

### 4. Telegram bot token and chat id
- In Telegram, open BotFather, send /newbot, pick a name (for example Warden) and a username ending in bot. Copy the token.
- Send /setprivacy to BotFather, pick your bot, choose Disable, so the bot can read messages in the deals channel later.
- Start a chat with your new bot and send it any message.
- Your chat id: open https://api.telegram.org/bot<TOKEN>/getUpdates in a browser and read message.chat.id. Or paste the token into the clipboard first and Warden will detect your chat id from your first message.
- Paste token and chat id into the Warden clipboard.

### 5. DocLedger repo and token
- Confirm the repo URL (I found https://github.com/Saxqb777/docledger).
- Create a fine grained personal access token: GitHub Settings, Developer settings, Personal access tokens, Fine grained, Generate new token. Repository access: only the DocLedger repo. Permissions: Contents read and write, Pull requests read and write, Metadata read. Expiry: 1 year.
- Paste the token into the Warden clipboard. Builder uses it only to push branches and open pull requests. It never merges.
- Tell me how the repo runs its tests (for example pnpm test) if there is no obvious script.

### 6. Calendar booking link
- Any public booking link works: Cal.com, Calendly, Google Calendar appointment page.
- Paste the link into the clipboard.

### 7. Resend
- resend.com, sign up, Domains, Add domain (the domain you want emails to come from, for example your consulting domain).
- Add the DNS records Resend shows (SPF, DKIM, and the return path record) at your DNS provider. Wait until Resend shows Verified.
- API Keys, Create API key, permission Sending access, domain: the one you verified.
- Paste the API key and the sending address (for example saaqib@yourdomain.com) into the clipboard.
- Optional for reply handling: Resend inbound email. Add the MX record Resend gives you for a subdomain like reply.yourdomain.com. Chaser then reads replies automatically. Without it you forward replies to Warden by hand.

### 8. DocLedger product facts
- One paragraph on what DocLedger does for a freight forwarder, the price, and a two line signature (name, title, phone, site).
- Paste into the clipboard as plain text. Writer uses it in every email.

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
