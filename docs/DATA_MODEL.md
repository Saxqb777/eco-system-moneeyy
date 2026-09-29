# The Tower: data model (Phase 0 proposal)

Postgres on Neon, managed with Drizzle. Conventions:

- id: uuid primary key (gen_random_uuid) unless noted. Log tables use bigserial.
- created_at and updated_at: timestamptz, default now.
- simulated: boolean, default false, on every table that simulation mode can write. Real counters only sum rows where simulated is false.
- Status columns are text with an application enum, so adding a state never needs a migration.
- Money is numeric(12,6) in USD. Original currency amounts are kept next to the USD value where relevant.
- task_events is append only: the app never updates or deletes rows there, and a database rule blocks it too.

## Core

### settings
| column | type | notes |
|--------|------|-------|
| key | text, pk | simulation_mode, daily_cap_usd (1.70), hard_ceiling_usd (5.00), budget_level (1), timezone (Asia/Dubai), warden_interval_hours (4), brief_hour_local (8), model_overrides, sound_enabled, owner_chat_id, launch_date |
| value | jsonb | |
| updated_at | timestamptz | |

### setup_items
| column | type | notes |
|--------|------|-------|
| key | text, pk | anthropic_api_key, telegram_bot_token, telegram_chat_id, docledger_repo_url, docledger_github_token, calendar_link, resend_api_key, resend_from, affiliate_amazon_ae, affiliate_noon, affiliate_other, deals_channel, docledger_product_facts, consulting_site_url |
| label | text | shown on the clipboard |
| how_to | text | one line on how to get it |
| kind | text | secret, text, url |
| required_for | text[] | floor slugs or features, for example docledger, deals, builder, telegram, email |
| status | text | missing, present, invalid |
| value_encrypted | text | AES 256 GCM, null when missing |
| hint | text | last 4 characters for secrets, full value for non secrets |
| provided_at | timestamptz | |
| sort | int | |

### floors
| column | type | notes |
|--------|------|-------|
| id | uuid | |
| slug | text, unique | penthouse, docledger, deals, content, service, lobby |
| name | text | |
| level | int | 0 lobby, 1 ground, 2 floor 1, 3 floor 2, 4 floor 3, 5 penthouse |
| accent | text | hex color |
| goal_metric | text | for example demos booked |
| weekly_target | numeric | |
| target_unit | text | |
| status | text | locked, live, paused |
| unlock_rule | text | plain English label shown on the floor plate |
| unlock_condition | jsonb | machine form, for example {net_usd_min: 100, budget_level_min: 2} |
| strategy_note | text | written by Warden |
| strategy_updated_at | timestamptz | |
| auto_approve | boolean | Deals Engine after the approved request |
| auto_approve_since | timestamptz | |
| throttled_until | timestamptz | set by the 40 percent guard, cleared at the next Dubai midnight |
| paused_reason | text | why the floor is paused, for example the daily cap |
| niche | text | current niche, for example freight forwarders |
| next_niches | jsonb | ordered list kept by Warden |
| monthly_guide_usd | numeric | allocation guide from the brief |
| sort | int | |

### agents
| column | type | notes |
|--------|------|-------|
| id | uuid | |
| slug | text, unique | warden, docledger_scout, docledger_analyst, docledger_writer, docledger_chaser, docledger_builder, deals_scout, deals_editor, deals_publisher |
| floor_id | uuid | fk floors |
| name | text | editable inline in the character panel |
| role | text | scout, analyst, writer, chaser, builder, editor, publisher, warden |
| kind | text | warden, worker, builder |
| model_key | text | key into config/models.ts, overridable |
| status | text | idle, working, blocked, paused, riding, helping, offline |
| location_level | int | where the sprite is right now |
| current_task_id | uuid | |
| sprite | jsonb | hair, glasses, mug, slouch, coat, palette index |
| playbook_key | text | |
| prompt_version | int | |
| tasks_done | int | |
| tasks_failed | int | |
| review_score_sum | numeric | |
| review_count | int | |

## Work

### tasks
| column | type | notes |
|--------|------|-------|
| id | uuid | |
| floor_id | uuid | |
| agent_id | uuid | assigned worker |
| kind | text | playbook step, for example find_leads, qualify_lead, draft_outreach, follow_up, find_deals, write_post, publish_post, build_ticket |
| title | text | the 3 word label shown in the paper bubble |
| description | text | |
| status | text | queued, assigned, running, in_batch, review, done, rejected, blocked, cancelled |
| priority | int | |
| input | jsonb | |
| output | jsonb | validated against the playbook output schema |
| review_score | int | 1 to 10 from Warden |
| review_reason | text | |
| feedback | text | from a rejection or from Saaqib |
| parent_task_id | uuid | pipeline lineage |
| batch_id | text | Anthropic batch id |
| batch_custom_id | text | |
| attempts | int | |
| blocked_reason | text | |
| needs_owner | boolean | true when only Saaqib can unblock it |
| due_at | timestamptz | |
| started_at | timestamptz | |
| finished_at | timestamptz | |
| simulated | boolean | |

### task_events (append only)
| column | type | notes |
|--------|------|-------|
| id | bigserial | |
| task_id | uuid | |
| agent_id | uuid | |
| floor_id | uuid | |
| type | text | created, assigned, started, log, output, blocked, help_requested, warden_dispatched, warden_arrived, review, rejected, done, cancelled |
| message | text | one line for the live log stream |
| data | jsonb | |
| created_at | timestamptz | |

Index on (task_id, id) and on (created_at) for the live stream.

### approvals
| column | type | notes |
|--------|------|-------|
| id | uuid | |
| type | text | outreach_email, public_post, pull_request, spend_increase, floor_unlock, credential_request, decision |
| status | text | pending, approved, rejected, expired |
| summary | text | plain English |
| content | jsonb | the full content, for example subject and body, or post text and links |
| preview_url | text | pull request or Vercel preview |
| risk_note | text | |
| feedback | text | on reject |
| task_id | uuid | |
| agent_id | uuid | |
| floor_id | uuid | |
| telegram_message_id | bigint | to edit the message after a decision |
| decided_at | timestamptz | |
| decided_via | text | ui, telegram, auto |
| executed_at | timestamptz | when the side effect ran |
| execution_result | jsonb | |
| simulated | boolean | |

## Money

### budget_ledger
| column | type | notes |
|--------|------|-------|
| id | bigserial | |
| kind | text | api_cost, web_search, revenue, adjustment |
| amount_usd | numeric(12,6) | costs positive under kind api_cost, revenue positive under kind revenue |
| floor_id | uuid | |
| agent_id | uuid | |
| task_id | uuid | |
| agent_run_id | uuid | |
| revenue_id | uuid | |
| verified | boolean | only revenue rows use it |
| note | text | |
| simulated | boolean | |
| occurred_at | timestamptz | |

Indexes on (occurred_at) and (floor_id, occurred_at). The roof counters, the petty cash counter, the daily cap check and the weekly review all read this table.

### agent_runs
| column | type | notes |
|--------|------|-------|
| id | uuid | |
| agent_id | uuid | |
| task_id | uuid | |
| floor_id | uuid | |
| model | text | exact model id used |
| mode | text | sync, batch |
| input_tokens | int | |
| output_tokens | int | |
| cache_read_tokens | int | |
| cache_write_tokens | int | |
| web_search_count | int | |
| cost_usd | numeric(12,6) | |
| duration_ms | int | |
| stop_reason | text | |
| batch_id | text | |
| custom_id | text | |
| error | text | |
| simulated | boolean | |
| started_at | timestamptz | |
| finished_at | timestamptz | |

### revenue
| column | type | notes |
|--------|------|-------|
| id | uuid | |
| floor_id | uuid | |
| source | text | commission, invoice, other |
| amount_usd | numeric | |
| amount_original | numeric | |
| currency | text | AED or USD |
| verified | boolean | false until Saaqib confirms or a payout report matches |
| verified_at | timestamptz | |
| verified_by | text | owner, system |
| evidence_url | text | |
| note | text | |
| lead_id | uuid | |
| post_id | uuid | |
| simulated | boolean | |
| occurred_at | timestamptz | |

### budget_reviews
| column | type | notes |
|--------|------|-------|
| id | uuid | |
| week_start | date | |
| spend_usd | numeric | |
| verified_revenue_usd | numeric | |
| ratio | numeric | |
| decision | text | raise, hold, drop, needs_approval |
| level_before | int | |
| level_after | int | |
| cap_before | numeric | |
| cap_after | numeric | |
| approval_id | uuid | when past the ceiling |
| consecutive_low_weeks | int | |
| created_at | timestamptz | |

## Floor 3: DocLedger Sales

### leads
| column | type | notes |
|--------|------|-------|
| id | uuid | |
| floor_id | uuid | |
| company | text | |
| website | text | |
| segment | text | freight_forwarder, customs_broker, small_3pl |
| city | text | |
| country | text | default AE |
| phone | text | |
| source_url | text | where Scout found it |
| decision_maker | jsonb | name, title, email, linkedin, confidence |
| score | int | 1 to 10 from Analyst |
| score_reason | text | |
| status | text | new, qualified, disqualified, drafted, contacted, replied, demo_booked, client, lost |
| next_action_at | timestamptz | for Chaser |
| dedupe_key | text, unique | normalised company plus domain |
| found_by_task_id | uuid | |
| simulated | boolean | |

### outreach
| column | type | notes |
|--------|------|-------|
| id | uuid | |
| lead_id | uuid | |
| step | int | 1 first email, 2 and 3 follow ups |
| channel | text | email |
| subject | text | |
| body_text | text | |
| body_html | text | |
| approval_id | uuid | required before sending |
| status | text | draft, approved, sent, delivered, replied, bounced, rejected |
| resend_id | text | |
| sent_at | timestamptz | |
| reply_text | text | |
| reply_at | timestamptz | |
| simulated | boolean | |

### tickets (Builder)
| column | type | notes |
|--------|------|-------|
| id | uuid | |
| floor_id | uuid | |
| source | text | idea, warden, builder, owner |
| title | text | |
| description | text | |
| repo | text | |
| branch | text | |
| pr_url | text | |
| preview_url | text | |
| status | text | backlog, assigned, in_progress, pr_open, approved, merged, rejected, failed |
| approval_id | uuid | |
| idea_id | uuid | |
| builder_task_id | uuid | |
| cost_usd | numeric | |
| failure_reason | text | |
| simulated | boolean | |

## Floor 2: Deals Engine

### deals
| column | type | notes |
|--------|------|-------|
| id | uuid | |
| floor_id | uuid | |
| store | text | amazon_ae, noon, sharaf_dg, carrefour, talabat |
| title | text | |
| url | text | |
| affiliate_url | text | null when no affiliate id exists |
| price | numeric | |
| was_price | numeric | |
| discount_pct | numeric | |
| currency | text | AED |
| category | text | |
| image_url | text | |
| found_by_task_id | uuid | |
| status | text | found, selected, posted, expired, rejected |
| expires_at | timestamptz | |
| dedupe_key | text, unique | store plus product id or normalised url |
| simulated | boolean | |

### posts
| column | type | notes |
|--------|------|-------|
| id | uuid | |
| floor_id | uuid | |
| kind | text | deal, content |
| deal_ids | uuid[] | |
| body | text | |
| channel | text | telegram_channel, site |
| approval_id | uuid | |
| status | text | draft, approved, scheduled, posted, failed, rejected |
| scheduled_at | timestamptz | |
| posted_at | timestamptz | |
| telegram_message_id | bigint | |
| short_code | text, unique | for /go/<code> |
| clicks | int | cached count |
| simulated | boolean | |

### clicks
| column | type | notes |
|--------|------|-------|
| id | bigserial | |
| short_code | text | |
| post_id | uuid | |
| deal_id | uuid | |
| ts | timestamptz | |
| referrer | text | |
| country | text | from the request geo header |
| ua_hash | text | hashed user agent, no raw personal data |

## Warden and messaging

### ideas
| column | type | notes |
|--------|------|-------|
| id | uuid | |
| text | text | |
| source | text | telegram, ui |
| status | text | new, planned, rejected, done |
| floor_id | uuid | assigned by Warden |
| ticket_id | uuid | |
| warden_reply | text | |
| telegram_message_id | bigint | |
| handled_at | timestamptz | |

### warden_runs
| column | type | notes |
|--------|------|-------|
| id | uuid | |
| mode | text | sync, batch |
| trigger | text | schedule, setup, manual, idea, blocked, weekly |
| status | text | submitted, applied, failed |
| snapshot | jsonb | what Warden saw |
| decisions | jsonb | what Warden decided, validated against the schema |
| summary | text | one paragraph shown in the Warden panel |
| cost_usd | numeric | |
| agent_run_id | uuid | |
| batch_id | text | |
| started_at | timestamptz | |
| finished_at | timestamptz | |
| simulated | boolean | |

### batches
| column | type | notes |
|--------|------|-------|
| id | text, pk | Anthropic batch id |
| status | text | submitted, ended, collected, failed |
| request_count | int | |
| submitted_at | timestamptz | |
| ended_at | timestamptz | |
| collected_at | timestamptz | |
| error | text | |

### messages_out
| column | type | notes |
|--------|------|-------|
| id | uuid | |
| channel | text | telegram |
| chat_id | text | |
| kind | text | brief, approval, reply, alert, post |
| body | text | |
| inline_keyboard | jsonb | |
| related_type | text | approval, idea, post |
| related_id | uuid | |
| status | text | queued, sent, failed |
| send_after | timestamptz | |
| sent_at | timestamptz | |
| provider_message_id | bigint | |
| attempts | int | |
| last_error | text | |

### telegram_updates
| column | type | notes |
|--------|------|-------|
| update_id | bigint, pk | idempotency for the webhook |
| received_at | timestamptz | |
| payload | jsonb | |

### ticks
| column | type | notes |
|--------|------|-------|
| id | uuid | |
| trigger | text | cron, manual, setup, idea, blocked, ui |
| status | text | running, done, failed |
| steps | jsonb | what each step did |
| error | text | |
| started_at | timestamptz | |
| finished_at | timestamptz | |

One row per heartbeat so the status page and Warden can see the pulse.

## Derived views (not tables)

- today_spend_by_floor: sum of api_cost and web_search rows since midnight Dubai, grouped by floor, real rows only.
- tower_net: verified revenue minus all costs, real rows only. Shown on the roof.
- floor_week_actual: this week's value of the floor's goal metric, computed per floor from leads, outreach, posts, clicks or revenue.
- agent_stats: tasks done, success rate and average review score per agent, computed from tasks.

## Notes

- The deals table is the Deals Engine product deals. DocLedger sales progress lives on leads.status (demo_booked, client), so no second deals table is needed.
- Warden is a row in agents (kind warden) so it has a sprite, a location and stats like everyone else.
- Locked floors already have their rows and unlock conditions from day one so the padlock labels come from the database.
