# ❤️ Requires-Heart Gate

[← Back to Help](README.md)

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/japer-technology/github-intelligence/main/.github-intelligence/logo.png" alt="Issue Intelligence" width="400">
  </picture>
</p>

---

Optionally require a ❤️ (heart) reaction on newly opened issues before the agent processes them. This gives repository owners a manual approval step — the agent won't respond to a new issue until someone explicitly hearts it.

## How It Works

When the requires-heart gate is **active**:

1. A new issue is opened
2. The Guard step checks for a ❤️ reaction on the issue
3. If no heart reaction is found, the workflow exits — the agent does **not** process the issue
4. If a heart reaction **is** found, the agent proceeds normally

```
New issue opened
    → Guard checks for github-intelligence-HEART-REQUIRED.md file
    → File found → checks issue for ❤️ reaction
    → No ❤️ → workflow exits (issue is skipped)
    → ❤️ found → agent processes the issue
```

> **Important:** The requires-heart gate only applies to **newly opened issues** (`issues` event). Follow-up comments (`issue_comment`) are **always processed**, so approved conversations can continue uninterrupted.

## Enable the Requires-Heart Gate

Create the file `github-intelligence-HEART-REQUIRED.md` in the `.github-intelligence/` directory:

```bash
touch .github-intelligence/github-intelligence-HEART-REQUIRED.md
git add .github-intelligence/github-intelligence-HEART-REQUIRED.md
git commit -m "Enable requires-heart gate"
git push
```

The file's contents don't matter — only its presence is checked.

## Disable the Requires-Heart Gate

Remove the `github-intelligence-HEART-REQUIRED.md` file from the `.github-intelligence/` directory:

```bash
rm .github-intelligence/github-intelligence-HEART-REQUIRED.md
git add -A
git commit -m "Disable requires-heart gate"
git push
```

## Approving an Issue

Once the gate is active, approve an issue by adding a ❤️ reaction:

1. Go to the issue on GitHub
2. Click the emoji reaction button (🙂) at the top of the issue
3. Select the ❤️ (heart) reaction
4. Re-trigger the workflow — either close and re-open the issue, or manually re-run the failed workflow from the **Actions** tab

The agent will detect the heart reaction and process the issue.

## Security Model

The requires-heart gate follows the same **fail-closed** principle as the rest of Issue Intelligence:

- If the `gh` API call to check reactions fails, the workflow exits (fails closed)
- If there is no heart reaction, the workflow exits
- Only when a heart reaction is explicitly confirmed does the agent proceed

This prevents unreviewed issues from being processed when the gate is active.

## When to Use It

| Scenario | Recommended |
|----------|-------------|
| Public repo with many external contributors | ✅ Prevents the agent from responding to every new issue |
| Private repo with trusted team | ❌ Adds friction without much benefit |
| Repos with high issue volume | ✅ Lets you control which issues get agent attention |
| Testing and development | ❌ Easier to work without the extra approval step |

## See Also

- [▶️ Enable](enable.md) — enable or disable the agent entirely
- [⏸️ Disable](disable.md) — temporarily stop the agent
- [💬 Issues Management](issues-management.md) — how conversations work
- [⚙️ Configure](configure.md) — customize agent behavior
