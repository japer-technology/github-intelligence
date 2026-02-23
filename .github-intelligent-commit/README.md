# GitHub Intelligent Commit

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/japer-technology/github-intelligence/main/.github-intelligence/logo.png" alt="Commit Intelligence">
  </picture>
</p>

### Intelligence for commits — the immutable snapshots that form the agent's memory and audit trail.

---

## What It Acts On

| Trigger / Data | Description |
|---|---|
| **Commit history** | Reads `git log` to understand the full history of changes, decisions, and contributions |
| **Commit diffs** | Analyzes `git diff` between any two commits to understand what changed and why |
| **Commit messages** | Parses structured commit messages for metadata — token usage, model, skill invoked |
| **Git blame** | Uses per-line attribution to understand who wrote what and when, enriching code analysis |
| **Push events** | Triggers on `push` events when new commits are pushed to branches |
| **Session state commits** | Every agent conversation turn is committed to git — sessions and changes are pushed after every turn |

## What It Acts In

| Surface | How the Agent Participates |
|---|---|
| **State persistence** | All agent state (sessions, issue mappings, memory) is committed to git — diffable, auditable, revertable |
| **Commit-level audit trails** | Structured commit messages with metadata (token usage, model, skill invoked) for forensic analysis |
| **Blame-driven context** | When reviewing code, the agent uses `git blame` to understand authorship and timing, enriching its analysis |
| **Diff-based change summaries** | Automatically summarizes what changed between any two points — useful for release notes and review summaries |
| **Conflict resolution** | Handles concurrent writes gracefully with `git pull --rebase` and a retry loop |
| **Change categorization** | Analyzes the nature of commits (breaking, feature, fix) for semantic versioning decisions |
