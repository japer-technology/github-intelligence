# .issue-intelligence 🦞 Install

### These files are installed by ISSUE-INTELLIGENCE-INSTALLER.yml

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/japer-technology/blank-with-issue-intelligence/main/.issue-intelligence/ISSUE-INTELLIGENCE-LOGO.png" alt="Issue Intelligence" width="500">
  </picture>
</p>

The `install/` directory contains the **installable payload** for `.issue-intelligence`

Everything in this folder is intentionally flat (no nested subfolders) so it can be copied, vendored, or inspected quickly.

## Files in this folder

- `ISSUE-INTELLIGENCE-INSTALLER.ts` — one-time installer script.
- `ISSUE-INTELLIGENCE-WORKFLOW-AGENT.yml` — GitHub Actions workflow template copied to `.github/workflows/ISSUE-INTELLIGENCE-WORKFLOW-AGENT.yml`.
- `ISSUE-INTELLIGENCE-TEMPLATE-HATCH.md` — issue template copied to `.github/ISSUE_TEMPLATE/hatch.md`.
- `ISSUE-INTELLIGENCE-AGENTS.md` — default agent identity/instructions copied to `.issue-intelligence/AGENTS.md`.
- `package.json` and `package-lock.json` — runtime dependencies for the scripts under `.issue-intelligence/`.

## Install process (step-by-step)

### 1) Place `.issue-intelligence` at your repository root

The expected layout is:

```text
<repo>/
  .issue-intelligence/
    install/
      ISSUE-INTELLIGENCE-INSTALLER.ts
      ISSUE-INTELLIGENCE-WORKFLOW-AGENT.yml
      ISSUE-INTELLIGENCE-TEMPLATE-HATCH.md
      ISSUE-INTELLIGENCE-AGENTS.md
      package.json
      package-lock.json
    lifecycle/
      ISSUE-INTELLIGENCE-AGENT.ts
      ISSUE-INTELLIGENCE-INDICATOR.ts
      ISSUE-INTELLIGENCE-ENABLED.ts
```

### 2) Run the installer

From the repository root:

```bash
bun .issue-intelligence/install/ISSUE-INTELLIGENCE-INSTALLER.ts
```

The installer is **non-destructive**:

- If a destination file already exists, it skips it.
- If a destination file is missing, it installs it.

### 3) What `ISSUE-INTELLIGENCE-INSTALLER.ts` installs

The script installs the following resources:

1. `.issue-intelligence/install/ISSUE-INTELLIGENCE-WORKFLOW-AGENT.yml` → `.github/workflows/ISSUE-INTELLIGENCE-WORKFLOW-AGENT.yml`
2. `.issue-intelligence/install/ISSUE-INTELLIGENCE-TEMPLATE-HATCH.md` → `.github/ISSUE_TEMPLATE/hatch.md`
3. `.issue-intelligence/install/ISSUE-INTELLIGENCE-AGENTS.md` → `.issue-intelligence/AGENTS.md`
4. Ensures `.gitattributes` contains:

```text
memory.log merge=union
```

That merge rule keeps the memory log append-only merge behavior safe when multiple branches update it.

### 4) Install dependencies

```bash
cd .issue-intelligence
bun install
```

### 5) Configure secrets and push

1. Add `ANTHROPIC_API_KEY` in: **Repository Settings → Secrets and variables → Actions**.
2. Commit the new/installed files.
3. Push to GitHub.

### 6) (Optional) Enable the automated installer workflow

`ISSUE-INTELLIGENCE-INSTALLER.yml` is a reusable GitHub Actions workflow that bootstraps issue-intelligence automatically whenever changes to `.issue-intelligence/**` are pushed, or on demand via `workflow_dispatch`.

To activate it:

1. Copy `.issue-intelligence/ISSUE-INTELLIGENCE-INSTALLER.yml` into your `.github/workflows/` folder:

   ```bash
   cp .issue-intelligence/ISSUE-INTELLIGENCE-INSTALLER.yml .github/workflows/ISSUE-INTELLIGENCE-INSTALLER.yml
   ```

2. Commit and push:

   ```bash
   git add .github/workflows/ISSUE-INTELLIGENCE-INSTALLER.yml
   git commit -m "chore: add ISSUE-INTELLIGENCE installer workflow"
   git push
   ```

3. To trigger it manually, go to **Actions → ISSUE-INTELLIGENCE Bootstrap → Run workflow** in your GitHub repository.

### 7) Start using the agent

Open a GitHub issue. The workflow picks it up and the agent responds in issue comments.

## Why this structure exists

Keeping installable assets in `install/` provides:

- a single source of truth for what gets installed,
- a predictable payload for distribution,
- easier auditing of installation-time files,
- simpler automation for future installers.
