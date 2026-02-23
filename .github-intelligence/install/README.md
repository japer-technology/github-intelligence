# .github-intelligence 🦞 Install

### These files are installed by github-intelligence-INSTALLER.yml

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/japer-technology/github-intelligence/main/.github-intelligence/logo.png" alt="Issue Intelligence" width="500">
  </picture>
</p>

The `install/` directory contains the **installable payload** for `.github-intelligence`

Everything in this folder is intentionally flat (no nested subfolders) so it can be copied, vendored, or inspected quickly.

## Files in this folder

- `github-intelligence-INSTALLER.ts` — one-time installer script.
- `github-intelligence-WORKFLOW-AGENT.yml` — GitHub Actions workflow template copied to `.github/workflows/github-intelligence-WORKFLOW-AGENT.yml`.
- `github-intelligence-TEMPLATE-HATCH.md` — issue template copied to `.github/ISSUE_TEMPLATE/hatch.md`.
- `github-intelligence-AGENTS.md` — default agent identity/instructions copied to `.github-intelligence/AGENTS.md`.
- `package.json` and `package-lock.json` — runtime dependencies for the scripts under `.github-intelligence/`.

## Install process (step-by-step)

### 1) Place `.github-intelligence` at your repository root

The expected layout is:

```text
<repo>/
  .github-intelligence/
    install/
      github-intelligence-INSTALLER.ts
      github-intelligence-WORKFLOW-AGENT.yml
      github-intelligence-TEMPLATE-HATCH.md
      github-intelligence-AGENTS.md
      package.json
      package-lock.json
    lifecycle/
      github-intelligence-AGENT.ts
      github-intelligence-INDICATOR.ts
      github-intelligence-ENABLED.ts
```

### 2) Run the installer

From the repository root:

```bash
bun .github-intelligence/install/github-intelligence-INSTALLER.ts
```

The installer is **non-destructive**:

- If a destination file already exists, it skips it.
- If a destination file is missing, it installs it.

### 3) What `github-intelligence-INSTALLER.ts` installs

The script installs the following resources:

1. `.github-intelligence/install/github-intelligence-WORKFLOW-AGENT.yml` → `.github/workflows/github-intelligence-WORKFLOW-AGENT.yml`
2. `.github-intelligence/install/github-intelligence-TEMPLATE-HATCH.md` → `.github/ISSUE_TEMPLATE/hatch.md`
3. `.github-intelligence/install/github-intelligence-AGENTS.md` → `.github-intelligence/AGENTS.md`
4. Ensures `.gitattributes` contains:

```text
memory.log merge=union
```

That merge rule keeps the memory log append-only merge behavior safe when multiple branches update it.

### 4) Install dependencies

```bash
cd .github-intelligence
bun install
```

### 5) Configure secrets and push

1. Add `ANTHROPIC_API_KEY` in: **Repository Settings → Secrets and variables → Actions**.
2. Commit the new/installed files.
3. Push to GitHub.

### 6) (Optional) Enable the automated installer workflow

`github-intelligence-INSTALLER.yml` is a reusable GitHub Actions workflow that bootstraps issue-intelligence automatically whenever changes to `.github-intelligence/**` are pushed, or on demand via `workflow_dispatch`.

To activate it:

1. Copy `.github-intelligence/github-intelligence-INSTALLER.yml` into your `.github/workflows/` folder:

   ```bash
   cp .github-intelligence/github-intelligence-INSTALLER.yml .github/workflows/github-intelligence-INSTALLER.yml
   ```

2. Commit and push:

   ```bash
   git add .github/workflows/github-intelligence-INSTALLER.yml
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
