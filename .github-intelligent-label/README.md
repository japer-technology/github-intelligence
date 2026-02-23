# GitHub Intelligent Label

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/japer-technology/github-intelligence/main/.github-intelligence/logo.png" alt="Label Intelligence">
  </picture>
</p>

### Intelligence for labels — automated classification, routing, and taxonomy enforcement.

---

## What It Acts On

| Trigger / Data | Description |
|---|---|
| **Issue and PR labels** | Reads labels assigned to issues and pull requests for categorization and filtering |
| **Label taxonomy** | Operates with a managed label taxonomy defining standard categories — type, priority, area, status |
| **Issue/PR content** | Analyzes title and body text to determine appropriate labels |
| **Urgency signals** | Detects priority indicators in issue text for automatic priority labeling |
| **Label-based routing** | Reads labels like `agent:review`, `agent:docs`, `agent:triage` to dispatch to specific skills |

## What It Acts In

| Surface | How the Agent Participates |
|---|---|
| **Auto-labeling** | Automatically labels new issues based on title and body analysis — `bug`, `feature`, `question`, `documentation` |
| **Priority detection** | Analyzes urgency signals in issue text and applies priority labels |
| **Taxonomy enforcement** | Warns or auto-fixes when issues lack required labels or have conflicting ones |
| **Label-driven dispatch** | Routes issues to different agent skills based on labels — `agent:review`, `agent:docs`, `agent:triage` |
| **Label hygiene** | Enforces label rules — ensures taxonomy consistency across the repository |
| **Skill selection** | Uses issue templates with pre-assigned labels to invoke specific agent skills |
