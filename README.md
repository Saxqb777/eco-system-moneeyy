# The Tower

A personal AI agent ecosystem that looks like a tycoon game. Warden runs a building of worker agents. Each floor is a business. Saaqib approves, gives ideas and pastes credentials.

Start with CLAUDE.md, then docs/PLAN.md. The brief is docs/MASTER_PROMPT.md. What Saaqib must provide is in SETUP.md.

## Run locally

```
pnpm install
cp .env.example .env.local   # fill in values
pnpm db:migrate
pnpm db:seed
pnpm dev
```

`pnpm tick` runs one heartbeat locally. `pnpm test` runs the rule tests. `pnpm typecheck` checks types.
