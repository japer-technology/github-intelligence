# GitHub Intelligent Code Review

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/japer-technology/github-intelligence/main/.github-intelligence/github-intelligence-LOGO.png" alt="Code Review Intelligence">
  </picture>
</p>

### Intelligence for code review — structured reviews, inline comments, and merge gating.

---

## What It Acts On

| Trigger / Data | Description |
|---|---|
| **Pull request diffs** | Reads the diff between branches to analyze what changed |
| **Review threads** | Monitors unresolved review comment threads for follow-up |
| **Review verdicts** | Tracks `APPROVE`, `REQUEST_CHANGES`, and `COMMENT` reviews on PRs |
| **Check runs & status checks** | Reads pass/fail results and inline annotations on commits |
| **File-level changes** | Inspects changed files, additions, deletions, and modifications line-by-line |
| **Code patterns** | Detects anti-patterns, security issues, style violations, and missing tests |

## What It Acts In

| Surface | How the Agent Participates |
|---|---|
| **Structured reviews** | Posts `APPROVE`, `REQUEST_CHANGES`, or `COMMENT` reviews via the GitHub API with a consistent rubric |
| **Line-level comments** | Attaches file-specific review comments to the correct diff hunks |
| **Suggested changes** | Uses GitHub's "suggested change" syntax in review comments so users can apply fixes with one click |
| **Diff summarization** | Generates a top-level summary for large PRs — what changed, why it matters, what to pay attention to |
| **Review thread participation** | Replies inline to unresolved threads with analysis or suggested fixes |
| **Check run annotations** | Posts Check Runs with inline file-level and line-level annotations with severity levels |
| **Required status checks** | Registers `github-intelligence/review` as a required check, gating merges on agent approval |
| **Multi-check reporting** | Separate checks for different concerns: style, security, tests |
