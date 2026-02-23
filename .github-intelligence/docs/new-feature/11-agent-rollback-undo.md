# Feature: Agent Rollback & Undo System

## Summary

Give users the ability to undo the agent's last set of changes with a `/undo` command or 👎 reaction. The agent identifies its most recent commits, reverts them, closes any PRs it opened, restores modified files, and posts a clear summary of what was undone. This is the trust infrastructure that makes people willing to let an AI agent write to their repository — knowing that any mistake is one word away from being erased.

## Why This Feature — The Deep Reasoning

**1. Trust requires a safety net, not just competence.**

Every other feature in this set makes the agent more *capable*. None of them make it more *recoverable*. But recovery is what determines whether teams adopt a tool or abandon it after the first bad experience. A code review that misses a bug is annoying. A refactor that breaks production is terrifying — unless you can say "/undo" and have it gone in 10 seconds. The existence of undo changes the psychology of every interaction: from "I hope this works" to "let's try it."

**2. The agent's commits are already perfectly structured for reversal.**

Every agent run produces a commit with the message `gitclaw: work on issue #N`. These commits are self-contained units of work — they include all file changes from a single agent turn. `git revert <sha>` on a gitclaw commit is a clean, well-defined operation. The commit history is the undo log, and it already exists.

**3. Undo is the complement to branch-per-task (feature 07).**

With branch-per-task, code changes go through PRs. Undo on a PR is simple: close the PR and delete the branch. Without branch-per-task (direct push to main), undo is a `git revert`. Both paths need to be handled, and both are straightforward because the agent's changes are well-demarcated.

**4. It prevents the "afraid to use it" problem.**

Teams that try GitClaw on a real repo will inevitably hit a case where the agent does something wrong — edits the wrong file, generates bad code, misunderstands the request. Without undo, the user has to manually figure out what changed, how to revert it, and whether the session state is still consistent. That friction is often enough to make them stop using the tool. One-command undo removes that friction entirely.

**5. It closes the feedback loop for agent improvement.**

When a user undoes a change, that's a strong negative signal. The undo event can be logged to memory ("User undid my changes to auth.ts — the refactoring approach was wrong") so the agent learns what NOT to do. Over time, undo events become a training signal for better agent behavior.

## Scope

### In Scope
- `/undo` slash command that reverts the agent's last commit(s) for the current issue
- `/undo N` to revert the last N agent commits
- 👎 reaction on the agent's comment triggers undo of that specific response's changes
- Revert both file changes AND session state (roll back the session to pre-change state)
- Close any PR opened by the reverted commit (if branch-per-task is active)
- Post a summary of what was undone (files restored, commits reverted)
- Log the undo event to memory for future reference
- Handle edge cases: nothing to undo, revert conflicts, changes already merged

### Out of Scope
- Undo across issues (only undoes changes from the current issue's session)
- Selective undo (revert specific files but keep others from the same commit)
- Undo of undo (no redo — use the conversation to re-apply changes)
- Automatic undo triggered by CI failure (future follow-up)

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Commit identification** | Find agent commits for the current issue | ~1 hour |
| **Revert logic** | `git revert` for main-branch changes, PR close for branch-per-task | ~2 hours |
| **Session rollback** | Restore the session JSONL to its state before the reverted turn | ~1.5 hours |
| **👎 reaction handler** | Detect reaction on agent comments, trigger undo | ~1 hour |
| **Summary generation** | Report what was undone | ~30 min |
| **Memory logging** | Record undo events in memory.log | ~15 min |
| **Edge case handling** | Conflicts, nothing to undo, already merged | ~1 hour |
| **Docs** | Document undo system | ~30 min |
| **Testing** | Test undo on various change types | ~1.5 hours |

**Total: ~9–10 hours.**

---

## AI Implementation Instructions

### Step 1: Identify agent commits for the current issue

**New file:** `.GITCLAW/lifecycle/GITCLAW-UNDO.ts`

```typescript
export interface AgentCommit {
  sha: string;
  message: string;
  timestamp: string;
  filesChanged: string[];
  isStateOnly: boolean;   // true if only .GITCLAW/ files changed
}

export async function findAgentCommits(
  issueNumber: number,
  maxCount: number = 5
): Promise<AgentCommit[]>
```

**Implementation:**

```typescript
export async function findAgentCommits(issueNumber: number, maxCount: number = 5): Promise<AgentCommit[]> {
  // Find commits with the gitclaw commit message pattern for this issue
  const { stdout } = await run([
    "git", "log",
    "--oneline",
    "--format=%H|%s|%aI",
    `--grep=gitclaw: work on issue #${issueNumber}`,
    `--grep=gitclaw: changes for issue #${issueNumber}`,
    `--grep=gitclaw: state update for issue #${issueNumber}`,
    `--grep=gitclaw: review PR #${issueNumber}`,
    "-n", String(maxCount),
  ]);
  
  if (!stdout.trim()) return [];
  
  const commits: AgentCommit[] = [];
  for (const line of stdout.trim().split("\n")) {
    const [sha, message, timestamp] = line.split("|");
    
    // Get the list of files changed in this commit
    const { stdout: files } = await run([
      "git", "diff-tree", "--no-commit-id", "--name-only", "-r", sha
    ]);
    
    const filesChanged = files.trim().split("\n").filter(Boolean);
    const isStateOnly = filesChanged.every(f => f.startsWith(".GITCLAW/"));
    
    commits.push({ sha, message, timestamp, filesChanged, isStateOnly });
  }
  
  return commits;
}
```

### Step 2: Implement the revert logic

```typescript
export interface UndoResult {
  revertedCommits: AgentCommit[];
  revertedFiles: string[];
  closedPRs: string[];
  sessionRolledBack: boolean;
  revertCommitSha: string | null;
  errors: string[];
}

export async function undoLastChanges(
  issueNumber: number,
  count: number = 1,
  repo: string,
  defaultBranch: string
): Promise<UndoResult>
```

**Implementation:**

```typescript
export async function undoLastChanges(
  issueNumber: number,
  count: number = 1,
  repo: string,
  defaultBranch: string
): Promise<UndoResult> {
  const result: UndoResult = {
    revertedCommits: [],
    revertedFiles: [],
    closedPRs: [],
    sessionRolledBack: false,
    revertCommitSha: null,
    errors: [],
  };
  
  // Find the agent's commits
  const commits = await findAgentCommits(issueNumber, count);
  
  if (commits.length === 0) {
    result.errors.push("No agent commits found for this issue to undo.");
    return result;
  }
  
  // Filter to only commits that changed non-state files
  // (we don't undo state-only commits — those are session updates)
  const codeCommits = commits.filter(c => !c.isStateOnly);
  
  if (codeCommits.length === 0) {
    result.errors.push("The agent's recent commits for this issue only updated session state (no file changes to undo).");
    return result;
  }
  
  // Check for any open PRs from this issue's branch
  const branchName = `gitclaw/issue-${issueNumber}`;
  const { stdout: openPRs } = await run([
    "gh", "pr", "list",
    "--head", branchName,
    "--state", "open",
    "--json", "number,url",
  ]);
  
  if (openPRs.trim() && openPRs.trim() !== "[]") {
    // Close the PR(s) and delete the branch
    const prs = JSON.parse(openPRs);
    for (const pr of prs) {
      try {
        await run(["gh", "pr", "close", String(pr.number), "--delete-branch",
          "--comment", `🔙 Closed by \`/undo\` on issue #${issueNumber}.`]);
        result.closedPRs.push(pr.url);
      } catch (e) {
        result.errors.push(`Failed to close PR #${pr.number}: ${e}`);
      }
    }
  } else {
    // No PR — changes were pushed directly to main. Revert the commits.
    for (const commit of codeCommits.slice(0, count)) {
      const { exitCode } = await run([
        "git", "revert", "--no-edit", commit.sha
      ]);
      
      if (exitCode !== 0) {
        // Revert had conflicts
        await run(["git", "revert", "--abort"]);
        result.errors.push(
          `Could not cleanly revert commit ${commit.sha.slice(0, 7)}. ` +
          `The changes may have been modified by subsequent commits. ` +
          `Manual intervention may be needed.`
        );
        break;
      }
      
      result.revertedCommits.push(commit);
      result.revertedFiles.push(...commit.filesChanged.filter(f => !f.startsWith(".GITCLAW/")));
    }
    
    // Push the revert commit(s)
    if (result.revertedCommits.length > 0) {
      for (let i = 1; i <= 3; i++) {
        const push = await run(["git", "push", "origin", `HEAD:${defaultBranch}`]);
        if (push.exitCode === 0) break;
        await run(["git", "pull", "--rebase", "origin", defaultBranch]);
      }
      
      // Get the revert commit SHA
      const { stdout: headSha } = await run(["git", "rev-parse", "HEAD"]);
      result.revertCommitSha = headSha.trim();
    }
  }
  
  return result;
}
```

### Step 3: Implement session rollback

When changes are undone, the session should reflect this. We don't delete the session — we append a note about the undo:

```typescript
export function recordUndoInSession(
  sessionPath: string,
  undoResult: UndoResult
): void {
  // Append a synthetic user/assistant exchange noting the undo
  const undoEntry = {
    type: "message",
    timestamp: new Date().toISOString(),
    message: {
      role: "user",
      content: [{ type: "text", text: "[System: The user invoked /undo. The following changes were reverted: " +
        undoResult.revertedFiles.join(", ") + ". " +
        (undoResult.closedPRs.length > 0 ? "PRs closed: " + undoResult.closedPRs.join(", ") + ". " : "") +
        "The agent should not re-apply these changes unless explicitly asked.]" }]
    }
  };
  
  const ackEntry = {
    type: "message",
    timestamp: new Date().toISOString(),
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Understood. I've noted that the previous changes were undone. I won't re-apply them unless you ask." }]
    }
  };
  
  appendFileSync(sessionPath, JSON.stringify(undoEntry) + "\n" + JSON.stringify(ackEntry) + "\n");
}
```

This ensures that when the conversation resumes, the agent knows its previous changes were rejected and why.

### Step 4: Integrate `/undo` as a slash command

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts` (or `GITCLAW-COMMANDS.ts` if feature 02 is implemented)

Handle `/undo` as a fast-path command (no LLM invocation needed):

```typescript
if (parsed.isCommand && parsed.command === "undo") {
  const count = parseInt(parsed.args) || 1;
  
  const undoResult = await undoLastChanges(issueNumber, count, repo, defaultBranch);
  
  // Record in session
  if (sessionPath && existsSync(sessionPath)) {
    recordUndoInSession(sessionPath, undoResult);
  }
  
  // Log to memory
  const memoryEntry = `[${new Date().toISOString().slice(0, 16).replace("T", " ")}] ` +
    `User undid agent changes on issue #${issueNumber}. ` +
    `Files reverted: ${undoResult.revertedFiles.join(", ") || "none"}. ` +
    `PRs closed: ${undoResult.closedPRs.length || 0}.`;
  appendFileSync(resolve(stateDir, "memory.log"), memoryEntry + "\n");
  
  // Build the response
  let response: string;
  if (undoResult.errors.length > 0 && undoResult.revertedCommits.length === 0 && undoResult.closedPRs.length === 0) {
    response = `## ⚠️ Could not undo\n\n${undoResult.errors.join("\n\n")}`;
  } else {
    const sections: string[] = ["## 🔙 Undo complete\n"];
    
    if (undoResult.revertedCommits.length > 0) {
      sections.push(`**Reverted ${undoResult.revertedCommits.length} commit(s):**`);
      for (const c of undoResult.revertedCommits) {
        sections.push(`- \`${c.sha.slice(0, 7)}\` ${c.message}`);
      }
      sections.push("");
    }
    
    if (undoResult.revertedFiles.length > 0) {
      sections.push(`**Files restored:**`);
      for (const f of [...new Set(undoResult.revertedFiles)]) {
        sections.push(`- \`${f}\``);
      }
      sections.push("");
    }
    
    if (undoResult.closedPRs.length > 0) {
      sections.push(`**PRs closed:**`);
      for (const pr of undoResult.closedPRs) {
        sections.push(`- ${pr}`);
      }
      sections.push("");
    }
    
    if (undoResult.errors.length > 0) {
      sections.push(`**Warnings:**`);
      for (const e of undoResult.errors) {
        sections.push(`- ${e}`);
      }
    }
    
    if (undoResult.revertCommitSha) {
      sections.push(`\nRevert commit: \`${undoResult.revertCommitSha.slice(0, 7)}\``);
    }
    
    response = sections.join("\n");
  }
  
  // Post response and commit state changes
  await gh("issue", "comment", String(issueNumber), "--body", response);
  
  await run(["git", "add", "-A"]);
  const { exitCode } = await run(["git", "diff", "--cached", "--quiet"]);
  if (exitCode !== 0) {
    await run(["git", "commit", "-m", `gitclaw: undo changes for issue #${issueNumber}`]);
    // Push with retry
    for (let i = 1; i <= 3; i++) {
      const push = await run(["git", "push", "origin", `HEAD:${defaultBranch}`]);
      if (push.exitCode === 0) break;
      await run(["git", "pull", "--rebase", "origin", defaultBranch]);
    }
  }
  
  // Skip normal agent execution
  return;
}
```

### Step 5: Implement 👎 reaction-triggered undo

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts`

This requires a new workflow trigger. Add `issue_comment` reaction events — but GitHub Actions doesn't directly trigger on reactions. Instead, use a polling approach or a separate workflow.

**Simpler alternative:** Don't trigger on reactions directly. Instead, when the agent resumes a session (on the next `issue_comment`), check if the previous agent comment received a 👎 reaction:

```typescript
// After fetching issue context, before running pi:
if (eventName === "issue_comment") {
  // Check if the user's new comment is essentially "undo"
  // Also check if the previous agent comment got a 👎
  const { stdout: comments } = await run([
    "gh", "api", `repos/${repo}/issues/${issueNumber}/comments`,
    "--jq", "[.[] | select(.user.login == \"github-actions[bot]\") | .id] | last"
  ]);
  
  const lastAgentCommentId = comments.trim();
  if (lastAgentCommentId) {
    const { stdout: reactions } = await run([
      "gh", "api", `repos/${repo}/issues/comments/${lastAgentCommentId}/reactions`,
      "--jq", '[.[] | select(.content == "-1")] | length'
    ]);
    
    const thumbsDownCount = parseInt(reactions.trim()) || 0;
    if (thumbsDownCount > 0) {
      // The previous response was disliked — inject context
      prompt = `[Note: Your previous response received a 👎 reaction. The user may want you to take a different approach. Be aware of this feedback.]\n\n${prompt}`;
    }
  }
}
```

For actual undo-on-reaction, document that users should use `/undo` for definitive rollback, while 👎 serves as soft feedback for the next interaction.

### Step 6: Handle edge cases

**Nothing to undo:**
```
## ⚠️ Nothing to undo

I haven't made any file changes on this issue yet. My previous responses were conversation-only (no code edits).
```

**Revert conflicts:**
```
## ⚠️ Could not cleanly undo

The changes from commit `abc1234` have been modified by subsequent commits and can't be automatically reverted.

**What you can do:**
- Manually revert specific files: `git checkout abc1234^ -- path/to/file`
- View the original changes: `git show abc1234`
- Ask me to re-apply the changes differently
```

**Changes already merged (branch-per-task):**
```
## ⚠️ Changes already merged

The PR with these changes has already been merged. To undo them:
1. I can create a new revert PR that undoes the merged changes
2. You can manually revert: `git revert <merge-sha>`

Would you like me to create a revert PR?
```

If the user says yes in a follow-up, the agent creates a revert PR.

### Step 7: Update documentation

**File:** `.GITCLAW/README.md`
- Add "Undo" to the capabilities table
- Document `/undo` in the quick reference

**New file:** `.GITCLAW/docs/GITCLAW-Undo.md`
- Full undo reference: `/undo`, `/undo N`, 👎 reaction behavior
- What gets reverted (files) vs. what's preserved (conversation history)
- Edge cases and manual recovery procedures
- How undo events are logged to memory

### Step 8: Test

- Ask the agent to create a file, then `/undo`:
  1. Verify the file is removed (revert commit).
  2. Verify the session records the undo.
  3. Verify memory.log records the undo event.
- Ask the agent to edit an existing file, then `/undo`:
  1. Verify the file is restored to its pre-edit state.
- Ask the agent to make multiple changes across turns, then `/undo 2`:
  1. Verify two commits are reverted.
- `/undo` when the agent only answered a question (no file changes):
  1. Verify the "nothing to undo" response.
- With branch-per-task active: `/undo` after agent opens a PR:
  1. Verify the PR is closed.
  2. Verify the branch is deleted.
- `/undo` when a revert would conflict:
  1. Verify the error message with manual recovery instructions.
