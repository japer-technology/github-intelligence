# Feature: Token Usage & Cost Tracking

## Summary

Track and report LLM token usage, estimated cost, and session metrics for every agent run. Store per-run metrics in `state/metrics/`, surface them in issue comments as a collapsible footer, and provide a `/cost` slash command (or standalone skill) that generates usage summaries over time. This gives teams the visibility they need to adopt GitClaw without fear of runaway API bills.

## Why This Feature

1. **Cost anxiety is the #1 barrier to real adoption.** Teams considering GitClaw immediately ask "what will this cost us?" Today the answer is "check your Anthropic dashboard, I guess." That's unacceptable for any tool that runs on every issue and PR. Built-in cost tracking makes adoption a data-driven decision.

2. **The data is already flowing through the pipeline.** The `pi` agent emits JSON events that include token counts in `message_end` events (input tokens, output tokens, cache reads/writes). GitClaw already captures this stream to `/tmp/agent-raw.jsonl`. Extracting token counts is a parsing exercise, not a new data source.

3. **It enables intelligent model routing.** Once you know how many tokens each task type consumes, you can make smart decisions: use a cheaper model for simple questions, reserve the expensive model for code reviews. Cost data is the prerequisite for cost optimization.

4. **It compounds with every other feature.** PR reviews, scheduled runs, slash commands — they all consume tokens. Per-feature cost breakdowns let teams understand which capabilities are worth the spend.

5. **It's a trust signal.** An agent that reports its own resource consumption feels honest and accountable. Hiding costs feels like a vendor dark pattern. Showing them feels like a partnership.

## Scope

### In Scope
- Parse token usage from `pi`'s JSON output stream after each run
- Store per-run metrics in `state/metrics/<issueNumber>-<timestamp>.json`
- Append a collapsible cost footer to every agent comment (tokens used, estimated cost)
- Cumulative metrics file `state/metrics/summary.json` updated on each run
- A `/cost` command (or `status` enhancement) that reports usage over configurable periods
- Cost estimation based on provider/model pricing tables (hardcoded, user-overridable)

### Out of Scope
- Real-time budget enforcement or spending caps (future follow-up)
- Per-user cost attribution
- GitHub Pages dashboard (Phase 6)
- Billing integration with LLM providers

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Token parser** (new module `GITCLAW-METRICS.ts`) | Extract input/output tokens from `pi` JSON stream | ~1 hour |
| **Pricing table** | Hardcoded cost-per-token for supported providers/models | ~30 min |
| **Per-run storage** | Write metrics JSON after each run, update cumulative summary | ~1 hour |
| **Comment footer** | Append collapsible usage footer to every agent comment | ~30 min |
| **Cost reporting** | `/cost` command or standalone query against metrics | ~1.5 hours |
| **Agent orchestrator** (`GITCLAW-AGENT.ts`) | Integrate metrics extraction and footer injection | ~1 hour |
| **Docs** | Add cost tracking reference doc, update README | ~30 min |
| **Testing** | Verify token extraction, cost calculation, footer rendering, summary accumulation | ~1 hour |

**Total: ~7 hours of focused work.**

---

## AI Implementation Instructions

### Step 1: Create the metrics module

**New file:** `.GITCLAW/lifecycle/GITCLAW-METRICS.ts`

```typescript
export interface RunMetrics {
  timestamp: string;
  issueNumber: number;
  eventType: string;         // "issues", "issue_comment", "pull_request", "schedule"
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  estimatedCostUSD: number;
  durationMs: number;
  toolCalls: number;
}

export interface CumulativeMetrics {
  totalRuns: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUSD: number;
  totalDurationMs: number;
  firstRun: string;
  lastRun: string;
  byModel: Record<string, { runs: number; tokens: number; costUSD: number }>;
  byEventType: Record<string, { runs: number; tokens: number; costUSD: number }>;
}
```

**`extractTokensFromStream(rawJsonlPath: string): { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, toolCalls }`**

- Read `/tmp/agent-raw.jsonl` line by line.
- Look for events with `type === "message_end"` — these contain the `message.usage` object in `pi`'s output format.
- The usage object typically includes: `input_tokens`, `output_tokens`, and optionally `cache_creation_input_tokens`, `cache_read_input_tokens`.
- Sum all `message_end` usage blocks across the entire stream (a multi-turn session may have multiple message_end events).
- Also count tool calls: lines where `message.content` contains blocks with `type === "toolCall"`.
- If no `message_end` events have usage data (e.g., the model/provider doesn't report it), return zeroes and set a flag indicating usage was unavailable.

**Fallback parsing:** If `message_end` events don't contain usage, check for `message_start` or `message_delta` events that might carry token counts (varies by provider). Be defensive — return zeroes rather than crashing.

### Step 2: Create the pricing table

**In `GITCLAW-METRICS.ts` or a separate `GITCLAW-PRICING.ts`:**

```typescript
// Prices in USD per 1M tokens, as of early 2026
// Users can override via .GITCLAW/pricing-overrides.json
const DEFAULT_PRICING: Record<string, { input: number; output: number; cacheRead?: number; cacheWrite?: number }> = {
  // Anthropic
  "claude-opus-4-6":           { input: 15.00, output: 75.00, cacheRead: 1.50, cacheWrite: 18.75 },
  "claude-sonnet-4-20250514":  { input: 3.00,  output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-haiku-3.5":          { input: 0.80,  output: 4.00,  cacheRead: 0.08, cacheWrite: 1.00 },
  // OpenAI
  "gpt-5.3-codex":            { input: 2.00,  output: 8.00 },
  "gpt-5.3-codex-spark":      { input: 0.50,  output: 2.00 },
  // Google
  "gemini-2.5-pro":           { input: 1.25,  output: 10.00 },
  "gemini-2.5-flash":         { input: 0.15,  output: 0.60 },
  // xAI
  "grok-3":                   { input: 3.00,  output: 15.00 },
  "grok-3-mini":              { input: 0.30,  output: 0.50 },
};

export function estimateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number
): number
```

**Cost calculation:**
- Look up the model in `DEFAULT_PRICING`. If not found, try prefix matching (e.g., `claude-sonnet-4` matches `claude-sonnet-4-20250514`). If still not found, return 0 with a console warning.
- Check for `pricing-overrides.json` in `.GITCLAW/` — if it exists, merge its entries over the defaults. This lets users update prices without waiting for a GitClaw release.
- Calculate: `(inputTokens * price.input / 1_000_000) + (outputTokens * price.output / 1_000_000) + (cacheReadTokens * (price.cacheRead || price.input) / 1_000_000) + (cacheWriteTokens * (price.cacheWrite || price.input) / 1_000_000)`

### Step 3: Store per-run metrics

**In `GITCLAW-AGENT.ts`, after extracting `agentText` and before posting the comment:**

```typescript
import { extractTokensFromStream, estimateCost, RunMetrics, updateCumulativeMetrics } from "./GITCLAW-METRICS";

// After the pi agent finishes:
const runEnd = Date.now();
const tokenData = extractTokensFromStream("/tmp/agent-raw.jsonl");
const cost = estimateCost(
  configuredModel,
  tokenData.inputTokens,
  tokenData.outputTokens,
  tokenData.cacheReadTokens,
  tokenData.cacheWriteTokens
);

const metrics: RunMetrics = {
  timestamp: new Date().toISOString(),
  issueNumber,
  eventType: eventName,
  provider: configuredProvider,
  model: configuredModel,
  inputTokens: tokenData.inputTokens,
  outputTokens: tokenData.outputTokens,
  cacheReadTokens: tokenData.cacheReadTokens,
  cacheWriteTokens: tokenData.cacheWriteTokens,
  totalTokens: tokenData.inputTokens + tokenData.outputTokens,
  estimatedCostUSD: cost,
  durationMs: runEnd - runStart,  // capture runStart at the beginning of the try block
  toolCalls: tokenData.toolCalls,
};

// Write per-run metrics
const metricsDir = resolve(stateDir, "metrics");
mkdirSync(metricsDir, { recursive: true });
const metricsFile = resolve(metricsDir, `${issueNumber}-${Date.now()}.json`);
writeFileSync(metricsFile, JSON.stringify(metrics, null, 2) + "\n");

// Update cumulative summary
updateCumulativeMetrics(metricsDir, metrics);
```

**`updateCumulativeMetrics(metricsDir, newRun)`:**
- Read `state/metrics/summary.json` if it exists, otherwise initialize empty.
- Increment all cumulative counters.
- Update `byModel` and `byEventType` breakdowns.
- Write back to `summary.json`.

### Step 4: Append a cost footer to every agent comment

**In `GITCLAW-AGENT.ts`, when constructing `commentBody`:**

```typescript
const costFooter = formatCostFooter(metrics);
const commentBody = trimmedText.length > 0
  ? trimmedText.slice(0, MAX_COMMENT_LENGTH - costFooter.length - 10) + "\n\n" + costFooter
  : `✅ The agent ran successfully but did not produce a text response.\n\n${costFooter}`;
```

**`formatCostFooter(metrics: RunMetrics): string`:**

```typescript
function formatCostFooter(m: RunMetrics): string {
  const costStr = m.estimatedCostUSD > 0
    ? `$${m.estimatedCostUSD.toFixed(4)}`
    : "unknown";
  const duration = m.durationMs > 60000
    ? `${Math.floor(m.durationMs / 60000)}m ${Math.round((m.durationMs % 60000) / 1000)}s`
    : `${Math.round(m.durationMs / 1000)}s`;

  return [
    "<details>",
    "<summary>📊 Usage: " +
      `${m.totalTokens.toLocaleString()} tokens · ${costStr} · ${duration} · ${m.toolCalls} tool calls` +
    "</summary>",
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Provider | \`${m.provider}\` |`,
    `| Model | \`${m.model}\` |`,
    `| Input tokens | ${m.inputTokens.toLocaleString()} |`,
    `| Output tokens | ${m.outputTokens.toLocaleString()} |`,
    m.cacheReadTokens > 0 ? `| Cache read tokens | ${m.cacheReadTokens.toLocaleString()} |` : "",
    m.cacheWriteTokens > 0 ? `| Cache write tokens | ${m.cacheWriteTokens.toLocaleString()} |` : "",
    `| Estimated cost | ${costStr} |`,
    `| Duration | ${duration} |`,
    `| Tool calls | ${m.toolCalls} |`,
    "",
    "</details>",
  ].filter(Boolean).join("\n");
}
```

This renders as a collapsed `<details>` block at the bottom of every comment — visible if you want it, out of the way if you don't. Example:

> <details>
> <summary>📊 Usage: 12,450 tokens · $0.0387 · 45s · 8 tool calls</summary>
>
> | Metric | Value |
> |---|---|
> | Provider | `anthropic` |
> | Model | `claude-sonnet-4-20250514` |
> | Input tokens | 8,200 |
> | Output tokens | 4,250 |
> | Estimated cost | $0.0387 |
> | Duration | 45s |
> | Tool calls | 8 |
>
> </details>

### Step 5: Implement `/cost` reporting (integrates with slash commands feature, or standalone)

**If slash commands (feature 02) are implemented:** Add a `/cost` built-in command.

**If slash commands are NOT yet implemented:** Make this work as a natural language request the agent handles via its memory skill. The metrics files in `state/metrics/` are readable by the agent.

**Either way, the reporting logic is:**

When the user asks about cost (via `/cost` or natural language), the agent should:

1. Read `state/metrics/summary.json` for cumulative totals.
2. Optionally scan `state/metrics/*.json` files for recent per-run details.
3. Format a report:

```markdown
## 📊 GitClaw Usage Report

### Cumulative (since <firstRun>)
- **Total runs:** 47
- **Total tokens:** 2,145,000
- **Estimated total cost:** $8.42
- **Total agent time:** 38m 12s

### By Model
| Model | Runs | Tokens | Cost |
|---|---|---|---|
| claude-opus-4-6 | 12 | 890,000 | $6.15 |
| claude-sonnet-4-20250514 | 35 | 1,255,000 | $2.27 |

### By Event Type
| Trigger | Runs | Cost |
|---|---|---|
| issue_comment | 32 | $5.80 |
| issues | 10 | $2.12 |
| schedule | 5 | $0.50 |

### Last 7 Days
- **Runs:** 12
- **Tokens:** 548,000
- **Cost:** $1.84
```

**If implementing as a `/cost` command (no-LLM fast path):**
- Read the metrics files directly in TypeScript.
- Build the report string.
- Post as a comment without invoking the agent.
- Accept optional args: `/cost last-week`, `/cost last-month`, `/cost by-model`.

### Step 6: Handle missing token data gracefully

Not all providers/models report token usage in the same format. The metrics module must handle:

- **No usage data at all:** Set all token fields to 0, cost to 0, and add a note in the footer: `📊 Usage: token data unavailable for this provider`
- **Partial data:** Report what's available, estimate the rest or show "N/A".
- **Different field names:** Anthropic uses `input_tokens`/`output_tokens`, OpenAI uses `prompt_tokens`/`completion_tokens`. The parser should handle both.

### Step 7: Update documentation

**New file:** `.GITCLAW/docs/GITCLAW-Cost-Tracking.md`

Document:
- What metrics are tracked and where they're stored
- How cost estimation works (pricing table, overrides)
- How to read the cost footer on comments
- How to use `/cost` for reports
- How to override pricing via `pricing-overrides.json`
- Privacy note: metrics are committed to git and visible in public repos

**File:** `.GITCLAW/README.md`
- Add a "Cost Tracking" row to the capabilities table
- Mention the cost footer and `/cost` command

### Step 8: Test

- Run the agent on an issue and verify:
  1. A metrics JSON file is created in `state/metrics/`
  2. The `summary.json` is created/updated
  3. The agent's comment includes the collapsible cost footer
  4. Token counts and cost look reasonable for the interaction
- Run multiple interactions and verify:
  1. `summary.json` accumulates correctly
  2. `byModel` and `byEventType` breakdowns update
- Test with a model that doesn't report token usage:
  1. Verify graceful degradation (footer says "unavailable")
  2. Verify no crash
- Test `/cost` command (or ask "how much have you cost me?"):
  1. Verify a formatted report is generated from metrics files
