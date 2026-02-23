# GitHub Intelligent Project

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/japer-technology/github-intelligence/main/.github-intelligence/logo.png" alt="Project Intelligence">
  </picture>
</p>

### Intelligence for GitHub Projects (v2) — automated project management, board sync, and milestone tracking.

---

## What It Acts On

| Trigger / Data | Description |
|---|---|
| **Project board state** | Reads project board columns, items, and their status via the GraphQL `ProjectV2` schema |
| **Custom fields** | Reads project custom fields — text, number, date, single-select, iteration |
| **Project views** | Inspects table, board, and roadmap views for current project state |
| **Milestones** | Reads milestone progress — open/closed counts, due dates, and scope |
| **Issue and PR metadata** | Correlates project items with issue labels, PR status, and assignee data |

## What It Acts In

| Surface | How the Agent Participates |
|---|---|
| **Board column management** | Moves items through project board columns based on agent analysis — triage → in-progress → review → done |
| **Custom field updates** | Sets custom field values (effort estimates, priority scores) based on issue complexity analysis |
| **Auto-add items** | Automatically creates project items when new issues match configured criteria |
| **Sprint summaries** | Generates sprint summaries by reading project board state and milestone progress |
| **Milestone assignment** | Assigns issues to milestones based on label or content analysis |
| **Milestone progress reports** | Generates milestone reports — burn-down data, scope creep warnings, overdue item alerts |
| **Scope monitoring** | Warns when a milestone's scope changes significantly between check-ins |
