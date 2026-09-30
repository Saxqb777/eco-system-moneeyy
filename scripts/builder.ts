// Builder's night shift. Runs inside builder.yml on GitHub Actions, never on Vercel.
// One ticket: clone the DocLedger repo, let Sonnet edit it with bash and file tools under hard caps,
// run the tests, push a branch, open a pull request, report back to the Tower. Never merges.
import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam, Tool } from "@anthropic-ai/sdk/resources/messages/messages";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { computeCostUsd } from "@/lib/money";

const TOWER_URL = (process.env.TOWER_URL ?? "").replace(/\/$/, "");
const TOKEN = process.env.TOWER_TOKEN ?? "";
const AUTH = process.env.TOWER_AUTH ?? "github-oidc";
const MODEL = process.env.BUILDER_MODEL ?? "claude-sonnet-5-5";

interface Job {
  ticket: { id: string; title: string; description: string | null; repo: string | null };
  repoUrl: string;
  caps: { toolCalls: number; usd: number; minutes: number };
}

async function tower(method: "GET" | "POST", query: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${TOWER_URL}/api/builder${query}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, "x-tower-auth": AUTH, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Tower ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

function sh(cmd: string, cwd: string, timeoutMs = 120_000): { code: number; out: string } {
  const r = spawnSync("bash", ["-lc", cmd], { cwd, encoding: "utf8", timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  const out = `${r.stdout ?? ""}${r.stderr ? `\n${r.stderr}` : ""}`.trim();
  return { code: r.status ?? 1, out: out.length > 6000 ? `${out.slice(0, 3000)}\n...\n${out.slice(-2500)}` : out };
}

function detectTest(cwd: string): string | null {
  const pkg = path.join(cwd, "package.json");
  if (existsSync(pkg)) {
    try {
      const p = JSON.parse(readFileSync(pkg, "utf8")) as { scripts?: Record<string, string> };
      if (p.scripts?.test) return existsSync(path.join(cwd, "pnpm-lock.yaml")) ? "pnpm install --frozen-lockfile && pnpm test" : "npm ci && npm test";
      return existsSync(path.join(cwd, "pnpm-lock.yaml")) ? "pnpm install --frozen-lockfile && pnpm exec tsc --noEmit || true" : "npm ci && npx tsc --noEmit || true";
    } catch {
      return null;
    }
  }
  if (existsSync(path.join(cwd, "pyproject.toml")) || existsSync(path.join(cwd, "pytest.ini"))) return "python -m pytest -q";
  return null;
}

const TOOLS: Tool[] = [
  { name: "bash", description: "Run a shell command inside the repository checkout. Output is truncated. No network installs beyond the package manager.", input_schema: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } },
  { name: "read_file", description: "Read a file from the checkout (path relative to the repo root).", input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } },
  { name: "write_file", description: "Write a whole file in the checkout (path relative to the repo root). Creates folders as needed.", input_schema: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } },
];

function runTool(name: string, input: Record<string, unknown>, cwd: string): string {
  const rel = String(input.path ?? "");
  const target = path.resolve(cwd, rel);
  if ((name === "read_file" || name === "write_file") && !target.startsWith(cwd)) return "Refused: path leaves the checkout";
  if (name === "bash") return sh(String(input.command ?? ""), cwd, 90_000).out || "(no output)";
  if (name === "read_file") return existsSync(target) ? readFileSync(target, "utf8").slice(0, 20000) : "File not found";
  if (name === "write_file") {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, String(input.content ?? ""), "utf8");
    return `Wrote ${rel}`;
  }
  return "Unknown tool";
}

async function main() {
  if (!TOWER_URL || !TOKEN) throw new Error("TOWER_URL and TOWER_TOKEN are required");
  const handout = (await tower("GET", "?action=next")) as { job: Job | null; reason?: string; secrets?: { anthropicKey: string | null; githubToken: string | null } };
  if (!handout.job) {
    console.log(`No ticket tonight: ${handout.reason ?? "backlog empty"}`);
    return;
  }
  const { job, secrets } = handout;
  if (!secrets?.anthropicKey) throw new Error("Anthropic key not on the clipboard");
  if (!secrets.githubToken) throw new Error("DocLedger GitHub token not on the clipboard");
  console.log(`::add-mask::${secrets.anthropicKey}`);
  console.log(`::add-mask::${secrets.githubToken}`);
  await tower("POST", "", { action: "start", ticketId: job.ticket.id });

  const started = Date.now();
  const deadline = started + job.caps.minutes * 60_000;
  const repoMatch = job.repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (!repoMatch) throw new Error(`Cannot parse repo URL ${job.repoUrl}`);
  const [, owner, repo] = repoMatch;
  const work = mkdtempSync(path.join(tmpdir(), "builder-"));
  const cwd = path.join(work, repo!);
  execFileSync("git", ["clone", "--depth", "50", `https://x-access-token:${secrets.githubToken}@github.com/${owner}/${repo}.git`, cwd], { stdio: "pipe" });
  sh('git config user.name "Builder (The Tower)" && git config user.email "builder@the-tower.invalid"', cwd);
  const slug = job.ticket.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  const branch = `builder/${slug}-${job.ticket.id.slice(0, 6)}`;
  sh(`git checkout -b ${branch}`, cwd);
  const tree = sh("git ls-files | head -200", cwd).out;
  const testCmd = detectTest(cwd);

  const client = new Anthropic({ apiKey: secrets.anthropicKey });
  const system = `You are Builder on the DocLedger Sales floor of The Tower. You work on one ticket in the DocLedger repository checkout using the tools. Make the smallest change that resolves the ticket, keep the existing style, add or update a test when the repo has tests. Do not touch CI files, secrets or unrelated code. When the change is complete, reply with a short plain English summary of what you changed and why (no hyphens or em dashes). You have at most ${job.caps.toolCalls} tool calls.`;
  const messages: MessageParam[] = [{ role: "user", content: `Ticket: ${job.ticket.title}\n\n${job.ticket.description ?? ""}\n\nRepository files (first 200):\n${tree}\n\nTest command detected: ${testCmd ?? "none"}\n\nStart by reading the files that matter, then make the change.` }];
  let toolCalls = 0;
  let costUsd = 0;
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let summary = "";
  let failureReason: string | null = null;

  while (true) {
    if (Date.now() > deadline) {
      failureReason = `Time cap of ${job.caps.minutes} minutes reached`;
      break;
    }
    const res = await client.messages.create({ model: MODEL, max_tokens: 4000, system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }], messages, tools: TOOLS, output_config: { effort: "medium" } });
    usage.inputTokens += res.usage.input_tokens;
    usage.outputTokens += res.usage.output_tokens;
    usage.cacheReadTokens += res.usage.cache_read_input_tokens ?? 0;
    usage.cacheWriteTokens += res.usage.cache_creation_input_tokens ?? 0;
    costUsd += computeCostUsd(MODEL, { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, cacheReadTokens: res.usage.cache_read_input_tokens ?? 0, cacheWriteTokens: res.usage.cache_creation_input_tokens ?? 0 });
    const toolUses = res.content.filter((b) => b.type === "tool_use");
    const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();
    if (!toolUses.length || res.stop_reason === "end_turn") {
      summary = text || "Change made";
      break;
    }
    if (costUsd > job.caps.usd) {
      failureReason = `Cost cap of ${job.caps.usd} USD reached`;
      break;
    }
    messages.push({ role: "assistant", content: res.content });
    const results = [];
    for (const tu of toolUses) {
      if (tu.type !== "tool_use") continue;
      toolCalls += 1;
      if (toolCalls > job.caps.toolCalls) {
        failureReason = `Tool call cap of ${job.caps.toolCalls} reached`;
        break;
      }
      const out = runTool(tu.name, (tu.input ?? {}) as Record<string, unknown>, cwd);
      console.log(`[tool ${toolCalls}] ${tu.name}: ${String((tu.input as Record<string, unknown>).command ?? (tu.input as Record<string, unknown>).path ?? "").slice(0, 120)}`);
      results.push({ type: "tool_result" as const, tool_use_id: tu.id, content: out });
    }
    if (failureReason) break;
    messages.push({ role: "user", content: results });
  }

  const durationMs = Date.now() - started;
  const usageReport = { ...usage, costUsd: Math.round(costUsd * 1e6) / 1e6, durationMs, toolCalls, model: MODEL };
  const changed = sh("git status --porcelain", cwd).out;
  if (!failureReason && !changed) failureReason = "No files changed";
  let testOut = "";
  if (!failureReason && testCmd) {
    const t = sh(testCmd, cwd, 8 * 60_000);
    testOut = t.out;
    if (t.code !== 0) failureReason = `Tests failed:\n${t.out.slice(-1500)}`;
  }
  if (failureReason) {
    await tower("POST", "", { action: "result", ticketId: job.ticket.id, status: "failed", failureReason: failureReason.slice(0, 2000), usage: usageReport });
    console.log(`Failed: ${failureReason.slice(0, 300)}`);
    process.exitCode = 0;
    return;
  }
  sh(`git add -A && git commit -q -m "${job.ticket.title.replace(/"/g, "'")}\n\nOpened by Builder from The Tower. Ticket ${job.ticket.id}."`, cwd);
  const push = sh(`git push -u origin ${branch}`, cwd, 120_000);
  if (push.code !== 0) {
    await tower("POST", "", { action: "result", ticketId: job.ticket.id, status: "failed", failureReason: `Push failed: ${push.out.slice(-800)}`, usage: usageReport });
    return;
  }
  const defaultBranch = sh("git remote show origin | sed -n 's/.*HEAD branch: //p'", cwd).out.trim() || "main";
  const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls`, {
    method: "POST",
    headers: { authorization: `Bearer ${secrets.githubToken}`, accept: "application/vnd.github+json", "content-type": "application/json", "user-agent": "the-tower-builder" },
    body: JSON.stringify({ title: job.ticket.title, head: branch, base: defaultBranch, body: `${summary}\n\n${testOut ? `Tests:\n\`\`\`\n${testOut.slice(-800)}\n\`\`\`\n\n` : ""}Opened by Builder from The Tower. Never merged by Builder.` }),
  });
  const pr = (await prRes.json().catch(() => ({}))) as { html_url?: string; message?: string };
  if (!prRes.ok || !pr.html_url) {
    await tower("POST", "", { action: "result", ticketId: job.ticket.id, status: "failed", failureReason: `Pull request failed: ${pr.message ?? prRes.status}`, branch, usage: usageReport });
    return;
  }
  await tower("POST", "", { action: "result", ticketId: job.ticket.id, status: "pr_open", branch, prUrl: pr.html_url, summary: summary.slice(0, 2000), usage: usageReport });
  console.log(`Pull request opened: ${pr.html_url}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
