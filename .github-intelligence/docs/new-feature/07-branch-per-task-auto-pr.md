# Feature: Branch-per-Task with Auto-PR for Code Changes

## Summary

When the agent modifies repository files (as opposed to just updating its own state), it should create a feature branch and open a pull request instead of pushing directly to `main`. Session state and memory still commit to the default branch (that's the agent's brain — it must persist), but code changes go through human review. This is the single most important safety improvement GitClaw can make, and the #1 requirement any serious team would demand before letting an AI agent write to their repo.

## Why This Feature — The Deep Reasoning

**1. Pushing to main is the original sin of this architecture.**

The current design commits *everything* — session logs, issue mappings, AND arbitrary file edits — to the default branch in a single `git add -A && git commit && git push`. This means if a user says "refactor the auth module," the agent rewrites production code and pushes it to `main` with no review, no CI, no tests, no human approval. The retry-on-conflict rebase loop makes this even more dangerous: a failed push triggers `git pull --rebase`, which could silently resolve conflicts in agent-edited files by favoring the agent's version.

This is fine for a demo. It is disqualifying for real usage.

**2. The fix is architecturally clean because state and code are separable.**

GitClaw's state lives in `.GITCLAW/state/` — session logs and issue mappings. This state MUST go to the default branch immediately because it's the agent's persistent memory. If a subsequent run can't find the session mapping, it starts fresh and loses context. But file edits outside `.GITCLAW/` are *work product* — they should go through the same review process as any human's code changes.

The separation is: `.GITCLAW/` changes → push to default branch. Everything else → branch + PR.

**3. It makes every other feature safer.**

PR auto-review (feature 01) only makes sense if there are PRs to review. Scheduled runs (feature 04) that modify code should absolutely not push to main. Slash commands like `/refactor` or `/test` that edit files need a safety net. Branch-per-task is the safety infrastructure that makes autonomous code editing trustworthy.

**4. It aligns with how the GitHub platform wants you to work.**

Branch protection rules, required reviews, status checks, CODEOWNERS — GitHub's entire governance model assumes code flows through PRs. An agent that bypasses all of this is working against the platform, not with it. An agent that creates PRs integrates with the entire ecosystem: CI runs on the PR, CODEOWNERS are requested, checks gate the merge.

**5. It creates a natural human-in-the-loop checkpoint.**

The agent does the work. A human reviews and merges. This is the "human-in-the-loop by default" principle from the roadmap's guiding principles — currently violated by the direct-to-main push model.

## Scope

### In Scope
- Detect when the agent has modified files outside `.GITCLAW/` during a run
- Create a feature branch (`gitclaw/issue-<N>-<slug>`) for those changes
- Open a PR from the feature branch to the default branch
- Link the PR to the originating issue
- Still push `.GITCLAW/` state changes (sessions, mappings) directly to the default branch
- Configurable: opt into branch-per-task behavior via `settings.json` (default: enabled)
- Configurable: paths that should always go direct (e.g., docs, config) vs. always PR

### Out of Scope
- Automatic merging of agent PRs
- Branch cleanup after merge
- Multi-PR orchestration (one PR per run, not per file)
- Interaction between agent PRs and branch protection rules (that's GitHub's job)

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Change detection** | After `pi` runs, diff `.GITCLAW/` changes vs other changes | ~1 hour |
| **Branch creation & PR opening** | `git checkout -b`, selective `git add`, `gh pr create` | ~2 hours |
| **Split commit logic** | Two commits: state to default branch, code to feature branch | ~2 hours |
| **PR formatting** | Link to issue, summarize changes, request reviewers | ~1 hour |
| **Configuration** | Settings for enable/disable, path rules | ~30 min |
| **Docs** | Update README, internals, quickstart | ~30 min |
| **Testing** | Test with code edits, test with state-only changes, test with mixed | ~1.5 hours |

**Total: ~8–9 hours.** This is architecturally the most delicate feature because it restructures the core commit/push pipeline — the heart of GITCLAW-AGENT.ts.

---

## AI Implementation Instructions

### Step 1: Add configuration

**File:** `.GITCLAW/.pi/settings.json`

```json
{
  "defaultProvider": "anthropic",
  "defaultModel": "claude-opus-4-6",
  "defaultThinkingLevel": "high",
  "branchPerTask": {
    "enabled": true,
    "directPushPaths": [".GITCLAW/"],
    "branchPrefix": "gitclaw/",
    "autoRequestReviewers": true
  }
}
```

- `enabled`: Master toggle. When false, all changes push to main (current behavior).
- `directPushPaths`: Array of path prefixes that always push to the default branch. `.GITCLAW/` is mandatory and cannot be removed (session state must be on the default branch).
- `branchPrefix`: Prefix for feature branch names.
- `autoRequestReviewers`: If true, request the issue author as a reviewer on the PR.

### Step 2: Detect what changed after the agent runs

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts`

After the `pi` agent finishes and before the existing commit/push logic, insert a change-detection step:

```typescript
// Stage everything to see what changed
await run(["git", "add", "-A"]);

// Get the list of staged files
const { stdout: stagedFiles } = await run([
  "git", "diff", "--cached", "--name-only"
]);

if (!stagedFiles.trim()) {
  console.log("No changes to commit");
  // Skip commit/push entirely
} else {
  const changedFiles = stagedFiles.trim().split("\n");
  
  // Partition files into "state" (direct push) and "code" (branch + PR)
  const branchConfig = piSettings.branchPerTask || {};
  const directPushPaths = branchConfig.directPushPaths || [".GITCLAW/"];
  
  const stateFiles = changedFiles.filter(f => 
    directPushPaths.some(prefix => f.startsWith(prefix))
  );
  const codeFiles = changedFiles.filter(f => 
    !directPushPaths.some(prefix => f.startsWith(prefix))
  );
  
  console.log(`State files (direct push): ${stateFiles.length}`);
  console.log(`Code files (branch + PR): ${codeFiles.length}`);
  
  if (codeFiles.length === 0 || !branchConfig.enabled) {
    // No code changes, or branch-per-task disabled — use existing direct push
    await commitAndPushDirect(changedFiles);
  } else {
    // Split: push state to default branch, code to feature branch + PR
    await commitSplitAndPR(stateFiles, codeFiles);
  }
}
```

### Step 3: Implement the split commit and PR flow

**New function in `GITCLAW-AGENT.ts`:**

```typescript
async function commitSplitAndPR(stateFiles: string[], codeFiles: string[]): Promise<void> {
  // ── Phase 1: Commit and push state files to the default branch ──────────
  // This must happen first and must succeed — it's the agent's memory.
  
  // Unstage everything first
  await run(["git", "reset", "HEAD"]);
  
  // Stage only state files
  for (const f of stateFiles) {
    await run(["git", "add", f]);
  }
  
  // Check if there are staged state changes
  const { exitCode: stateCheck } = await run(["git", "diff", "--cached", "--quiet"]);
  if (stateCheck !== 0) {
    await run(["git", "commit", "-m", `gitclaw: state update for issue #${issueNumber}`]);
    
    // Push state to default branch with retry
    for (let i = 1; i <= 3; i++) {
      const push = await run(["git", "push", "origin", `HEAD:${defaultBranch}`]);
      if (push.exitCode === 0) break;
      console.log(`State push failed, rebasing and retrying (${i}/3)...`);
      await run(["git", "pull", "--rebase", "origin", defaultBranch]);
    }
  }
  
  // ── Phase 2: Create feature branch with code changes ────────────────────
  
  // Generate a branch name from the issue
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const branchName = `${piSettings.branchPerTask?.branchPrefix || "gitclaw/"}issue-${issueNumber}-${slug}`;
  
  // Check if this branch already exists (agent may be continuing work on the same issue)
  const { stdout: existingBranch } = await run([
    "git", "ls-remote", "--heads", "origin", branchName
  ]);
  
  if (existingBranch.trim()) {
    // Branch exists — fetch it and check it out
    await run(["git", "fetch", "origin", branchName]);
    await run(["git", "checkout", branchName]);
    await run(["git", "merge", defaultBranch, "--no-edit"]);  // bring in latest state
  } else {
    // Create new branch from current HEAD (which has state changes already)
    await run(["git", "checkout", "-b", branchName]);
  }
  
  // Stage code files on the feature branch
  for (const f of codeFiles) {
    await run(["git", "add", f]);
  }
  
  const { exitCode: codeCheck } = await run(["git", "diff", "--cached", "--quiet"]);
  if (codeCheck !== 0) {
    await run(["git", "commit", "-m", `gitclaw: changes for issue #${issueNumber}`]);
  }
  
  // Push the feature branch
  await run(["git", "push", "origin", branchName, "--force-with-lease"]);
  
  // ── Phase 3: Open or update a PR ───────────────────────────────────────
  
  // Check if a PR already exists for this branch
  const { stdout: existingPR } = await run([
    "gh", "pr", "list",
    "--head", branchName,
    "--state", "open",
    "--json", "number",
    "--jq", ".[0].number"
  ]);
  
  if (existingPR.trim()) {
    // PR already exists — it was auto-updated by the push.
    // Post a comment noting new changes.
    const prNumber = existingPR.trim();
    console.log(`Updated existing PR #${prNumber} with new changes`);
    await gh("pr", "comment", prNumber, "--body",
      `🦞 Updated with new changes from issue #${issueNumber}.\n\n` +
      `**Files changed:**\n${codeFiles.map(f => `- \`${f}\``).join("\n")}`
    );
  } else {
    // Create a new PR
    const prBody = [
      `## Changes from GitClaw`,
      ``,
      `Automated changes generated from issue #${issueNumber}.`,
      ``,
      `**Files changed:**`,
      ...codeFiles.map(f => `- \`${f}\``),
      ``,
      `---`,
      `_Review these changes and merge when satisfied. Created by GitClaw 🦞_`,
    ].join("\n");
    
    const { stdout: prUrl } = await run([
      "gh", "pr", "create",
      "--title", `[GitClaw] ${title}`,
      "--body", prBody,
      "--base", defaultBranch,
      "--head", branchName,
    ]);
    
    console.log(`Created PR: ${prUrl.trim()}`);
    
    // Request reviewer if configured
    if (piSettings.branchPerTask?.autoRequestReviewers) {
      const issueAuthor = event.issue?.user?.login || event.comment?.user?.login;
      if (issueAuthor && issueAuthor !== "github-actions[bot]") {
        try {
          const prNumber = prUrl.trim().split("/").pop();
          await gh("pr", "edit", prNumber!, "--add-reviewer", issueAuthor);
        } catch (e) {
          console.log("Could not request reviewer:", e);
        }
      }
    }
  }
  
  // ── Phase 4: Return to the default branch ──────────────────────────────
  // The workflow should leave the working tree on the default branch so that
  // session state is always committed there.
  await run(["git", "checkout", defaultBranch]);
}
```

### Step 4: Update the agent's comment to mention the PR

When the agent's response is posted as an issue comment, append a note about the PR if one was created:

```typescript
// After creating the PR, store the URL
let createdPRUrl: string | null = null;
// ... (set this in the PR creation step above) ...

// When constructing the comment body:
let commentBody = trimmedText.slice(0, MAX_COMMENT_LENGTH);
if (createdPRUrl) {
  const prNote = `\n\n---\n📝 I've opened a PR with these changes: ${createdPRUrl}\nPlease review and merge when you're satisfied.`;
  commentBody = commentBody.slice(0, MAX_COMMENT_LENGTH - prNote.length) + prNote;
}
```

### Step 5: Handle the case where code files are deleted

When the agent deletes a file (e.g., during a refactor), `git diff --cached --name-only` still lists the file with a `D` status. Ensure deleted files are handled:

```typescript
// Use --name-status to distinguish additions/modifications from deletions
const { stdout: stagedStatus } = await run([
  "git", "diff", "--cached", "--name-status"
]);
// Parse lines like "M\tpath/to/file" or "D\tpath/to/file"
```

Deleted files should follow the same path rules: if the deleted file is outside `.GITCLAW/`, it goes to the feature branch.

### Step 6: Handle subsequent agent runs on the same issue

If the user comments on the issue again and the agent makes more code changes:

1. The branch `gitclaw/issue-<N>-<slug>` already exists.
2. The PR is already open.
3. New code changes should be pushed to the SAME branch (not a new one).
4. The PR is automatically updated by the push.
5. A comment is posted on the PR noting the new changes.

This is already handled by Step 3 (the "branch exists" path), but verify that:
- The branch checkout + merge doesn't conflict with state that was just pushed to main.
- The `--force-with-lease` push won't reject if the branch was updated by a previous run.

### Step 7: Handle the edge case where the user wants direct push

Add a mechanism for the user to opt out per-issue. If the issue comment contains `[direct]` or the issue has a `gitclaw:direct` label, skip branch creation and push all changes directly to the default branch.

```typescript
const forceDirectPush = prompt.includes("[direct]") ||
  (event.issue?.labels || []).some((l: any) => l.name === "gitclaw:direct");

if (forceDirectPush || codeFiles.length === 0 || !branchConfig.enabled) {
  await commitAndPushDirect(changedFiles);
} else {
  await commitSplitAndPR(stateFiles, codeFiles);
}
```

### Step 8: Update the workflow permissions

**File:** `.github/workflows/GITCLAW-WORKFLOW-AGENT.yml`

Add `pull-requests: write` to the permissions block (needed for `gh pr create`):

```yaml
permissions:
  contents: write
  issues: write
  actions: write
  pull-requests: write
```

### Step 9: Update documentation

**File:** `.GITCLAW/README.md`
- Add "Branch-per-Task" section explaining that code changes go through PRs.
- Update the "How It Works" section: "The agent creates a feature branch and opens a PR for code changes, while session state is saved directly to the default branch."
- Document the `branchPerTask` configuration options.
- Document the `[direct]` escape hatch.

**File:** `.GITCLAW/docs/GITCLAW-Internal-Mechanics.md`
- Add a new section "Split Commit Model" explaining the state-vs-code separation.
- Update the commit/push section to describe both paths.
- Document the branch naming convention.

### Step 10: Test

- Ask the agent to create a file (e.g., "Create a hello.py script"):
  1. Verify `.GITCLAW/state/` changes push to main.
  2. Verify `hello.py` is on a new branch `gitclaw/issue-<N>-<slug>`.
  3. Verify a PR is opened linking to the issue.
  4. Verify the agent's comment mentions the PR.
- Ask the agent a question that doesn't edit files:
  1. Verify only state changes push to main.
  2. Verify no branch or PR is created.
- Ask the agent to make more changes on the same issue:
  1. Verify the SAME branch is updated.
  2. Verify the existing PR is updated (not a new PR).
- Test with `branchPerTask.enabled: false`:
  1. Verify all changes push directly to main (current behavior).
- Test with `[direct]` in the comment:
  1. Verify direct push regardless of config.
- Test with a repo that has branch protection on main:
  1. Verify state changes can still push (they must — state is essential).
  2. If branch protection blocks the state push, document this as a known limitation and recommend excluding `.GITCLAW/` from protection rules.

## Design Decisions

**Why not put everything on the feature branch?** Session state MUST be on the default branch because subsequent runs check out the default branch and read `state/issues/<N>.json` to find the session. If the session mapping is on a feature branch, the next run can't find it and starts fresh — losing the entire conversation.

**Why `--force-with-lease` instead of regular push?** The feature branch is "owned" by the agent for that issue. If the agent rewrites changes (e.g., the user says "actually, do it this way instead"), force-pushing is correct — the branch reflects the latest version. `--force-with-lease` adds safety by checking that nobody else has pushed to the branch.

**Why not one branch per run instead of per issue?** One branch per issue allows the agent to accumulate changes across multiple interactions. The user says "create a module," then "add tests," then "update the docs" — all on the same issue, all on the same branch, all in the same PR. This matches how humans work: a feature branch collects related changes over time.

**Why link the PR to the issue instead of making the issue the PR?** Issues and PRs serve different purposes. The issue is the conversation. The PR is the code review. Keeping them separate allows the conversation to continue on the issue while the PR goes through its own review lifecycle.
