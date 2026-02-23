# Feature: Session Summarization & Archival

## Summary

Automatically summarize and compress old sessions to prevent unbounded repo growth and reduce token costs on resumed conversations. When a session exceeds a configurable size threshold, the agent generates a concise summary of the older turns, replaces them with the summary, and archives the full original to a separate branch. This keeps active sessions lean while preserving full history for audit.

## Why This Feature

1. **Repo bloat is inevitable without intervention.** The repo already has 1.9MB of session data after just 21 issues over 3 days. At production usage (10+ issues/day, multi-turn conversations), sessions will grow to tens or hundreds of MB within weeks. Git handles large repos poorly — clone times increase, diffs slow down, and GitHub may eventually enforce size limits.

2. **Long sessions degrade agent quality and increase cost.** When a session resumes, `pi` loads the entire JSONL transcript as context. A 50-turn session with tool calls can easily be 100K+ tokens of context. This means: higher API costs (paying for input tokens), slower responses (more to process), and worse quality (important context gets buried in noise).

3. **The fix is natural to the existing architecture.** Sessions are JSONL files — append-only logs with clear message boundaries. Summarizing older turns and replacing them with a compact summary block is a well-understood pattern. The session model already supports "start fresh with context" via the `--session` flag.

4. **It enables truly long-running projects.** GitClaw's vision is an agent that evolves a project over weeks and months via issue threads. Without session management, this vision hits a wall at ~20-30 turns per issue. With summarization, conversations can run indefinitely.

5. **Archival preserves the audit trail.** Full session transcripts are pushed to an archive branch (`gitclaw-archive`), so nothing is lost. The main branch stays lean; the archive branch is there for compliance, debugging, or curiosity.

## Scope

### In Scope
- Detect when a session exceeds a configurable token/line threshold before resuming
- Generate a summary of older turns using the LLM (a "summarize this conversation" meta-call)
- Replace the original session file with: summary block + recent N turns
- Archive the full original session to `gitclaw-archive` branch
- Configuration in `settings.json`: threshold, number of recent turns to keep, enable/disable
- Run summarization automatically at the start of a resume (before the user's new message is processed)

### Out of Scope
- Real-time summarization during a session (only on resume)
- Multiple compression levels (only one: summarize + keep recent)
- Cross-session summarization (merging sessions from different issues)
- Automatic deletion of archived sessions

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Session analyzer** (new module `GITCLAW-SESSION.ts`) | Parse JSONL, count tokens/lines, identify old vs recent turns | ~1.5 hours |
| **Summarizer** | Use `pi` or direct LLM call to summarize older turns | ~1.5 hours |
| **Session rewriter** | Replace session file with summary + recent turns | ~1 hour |
| **Archival** | Push full original to `gitclaw-archive` branch | ~1 hour |
| **Agent orchestrator** (`GITCLAW-AGENT.ts`) | Insert summarization step before session resume | ~1 hour |
| **Configuration** | Add thresholds to `settings.json`, default values | ~15 min |
| **Docs** | Add session management doc, update internals | ~30 min |
| **Testing** | Verify summarization triggers, verify archive, verify resumed sessions work | ~1.5 hours |

**Total: ~8–9 hours of focused work.** The most complex part is the summarization call — it's a meta-use of the LLM to compress its own conversation history.

---

## AI Implementation Instructions

### Step 1: Add configuration to settings.json

**File:** `.GITCLAW/.pi/settings.json`

Add session management settings:

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-opus-4-6",
  "defaultThinkingLevel": "high",
  "sessionManagement": {
    "enabled": true,
    "maxSessionLines": 200,
    "recentTurnsToKeep": 10,
    "archiveBranch": "gitclaw-archive",
    "summaryModel": null
  }
}
```

- `maxSessionLines`: When a session JSONL exceeds this many lines, trigger summarization on next resume. 200 lines ≈ ~20 multi-tool turns.
- `recentTurnsToKeep`: Number of most recent user/assistant turn pairs to preserve verbatim. 10 turns gives the agent good recent context.
- `archiveBranch`: Branch name for full session archives.
- `summaryModel`: Optional model override for summarization (use a cheaper model). If null, use the default model.

### Step 2: Create the session analysis module

**New file:** `.GITCLAW/lifecycle/GITCLAW-SESSION.ts`

```typescript
export interface SessionAnalysis {
  totalLines: number;
  totalMessages: number;
  userMessages: number;
  assistantMessages: number;
  toolResults: number;
  estimatedTokens: number;    // rough estimate: characters / 4
  needsSummarization: boolean;
  oldTurns: any[];             // messages to summarize
  recentTurns: any[];          // messages to keep verbatim
  headerLines: any[];          // session/model_change/thinking_level_change events
}

export function analyzeSession(sessionPath: string, maxLines: number, recentTurnsToKeep: number): SessionAnalysis
```

**`analyzeSession` implementation:**

1. Read the JSONL file line by line, parsing each JSON object.
2. Separate lines into categories:
   - **Header lines**: `type === "session"`, `type === "model_change"`, `type === "thinking_level_change"` — always keep these.
   - **Message lines**: `type === "message"` or `type === "message_end"` — these form the conversation.
3. Count total lines. If below `maxLines`, return `needsSummarization: false`.
4. If above threshold, identify "turns." A turn is a sequence: user message → assistant messages (including tool calls) → tool results → assistant response. Group messages into turns by tracking role transitions.
5. Split turns into `oldTurns` (all but the last `recentTurnsToKeep` turns) and `recentTurns` (the last N turns).
6. Estimate token count: sum all text content character lengths, divide by 4 (rough approximation).

**Turn grouping logic:**

```typescript
interface Turn {
  messages: any[];   // all JSONL lines in this turn
  userText: string;  // extracted user message text (for summary context)
  assistantText: string;  // extracted assistant response text
}

function groupIntoTurns(messageLines: any[]): Turn[]
```

- A new turn starts when a `message` event has `role === "user"`.
- Everything from a user message until the next user message (exclusive) is one turn.
- Extract `userText` and `assistantText` from text blocks within each turn's messages.

### Step 3: Generate a summary of old turns

**In `GITCLAW-SESSION.ts`:**

```typescript
export async function summarizeOldTurns(
  turns: Turn[],
  provider: string,
  model: string
): Promise<string>
```

**Implementation:**

Build a conversation digest from the old turns:

```typescript
const digest = turns.map((turn, i) => {
  return `Turn ${i + 1}:\n  User: ${turn.userText.slice(0, 500)}\n  Assistant: ${turn.assistantText.slice(0, 500)}`;
}).join("\n\n");
```

Then call `pi` (or use the LLM API directly) with a summarization prompt:

```typescript
const summaryPrompt = `Summarize the following conversation history into a concise briefing document. 
This summary will be used as context for continuing the conversation, so preserve:
- Key decisions made
- Important facts and preferences established
- Technical context (files discussed, approaches chosen, problems identified)
- Action items or open questions
- The user's communication style and priorities

Be concise but complete. Use bullet points. Target 500-1000 words.

CONVERSATION HISTORY:
${digest}`;
```

**Two approaches for the summarization call:**

**Option A (simpler): Use `pi` CLI with a one-shot prompt:**

```typescript
const piBin = resolve(gitclawDir, "node_modules", ".bin", "pi");
const summaryArgs = [
  piBin, "--mode", "json",
  "--provider", provider,
  "--model", model,
  "--tools", "",  // no tools needed for summarization
  "-p", summaryPrompt,
];
const proc = Bun.spawn(summaryArgs, { stdout: "pipe", stderr: "inherit" });
// ... extract text from output (same jq pattern as main agent) ...
```

Note: Use `--tools ""` or `--tools none` to prevent the summarizer from making tool calls. It should only generate text.

**Option B (more efficient): Direct API call via fetch:**
This avoids the overhead of spawning `pi` for a simple completion. However, it requires implementing provider-specific API calls. Option A is recommended for simplicity.

**Important:** The summarization uses LLM tokens, which adds cost. Using a cheaper `summaryModel` (e.g., `claude-haiku-3.5` or `gemini-2.5-flash`) for this meta-task keeps costs low. The summary doesn't need the best model — it's a compression task, not a reasoning task.

### Step 4: Rewrite the session file

**In `GITCLAW-SESSION.ts`:**

```typescript
export function rewriteSession(
  sessionPath: string,
  analysis: SessionAnalysis,
  summaryText: string
): void
```

**Implementation:**

1. Construct the new session file contents:
   - **Header lines** (session, model_change, etc.) — preserved as-is.
   - **Summary block** — a synthetic message injected as a "system context" turn:
     ```json
     {
       "type": "message",
       "timestamp": "<now>",
       "message": {
         "role": "user",
         "content": [{ "type": "text", "text": "[Session Summary - Earlier conversation compressed]\n\n<summaryText>" }]
       }
     }
     {
       "type": "message",
       "timestamp": "<now>",
       "message": {
         "role": "assistant",
         "content": [{ "type": "text", "text": "Understood. I have the context from our earlier conversation. Let's continue." }]
       }
     }
     ```
   - **Recent turns** — preserved verbatim as original JSONL lines.

2. Write the new session file to a temp path first, then rename over the original. This prevents corruption if the process crashes mid-write.

3. Log the compression ratio: `"Session compressed: {oldLines} lines → {newLines} lines ({percentage}% reduction)"`.

**Why inject as user/assistant messages?** The `pi` session format expects alternating user/assistant messages. A bare "summary" block wouldn't fit the schema. By framing it as "here's a summary" / "got it", we maintain valid session structure that `pi` can load without modification.

### Step 5: Archive the original session

**In `GITCLAW-SESSION.ts`:**

```typescript
export async function archiveSession(
  sessionPath: string,
  archiveBranch: string,
  repo: string
): Promise<void>
```

**Implementation:**

1. Check if the archive branch exists:
   ```bash
   git ls-remote --heads origin <archiveBranch>
   ```
   If not, create it as an orphan branch:
   ```bash
   git checkout --orphan <archiveBranch>
   git rm -rf .
   echo "# GitClaw Session Archives" > README.md
   git add README.md
   git commit -m "Initialize archive branch"
   git push origin <archiveBranch>
   git checkout <defaultBranch>
   ```

2. Copy the original (pre-compression) session file to a temp location before rewriting.

3. Use `git worktree` or a separate checkout to add the file to the archive branch:
   ```bash
   git stash  # if needed
   git checkout <archiveBranch>
   mkdir -p archived-sessions/
   cp /tmp/original-session.jsonl archived-sessions/<original-filename>
   git add archived-sessions/
   git commit -m "Archive session: <filename>"
   git push origin <archiveBranch>
   git checkout <defaultBranch>
   git stash pop  # if needed
   ```

   **Simpler alternative using the GitHub API** (avoids branch switching):
   ```bash
   # Read the file content, base64 encode it, and create via API
   gh api repos/{owner}/{repo}/contents/archived-sessions/{filename} \
     --method PUT \
     -f message="Archive session: {filename}" \
     -f branch="{archiveBranch}" \
     -f content="$(base64 -w0 /tmp/original-session.jsonl)"
   ```
   This is cleaner because it doesn't require switching branches in the working directory, which could conflict with the main agent's git operations.

4. The GitHub API approach is recommended. It's atomic, doesn't touch the working tree, and handles branch creation implicitly.

### Step 6: Integrate into the agent orchestrator

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts`

In the session resolution section, after determining `mode === "resume"` and before running `pi`:

```typescript
import { analyzeSession, summarizeOldTurns, rewriteSession, archiveSession } from "./GITCLAW-SESSION";

// ... after resolving sessionPath and mode === "resume" ...

// Check if session needs summarization
const sessionConfig = piSettings.sessionManagement || {};
if (sessionConfig.enabled !== false && mode === "resume" && sessionPath) {
  const analysis = analyzeSession(
    sessionPath,
    sessionConfig.maxSessionLines || 200,
    sessionConfig.recentTurnsToKeep || 10
  );

  if (analysis.needsSummarization) {
    console.log(`Session has ${analysis.totalLines} lines (threshold: ${sessionConfig.maxSessionLines || 200}), summarizing...`);

    // Archive the original before modifying
    try {
      await archiveSession(
        sessionPath,
        sessionConfig.archiveBranch || "gitclaw-archive",
        repo
      );
      console.log("Original session archived");
    } catch (e) {
      console.error("Failed to archive session (continuing anyway):", e);
    }

    // Generate summary
    const summaryModel = sessionConfig.summaryModel || configuredModel;
    const summaryText = await summarizeOldTurns(
      analysis.oldTurns,
      configuredProvider,
      summaryModel
    );

    // Rewrite the session file
    rewriteSession(sessionPath, analysis, summaryText);
    console.log(`Session summarized: ${analysis.totalLines} → ${analysis.recentTurns.length + 4} lines`);
  }
}

// ... continue with running pi using the (possibly compressed) session ...
```

**Important timing:** Summarization happens BEFORE the agent runs on the user's new message. This means the agent gets a lean, focused context when it processes the new request. The summarization cost is paid once per threshold crossing, not on every turn.

### Step 7: Handle edge cases

**Session too small to summarize meaningfully:**
- If `oldTurns` has fewer than 3 turns, skip summarization even if line count exceeds threshold (the turns might be long tool outputs). Set `needsSummarization = false`.

**Summarization fails (LLM error):**
- Catch the error, log it, and continue with the original (unsummarized) session. Never corrupt a session because summarization failed. The next run will try again.

**Archive push fails:**
- Log and continue. Archival is best-effort — the session will be rewritten regardless. The original content is in git history anyway (prior commits).

**Concurrent runs on the same issue:**
- The existing push-retry-rebase loop handles this. If two runs try to summarize the same session simultaneously, one will rebase on the other's changes. Since summarization is idempotent (both would produce similar summaries), the rebase should succeed cleanly.

**Session format changes:**
- The parser should be defensive about unknown fields or event types. Skip lines it doesn't recognize rather than crashing.

### Step 8: Update documentation

**New file:** `.GITCLAW/docs/GITCLAW-Session-Management.md`

Document:
- Why sessions are summarized (repo size, token costs, quality)
- How the threshold works and how to configure it
- What the summary preserves and what it discards
- Where archives live and how to access them
- How to disable summarization (`"enabled": false`)
- Cost of summarization (one LLM call per compression, recommend cheap model)

**File:** `.GITCLAW/README.md`
- Add "Session Management" to the capabilities table
- Mention that long conversations are automatically compressed

**File:** `.GITCLAW/docs/GITCLAW-Internal-Mechanics.md`
- Add a "Session Compression" section explaining the summarize-and-archive flow
- Update the data model section to mention the archive branch

### Step 9: Test

- Create an issue and have a long conversation (15+ back-and-forth turns):
  1. Check the session file line count after each turn
  2. When it crosses the threshold, verify summarization triggers on the next resume
  3. Verify the session file is smaller after summarization
  4. Verify the summary block is coherent and preserves key context
  5. Verify the recent turns are preserved verbatim
  6. Verify the agent can still reference earlier conversation points (via the summary)
- Check the archive branch:
  1. Verify `gitclaw-archive` branch was created
  2. Verify the full original session file exists in `archived-sessions/`
  3. Verify the file is identical to the pre-compression version
- Test with summarization disabled:
  1. Set `"enabled": false` in settings
  2. Verify sessions grow without intervention
- Test with a session just at the threshold:
  1. Verify it summarizes on the next turn (not on the current turn)
- Test error cases:
  1. Temporarily break the API key for the summary model — verify the agent falls back to the original session without crashing
  2. Block the archive push — verify summarization still completes

## Design Decisions

**Why summarize on resume, not after each turn?** Summarizing after every turn would add latency and cost to every interaction. Doing it on resume means the cost is only paid when the user comes back to a long conversation — and it's paid once, not repeatedly.

**Why keep recent turns verbatim?** The most recent context is the most relevant. A summary of "you asked me to fix the auth bug and I edited 3 files" is less useful than the actual messages showing which files were edited and what the user said about them. Recent turns give the agent precise, actionable context.

**Why archive to a separate branch?** Keeping archives on `main` would defeat the purpose — the repo would still grow. A separate branch keeps `main` lean for clones while preserving full history for anyone who needs it. Orphan branches don't affect `main`'s size in a shallow clone.

**Why use the GitHub API for archival instead of branch switching?** Switching branches in the working directory during an agent run is dangerous — it could conflict with uncommitted changes, confuse `pi`, or break the push loop. The API approach is atomic and doesn't touch the working tree.

**Why a synthetic user/assistant turn for the summary?** The `pi` session format expects alternating user/assistant messages. Injecting the summary as a user message ("here's what happened") with an assistant acknowledgment ("understood") is the cleanest way to maintain valid session structure without modifying `pi` itself.
