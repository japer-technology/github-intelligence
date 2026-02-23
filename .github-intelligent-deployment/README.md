# GitHub Intelligent Deployment

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/japer-technology/github-intelligence/main/.github-intelligence/logo.png" alt="Deployment Intelligence">
  </picture>
</p>

### Intelligence for environments and deployments — staged rollouts with approval gates.

---

## What It Acts On

| Trigger / Data | Description |
|---|---|
| **Environments** | Reads named deployment targets (`staging`, `production`) with their protection rules and secrets |
| **Required reviewers** | Monitors environment approval requirements before deployment proceeds |
| **Deployment status** | Tracks deployment state — pending, in-progress, success, failure — via the Deployments API |
| **Environment secrets** | Operates with environment-specific secrets (deploy keys, API endpoints) scoped per stage |
| **Deployment branches** | Enforces branch restrictions that control which branches can deploy to each environment |
| **OIDC tokens** | Uses short-lived OIDC credentials for cloud authentication without long-lived secrets |

## What It Acts In

| Surface | How the Agent Participates |
|---|---|
| **Staged agent rollout** | Uses environments to gate agent capability upgrades — test new skills in `staging` before `production` |
| **Deployment tracking** | When the agent creates or approves a release, tracks the deployment through environments |
| **Approval-gated operations** | Destructive agent actions (file deletion, release publishing) require environment approval from reviewers |
| **Environment-scoped configuration** | Different LLM API keys or model selections per environment (cheaper models for staging, best models for production) |
| **Deployment status reporting** | Posts deployment status updates that appear in the PR timeline |
| **Cloud resource access** | Accesses AWS, GCP, or Azure resources using short-lived OIDC tokens — no static credentials to rotate |
