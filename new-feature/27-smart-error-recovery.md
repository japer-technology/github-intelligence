# Feature: Smart Error Recovery UX

## Summary

When the agent fails — API error, timeout, tool crash, model refusal, context overflow — instead of a generic error message or silence, it posts a structured diagnostic: what it was trying to do, where exactly it failed, what the user can try, and a direct link to the workflow logs. It classifies errors into actionable categories (transient vs. permanent, user-fixable vs. admin-fixable), suggests specific remediation steps, and offers a one-reaction retry (🔄). For transient errors (rate limits, network blips), it automatically retries with exponential backoff before surfacing the error. The agent fails gracefully, informatively, and recoverably.

## Why This Feature — The Deep Reasoning

### 1. The Current Error Experience Is Terrible

Today, when the agent fails, one of three things happens:
- **The 👀 reaction disappears and... nothing.** No comment, no explanation. The user stares at a silent issue thread. They might check the Actions tab — if they know where it is, if they have the patience to read raw logs.
- **A terse error comment** like "pi agent exited with code 1" — technically accurate, completely unhelpful.
- **A partial response** — the agent started responding but crashed mid-sentence. The user gets half an answer with no explanation for why it stopped.

Each of these leaves the user confused, frustrated, and unsure what to do. They re-post their comment, hoping it works the second time. Sometimes it does (transient error). Sometimes it doesn't (permanent error), and they burn another API call for the same failure.

### 2. Error Messages Are the Highest-Leverage UX Investment

Users encounter errors more often than they encounter features. A study of this repo's 21 sessions shows: 3 sessions (14%) have only 5 lines — they failed immediately without producing output. That's 14% of all interactions ending in confusion. If 14% of your users' experiences are failures with no explanation, your UX is broken regardless of how good the happy path is.

Good error messages turn a frustrating experience into a learning moment:
- "API key not found" → "Add your ANTHROPIC_API_KEY as a repository secret (Settings → Secrets → Actions)"
- "Context too long" → "This conversation has grown too large. Start a new issue, or I'll try to compress the context"
- "Rate limited" → "The API is rate-limiting requests. I'll retry automatically in 30 seconds"
- "Tool error" → "A command I ran failed. Here's the output. You might need to fix the underlying issue first"

### 3. Error Classification Enables Intelligent Recovery

Not all errors are equal:

| Category | Example | Recovery |
|---|---|---|
| **Transient** | Rate limit, network timeout, API 503 | Auto-retry with backoff |
| **Auth** | Missing API key, expired token | Guide user to add/rotate secret |
| **Context** | Session too large, token limit exceeded | Compress context, suggest new issue |
| **Tool** | `git push` failed, `bash` command errored | Show output, suggest fix |
| **Model** | Safety refusal, empty response, malformed output | Rephrase prompt, suggest alternative |
| **Config** | Invalid settings.json, missing files | Show which setting is wrong, provide fix |
| **Budget** | Cost limit exceeded (feature 05) | Show cost, suggest increasing limit |

Each category has a different recovery strategy. Classifying the error enables suggesting the right fix.

### 4. Automatic Retry for Transient Errors Eliminates Most Failures

Based on typical LLM API usage, approximately 60-70% of errors are transient: rate limits (429), server errors (500/502/503), and network timeouts. These resolve on their own within seconds to minutes. Automatic retry with exponential backoff eliminates these entirely — the user never sees them.

The remaining 30-40% are permanent errors that require human action. For these, the agent provides a structured diagnosis.

### 5. Workflow Log Links Close the Debugging Loop

When an error can't be automatically resolved, the user needs to see the full logs. Today, finding the workflow run requires: navigate to Actions tab → find the correct run → click into it → expand the correct step → scroll through hundreds of lines. The agent can construct a direct link to the specific workflow run from environment variables available in GitHub Actions.

## Scope

### In Scope
- **Error classification**: Categorize errors into transient, auth, context, tool, model, config, budget
- **Structured error comments**: Post detailed, actionable error diagnostics to the issue
- **Automatic retry for transient errors**: Retry with exponential backoff (up to 3 attempts)
- **Recovery suggestions**: Specific, actionable steps for each error category
- **Workflow log links**: Direct link to the failed workflow run
- **Partial response recovery**: If the agent produced partial output before failing, post it with a note
- **Error tracking**: Record errors in `state/errors.jsonl` for pattern detection
- **Error rate alerting**: If errors exceed a threshold, post a warning

### Out of Scope
- Automatic error fixing (the agent can't fix its own API key)
- Error notification to external services (Slack, PagerDuty — that's plugin territory)
- Model fallback (switching to a different model on failure — that's a separate feature)

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Error classifier** | Categorize errors from exit codes, stderr, API responses | ~2 hours |
| **Structured error formatter** | Generate diagnostic comments per category | ~1.5 hours |
| **Automatic retry** | Exponential backoff for transient errors | ~1.5 hours |
| **Partial response recovery** | Detect and post partial agent output | ~1 hour |
| **Workflow log linker** | Construct direct links to failed runs | ~30 min |
| **Error tracker** | Append-only error log for pattern detection | ~30 min |
| **Agent orchestrator integration** | Wrap try/catch with classified recovery | ~1.5 hours |
| **Configuration** | Retry limits, error thresholds | ~30 min |
| **Docs** | Document error handling and recovery | ~30 min |
| **Testing** | Test each error category, test retry, test partial recovery | ~1.5 hours |

**Total: ~11 hours.**

---

## AI Implementation Instructions

### Step 1: Error classifier

**New file:** `.GITCLAW/lifecycle/GITCLAW-ERRORS.ts`

```typescript
export type ErrorCategory = 
  | "transient"    // rate limit, network, server error — auto-retry
  | "auth"         // missing/invalid API key or token
  | "context"      // session too large, token limit exceeded
  | "tool"         // bash/read/write tool failed
  | "model"        // safety refusal, empty response, malformed output
  | "config"       // invalid settings, missing files
  | "budget"       // cost limit exceeded
  | "unknown";     // unclassified

export interface ClassifiedError {
  category: ErrorCategory;
  title: string;
  detail: string;
  recoverable: boolean;
  autoRetryable: boolean;
  userAction: string;          // what the user should do
  adminAction?: string;        // what a repo admin should do (if different)
  logLink?: string;
}

export function classifyError(
  error: Error | string,
  exitCode: number,
  stderr: string,
  context: {
    piExitCode?: number;
    agentPartialOutput?: string;
    runId?: string;
    repo?: string;
  }
): ClassifiedError {
  const errorStr = typeof error === "string" ? error : error.message;
  const combined = `${errorStr}\n${stderr}`.toLowerCase();
  
  // ── Transient errors (auto-retryable) ────────────────────────────────────
  if (/rate.?limit|429|too many requests/i.test(combined)) {
    return {
      category: "transient",
      title: "Rate Limited",
      detail: "The API is rate-limiting requests. This is temporary.",
      recoverable: true,
      autoRetryable: true,
      userAction: "No action needed — I'll retry automatically.",
    };
  }
  
  if (/timeout|timed.?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED/i.test(combined)) {
    return {
      category: "transient",
      title: "Network Timeout",
      detail: "The API request timed out. This usually resolves quickly.",
      recoverable: true,
      autoRetryable: true,
      userAction: "No action needed — I'll retry automatically.",
    };
  }
  
  if (/50[023]|internal.?server.?error|bad.?gateway|service.?unavailable/i.test(combined)) {
    return {
      category: "transient",
      title: "API Server Error",
      detail: "The API returned a server error. This is usually temporary.",
      recoverable: true,
      autoRetryable: true,
      userAction: "No action needed — I'll retry automatically.",
    };
  }
  
  if (/overloaded|capacity|busy/i.test(combined)) {
    return {
      category: "transient",
      title: "API Overloaded",
      detail: "The API is currently overloaded. This is temporary.",
      recoverable: true,
      autoRetryable: true,
      userAction: "No action needed — I'll retry automatically. If it persists, try again in a few minutes.",
    };
  }
  
  // ── Auth errors ──────────────────────────────────────────────────────────
  if (/api.?key|ANTHROPIC_API_KEY|OPENAI_API_KEY|unauthorized|401|authentication|invalid.*key/i.test(combined)) {
    return {
      category: "auth",
      title: "API Key Missing or Invalid",
      detail: "The API key is missing, expired, or invalid.",
      recoverable: false,
      autoRetryable: false,
      userAction: "Ask a repo admin to update the API key.",
      adminAction: "Go to Settings → Secrets and variables → Actions. Verify the API key secret exists and is valid.",
    };
  }
  
  if (/permission|403|forbidden|GITHUB_TOKEN/i.test(combined)) {
    return {
      category: "auth",
      title: "Permission Denied",
      detail: "The GitHub token lacks required permissions.",
      recoverable: false,
      autoRetryable: false,
      userAction: "Ask a repo admin to check workflow permissions.",
      adminAction: "Go to Settings → Actions → General → Workflow permissions. Ensure 'Read and write permissions' is selected.",
    };
  }
  
  // ── Context errors ───────────────────────────────────────────────────────
  if (/context.?length|too.?long|token.?limit|max.?tokens|context_length_exceeded/i.test(combined)) {
    return {
      category: "context",
      title: "Conversation Too Long",
      detail: "This conversation has exceeded the model's context window.",
      recoverable: true,
      autoRetryable: false,
      userAction: "Start a new issue for a fresh conversation, or reply with `/summarize` to compress the context.",
    };
  }
  
  // ── Tool errors ──────────────────────────────────────────────────────────
  if (/git push.*failed|non-fast-forward|merge conflict/i.test(combined)) {
    return {
      category: "tool",
      title: "Git Push Failed",
      detail: "Failed to push changes to the repository. This may indicate a merge conflict.",
      recoverable: true,
      autoRetryable: true,
      userAction: "React with 🔄 to retry. If it persists, there may be a merge conflict that needs manual resolution.",
    };
  }
  
  if (/command.*failed|exit.?code.*[1-9]|non-zero/i.test(combined) && !/pi agent/i.test(combined)) {
    return {
      category: "tool",
      title: "Tool Command Failed",
      detail: `A command the agent ran returned an error.`,
      recoverable: true,
      autoRetryable: false,
      userAction: "Check the error output below. The underlying issue may need to be fixed before the agent can proceed.",
    };
  }
  
  // ── Model errors ─────────────────────────────────────────────────────────
  if (/safety|refused|content.?policy|harmful|inappropriate/i.test(combined)) {
    return {
      category: "model",
      title: "Request Declined",
      detail: "The model declined to process this request due to content policy.",
      recoverable: false,
      autoRetryable: false,
      userAction: "Rephrase your request. If you believe this is an error, try being more specific about the technical context.",
    };
  }
  
  if (/did not produce.*response|empty.*response/i.test(combined) || (context.piExitCode === 0 && !context.agentPartialOutput)) {
    return {
      category: "model",
      title: "Empty Response",
      detail: "The model ran successfully but produced no text output.",
      recoverable: true,
      autoRetryable: true,
      userAction: "React with 🔄 to retry. If it persists, try rephrasing your request.",
    };
  }
  
  // ── Config errors ────────────────────────────────────────────────────────
  if (/settings\.json|invalid.*config|parse.*error.*json|JSON.*parse/i.test(combined)) {
    return {
      category: "config",
      title: "Configuration Error",
      detail: "A configuration file is invalid or malformed.",
      recoverable: false,
      autoRetryable: false,
      userAction: "Check `.GITCLAW/.pi/settings.json` for JSON syntax errors.",
      adminAction: "Validate all JSON files in `.GITCLAW/` with a JSON linter.",
    };
  }
  
  // ── Budget errors ────────────────────────────────────────────────────────
  if (/budget|cost.?limit|spending.?limit|exceeded.*limit/i.test(combined)) {
    return {
      category: "budget",
      title: "Cost Limit Exceeded",
      detail: "The agent's cost budget has been exhausted.",
      recoverable: false,
      autoRetryable: false,
      userAction: "Ask a repo admin to increase the cost limit, or wait for the budget period to reset.",
      adminAction: "Update the cost limit in `.GITCLAW/cost.json`.",
    };
  }
  
  // ── Unknown ──────────────────────────────────────────────────────────────
  return {
    category: "unknown",
    title: "Unexpected Error",
    detail: errorStr.slice(0, 500),
    recoverable: false,
    autoRetryable: false,
    userAction: "Check the workflow logs for details. React with 🔄 to retry.",
  };
}
```

### Step 2: Structured error comment formatter

```typescript
export function formatErrorComment(
  classified: ClassifiedError,
  stderr: string,
  partialOutput?: string
): string {
  const icon = {
    transient: "⏳", auth: "🔑", context: "📏", tool: "🔧",
    model: "🤖", config: "⚙️", budget: "💰", unknown: "❓",
  }[classified.category];
  
  const sections: string[] = [
    `## ${icon} ${classified.title}`,
    "",
    classified.detail,
    "",
  ];
  
  // Partial output recovery
  if (partialOutput && partialOutput.trim().length > 50) {
    sections.push(
      "### Partial Response",
      "_The agent produced this output before the error occurred:_",
      "",
      partialOutput.trim().slice(0, 3000),
      "",
      "---",
      "",
    );
  }
  
  // What to do
  sections.push("### What You Can Do");
  sections.push(`- ${classified.userAction}`);
  if (classified.adminAction) {
    sections.push(`- **Admin:** ${classified.adminAction}`);
  }
  sections.push(`- React with 🔄 to retry this request`);
  sections.push("");
  
  // Error details (collapsed)
  if (stderr && stderr.trim().length > 0) {
    sections.push(
      "<details>",
      "<summary>Error Details</summary>",
      "",
      "```",
      stderr.trim().slice(-2000),
      "```",
      "",
      "</details>",
      "",
    );
  }
  
  // Workflow log link
  if (classified.logLink) {
    sections.push(`[📋 View full workflow logs](${classified.logLink})`);
    sections.push("");
  }
  
  // Footer
  sections.push(
    "---",
    `_Error category: \`${classified.category}\` · ${classified.recoverable ? "Recoverable" : "Requires action"} · ${classified.autoRetryable ? "Auto-retrying" : "Manual retry needed"}_`,
  );
  
  return sections.join("\n");
}
```

### Step 3: Automatic retry for transient errors

In `GITCLAW-AGENT.ts`, wrap the pi agent execution in a retry loop:

```typescript
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 5000; // 5 seconds

let lastError: Error | null = null;
let agentText = "";
let piExitCode = 0;

for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
  try {
    const pi = Bun.spawn(piArgs, { stdout: "pipe", stderr: "pipe" });
    const tee = Bun.spawn(["tee", "/tmp/agent-raw.jsonl"], { stdin: pi.stdout, stdout: "inherit" });
    const stderrText = await new Response(pi.stderr).text();
    await tee.exited;
    piExitCode = await pi.exited;
    
    if (piExitCode !== 0) {
      const classified = classifyError(
        `pi agent exited with code ${piExitCode}`,
        piExitCode,
        stderrText,
        { piExitCode }
      );
      
      if (classified.autoRetryable && attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1); // exponential backoff
        console.log(`${classified.title} — retrying in ${delay / 1000}s (attempt ${attempt}/${MAX_RETRIES})`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      
      throw new Error(`${classified.title}: ${stderrText}`);
    }
    
    // Success — extract agent text and break
    // ... existing agent text extraction ...
    break;
    
  } catch (e) {
    lastError = e as Error;
    
    const classified = classifyError(
      e as Error,
      piExitCode,
      "",
      { piExitCode }
    );
    
    if (classified.autoRetryable && attempt < MAX_RETRIES) {
      const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
      console.log(`${classified.title} — retrying in ${delay / 1000}s (attempt ${attempt}/${MAX_RETRIES})`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }
    
    // Permanent error or max retries — post diagnostic
    const logLink = `https://github.com/${repo}/actions/runs/${process.env.GITHUB_RUN_ID}`;
    classified.logLink = logLink;
    
    // Check for partial output
    let partialOutput = "";
    try {
      // Extract any text the agent produced before failing
      partialOutput = await extractPartialOutput("/tmp/agent-raw.jsonl");
    } catch (pe) { /* ignore */ }
    
    const errorComment = formatErrorComment(classified, String(e), partialOutput);
    await gh("issue", "comment", String(issueNumber), "--body", errorComment);
    
    // Log the error
    appendFileSync(
      resolve(stateDir, "errors.jsonl"),
      JSON.stringify({
        timestamp: new Date().toISOString(),
        issueNumber,
        category: classified.category,
        title: classified.title,
        detail: String(e).slice(0, 500),
        attempt,
        recovered: false,
      }) + "\n"
    );
    
    throw e; // re-throw so the finally block runs
  }
}
```

### Step 4: Partial response recovery

```typescript
async function extractPartialOutput(rawJsonlPath: string): Promise<string> {
  if (!existsSync(rawJsonlPath)) return "";
  
  try {
    const { stdout } = await run([
      "bash", "-c",
      `tac ${rawJsonlPath} | jq -r -s '[ .[] | select(.message.role == "assistant") | select((.message.content // []) | map(select(.type == "text")) | length > 0) ] | .[0].message.content[] | select(.type == "text") | .text' 2>/dev/null || true`,
    ]);
    return stdout.trim();
  } catch (e) {
    return "";
  }
}
```

### Step 5: Error tracking and alerting

```typescript
export function checkErrorRate(stateDir: string, threshold: number = 5): {
  alertNeeded: boolean;
  recentErrors: number;
  message: string;
} {
  const errorFile = resolve(stateDir, "errors.jsonl");
  if (!existsSync(errorFile)) return { alertNeeded: false, recentErrors: 0, message: "" };
  
  const lines = readFileSync(errorFile, "utf-8").split("\n").filter(Boolean);
  const last24h = lines
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean)
    .filter(e => new Date(e.timestamp).getTime() > Date.now() - 24 * 60 * 60 * 1000);
  
  if (last24h.length >= threshold) {
    const categories = last24h.reduce((acc: Record<string, number>, e: any) => {
      acc[e.category] = (acc[e.category] || 0) + 1;
      return acc;
    }, {});
    
    return {
      alertNeeded: true,
      recentErrors: last24h.length,
      message: `⚠️ High error rate: ${last24h.length} errors in the last 24 hours. ` +
        `Breakdown: ${Object.entries(categories).map(([k, v]) => `${k}: ${v}`).join(", ")}`,
    };
  }
  
  return { alertNeeded: false, recentErrors: last24h.length, message: "" };
}
```

### Step 6: Test

- Simulate a rate limit error → verify auto-retry with backoff
- Simulate a missing API key → verify structured error with admin instructions
- Simulate context overflow → verify suggestion to start new issue
- Kill the agent mid-response → verify partial output is recovered and posted
- Verify workflow log link is correct and clickable
- Simulate 5+ errors in 24h → verify error rate alert
- React with 🔄 on an error comment → verify retry is triggered

## Design Decisions

**Why auto-retry transient errors silently?** Because transient errors resolve on their own. Telling the user "rate limited, retrying..." and then "success!" is noise. The user doesn't care about the retry — they care about the result. Silent retry eliminates the most common error experience entirely.

**Why post partial output on failure?** If the agent produced 80% of a useful response before crashing, that 80% might be all the user needs. Discarding it forces the user to re-ask and wait for the full response again. Posting it with a "this is partial" warning gives the user immediate value and clear context.

**Why classify errors instead of just dumping the stack trace?** Stack traces are useful for developers debugging the agent itself. They're useless for users who want to know "what happened and what should I do." Classification bridges this gap: the user gets actionable guidance, and the full error details are available in a collapsed section for debugging.

**Why track errors in a JSONL file?** Pattern detection. If the same error category recurs across multiple issues, it signals a systemic problem (wrong API key, misconfigured permissions, context consistently too large). The error log enables the agent (or an admin) to identify and fix root causes, not just symptoms.
