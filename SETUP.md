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
| 3 | Anthropic API key | Leaving simulation mode, every real agent run | Done | done 2026-09-30 07:28 UTC, simulation off, first real batch and Warden run 07:40 to 07:43 UTC |
| 4 | Telegram bot token, then pair your chat with /pair | Warden messages, approvals over Telegram, morning brief | Done | done 2026-09-30, chat paired, first four messages delivered 08:18 UTC |
| 5 | DocLedger GitHub repo URL and a GitHub token for it | Builder (nightly at 02:00 Dubai, built in Phase 5) | Done | done 2026-09-30 18:35 UTC: Saxqb777/Petty-Cash- (the live app, D069) and a token for it |
| 6 | Calendar booking link | Chaser demo booking | Done | done 2026-09-30 (cal.com 15 min link) |
| 7 | Resend API key and sending address | Sending approved outreach emails, reading replies | Redo the key | done 2026-09-30: key, sender Saaqib Khan <saaqib@docledger.site>, domain Verified. 2026-10-02 (D077): the key is sending only, so replies cannot be read: create a Full access key and paste it over the box, then tick the delivery events on the webhook (section 7) |
| 8 | DocLedger price line and signature block (the pitch itself is in the repo) | Writer and Chaser | Now | missing |
| 8b | Resend webhook secret for replies (optional) | Chaser reads replies itself | Done | done 2026-09-30 09:06 UTC |
| 9 | Affiliate IDs: Amazon.ae tag, Noon, others | Deals Engine earning (posts run without them, links stay plain) | Done for Amazon | Amazon.ae tag themarketde0c-21 saved 2026-09-30 (right account). Noon and others optional |
| 10 | Telegram deals channel handle, bot added as admin | Publisher posting to the channel | Done | t.me/Themarketdeals works since pull request 7. Bot @Thedealsmarketbot added as channel admin by Saaqib 2026-09-30 (it was missing before). Not verifiable from here: the first approved post proves Post Messages works |
| 11 | Consulting site URL | Ground floor (locked until unlock rule is met) | Later | missing |
| 12 | X account keys (optional) | Deal posts also go to X for reach | When you want it | missing: developer.x.com app with Read and write, paste API Key, API Key Secret, Access Token, Access Token Secret separated by spaces in the box "X account for deal posts" |
| 13 | Facebook Page id and token (optional) | Deal posts also go to your Facebook Page | When you want it | missing: a Page for the deals, a Meta app with pages_manage_posts, a Page token that does not expire; paste the Page ID and the token separated by a space |
| 16 | Alpaca paper trading keys | Wall Street's real prices and news (D075) | When you can | missing: steps in section 13 below, paste "KEYID SECRET" in the box "Alpaca paper trading keys". Until then stocks wait; crypto may run on the free feed |
| 17 | Paddle billing (app) | Taking card payments after the free month | Waiting for you | section 7d: Paddle account, product and price, client token, webhook secret, four Vercel variables on petty-cash |
| 15 | DocLedger Facebook Page: Page ID and a Page token | Social posts to the Page (D074) | When you can | missing: steps in section 12 below, paste "PAGEID TOKEN" in the box "DocLedger Facebook Page". Social plans the week already, posts start once it is here |
| 14 | Business postal address (optional) | DocLedger emails to US companies (US law wants an address under the signature) | When you want US leads | missing: paste the address to print under your signature in the box "Business postal address". Until then the Scout skips the US |

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

### 2c. Heartbeat: nothing to do
- Since 2026-09-30 (D058) the main clock is a small Neon Function ("heartbeat") with a Neon schedule trigger every 15 minutes. It fires even while the database sleeps and knocks on the public /api/heartbeat, which runs a tick only when the last one is 10 minutes old, one tick at a time.
- Backups that knock on the same door: GitHub's tick workflow (every 15 minutes, often late), Vercel's daily cron at 03:55 UTC, and the game itself when you have it open.
- Optional extra backup, no secret needed: cron-job.org, a free account, one cronjob with URL https://the-tower-saxqb777s-projects.vercel.app/api/heartbeat?via=other every 15 minutes. A reply with "status":"started" or "fresh" means it works.

### 3. Anthropic API key
- console.anthropic.com, API Keys, Create Key. Name it the-tower.
- Add credit (prepaid). The base cap is 1.70 USD a day, so 20 USD covers the first weeks.
- Paste it into the Warden clipboard (Phase 3 and later). Simulation mode turns off only after this key is present and you toggle it.

### 4. Telegram bot token and chat id
- Telegram, BotFather, /newbot, copy the token. Paste it in the game: Warden, Setup tab, Telegram bot token, Save.
- Pair your chat: open your new bot in Telegram and send the /pair line shown under "Your Telegram chat id" in the Setup tab (a six character code). Nobody else can pair, the code lives only in the passcode protected game.
- The webhook registers itself on the next heartbeat (no step for you). From then on: the morning brief at 08:00 Dubai, approvals with Approve and Reject buttons, Warden's replies to your ideas.
- Commands: /status, /brief, /pause <floor>, /resume <floor>, /cap, /run, /reply <company>: <their text> (forward a reply by hand), /send <company>: <your text> (write to a lead yourself, it goes out at once and replaces the drafted answer). Any other text is an idea.
- Approval messages show the email or the post itself, so you can decide from the phone.
- DocLedger customers (D065): /trial <company> when a company starts its free month (Success takes over), /won <company> <USD a month> when it pays (revenue and monthly revenue update), /lost <company> to close one.
- Partner offer: the Partners worker promises "a share of the monthly fee, agreed on a call" with no number. When you decide the share, tell Claude and it goes into config/docledger.ts (PARTNER_OFFER).
- Works in simulation too, so you can try the bot before pasting the Anthropic key. Simulated approvals never ring the phone, only real ones.

### 5. DocLedger repo and token
- Paste the repo URL (https://github.com/Saxqb777/docledger) under "DocLedger GitHub repo URL".
- GitHub, Settings, Developer settings, Fine grained tokens, Generate: only that repository, permissions Contents read and write, Pull requests read and write. Paste it under "GitHub token for the DocLedger repo".
- Builder runs every night at 02:00 Dubai from .github/workflows/builder.yml: top backlog ticket, clone, edit with bash and file tools, run the repo's tests, push branch builder/<ticket>, open a pull request, put a pull_request item on the red phone. Caps 25 tool calls, 0.40 USD, 20 minutes. It never merges. Tickets come from Warden and from your ideas.

### 6. Calendar booking link
- Cal.com, Calendly or a Google appointment page. Paste under "Calendar booking link". Chaser puts it in replies to warm leads.

### 7. Resend
- Status 2026-09-30: domain docledger.site (Spaceship, order 28d0dc4b, renews yearly at 55.39 AED, privacy free). Resend domain created in region eu-west-1 with sending and receiving, tracking off. Send only API key restricted to that domain. Reply webhook created for email.received pointing at /api/email/inbound.
- DNS at Spaceship (nameservers are Spaceship basic, launch1/launch2.spaceship.net). Six records, added by Claude through the Spaceship connector on 2026-09-30:
  - TXT, host resend._domainkey, value p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDURZQercKTP9Q0YoDZUl7sEz31dFw66TcKZ8OeHyi48npfVCYCUl4VryAQvqoBPqcjguIf+BnvBKELD8MTfSkHrqKeYvI53jw1blWT2vsMe7U1fDNOdIdNoFb8D/1x0l1nGgNSLJ87CWq/7347WhG8C4Db2LVYt6qnKSpVinzWnwIDAQAB
  - MX, host send, value feedback-smtp.eu-west-1.amazonses.com, priority 10
  - TXT, host send, value v=spf1 include:amazonses.com ~all
  - CNAME, host rsend, value send.forge.rmta.net
  - MX, host @, value inbound-smtp.eu-west-1.amazonaws.com, priority 10 (replies)
  - TXT, host _dmarc, value v=DMARC1; p=none;
- The domain was also added to the Vercel team (zone on, nameservers not pointed, inert). Vercel's DNS upload endpoint is closed to this environment, so DNS lives at Spaceship.
- resend.com, add and verify your sending domain, then API Keys, Create with permission Full access. Paste under "Resend API key". Paste the from address (on that domain) under "Sending address".
- 2026-10-02 (D077): the key pasted on 2026-09-30 is sending only, and Resend's reply webhook carries no text, so replies could not be read (Qafila's reply sat as a placeholder). To do: resend.com, API Keys, Create, name "The Tower full", permission Full access, paste it over the "Resend API key" box. Then: Webhooks, open the existing one, tick email.delivered, email.bounced, email.complained and email.delivery_delayed next to email.received, save (the signing secret stays the same). The Tower then reads every waiting reply on the next heartbeat and sees bounces and spam complaints.
- Approved outreach emails are sent by the next heartbeat. Nothing goes out without your Approve.
- Replies, two ways: (a) Resend Receiving: add the MX record for a subdomain, create a webhook for email.received pointing at https://the-tower-saxqb777s-projects.vercel.app/api/email/inbound, paste the signing secret under "Resend webhook secret". (b) Forward by hand on Telegram: /reply Gulf Crescent Freight: their text. Chaser picks it up either way.

### 7d. Billing in the Doc Ledger app (D080)
- Status 2026-10-02: built, waiting for your Paddle account. Until the four values below exist, the Billing page in the app says card payments open soon and nobody is ever blocked; every new company still gets its 30 day free month.
- Why Paddle: it is the merchant of record, so VAT, invoices, card storage and refunds are theirs, and a UAE founder needs no payment company of his own. Their fee is about 5 percent plus 50 cents per payment.
- Your steps, one at a time (I guide you): 1. paddle.com, create an account for Doc Ledger (sandbox first). 2. Catalog, Products, New: "Doc Ledger", one monthly price in USD (99 is the base, the price per company is set later), copy the price id (pri_...). 3. Developer tools, Authentication: a client side token. 4. Developer tools, Notifications, New destination: URL https://docledger.site/api/billing/paddle, events subscription.activated, subscription.updated, subscription.canceled, subscription.past_due, transaction.completed; copy the secret (pdl_ntfset_...). 5. Vercel, project petty-cash, Settings, Environment Variables (Production and Preview): PADDLE_ENV sandbox, PADDLE_CLIENT_TOKEN, PADDLE_PRICE_ID, PADDLE_WEBHOOK_SECRET. 6. Redeploy once. Switch PADDLE_ENV to production when Paddle approves the account.
- The Tower side needs nothing from you: DEMO_EVENT_KEY is already on both projects.

### 7c. DocLedger sales page and demo (D070)
- Done 2026-09-30: https://docledger.site is the DocLedger app with its sales page for visitors, https://demo.docledger.site is the public demo (a sample company per visitor, its own database). Emails link to the demo set up for each company.
- Changes to the app come as pull requests on Saxqb777/Petty-Cash-; you merge them.

### 7b. Company website on docledger.site (D067)
- Nothing for you to do. The Tower's deployment serves the DocLedger home page on https://docledger.site (and www redirects there). Only the home page and the per company previews live on that domain; the game stays on the Tower address.
- DNS at Spaceship: an A record for @ and a CNAME for www pointing at Vercel, added next to the six email records, which stay as they are.
- The page words come from config/docledger.ts until the Marketer's first pack arrives, then from his web page words. The booking button uses your calendar link.
- Live since 2026-09-30 about 16:25 UTC: https://docledger.site answers over HTTPS and preview links in new emails use it (settings.docledger_site_url).

### 8. DocLedger price and signature block
- The product story, the email rules and the reply walkthrough are in the repo (config/docledger.ts) from your brief of 30 September. Writer and Chaser quote them.
- Paste only what they cannot know: your price line (for example 99 USD a month per company, first month free) and the signature Writer signs with (name, title, phone). Until it is pasted, emails quote no price and sign as the Doc Ledger team.
- Every first email links to a preview page made for that company at /for/<code>, no passcode. You see the link on the approval item before you approve.

### 9. Affiliate IDs
- Amazon.ae: affiliate-program.amazon.ae, Associates account, copy the tracking tag (looks like name-21). Paste under "Amazon.ae Associates tag". Every Amazon.ae link gets ?tag= added.
- Noon and the others usually run through a network (ArabClicks, Involve Asia). Paste a link template with {url} where the product link goes, for example https://network.example/click?u={url}. Without one the post carries the plain store link and earns nothing, but the channel still grows.

### 10. Telegram deals channel
- Create a public channel in Telegram (for example @uaedailydeals). Add your bot (the same one as item 4) as an admin with "Post messages". Paste the handle under "Telegram deals channel handle".
- Scout scans the store deal pages every morning at 09:00 Dubai, Editor writes up to 10 posts, each one lands on the red phone. Approved posts go out one an hour from 10:00 to 22:00 Dubai. After 14 days Warden may ask you once to auto approve this floor.
- Every post links through https://the-tower-saxqb777s-projects.vercel.app/go/<code>, so clicks are counted. The public page https://the-tower-saxqb777s-projects.vercel.app/deals lists what was posted. Subscriber count is read from Telegram once a day for the floor's goal.

### 11. Consulting site URL
- Only needed when Ground floor unlocks (first DocLedger demo booked and budget level 2 or higher).

### 12. DocLedger Facebook Page (D074)
Social, the seventh person on the Growth floor, runs the Page. It needs the Page ID and a Page token that does not expire.
1. Facebook, Pages, Create new Page: name it DocLedger, category Software. Add the logo and a cover (the sales page screenshots work).
2. developers.facebook.com, My Apps, Create App. Pick the use case for managing everything on your Page. Your own Page needs no Meta review while the app stays yours.
3. Tools, Graph API Explorer: pick the app, then Get Token, Get Page Access Token. Tick pages_show_list, pages_manage_posts, pages_read_engagement, pages_read_user_engagement, pages_manage_engagement and read_insights. Choose the DocLedger Page and continue.
4. Tools, Access Token Debugger: paste the token, Extend Access Token, copy the long token.
5. Back in the Graph API Explorer, paste the long token and ask for me/accounts. The DocLedger entry shows the Page id and an access_token: that Page token does not expire.
6. In the game: Warden, Setup, "DocLedger Facebook Page": paste the Page id, a space, then that Page token.
What happens next: posts start within the hour (09:00 to 21:00 Dubai, at most 2 a day). Every post waits on your tap with the picture shown. After 10 approved in a row the Tower asks once to post on its own; turn it off any time in the Company tab. Answers to comments always wait on you.

### 13. Alpaca paper trading keys (D075)
Wall Street trades paper money on real prices. Alpaca's free market data needs a free paper account's keys. The floor only reads prices and news with them: it never places an order.
1. alpaca.markets, Sign up with your email. A Paper Only account works from any country and needs no money or ID.
2. In the dashboard keep Paper Trading selected, then API Keys, Generate New Keys.
3. In the game: Warden, Setup, "Alpaca paper trading keys": paste the API Key ID, a space, then the Secret Key.
What happens next: within 5 minutes the floor reads prices, Larry buys the index at the next US open (17:30 Dubai in summer, 18:30 in winter), the desks start trading. A one time approval asks to raise the daily cap by 2 USD for the floor's AI (his number); DocLedger keeps its own limits.

## What I set up myself (no action from you, but I ask before doing it)
- Neon: the tower database, schema, migrations.
- Vercel: the project, environment variables (DATABASE_URL, CRON_SECRET, OWNER_PASSCODE, SECRETS_KEY, TELEGRAM_WEBHOOK_SECRET), region, function duration.
- GitHub Actions workflow files in this repo.
- The owner passcode for the game UI. I will send it to you in chat once, and you can change it in Vercel env vars any time.
