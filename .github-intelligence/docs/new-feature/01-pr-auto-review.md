# Feature: Pull Request Auto-Review

## Summary

Extend GitClaw to automatically review pull requests when they are opened or updated, and participate in PR review comment threads — reusing the existing session model, reaction indicators, and commit/push infrastructure.

## Why This Feature

1. **Highest leverage-to-effort ratio on the roadmap.** The entire infrastructure already exists: session persistence, reaction indicators, commit/push with conflict retry, authorization gating, and the `pi` agent invocation pipeline. PR review is a thin extension of all of that — not a new system.

2. **It's where developers actually need an AI agent most.** Issues are nice for brainstorming, but code review is where teams spend the most time waiting. An auto-review on every PR open/sync immediately saves real human hours.

3. **It validates the session model for non-issue event sources.** The roadmap explicitly calls out extending `state/issues/` to `state/pull-requests/`. Implementing this proves the pattern generalizes, which de-risks every subsequent phase (discussions, releases, security alerts).

4. **It's the feature that makes GitClaw "real" to potential adopters.** An issue chatbot is interesting; an agent that reviews your PRs is useful. This is the tipping point from "neat demo" to "I actually want this in my repos."

5. **No new dependencies or permissions beyond `pull-requests: write`.** Everything else — Bun, `gh`, `pi`, `git`, `jq` — is already in the stack.

## Scope

### In Scope
- Trigger on PR opened and new commits pushed (synchronize)
- Read the PR diff and post a structured review comment
- Resume PR conversations when someone replies to the agent's review
- PR-specific session namespace (`state/pull-requests/`)
- Post as a proper GitHub PR review (`COMMENT` type)

### Out of Scope
- No `APPROVE` / `REQUEST_CHANGES` decisions (keep human-in-the-loop)
- No line-level inline annotations (Phase 1.2 follow-up)
- No check runs or status gating (Phase 1.4/1.5)
- No new skills — uses the agent's existing code comprehension

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Workflow file** (`GITCLAW-WORKFLOW-AGENT.yml`) | Add PR triggers, add `pull-requests: write` permission, filter bot comments | ~30 min |
| **Indicator script** (`GITCLAW-INDICATOR.ts`) | Handle `pull_request` event shape for reactions | ~30 min |
| **Agent orchestrator** (`GITCLAW-AGENT.ts`) | New PR code path: detect event → fetch diff → build review prompt → resolve PR session → run `pi` → post as PR review | ~2–3 hours |
| **State directory** | Create `state/pull-requests/` namespace | ~15 min |
| **Docs** | Update README, internals doc, quickstart | ~30 min |
| **Testing** | Open test PRs, verify review posting, session resumption | ~1 hour |

**Total: ~5–6 hours of focused work.**

---

## AI Implementation Instructions

### Step 1: Extend the workflow file

**File:** `.github/workflows/GITCLAW-WORKFLOW-AGENT.yml`

- Add `pull_request: [opened, synchronize]` and `pull_request_review_comment: [created]` to the `on:` triggers.
- Add `pull-requests: write` to the `permissions:` block.
- Update the `if:` condition on the job to also allow `pull_request` events and `pull_request_review_comment` events (filtering out `github-actions[bot]` comments same as issues).
- In the Authorize step, extract the actor from `github.actor` the same way — no change needed since collaborator permission check is actor-based.
- In the Run step, pass all provider API key secrets that are already listed (no change needed if using the existing env block).

### Step 2: Extend the indicator script for PR events

**File:** `.GITCLAW/lifecycle/GITCLAW-INDICATOR.ts`

- Read `GITHUB_EVENT_NAME`. If it is `pull_request`, extract the PR number from `event.pull_request.number` (not `event.issue.number`).
- For `pull_request` events, add the 👀 reaction to the PR itself using `gh api repos/{owner}/{repo}/issues/{pr_number}/reactions` (GitHub treats PRs as issues for the reactions API).
- For `pull_request_review_comment` events, add the 👀 reaction to the specific review comment using `gh api repos/{owner}/{repo}/pulls/comments/{comment_id}/reactions`.
- Write the reaction state to `/tmp/reaction-state.json` with a new `reactionTarget` value of `"pr"` or `"pr_review_comment"` so the agent script knows how to clean it up.

### Step 3: Extend the agent orchestrator

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts`

**3a. Event detection and context extraction:**
- After reading `eventName`, determine a new variable `eventSource`: `"issue"` (for `issues` and `issue_comment`), `"pull_request"` (for `pull_request` and `pull_request_review_comment`).
- For PR events, extract `prNumber` from `event.pull_request.number` (for `pull_request`) or `event.pull_request.number` (for `pull_request_review_comment`).
- Use `prNumber` as the conversation key (analogous to `issueNumber`).

**3b. Session namespace:**
- Create `state/pull-requests/` directory alongside `state/issues/`.
- Use `state/pull-requests/<prNumber>.json` as the session mapping file for PR conversations.
- The mapping file has the same shape: `{ prNumber, sessionPath, updatedAt }`.
- Session JSONL files still go in `state/sessions/` — only the mapping pointer is namespaced.

**3c. Prompt construction for PR events:**
- For `pull_request` (opened/synchronize) events:
  - Fetch the PR title: `gh pr view <prNumber> --json title --jq .title`
  - Fetch the PR body: `gh pr view <prNumber> --json body --jq .body`
  - Fetch the diff: `gh pr diff <prNumber>`
  - Construct a prompt like:
    ```
    Review this pull request.

    **Title:** <title>
    **Description:** <body>

    **Diff:**
    ```diff
    <diff content, truncated to 30000 chars if needed>
    ```

    Provide a structured review: summarize what changed, identify potential issues
    (bugs, security, performance, style), and suggest improvements. Be specific
    and reference file names and line numbers from the diff.
    ```
  - If the diff is too large (>30000 chars), truncate it and append a note: `(diff truncated — full diff has N characters)`.
- For `pull_request_review_comment` events: use `event.comment.body` as the prompt (same pattern as `issue_comment`).

**3d. Posting the review:**
- Instead of `gh issue comment`, post a PR review using the GitHub API:
  ```bash
  gh api repos/{owner}/{repo}/pulls/{prNumber}/reviews \
    --method POST \
    -f body="<agentText>" \
    -f event="COMMENT"
  ```
- This posts a proper review object (appears in the PR's review timeline) with event type `COMMENT` (not `APPROVE` or `REQUEST_CHANGES`).
- For `pull_request_review_comment` follow-ups, post a regular PR comment instead:
  ```bash
  gh pr comment <prNumber> --body "<agentText>"
  ```

**3e. Reaction cleanup:**
- In the `finally` block, handle the new `reactionTarget` values (`"pr"` and `"pr_review_comment"`).
- For `"pr"`: delete via `repos/{owner}/{repo}/issues/{prNumber}/reactions/{reactionId}`.
- For `"pr_review_comment"`: delete via `repos/{owner}/{repo}/pulls/comments/{commentId}/reactions/{reactionId}`.

**3f. Commit message:**
- For PR events, use commit message `gitclaw: review PR #<prNumber>` instead of `gitclaw: work on issue #<issueNumber>`.

### Step 4: Create state directory

- Add an empty `state/pull-requests/` directory (with a `.gitkeep` if needed) so the directory exists in the repo before the first PR triggers the agent.

### Step 5: Update documentation

**File:** `.GITCLAW/README.md`
- Add PR review to the "How It Works" section.
- Add `pull_request` and `pull_request_review_comment` to the event list.
- Add `pull-requests: write` to the permissions table.
- Mention `state/pull-requests/` in the directory structure.

**File:** `.GITCLAW/docs/GITCLAW-Internal-Mechanics.md`
- Add a section on PR event handling parallel to the existing issue event documentation.
- Update the sequence diagram to show the PR path.

**File:** `.GITCLAW/docs/GITCLAW-Roadmap.md`
- Check off items 1.1 (PR triggers) and the basic part of 1.2 (PR reviews — `COMMENT` type only).

### Step 6: Update the installer

**File:** `.GITCLAW/install/GITCLAW-WORKFLOW-AGENT.yml`
- This is the template that the installer copies into `.github/workflows/`. It must match the changes made in Step 1.

### Step 7: Test

- Create a test PR with a small code change and verify:
  1. The workflow triggers on `pull_request.opened`
  2. The 👀 reaction appears on the PR
  3. The agent posts a structured review as a `COMMENT` review
  4. A session mapping is created in `state/pull-requests/`
  5. The 👀 reaction is removed after completion
- Push a new commit to the same PR and verify:
  1. The workflow triggers on `pull_request.synchronize`
  2. The agent resumes the same session
  3. A new review is posted that acknowledges the update
- Reply to the agent's review and verify:
  1. The workflow triggers on `pull_request_review_comment.created`
  2. The agent responds in the PR conversation
