# GitHub Intelligent Pull Request

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/japer-technology/github-intelligence/main/.github-intelligence/github-intelligence-LOGO.png" alt="Pull Request Intelligence">
  </picture>
</p>

### Intelligence for pull requests — the full PR lifecycle from review to merge.

---

## What It Acts On

| Trigger / Data | Description |
|---|---|
| **`pull_request` events** | Triggers on `opened`, `synchronize`, and `reopened` events |
| **`pull_request_review` events** | Triggers when reviews are submitted on a PR |
| **`pull_request_review_comment` events** | Triggers when line-level review comments are posted |
| **PR diffs** | Reads the diff between branches to analyze code changes |
| **PR files** | Inspects the list of changed files, additions, deletions, and modifications |
| **Review threads** | Reads unresolved review threads for follow-up and analysis |
| **Check suite results** | Monitors check run outcomes that gate merging |
| **Draft PR state** | Distinguishes between draft PRs (work-in-progress) and ready-for-review PRs |

## What It Acts In

| Surface | How the Agent Participates |
|---|---|
| **Auto-review on PR open** | When a PR is opened, reads the diff, analyzes it, and posts a structured review with line-level comments |
| **Review verdicts** | Posts `APPROVE` for clean changes, `REQUEST_CHANGES` for issues found, with a consistent rubric |
| **Diff summarization** | Large PRs get a top-level summary — what changed, why it matters, what to pay attention to |
| **Review thread participation** | Replies inline to unresolved threads with analysis or suggested fixes |
| **PR-to-session mapping** | Maps `PR #N → state/pull-requests/N.json → state/sessions/<session>.jsonl` for persistent memory |
| **Draft PR creation** | Creates draft PRs from issue discussions — "implement what we discussed in #42" |
| **Merge conflict resolution** | Detects merge conflicts, analyzes both sides, and proposes a resolution |
| **PR description generation** | From the diff alone, generates a structured PR description with summary, motivation, and testing notes |
| **Suggested changes** | Uses GitHub's "suggested change" syntax in review comments for one-click fixes |
