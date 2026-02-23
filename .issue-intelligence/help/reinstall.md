# ♻️ Reinstall Issue Intelligence

[← Back to Help](README.md)

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/japer-technology/blank-with-issue-intelligence/main/.issue-intelligence/ISSUE-INTELLIGENCE-LOGO.png" alt="Issue Intelligence" width="400">
  </picture>
</p>

---

Reset or upgrade an existing Issue Intelligence installation. Use this when you want a fresh start, need to update to a newer version, or want to fix a broken installation.

## When to Reinstall

- **Upgrading** — a newer version of Issue Intelligence is available with new features or fixes
- **Broken state** — session files or configuration got corrupted
- **Fresh start** — you want to clear all conversation history and start over
- **Workflow changes** — the workflow template has been updated upstream

## Upgrade — Preserve Configuration and History

To upgrade Issue Intelligence while keeping your existing configuration, personality, and conversation history:

### 1. Back up your customizations

```bash
# Save your agent identity
cp .issue-intelligence/AGENTS.md /tmp/AGENTS.md.bak

# Save your LLM settings
cp .issue-intelligence/.pi/settings.json /tmp/settings.json.bak

# Save your system prompt (if customized)
cp .issue-intelligence/.pi/APPEND_SYSTEM.md /tmp/APPEND_SYSTEM.md.bak
```

### 2. Replace the `.issue-intelligence` folder

Remove the old folder and copy in the new version:

```bash
rm -rf .issue-intelligence
# Copy the new .issue-intelligence folder from the latest release
```

### 3. Restore your customizations

```bash
cp /tmp/AGENTS.md.bak .issue-intelligence/AGENTS.md
cp /tmp/settings.json.bak .issue-intelligence/.pi/settings.json
cp /tmp/APPEND_SYSTEM.md.bak .issue-intelligence/.pi/APPEND_SYSTEM.md
```

### 4. Run the installer and install dependencies

```bash
bun .issue-intelligence/install/ISSUE-INTELLIGENCE-INSTALLER.ts
cd .issue-intelligence && bun install
```

> The installer never overwrites existing files — it only creates missing ones. This means your existing `ISSUE-INTELLIGENCE-WORKFLOW-AGENT.yml` workflow will remain as-is. If the workflow template has changed, delete `.github/workflows/ISSUE-INTELLIGENCE-WORKFLOW-AGENT.yml` before running the installer to get the latest version.

### 5. Commit and push

```bash
git add -A
git commit -m "Upgrade issue-intelligence"
git push
```

## Clean Reinstall — Start Fresh

To completely reset Issue Intelligence, including all conversation history:

### 1. Remove everything

```bash
rm -rf .issue-intelligence
rm -f .github/workflows/ISSUE-INTELLIGENCE-WORKFLOW-AGENT.yml
rm -f .github/ISSUE_TEMPLATE/hatch.md
```

### 2. Copy in a fresh `.issue-intelligence` folder

Copy the `.issue-intelligence` folder from the latest release into your repo root.

### 3. Run the full installation

```bash
bun .issue-intelligence/install/ISSUE-INTELLIGENCE-INSTALLER.ts
cd .issue-intelligence && bun install
```

### 4. Reconfigure

- Add your API key secret in **Settings → Secrets and variables → Actions** (if not already present)
- Edit `.issue-intelligence/.pi/settings.json` to set your preferred provider and model (see [Configure](configure.md))

### 5. Commit and push

```bash
git add -A
git commit -m "Reinstall issue-intelligence"
git push
```

## Fixing a Broken Workflow

If only the GitHub Actions workflow is broken or outdated:

```bash
# Remove the old workflow
rm .github/workflows/ISSUE-INTELLIGENCE-WORKFLOW-AGENT.yml

# Re-run the installer to regenerate it from the template
bun .issue-intelligence/install/ISSUE-INTELLIGENCE-INSTALLER.ts

git add -A
git commit -m "Regenerate issue-intelligence workflow"
git push
```

## Resetting Session State Only

If you want to clear conversation history without reinstalling:

```bash
rm -rf .issue-intelligence/state/sessions/*
rm -rf .issue-intelligence/state/issues/*

git add -A
git commit -m "Clear issue-intelligence session history"
git push
```

The agent will start fresh conversations for all issues going forward.

## See Also

- [🔧 Install](install.md) — first-time installation guide
- [🗑️ Uninstall](uninstall.md) — complete removal
- [⚙️ Configure](configure.md) — customize after reinstalling
