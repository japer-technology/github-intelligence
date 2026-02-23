# GitHub Intelligent Action

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/japer-technology/github-intelligence/main/.github-intelligence/logo.png" alt="Action Intelligence">
  </picture>
</p>

### Intelligence for GitHub Actions — the compute engine that powers the agent.

---

## What It Acts On

| Trigger / Data | Description |
|---|---|
| **Workflow runs** | Monitors workflow execution, status, and outcomes across all event types |
| **Event triggers** | Responds to 35+ GitHub event types: `push`, `pull_request`, `issues`, `schedule`, `workflow_dispatch`, `repository_dispatch`, and more |
| **Workflow logs** | Reads build and test logs to diagnose failures and surface actionable insights |
| **Artifacts** | Inspects uploaded workflow artifacts (reports, test results, build outputs) |
| **Secrets & variables** | Operates with repository and environment secrets for LLM API keys and configuration |
| **Runner environments** | Executes on GitHub-hosted (`ubuntu-latest`) or self-hosted runners |
| **Concurrency groups** | Detects and manages concurrent workflow runs to prevent conflicts |
| **Caching** | Leverages dependency and build caches to reduce cold-start time |

## What It Acts In

| Surface | How the Agent Participates |
|---|---|
| **Workflow execution** | The agent's entire lifecycle runs inside a single Actions workflow — from authorization to response |
| **Scheduled runs** | Cron-triggered workflows enable periodic tasks: triage, audits, documentation freshness checks, and health reports |
| **Workflow dispatch** | Manual triggers with configurable inputs — task type, target issue/PR, skill override, model selection |
| **Repository dispatch** | External systems (CI failures, monitoring alerts, deployment events) trigger the agent via typed event payloads |
| **Artifact uploads** | Agent reports (review summaries, audit results, usage metrics) are uploaded as workflow artifacts for later inspection |
| **Reusable workflows** | The agent workflow can be packaged as a reusable workflow that other repos call with `uses:` |
| **Composite actions** | The guard + indicator + agent sequence can be packaged as a composite action for cleaner workflow files |
| **Matrix builds** | Multiple agent personas can run in parallel on different issues using matrix strategies |
