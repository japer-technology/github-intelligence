# Feature 34: Wake Word Filter

## What
Only trigger the agent when the comment @mentions `@github-actions[bot]` (or a configurable wake word like `@gitclaw`), or when the issue has a `gitclaw` label. Human-to-human comments on the same issue don't waste API calls.

## Why — High Impact
Today, **every** comment on an issue triggers the agent — even "thanks!" or a teammate discussing a tangent. Each trigger costs API tokens and pollutes the session with irrelevant turns. Teams with active issue discussions will burn tokens on comments not meant for the agent.

## Effort: ~2 hours

## Implementation

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts`

After reading the event, before any processing:

```typescript
// ── Wake word filter ───────────────────────────────────────────────────────
const wakeConfig = existsSync(resolve(gitclawDir, "wake.json"))
  ? JSON.parse(readFileSync(resolve(gitclawDir, "wake.json"), "utf-8"))
  : { enabled: false };

if (wakeConfig.enabled && eventName === "issue_comment") {
  const commentBody = event.comment.body.toLowerCase();
  const wakeWords = wakeConfig.words || ["@github-actions", "@gitclaw"];
  const wakeLabels = wakeConfig.labels || ["gitclaw"];
  
  const hasWakeWord = wakeWords.some((w: string) => commentBody.includes(w.toLowerCase()));
  const hasLabel = (event.issue.labels || []).some((l: any) => wakeLabels.includes(l.name));
  
  if (!hasWakeWord && !hasLabel) {
    console.log("Wake word not found, skipping. Comment does not mention the agent.");
    process.exit(0);
  }
}
```

**New file:** `.GITCLAW/wake.json`
```json
{
  "enabled": false,
  "words": ["@github-actions", "@gitclaw"],
  "labels": ["gitclaw"],
  "alwaysRespondToOpened": true
}
```

When `alwaysRespondToOpened` is true, the agent always responds to `issues.opened` events (the initial issue creation) regardless of wake words — only follow-up comments need the wake word.

---

# Feature 35: Response Time & Model Footer

## What
Append a small footer to every agent response showing wall-clock time, model used, and turn number. `⏱️ 47s · claude-opus-4-6 · turn 8`

## Why — High Impact
Users have zero visibility into agent performance. A 90-second response feels broken without context. Knowing the model builds trust. Knowing the turn number signals conversation depth. All with **3 lines of code**.

## Effort: ~1 hour

## Implementation

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts`

Already has `configuredModel`. Record start time at the beginning:

```typescript
const agentStartTime = Date.now();
```

After extracting `agentText`, before posting:

```typescript
const elapsedSec = Math.round((Date.now() - agentStartTime) / 1000);
const turnNumber = mode === "resume" ? "resumed" : "1";
// Count user messages in session for accurate turn number
let turnCount = 1;
if (latestSession && existsSync(latestSession)) {
  const sessionContent = readFileSync(latestSession, "utf-8");
  turnCount = sessionContent.split("\n").filter(l => {
    try { return JSON.parse(l).message?.role === "user"; } catch { return false; }
  }).length;
}

const footer = `\n\n<sub>⏱️ ${elapsedSec}s · ${configuredModel} · turn ${turnCount}</sub>`;
const commentBody = trimmedText.slice(0, MAX_COMMENT_LENGTH - footer.length) + footer;
```

---

# Feature 36: Long Response Splitter

## What
When the agent's response exceeds 55,000 characters (leaving margin under GitHub's 65K limit), automatically split into numbered continuation comments instead of silently truncating.

## Why — High Impact
The current code does `trimmedText.slice(0, MAX_COMMENT_LENGTH)` — silently cutting off the response. The user gets an incomplete answer with no indication that content was lost. For long analyses, code generation, or multi-file changes, this regularly loses the most important part (the conclusion).

## Effort: ~1.5 hours

## Implementation

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts`

Replace the single comment post with:

```typescript
const SPLIT_THRESHOLD = 55000;

if (trimmedText.length <= SPLIT_THRESHOLD) {
  await gh("issue", "comment", String(issueNumber), "--body", commentBody);
} else {
  // Split into chunks at paragraph boundaries
  const chunks: string[] = [];
  let remaining = trimmedText;
  let partNum = 1;
  
  while (remaining.length > 0) {
    if (remaining.length <= SPLIT_THRESHOLD) {
      chunks.push(remaining);
      break;
    }
    
    // Find a good split point (paragraph break near the limit)
    let splitAt = remaining.lastIndexOf("\n\n", SPLIT_THRESHOLD);
    if (splitAt < SPLIT_THRESHOLD * 0.5) {
      splitAt = remaining.lastIndexOf("\n", SPLIT_THRESHOLD);
    }
    if (splitAt < SPLIT_THRESHOLD * 0.5) {
      splitAt = SPLIT_THRESHOLD;
    }
    
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trim();
  }
  
  for (let i = 0; i < chunks.length; i++) {
    const header = chunks.length > 1 ? `**(${i + 1}/${chunks.length})**\n\n` : "";
    await gh("issue", "comment", String(issueNumber), "--body", header + chunks[i]);
  }
}
```

---

# Feature 37: Session Reset Command

## What
User posts `/reset` — the agent clears the session mapping and starts fresh on the next comment, without closing the issue.

## Why — High Impact
When a conversation goes off track, the context becomes polluted, or the session grows too large, the only option today is to close the issue and open a new one. `/reset` lets the user start fresh in the same thread. Combined with context pressure (feature 22), this is the escape hatch when conversations go wrong.

## Effort: ~1.5 hours

## Implementation

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts`

After extracting the prompt, before session resolution:

```typescript
if (prompt.trim().toLowerCase() === "/reset") {
  const mappingFile = resolve(issuesDir, `${issueNumber}.json`);
  if (existsSync(mappingFile)) {
    unlinkSync(mappingFile);
  }
  
  await gh("issue", "comment", String(issueNumber), "--body",
    "🔄 Session reset. My memory for this issue has been cleared.\n\n" +
    "The next comment will start a fresh conversation. " +
    "The previous session file is still on disk if you need to reference it.");
  
  // Commit the mapping deletion
  await run(["git", "add", "-A"]);
  const { exitCode } = await run(["git", "diff", "--cached", "--quiet"]);
  if (exitCode !== 0) {
    await run(["git", "commit", "-m", `gitclaw: reset session for issue #${issueNumber}`]);
    for (let i = 1; i <= 3; i++) {
      const push = await run(["git", "push", "origin", `HEAD:${defaultBranch}`]);
      if (push.exitCode === 0) break;
      await run(["git", "pull", "--rebase", "origin", defaultBranch]);
    }
  }
  
  // Skip the rest of agent execution
  process.exit(0);
}
```

---

# Feature 38: File Change Summary Footer

## What
After every commit that modifies repo files, append a summary to the response: `📁 3 files changed (+150 lines, -23 lines) · src/auth.ts, src/types.ts, README.md`

## Why — High Impact
Users often don't realize the agent changed files (especially when the response is about analysis, not code). The summary makes file changes impossible to miss. It also serves as a mini changelog for every interaction.

## Effort: ~1.5 hours

## Implementation

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts`

After `git add -A` and before posting the comment:

```typescript
// Generate file change summary
const { stdout: diffStat } = await run([
  "git", "diff", "--cached", "--stat", "--", ".", ":!.GITCLAW/state",
]);

const { stdout: diffShortStat } = await run([
  "git", "diff", "--cached", "--shortstat", "--", ".", ":!.GITCLAW/state",
]);

let changeSummary = "";
if (diffStat.trim()) {
  // Extract file names (exclude state files)
  const changedFiles = diffStat.trim().split("\n")
    .slice(0, -1) // remove the summary line
    .map(line => line.trim().split("|")[0].trim())
    .filter(f => !f.startsWith(".GITCLAW/state"));
  
  if (changedFiles.length > 0) {
    const shortStat = diffShortStat.trim(); // e.g., "3 files changed, 150 insertions(+), 23 deletions(-)"
    const fileList = changedFiles.length <= 5
      ? changedFiles.map(f => `\`${f}\``).join(", ")
      : changedFiles.slice(0, 4).map(f => `\`${f}\``).join(", ") + ` +${changedFiles.length - 4} more`;
    
    changeSummary = `\n\n---\n📁 ${shortStat}\n${fileList}`;
  }
}

// Append to response
commentBody += changeSummary;
```

---

# Feature 39: Quiet Mode Label

## What
When an issue has the `gitclaw:quiet` label, the agent does its work (reads, writes, commits, pushes) but posts only a minimal confirmation instead of the full response: `✅ Done. 3 files changed. [View commit](link)`

## Why — High Impact
For batch operations, scheduled tasks (feature 04), and scripted workflows, the full verbose response clutters the issue thread. Quiet mode keeps the thread clean while the agent works in the background. Essential for issues used as automation endpoints.

## Effort: ~1 hour

## Implementation

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts`

After extracting `agentText` and before posting:

```typescript
const issueLabels = (event.issue?.labels || []).map((l: any) => l.name);
const quietMode = issueLabels.includes("gitclaw:quiet");

if (quietMode) {
  // Minimal response
  const { stdout: commitSha } = await run(["git", "rev-parse", "--short", "HEAD"]);
  const { stdout: shortStat } = await run(["git", "diff", "--shortstat", "HEAD~1"]);
  
  const quietBody = [
    `✅ Done.`,
    shortStat.trim() ? `📁 ${shortStat.trim()}` : "",
    `[View commit](https://github.com/${repo}/commit/${commitSha.trim()})`,
  ].filter(Boolean).join(" · ");
  
  await gh("issue", "comment", String(issueNumber), "--body", quietBody);
} else {
  // Normal verbose response
  await gh("issue", "comment", String(issueNumber), "--body", commentBody);
}
```

---

# Feature 40: Duplicate Issue Linker

## What
When a new issue is opened, search existing open issues for similar titles. If matches are found, post a comment linking them: `🔗 Possibly related: #42 (same topic), #85 (similar question)`.

## Why — High Impact
Repos accumulate duplicate issues. The agent has full access to search — it can catch duplicates before wasting a full LLM run on a question that was already answered. The user gets instant value (link to the existing answer) and the agent saves API tokens.

## Effort: ~2 hours

## Implementation

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts`

After reading the event, before running the agent (only for `issues.opened`):

```typescript
if (eventName === "issues" && event.action === "opened") {
  // Search for similar issues
  const searchTerms = title.split(/\s+/)
    .filter((w: string) => w.length > 3)
    .slice(0, 5)
    .join(" ");
  
  if (searchTerms.length > 5) {
    try {
      const { stdout: results } = await run([
        "gh", "issue", "list",
        "--search", `"${searchTerms}" in:title`,
        "--state", "all",
        "--json", "number,title,state",
        "--jq", `.[] | select(.number != ${issueNumber}) | "#\(.number) (\(.state)): \(.title)"`,
        "--limit", "5",
      ]);
      
      const matches = results.trim().split("\n").filter(Boolean);
      if (matches.length > 0) {
        const linkComment = [
          `🔗 **Possibly related issues:**`,
          ...matches.map(m => `- ${m}`),
          "",
          "_I'll still process your request. These are listed for reference._",
        ].join("\n");
        
        await gh("issue", "comment", String(issueNumber), "--body", linkComment);
      }
    } catch (e) {
      // Search failed — continue normally
    }
  }
}
```

---

# Feature 41: Auto-Lock Resolved Issues

## What
When the agent closes an issue (or it's closed manually), lock the conversation after a configurable cool-down period (default: 7 days) to prevent accidental re-triggering.

## Why — High Impact
Closed issues can still receive comments. If someone posts "thanks!" on a 3-month-old closed issue, the agent wakes up, burns API tokens, and posts a confused response with stale context. Locking prevents this. GitHub's lock prevents new comments while preserving the existing thread for reading.

## Effort: ~1.5 hours

## Implementation

This runs on the scheduled lifecycle (feature 04/32), or as a check at the start of each agent run:

```typescript
// On schedule or at agent startup:
async function lockStaleClosedIssues(repo: string, stateDir: string): Promise<number> {
  const lockAfterDays = 7;
  let locked = 0;
  
  // Find closed issues that are old enough and not yet locked
  const { stdout } = await run([
    "gh", "issue", "list",
    "--state", "closed",
    "--label", "gitclaw",
    "--json", "number,closedAt,locked",
    "--jq", `.[] | select(.locked == false) | select((.closedAt | fromdateiso8601) < (now - ${lockAfterDays * 86400})) | .number`,
    "--limit", "50",
  ]);
  
  for (const num of stdout.trim().split("\n").filter(Boolean)) {
    try {
      await run([
        "gh", "issue", "lock", num.trim(),
        "--reason", "resolved",
      ]);
      locked++;
    } catch (e) { /* ignore — may not have lock permission */ }
  }
  
  return locked;
}
```

Also, in the agent's workflow conditional, add an early exit for locked issues:

```typescript
if (event.issue?.locked) {
  console.log("Issue is locked, skipping.");
  process.exit(0);
}
```

---

# Feature 42: Configurable Max Response Length

## What
Set a maximum response length in settings. Responses exceeding the limit are truncated with a clear marker: `... [response truncated at 5,000 chars — reply "continue" for more]`

## Why — High Impact
Some models are extremely verbose. A question like "what does this file do?" can produce a 10,000-character essay. For teams that prefer concise responses, a configurable cap prevents verbosity without changing the model or system prompt. Combined with the splitter (feature 36), this handles both extremes: too long gets capped; way too long gets split.

## Effort: ~1 hour

## Implementation

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts`

```typescript
const maxLength = piSettings.maxResponseLength || 0; // 0 = no limit

if (maxLength > 0 && trimmedText.length > maxLength) {
  // Find a clean break point
  let cutAt = trimmedText.lastIndexOf("\n\n", maxLength);
  if (cutAt < maxLength * 0.5) cutAt = trimmedText.lastIndexOf("\n", maxLength);
  if (cutAt < maxLength * 0.5) cutAt = maxLength;
  
  trimmedText = trimmedText.slice(0, cutAt) +
    "\n\n---\n_Response truncated at " + maxLength.toLocaleString() + 
    " characters. Reply **\"continue\"** for the rest._";
}
```

Add to `.GITCLAW/.pi/settings.json`:
```json
{
  "maxResponseLength": 0
}
```

The "continue" reply works naturally — the agent sees "continue" as a prompt and picks up where it left off (since the full response is in the session).

---

# Feature 43: Smart Collapse for Long Outputs

## What
When the agent's response contains code blocks, tool outputs, or file listings longer than 30 lines, automatically wrap them in `<details>` tags with a descriptive summary. The main response stays scannable; the detail is one click away.

## Why — High Impact
A response that reads a 200-line file and shows it in a code block creates a wall of text. The user scrolls past it to find the 3-line analysis at the bottom. Auto-collapsing keeps the analysis visible and tucks the evidence behind a fold. This is a pure formatting improvement that transforms readability.

## Effort: ~2 hours

## Implementation

Post-process the agent's text before posting:

```typescript
function autoCollapse(text: string, threshold: number = 30): string {
  // Collapse long code blocks
  return text.replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, content) => {
    const lineCount = content.split("\n").length;
    if (lineCount <= threshold) return match;
    
    const preview = content.split("\n").slice(0, 5).join("\n");
    const label = lang ? `${lang} · ${lineCount} lines` : `${lineCount} lines`;
    
    return [
      `<details>`,
      `<summary><code>${label}</code></summary>`,
      ``,
      "```" + lang,
      content,
      "```",
      ``,
      `</details>`,
    ].join("\n");
  });
}

// Apply before posting:
const processedText = autoCollapse(trimmedText);
```

Also collapse long blockquotes and long unordered lists:

```typescript
// Collapse long lists (>20 items)
function collapseList(text: string): string {
  return text.replace(/((?:^- .+\n){20,})/gm, (match) => {
    const items = match.trim().split("\n");
    const preview = items.slice(0, 5).join("\n");
    return [
      preview,
      `<details>`,
      `<summary>${items.length - 5} more items</summary>`,
      ``,
      items.slice(5).join("\n"),
      ``,
      `</details>`,
    ].join("\n");
  });
}
```

**Note:** Feature 20 (Notification Intelligence) identified that `<details>` doesn't render in email. Add a config toggle — teams that interact primarily via email can disable auto-collapse.
