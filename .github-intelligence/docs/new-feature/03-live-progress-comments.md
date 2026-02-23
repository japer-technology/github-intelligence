# Feature: Live Progress Comments

## Summary

Replace the current "👀 reaction then silence for 30–120 seconds" UX with a live progress comment that the agent posts immediately and edits in real-time as it works. The comment shows what the agent is doing (reading files, running commands, thinking) and transitions to the final response when complete. This transforms every interaction from "fire and pray" to a visible, trustworthy process.

## Why This Feature

1. **The current UX is the #1 adoption blocker.** A user opens an issue, sees 👀, then waits 30–120+ seconds with zero feedback. They don't know if the agent is working, stuck, or crashed. This uncertainty erodes trust faster than a slow response does. Live progress turns waiting into watching.

2. **It's a UX multiplier for every other feature.** PR reviews, slash commands, scheduled runs, skill invocations — they all go through the same "run pi, wait, post comment" pipeline. Improving this pipeline once improves everything built on top of it.

3. **It makes long-running tasks viable.** Currently, complex tasks (large codebase reviews, multi-file refactors, test generation suites) are anxiety-inducing because the user has no idea if the agent is 10% or 90% done. Progress updates make 5-minute runs acceptable.

4. **GitHub's API supports it natively.** `gh issue comment --edit-last` or the REST API `PATCH /repos/{owner}/{repo}/issues/comments/{id}` lets you update a comment in place. The infrastructure cost is one extra API call per update cycle — trivially cheap.

5. **It differentiates GitClaw from every other GitHub AI bot.** Most bots post once when done. A bot that visibly works in real-time feels alive, competent, and trustworthy. This is the kind of polish that turns "neat tool" into "I love this tool."

## Scope

### In Scope
- Post an initial "⏳ Working..." comment within the first 5 seconds of agent startup
- Parse the `pi` JSON stream in real-time to detect tool calls (file reads, bash commands) and assistant text blocks
- Edit the progress comment every ~10 seconds (rate-limited to avoid API throttling) with a status summary
- Show: current action (reading file X, running command Y, thinking...), elapsed time, tool call count
- Replace the progress comment with the final agent response when complete
- On error, update the progress comment with the error details instead of leaving a stale "Working..." comment

### Out of Scope
- Streaming the full agent text character-by-character (too many API calls, GitHub rate limits)
- Progress bars or percentage completion (unknowable for LLM tasks)
- Multiple simultaneous progress comments for concurrent runs
- WebSocket or real-time push (GitHub Issues don't support this)

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Progress comment lifecycle** (new module `GITCLAW-PROGRESS.ts`) | Create comment, update comment, finalize comment, error-replace comment | ~1.5 hours |
| **Stream parser** (new module or inline in agent) | Read `pi` JSON stream in real-time, extract tool call events and assistant text starts | ~2 hours |
| **Agent orchestrator** (`GITCLAW-AGENT.ts`) | Replace `tee` piping with a custom stream consumer that feeds both the JSONL file and the progress updater | ~2 hours |
| **Rate limiter** | Debounce comment edits to max 1 per 10 seconds to stay within GitHub API limits | ~30 min |
| **Error handling** | Update progress comment on agent crash instead of leaving stale placeholder | ~30 min |
| **Docs** | Update README, internals doc | ~30 min |
| **Testing** | Verify progress updates appear, verify final replacement, verify error states | ~1 hour |

**Total: ~8 hours of focused work.** This is the most technically involved of the three features because it requires real-time stream processing rather than just new event routing.

---

## AI Implementation Instructions

### Step 1: Create the progress comment module

**New file:** `.GITCLAW/lifecycle/GITCLAW-PROGRESS.ts`

This module manages the lifecycle of a single progress comment on an issue or PR.

```typescript
export interface ProgressState {
  commentId: number | null;
  issueNumber: number;
  repo: string;
  startTime: number;
  lastUpdateTime: number;
  toolCalls: { name: string; summary: string }[];
  currentAction: string;
  updateCount: number;
}

export async function createProgressComment(issueNumber: number, repo: string): Promise<ProgressState>
export async function updateProgressComment(state: ProgressState): Promise<void>
export async function finalizeProgressComment(state: ProgressState, finalBody: string): Promise<void>
export async function errorProgressComment(state: ProgressState, error: string): Promise<void>
```

**`createProgressComment`:**
- Post an initial comment to the issue via `gh api repos/{owner}/{repo}/issues/{issueNumber}/comments --method POST -f body="..."`.
- The initial comment body should be:
  ```markdown
  ⏳ **Working on it...** (0s elapsed)

  _Starting up..._
  ```
- Parse the response to extract the `commentId` (the `id` field from the API response).
- Return a `ProgressState` object with the comment ID, start time, empty tool calls array, etc.
- Use `gh api` instead of `gh issue comment` because we need the response body to get the comment ID.

**`updateProgressComment`:**
- Check if enough time has passed since `lastUpdateTime` (minimum 10 seconds between updates to respect GitHub API rate limits — 5000 requests/hour for authenticated requests, but being conservative avoids any issues).
- If not enough time has passed, return without updating.
- Build the progress comment body:
  ```markdown
  ⏳ **Working on it...** (<elapsed>s elapsed)

  <currentAction>

  <last 5 tool calls, formatted as a compact list>
  ```
- Update the comment via `gh api repos/{owner}/{repo}/issues/comments/{commentId} --method PATCH -f body="..."`.
- Update `lastUpdateTime` and `updateCount`.

**`finalizeProgressComment`:**
- Edit the progress comment to replace its entire body with `finalBody` (the agent's actual response).
- This means the progress comment IS the final comment — no extra comment is created.
- Use `gh api repos/{owner}/{repo}/issues/comments/{commentId} --method PATCH -f body="<finalBody>"`.

**`errorProgressComment`:**
- Edit the progress comment to show the error:
  ```markdown
  ❌ **Agent encountered an error** (<elapsed>s elapsed)

  <error message>

  <tool call history if any>

  See the [workflow run logs](https://github.com/<repo>/actions) for full details.
  ```

**Formatting helpers:**

Create a helper to format the tool call history compactly:

```typescript
function formatToolHistory(toolCalls: { name: string; summary: string }[]): string
```

Output format (last 5 only, most recent first):
```
📂 Read `lifecycle/GITCLAW-AGENT.ts`
🔧 Ran `ls -la state/sessions/`
📂 Read `README.md`
💭 Thinking...
```

Use emoji prefixes based on tool name:
- `read` → 📂
- `bash` → 🔧
- `edit` → ✏️
- `write` → 📝
- thinking/text generation → 💭
- unknown → 🔄

Create a helper to format elapsed time:
```typescript
function formatElapsed(startTime: number): string
```
- Under 60s: `"23s"`
- 60s+: `"1m 42s"`
- 5m+: `"5m 12s"`

### Step 2: Create a real-time stream consumer

**Modification approach:** Currently, `GITCLAW-AGENT.ts` pipes `pi`'s stdout through `tee` to both the terminal and `/tmp/agent-raw.jsonl`. We need to replace this with a custom stream consumer that:

1. Writes every line to `/tmp/agent-raw.jsonl` (same as before — needed for final text extraction).
2. Prints every line to stdout (same as before — visible in Actions logs).
3. Parses each JSON line to detect tool calls and status changes.
4. Calls `updateProgressComment` when relevant events occur.

**In `GITCLAW-AGENT.ts`, replace the tee-based piping with:**

```typescript
import { createProgressComment, updateProgressComment, finalizeProgressComment, errorProgressComment } from "./GITCLAW-PROGRESS";

// ... inside the try block, after constructing piArgs ...

// Create the progress comment before starting the agent
const progress = await createProgressComment(issueNumber, repo);

// Open the raw output file for writing
const rawFile = Bun.file("/tmp/agent-raw.jsonl").writer();

// Start the pi agent
const pi = Bun.spawn(piArgs, { stdout: "pipe", stderr: "inherit" });

// Process the stream line by line
const reader = pi.stdout.getReader();
const decoder = new TextDecoder();
let buffer = "";

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value, { stream: true });
  process.stdout.write(chunk);   // echo to Actions log
  rawFile.write(chunk);           // persist for post-processing

  buffer += chunk;
  const lines = buffer.split("\n");
  buffer = lines.pop() || "";     // keep incomplete last line in buffer

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      processStreamEvent(event, progress);
    } catch {
      // not JSON, ignore
    }
  }
}

rawFile.end();
```

**`processStreamEvent` function:**

```typescript
function processStreamEvent(event: any, progress: ProgressState): void {
  // Detect tool calls from assistant messages
  if (event.type === "message" && event.message?.role === "assistant") {
    for (const block of event.message.content || []) {
      if (block.type === "toolCall") {
        const summary = summarizeToolCall(block.name, block.arguments);
        progress.toolCalls.push({ name: block.name, summary });
        progress.currentAction = summary;
        updateProgressComment(progress);  // fire-and-forget (async but don't await)
      }
    }
  }

  // Detect tool results (agent is now processing results)
  if (event.type === "message" && event.message?.role === "toolResult") {
    progress.currentAction = "💭 Processing results...";
    updateProgressComment(progress);
  }

  // Detect assistant text generation start
  if (event.type === "message" && event.message?.role === "assistant") {
    const hasText = (event.message.content || []).some((b: any) => b.type === "text" && b.text?.length > 0);
    if (hasText) {
      progress.currentAction = "✍️ Writing response...";
      updateProgressComment(progress);
    }
  }
}
```

**`summarizeToolCall` function:**

```typescript
function summarizeToolCall(toolName: string, args: any): string {
  switch (toolName) {
    case "read":
      return `📂 Reading \`${args.path || "file"}\``;
    case "bash":
      // Truncate long commands
      const cmd = (args.command || "").slice(0, 60);
      return `🔧 Running \`${cmd}${(args.command || "").length > 60 ? "..." : ""}\``;
    case "edit":
      return `✏️ Editing \`${args.path || "file"}\``;
    case "write":
      return `📝 Writing \`${args.path || "file"}\``;
    default:
      return `🔄 ${toolName}`;
  }
}
```

**Important: The `updateProgressComment` calls inside `processStreamEvent` should be fire-and-forget.** Do not `await` them — they run in the background, debounced by the 10-second rate limiter inside `updateProgressComment`. This ensures stream processing is never blocked by API calls.

### Step 3: Finalize or error the progress comment

**In `GITCLAW-AGENT.ts`, after extracting `agentText`:**

Replace the existing `gh issue comment` call with:

```typescript
const trimmedText = agentText.trim();
const commentBody = trimmedText.length > 0
  ? trimmedText.slice(0, MAX_COMMENT_LENGTH)
  : `✅ The agent ran successfully but did not produce a text response. Check the repository for any file changes.\n\nFor full details, see the [workflow run logs](https://github.com/${repo}/actions).`;

await finalizeProgressComment(progress, commentBody);
```

**In the `catch` block (or create one wrapping the agent run):**

```typescript
catch (error) {
  if (progress?.commentId) {
    await errorProgressComment(progress, String(error));
  }
  throw error;  // re-throw so the workflow still fails
}
```

**In the `finally` block:** The reaction cleanup stays the same. But add a safety net: if `progress.commentId` exists and the comment was never finalized (e.g., the process was killed), attempt to update it with an error state.

### Step 4: Handle the edge case of creating the comment before the agent runs

The progress comment is created BEFORE `pi` starts. This means:
- If `pi` fails to start (bad binary, missing API key), the progress comment already exists and must be error-updated.
- Move the `createProgressComment` call to just before the `pi` spawn, AFTER all validation (API key check, session resolution, etc.).
- Store `progress` in a variable accessible to the `catch`/`finally` blocks.

### Step 5: Remove the separate `gh issue comment` post

Since the progress comment IS the final comment (it gets edited in place), remove the old `gh issue comment` call at the end of the pipeline. The `finalizeProgressComment` call replaces it entirely.

This means one fewer comment is created per interaction — the user sees a single comment that evolves from "Working..." to the final response.

### Step 6: Persist progress comment ID for cleanup

Write the progress comment ID to `/tmp/progress-state.json` immediately after creation:

```json
{
  "commentId": 12345678,
  "issueNumber": 42,
  "repo": "owner/repo",
  "startTime": 1708600000000
}
```

This allows the `finally` block (or even a separate cleanup workflow step) to find and update the progress comment if the main process crashes without reaching the catch block.

In the `finally` block of `GITCLAW-AGENT.ts`, add:

```typescript
// If the progress comment was never finalized, mark it as errored
if (existsSync("/tmp/progress-state.json")) {
  try {
    const ps = JSON.parse(readFileSync("/tmp/progress-state.json", "utf-8"));
    // Check if we already finalized by looking for a marker file
    if (!existsSync("/tmp/progress-finalized") && ps.commentId) {
      const elapsed = Math.round((Date.now() - ps.startTime) / 1000);
      await gh(
        "api", `repos/${ps.repo}/issues/comments/${ps.commentId}`,
        "--method", "PATCH",
        "-f", `body=❌ **Agent process ended unexpectedly** (${elapsed}s elapsed)\n\nSee the [workflow run logs](https://github.com/${ps.repo}/actions) for details.`
      );
    }
  } catch (e) {
    console.error("Failed to clean up progress comment:", e);
  }
}
```

Write a `/tmp/progress-finalized` marker file inside `finalizeProgressComment` so the safety net knows not to overwrite a successful response.

### Step 7: Rate limiting implementation detail

Inside `updateProgressComment`, implement the debounce:

```typescript
const MIN_UPDATE_INTERVAL_MS = 10_000; // 10 seconds

export async function updateProgressComment(state: ProgressState): Promise<void> {
  const now = Date.now();
  if (now - state.lastUpdateTime < MIN_UPDATE_INTERVAL_MS) {
    return; // too soon, skip this update
  }
  state.lastUpdateTime = now;

  const elapsed = formatElapsed(state.startTime);
  const history = formatToolHistory(state.toolCalls.slice(-5));
  const body = [
    `⏳ **Working on it...** (${elapsed} elapsed)`,
    "",
    state.currentAction,
    "",
    history ? `**Recent activity:**\n${history}` : "",
  ].filter(Boolean).join("\n");

  try {
    await gh(
      "api", `repos/${state.repo}/issues/comments/${state.commentId}`,
      "--method", "PATCH",
      "-f", `body=${body}`
    );
    state.updateCount++;
  } catch (e) {
    // Log but don't throw — progress updates are best-effort
    console.error("Failed to update progress comment:", e);
  }
}
```

### Step 8: Update documentation

**File:** `.GITCLAW/README.md`
- Update "How It Works" section: "The agent posts a progress comment showing what it's doing in real-time, then replaces it with the final response."
- Add a note about the progress comment UX.

**File:** `.GITCLAW/docs/GITCLAW-Internal-Mechanics.md`
- Add a new section "Progress Comments" explaining the lifecycle: create → update (debounced) → finalize/error.
- Document the stream parsing approach.
- Document the rate limiting strategy and why 10 seconds was chosen.
- Update the sequence diagram to show the progress comment steps.

### Step 9: Test

- Open a new issue with a task that requires multiple tool calls (e.g., "Read all the files in the lifecycle/ directory and summarize each one"):
  1. Verify a "⏳ Working on it..." comment appears within ~5 seconds.
  2. Verify the comment updates every ~10 seconds with current action and tool history.
  3. Verify the comment is replaced with the final agent response when done.
  4. Verify only ONE comment exists at the end (the progress comment was edited, not a new one posted).
- Open an issue that will cause an error (e.g., misconfigure the API key):
  1. Verify the progress comment is updated with an error message.
  2. Verify the 👀 reaction is still cleaned up.
- Open an issue with a quick task (agent responds in <10 seconds):
  1. Verify the progress comment is created and then immediately finalized.
  2. Verify no intermediate updates occurred (task was too fast).
- Open an issue with a very long task:
  1. Verify updates continue appearing every ~10 seconds.
  2. Count the API calls in the workflow log to verify rate limiting is working.

## Design Decisions

**Why edit-in-place rather than posting a second comment?** Two comments per interaction doubles the noise. Edit-in-place means the user sees exactly one comment that evolves from status to response. It's cleaner, and avoids cluttering long issue threads.

**Why 10-second update intervals?** GitHub's authenticated API rate limit is 5000 requests/hour (~83/minute). At 1 update per 10 seconds, a 5-minute agent run uses ~30 requests — well within limits even with concurrent runs. Shorter intervals (e.g., 3 seconds) would feel more responsive but risk hitting rate limits on busy repos.

**Why fire-and-forget for stream event processing?** The agent's stream processing must never be blocked by a GitHub API call. If an update fails or is slow, the agent continues working. Progress updates are best-effort — the final response is the only one that matters.

**Why persist progress state to /tmp?** If the process crashes between creating the progress comment and the finally block, the comment ID would be lost. Writing to /tmp immediately after creation ensures any cleanup mechanism can find and update the stale comment.
