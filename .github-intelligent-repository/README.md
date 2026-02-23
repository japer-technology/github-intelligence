# GitHub Intelligent Repository

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/japer-technology/github-intelligence/main/.github-intelligence/logo.png" alt="Repository Intelligence">
  </picture>
</p>

### Intelligence for the repository itself — the runtime, storage, and coordination layer for the agent.

---

## What It Acts On

| Trigger / Data | Description |
|---|---|
| **Repository files** | Reads and writes any file in the repository — source code, configuration, documentation |
| **Git history** | The full version-control graph — commits, branches, tags, diffs, blame |
| **Repository settings** | Reads repository configuration — visibility, permissions, features enabled |
| **Contributor activity** | Tracks contributor patterns, commit frequency, and participation metrics |
| **Fork relationships** | Detects when running in a fork and understands upstream/downstream relationships |
| **`repository_dispatch` events** | Receives typed events from external systems with custom JSON payloads |
| **Webhook events** | Processes external event triggers — CI failures, monitoring alerts, deployment events |

## What It Acts In

| Surface | How the Agent Participates |
|---|---|
| **Git-native state** | All agent memory, decisions, and artifacts stay in the repo — diffable, auditable, revertable |
| **Repository as application** | The repo is not just storing code — it is running code, hosting conversations, and persisting state |
| **External event ingestion** | CI failures, monitoring alerts, and deployment events trigger the agent via `repository_dispatch` |
| **Cross-service integration** | Slack, Discord, Linear, Jira, or PagerDuty events dispatch agent tasks |
| **Fork-aware memory** | Detects when running in a fork and offers to start fresh or inherit upstream memory |
| **Contributor onboarding** | Detects new contributors (first-time PRs) and provides personalized onboarding guidance |
| **Community health analysis** | Tracks contributor patterns, response times, and engagement metrics |
| **Cross-repo orchestration** | A hub repo can host an agent that monitors satellite repos via the GitHub API |
