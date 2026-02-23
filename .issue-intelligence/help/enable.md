# ▶️ Enable Issue Intelligence

[← Back to Help](README.md)

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/japer-technology/blank-with-issue-intelligence/main/.issue-intelligence/ISSUE-INTELLIGENCE-LOGO.png" alt="Issue Intelligence" width="400">
  </picture>
</p>

---

Re-activate a previously disabled Issue Intelligence agent, or confirm that Issue Intelligence is currently enabled.

## How Enabling Works

Issue Intelligence uses a **fail-closed** security model controlled by a single sentinel file:

```
.issue-intelligence/ISSUE-INTELLIGENCE-ENABLED.md
```

When this file exists in the repository, the agent is **enabled** and will respond to issues and comments. When it's missing, the agent is **disabled** and all workflow runs exit immediately at the Guard step.

## Enable the Agent

### If the sentinel file was deleted

Recreate the sentinel file and push:

```bash
cat > .issue-intelligence/ISSUE-INTELLIGENCE-ENABLED.md << 'EOF'
# .issue-intelligence 🦞 Enabled

### Delete or rename this file to disable .issue-intelligence
EOF

git add .issue-intelligence/ISSUE-INTELLIGENCE-ENABLED.md
git commit -m "Enable issue-intelligence"
git push
```

### If the sentinel file was renamed

Rename it back:

```bash
mv .issue-intelligence/ISSUE-INTELLIGENCE-DISABLED.md .issue-intelligence/ISSUE-INTELLIGENCE-ENABLED.md
git add -A
git commit -m "Enable issue-intelligence"
git push
```

### If the workflow was disabled via GitHub UI

1. Go to your repository on GitHub
2. Click the **Actions** tab
3. Select the **ISSUE-INTELLIGENCE-WORKFLOW-AGENT** workflow in the left sidebar
4. Click **Enable workflow**

> **Note:** If both the sentinel file is missing AND the workflow is disabled, you need to do both: restore the sentinel file and re-enable the workflow.

## Verify Issue Intelligence Is Enabled

Check that all of the following are in place:

| Check | How to Verify |
|-------|---------------|
| Sentinel file exists | `ls .issue-intelligence/ISSUE-INTELLIGENCE-ENABLED.md` — file should be present |
| Workflow exists | `ls .github/workflows/ISSUE-INTELLIGENCE-WORKFLOW-AGENT.yml` — file should be present |
| Workflow is active | Go to **Actions** tab — workflow should not show "This workflow is disabled" |
| API key is set | Go to **Settings → Secrets and variables → Actions** — the provider secret should be listed |

## Testing After Enabling

Open a test issue or comment on an existing one. You should see:

1. A workflow run appears in the **Actions** tab
2. The Guard step passes (shows "Issue Intelligence enabled — ISSUE-INTELLIGENCE-ENABLED.md found.")
3. A 👀 reaction appears on the issue
4. The agent posts a reply

## Enabling for the First Time

If you haven't installed Issue Intelligence yet, see [Install](install.md) instead. The sentinel file is included in the `.issue-intelligence` folder by default — no extra steps are needed to enable it during initial setup.

## See Also

- [⏸️ Disable](disable.md) — temporarily stop the agent
- [⚙️ Configure](configure.md) — adjust settings after enabling
- [🔧 Install](install.md) — first-time setup
