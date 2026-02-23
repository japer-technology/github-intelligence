# Feature: Concurrency Control with Session Locking

## Summary

Add concurrency guards to prevent race conditions when multiple agent runs execute simultaneously on different issues (or the same issue). Today, concurrent runs can corrupt state through conflicting rebases, overwrite each other's session files, or produce duplicate responses. This feature adds GitHub Actions concurrency groups for per-issue serialization, a file-based session lock to prevent double-processing, and a stale-run detector that kills orphaned workflows. This is invisible infrastructure — users never see it — but it's the difference between a demo that works and a system that's reliable.

## Why This Feature — The Deep Reasoning

**1. The current architecture has a provable race condition.**

Consider: User A comments on issue #10. User B comments on issue #20. Both workflows start simultaneously. Both run `git add -A && git commit && git push`. Both modify files in `state/sessions/` and `state/issues/`. The first push succeeds. The second fails and enters the rebase-retry loop. During rebase, git merges the JSONL session files — which are append-only, so git usually auto-merges them. But the issue mapping files are JSON objects that get fully overwritten. If both runs update the same session (or the summary index, or memory.log), the rebase can silently choose one version and discard the other.

This isn't theoretical. With PR review, scheduled runs, and slash commands all triggering concurrently, collisions become frequent.

**2. Same-issue double-processing is a worse problem.**

User posts a comment. The workflow starts. 30 seconds later, user posts "actually, ignore that" as a second comment. A new workflow starts for the same issue. Now two agent runs are processing the same issue's session simultaneously. The first run writes to the session file while the second run is reading it. The second run might see a partial session. When both push, the session file has interleaved entries from both runs. The conversation is corrupted.

**3. GitHub Actions provides the solution natively.**

The `concurrency` key in workflow YAML was designed for exactly this. Setting `concurrency: { group: "gitclaw-issue-${{ github.event.issue.number }}", cancel-in-progress: true }` ensures that only one workflow runs per issue at a time, and newer runs cancel older ones. This is free, built-in, and requires zero code changes to the agent.

**4. The rebase-retry loop masks the problem instead of solving it.**

The 3-retry rebase loop in GITCLAW-AGENT.ts is clever but insufficient. It handles the symptom (push failure) without addressing the cause (concurrent state mutation). With concurrency control, the rebase loop becomes a safety net for rare edge cases rather than a load-bearing workaround.

**5. Every other feature makes this worse.**

PR review adds `pull_request` triggers. Scheduled runs add `schedule` triggers. Slash commands add more `issue_comment` triggers. Each new trigger surface multiplies the probability of concurrent runs. Without concurrency control, the system becomes less reliable as it becomes more capable.

## Scope

### In Scope
- GitHub Actions `concurrency` groups to serialize runs per issue/PR
- Cancel-in-progress for same-issue/same-PR superseding runs
- A global concurrency group to serialize git push operations (preventing rebase storms)
- File-based session lock (`.GITCLAW/state/locks/<N>.lock`) as a secondary guard
- Stale lock detection and cleanup
- Documentation of concurrency behavior and configuration

### Out of Scope
- Distributed locking service (overkill — file-based locks in git are sufficient)
- Queue-based processing (GitHub Actions doesn't support this natively)
- Per-user rate limiting
- Merging concurrent responses into a single comment

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Workflow concurrency groups** | Add `concurrency:` blocks to workflow YAML | ~30 min |
| **Session lock module** (new `GITCLAW-LOCK.ts`) | Acquire, release, detect stale locks | ~1.5 hours |
| **Agent orchestrator** | Integrate lock acquire/release around session access | ~1 hour |
| **Stale lock cleanup** | Detect and remove locks older than a threshold | ~30 min |
| **Push serialization** | Global concurrency group for the push step | ~30 min |
| **Indicator update** | When a run is cancelled-in-progress, clean up the 👀 reaction | ~30 min |
| **Docs** | Document concurrency model, troubleshooting stale locks | ~30 min |
| **Testing** | Trigger concurrent runs, verify serialization and cancellation | ~1 hour |

**Total: ~6 hours.** Most of the value comes from the workflow-level `concurrency:` configuration, which is trivial to implement. The session locking is belt-and-suspenders defense-in-depth.

---

## AI Implementation Instructions

### Step 1: Add concurrency groups to the workflow

**File:** `.github/workflows/GITCLAW-WORKFLOW-AGENT.yml` and `.GITCLAW/install/GITCLAW-WORKFLOW-AGENT.yml`

Add `concurrency` at the job level with a dynamic group name based on the event:

```yaml
jobs:
  run-agent:
    runs-on: ubuntu-latest
    concurrency:
      # Serialize by event source: one run per issue, one run per PR, one run for schedule
      group: >-
        gitclaw-${{
          github.event_name == 'issues' && format('issue-{0}', github.event.issue.number) ||
          github.event_name == 'issue_comment' && format('issue-{0}', github.event.issue.number) ||
          github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) ||
          github.event_name == 'pull_request_review_comment' && format('pr-{0}', github.event.pull_request.number) ||
          github.event_name == 'schedule' && 'schedule' ||
          github.event_name == 'workflow_dispatch' && format('dispatch-{0}', github.run_id) ||
          format('other-{0}', github.run_id)
        }}
      cancel-in-progress: true
    if: >-
      # ... existing conditions ...
```

**What this does:**
- All runs for issue #42 (whether `issues.opened` or `issue_comment.created`) share the concurrency group `gitclaw-issue-42`.
- If a new comment arrives on issue #42 while the agent is still processing a previous comment, the in-progress run is **cancelled** and the new run starts.
- This is the correct behavior: the newest message supersedes the old one, and the agent processes only the latest state.
- Each issue/PR gets its own group, so runs on different issues execute in parallel (which is safe — they have separate sessions).
- Scheduled runs share the `gitclaw-schedule` group, serializing them.

### Step 2: Handle cancellation gracefully

When `cancel-in-progress: true` cancels a running workflow, the process receives `SIGTERM`. The `finally` block in GITCLAW-AGENT.ts may or may not execute (GitHub gives a 7.5-second grace period).

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts`

Add a signal handler to ensure critical cleanup happens:

```typescript
// At the top of the file, before the try block:
let isShuttingDown = false;

process.on("SIGTERM", () => {
  console.log("Received SIGTERM — workflow is being cancelled");
  isShuttingDown = true;
  // The finally block should handle reaction cleanup.
  // Give it a chance to run by not immediately exiting.
  // Bun/Node will process the finally block if we don't call process.exit().
});
```

In the main agent execution, check `isShuttingDown` before expensive operations:

```typescript
// Before running pi:
if (isShuttingDown) {
  console.log("Run cancelled before agent execution");
  // Skip agent run, proceed to finally for cleanup
  throw new Error("Run cancelled");
}
```

In the `finally` block, the reaction cleanup already exists. Add a post-cancellation notice:

```typescript
finally {
  // ... existing reaction cleanup ...
  
  if (isShuttingDown) {
    // Post a brief notice so the user knows the run was superseded
    try {
      await gh("issue", "comment", String(issueNumber), "--body",
        "_⏭️ Previous agent run was superseded by a newer message. Processing the latest message now._"
      );
    } catch (e) {
      // Best-effort — the workflow might be killed before this completes
    }
  }
}
```

### Step 3: Create the session lock module

**New file:** `.GITCLAW/lifecycle/GITCLAW-LOCK.ts`

This is a secondary defense layer for cases where concurrency groups aren't sufficient (e.g., if the workflow is extended with multiple jobs that access sessions).

```typescript
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "fs";
import { resolve } from "path";

const LOCK_DIR = resolve(import.meta.dir, "..", "state", "locks");
const LOCK_TTL_MS = 10 * 60 * 1000;  // 10 minutes — max expected run time

export interface LockInfo {
  issueNumber: number;
  runId: string;
  acquiredAt: string;
  pid: number;
}

export function acquireLock(issueNumber: number, runId: string): boolean {
  mkdirSync(LOCK_DIR, { recursive: true });
  const lockFile = resolve(LOCK_DIR, `${issueNumber}.lock`);
  
  // Check for existing lock
  if (existsSync(lockFile)) {
    const existing: LockInfo = JSON.parse(readFileSync(lockFile, "utf-8"));
    const lockAge = Date.now() - new Date(existing.acquiredAt).getTime();
    
    if (lockAge < LOCK_TTL_MS) {
      // Lock is still valid — another run is active
      console.error(`Issue #${issueNumber} is locked by run ${existing.runId} (${Math.round(lockAge / 1000)}s ago)`);
      return false;
    }
    
    // Lock is stale — previous run probably crashed
    console.log(`Cleaning stale lock for issue #${issueNumber} (run ${existing.runId}, ${Math.round(lockAge / 1000)}s old)`);
    unlinkSync(lockFile);
  }
  
  // Acquire the lock
  const lock: LockInfo = {
    issueNumber,
    runId,
    acquiredAt: new Date().toISOString(),
    pid: process.pid,
  };
  writeFileSync(lockFile, JSON.stringify(lock, null, 2) + "\n");
  console.log(`Acquired lock for issue #${issueNumber}`);
  return true;
}

export function releaseLock(issueNumber: number, runId: string): void {
  const lockFile = resolve(LOCK_DIR, `${issueNumber}.lock`);
  
  if (!existsSync(lockFile)) return;
  
  // Only release if we own the lock
  try {
    const existing: LockInfo = JSON.parse(readFileSync(lockFile, "utf-8"));
    if (existing.runId === runId) {
      unlinkSync(lockFile);
      console.log(`Released lock for issue #${issueNumber}`);
    } else {
      console.log(`Lock for issue #${issueNumber} owned by different run, not releasing`);
    }
  } catch (e) {
    console.error("Error releasing lock:", e);
  }
}

export function cleanStaleLocks(): number {
  if (!existsSync(LOCK_DIR)) return 0;
  
  let cleaned = 0;
  const files = require("fs").readdirSync(LOCK_DIR);
  for (const file of files) {
    if (!file.endsWith(".lock")) continue;
    const lockFile = resolve(LOCK_DIR, file);
    try {
      const lock: LockInfo = JSON.parse(readFileSync(lockFile, "utf-8"));
      const lockAge = Date.now() - new Date(lock.acquiredAt).getTime();
      if (lockAge >= LOCK_TTL_MS) {
        unlinkSync(lockFile);
        cleaned++;
      }
    } catch (e) {
      // Corrupt lock file — remove it
      unlinkSync(lockFile);
      cleaned++;
    }
  }
  return cleaned;
}
```

**Important:** Lock files are NOT committed to git. They live in the working directory during a run but are ephemeral — they don't need to persist across runs because the concurrency groups handle inter-run serialization. The lock module handles intra-run safety and stale detection.

Add `state/locks/` to `.gitignore`:

```
state/locks/
```

### Step 4: Integrate locks into the agent orchestrator

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts`

```typescript
import { acquireLock, releaseLock, cleanStaleLocks } from "./GITCLAW-LOCK";

const runId = process.env.GITHUB_RUN_ID || String(Date.now());

// Clean stale locks before attempting to acquire
cleanStaleLocks();

// Attempt to acquire the lock
if (!acquireLock(issueNumber, runId)) {
  console.log(`Issue #${issueNumber} is being processed by another run. Exiting.`);
  // Don't post a comment — the other run will handle it.
  // Just clean up the reaction and exit.
  process.exit(0);
}

try {
  // ... existing agent logic ...
} finally {
  releaseLock(issueNumber, runId);
  // ... existing reaction cleanup ...
}
```

### Step 5: Add a global push serialization group

Even with per-issue concurrency, runs on DIFFERENT issues can still race on `git push`. The rebase-retry loop handles this, but we can reduce the frequency of retries by adding a short serialization window.

**Approach:** Instead of a second concurrency group (GitHub only supports one per job), make the push step more robust:

```typescript
// Enhanced push with exponential backoff
async function pushWithBackoff(defaultBranch: string, maxAttempts: number = 5): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const push = await run(["git", "push", "origin", `HEAD:${defaultBranch}`]);
    if (push.exitCode === 0) return;
    
    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 16000);
    // Add jitter: ±25% of the delay
    const jitter = delay * (0.75 + Math.random() * 0.5);
    
    console.log(`Push attempt ${attempt}/${maxAttempts} failed. Retrying in ${Math.round(jitter)}ms...`);
    await new Promise(resolve => setTimeout(resolve, jitter));
    await run(["git", "pull", "--rebase", "origin", defaultBranch]);
  }
  
  throw new Error(`Failed to push after ${maxAttempts} attempts`);
}
```

The jitter ensures that two concurrent runs don't retry at exactly the same time, breaking the retry-storm pattern.

### Step 6: Add concurrency documentation comments to the workflow

**File:** `.github/workflows/GITCLAW-WORKFLOW-AGENT.yml`

Add clear comments explaining the concurrency model:

```yaml
# CONCURRENCY MODEL
# -----------------
# Each issue/PR gets its own concurrency group. This means:
# 1. Only one agent run per issue/PR at a time.
# 2. If a new comment arrives while the agent is processing, the old run is cancelled.
# 3. Different issues/PRs process in parallel (safe — separate sessions).
# 4. Scheduled runs are serialized (one at a time).
# 5. Git push conflicts between parallel runs are handled by exponential backoff with jitter.
```

### Step 7: Update documentation

**File:** `.GITCLAW/README.md`
- Add a "Concurrency" section explaining that GitClaw serializes runs per issue/PR.
- Note that newer messages supersede older ones when they arrive during processing.
- Document that users may see a brief "superseded" message when this happens.

**File:** `.GITCLAW/docs/GITCLAW-Internal-Mechanics.md`
- Add a "Concurrency Control" section documenting:
  - The concurrency group naming scheme
  - The cancel-in-progress behavior
  - The session lock mechanism
  - The push backoff strategy
  - Failure modes and recovery

### Step 8: Test

- Post two comments on the same issue in rapid succession (within 5 seconds):
  1. Verify the first run is cancelled.
  2. Verify the second run processes the latest comment.
  3. Verify the superseded message appears briefly (or the 👀 is cleaned up).
  4. Verify the session is not corrupted.
- Post comments on two DIFFERENT issues simultaneously:
  1. Verify both runs execute in parallel.
  2. Verify both push successfully (possibly with one retry).
  3. Verify both session files are intact.
- Simulate a stale lock (manually create a lock file with an old timestamp):
  1. Verify the stale lock is cleaned up.
  2. Verify the new run acquires the lock and processes normally.
- Post 5 comments on the same issue in rapid sequence:
  1. Verify only the LAST comment is processed.
  2. Verify 4 runs are cancelled.
  3. Verify no session corruption.

## Design Decisions

**Why cancel-in-progress instead of queuing?** GitHub Actions doesn't support native queuing. More importantly, for conversational AI, the latest message is what matters. If a user says "do X" and then immediately says "actually, do Y instead," processing X is wasted work. Cancelling the old run and processing the latest message is the correct behavior.

**Why per-issue groups instead of a global group?** A global group would serialize ALL runs — issue #42 would block issue #43. This is unnecessarily restrictive. Issues have separate sessions, so parallel processing is safe. Only runs on the SAME issue need serialization.

**Why file-based locks in addition to concurrency groups?** Defense in depth. Concurrency groups handle the common case (multiple workflow runs). File locks handle edge cases: multi-job workflows where the same session might be accessed from different jobs, or future extensions where the agent is invoked outside of the normal workflow (e.g., a CLI mode). The lock module is cheap insurance.

**Why NOT commit lock files to git?** Lock files are ephemeral — they're only meaningful during a single workflow run. Committing them would create noise in the git history and could cause false lock-outs if a run crashes between the lock commit and the unlock commit. Keeping them in the working directory means they're automatically cleaned up when the runner is destroyed.

**Why exponential backoff with jitter for push retries?** The current linear retry (retry, rebase, retry, rebase, retry) has a thundering-herd problem: if 5 runs finish at roughly the same time, they all retry at the same intervals and keep colliding. Exponential backoff spreads them out over time. Jitter prevents the remaining collisions. This is a well-established distributed systems pattern.
