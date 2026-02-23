# GitHub Intelligent Issue

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/japer-technology/github-intelligence/main/.github-intelligence/logo.png" alt="Issue Intelligence">
  </picture>
</p>

### Intelligence for GitHub Issues — the primary conversation interface between human and agent.

---

## What It Acts On

| Trigger / Data | Description |
|---|---|
| **`issues.opened` events** | Triggers when a new issue is created — the title and body become the first prompt |
| **`issue_comment.created` events** | Triggers when a comment is posted — the agent resumes from its persisted session |
| **Issue body & title** | Reads Markdown content, task lists, file attachments, and cross-references |
| **Issue labels** | Reads assigned labels for routing, classification, and skill dispatch |
| **Issue templates** | Different templates invoke different agent skills — Bug Report, Feature Request, Code Review |
| **Reactions** | Monitors 👍/👎 reactions on agent comments as feedback signals |
| **Issue timeline** | Reads the full event history — assignments, label changes, references, and state changes |

## What It Acts In

| Surface | How the Agent Participates |
|---|---|
| **Conversation threads** | Every issue becomes a multi-turn chat thread — the agent replies as comments with full prior context |
| **Session mapping** | Maps `issue #N → state/issues/N.json → state/sessions/<session>.jsonl` for persistent memory |
| **👀 reaction indicator** | Signals that the agent is working by adding a 👀 reaction, removed when done |
| **Task list automation** | Reads Markdown task lists in issue bodies and posts progress updates as items are completed |
| **Sub-issue decomposition** | Breaks large requests into sub-issues, creating a hierarchy of tracked work items |
| **Issue search as memory** | Searches closed issues to find prior decisions, rejected approaches, and resolved questions |
| **Auto-close stale conversations** | Identifies idle issues and posts a summary-and-close comment |
| **Pinned issue dashboards** | Maintains a pinned issue with a live dashboard — open investigations, recent decisions, memory highlights |
