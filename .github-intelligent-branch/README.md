# GitHub Intelligent Branch

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/japer-technology/github-intelligence/main/.github-intelligence/logo.png" alt="Branch Intelligence">
  </picture>
</p>

### Intelligence for branches, branch protection rules, and repository rulesets.

---

## What It Acts On

| Trigger / Data | Description |
|---|---|
| **Branch protection rules** | Reads and audits protection settings — required reviews, status checks, signed commits, push restrictions, linear history |
| **Repository rulesets** | Inspects org-level and repo-level rulesets that govern branch, tag, and push policies |
| **Branch activity** | Monitors branch creation, deletion, and merge patterns |
| **Git refs** | Tracks `refs/heads/` namespace for parallel lines of development |
| **Merge conflicts** | Detects when branches diverge and conflicts arise |
| **Branch-per-task patterns** | Observes when the agent or developers create feature branches for exploratory work |

## What It Acts In

| Surface | How the Agent Participates |
|---|---|
| **Protection audits** | Inspects branch protection configuration and reports gaps — missing required reviews, no status checks, unsigned commits allowed |
| **Rule recommendations** | Suggests optimal protection rules based on repository activity patterns |
| **Compliance reporting** | Periodically verifies that protection rules meet organizational standards |
| **Ruleset validation** | For organizations, audits cross-repo rulesets for consistency and coverage |
| **Branch-per-investigation** | Creates feature branches for exploratory work, keeping `main` clean until a human merges |
| **PR-based state changes** | Routes agent changes through PRs that respect protection rules — human-in-the-loop by default |
| **Agent-as-required-reviewer** | Registers the agent as a required reviewer for specific paths, providing consistent automated review |
