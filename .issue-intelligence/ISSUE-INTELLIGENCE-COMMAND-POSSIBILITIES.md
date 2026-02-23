# GitHub Issue & Workflow Command Possibilities

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/japer-technology/blank-with-issue-intelligence/main/.issue-intelligence/ISSUE-INTELLIGENCE-LOGO.png" alt="Issue Intelligence" width="500">
  </picture>
</p>

### **1. Core Concepts: What Can Trigger Workflows**

GitHub Actions workflows are triggered by *events*. For working with issues and comments, the big ones are:

✔️ **issues** — issue opened, edited, closed, labeled, assigned, etc.

✔️ **issue_comment** — comment created, edited, or deleted

✔️ **pull_request / pull_request_review** — related PR events

✔️ **workflow_dispatch** — manual trigger

✔️ **schedule** — cron scheduled runs

Example triggers:

```yaml
on:
  issues:
    types: [opened, labeled, closed]
  issue_comment:
    types: [created, edited]
```

You can combine events and filter by types for precise automation. ([GitHub Docs][1])

---

### **2. Issue‐Driven Workflow Patterns**

These patterns help you automate based on activity in the issue tracker.

#### **Label Based Triggers**

Most reliable way to start a workflow from activity on an issue.

```yaml
on:
  issues:
    types: [labeled]
```

Then inside the job:

```yaml
if: github.event.label.name == 'deploy'
```

Use meaningful labels like `bug`, `feature`, `deploy`, `triaged` etc. ([GitHub Docs][1])

Common label use cases:

* `bug`, `enhancement`, `question`
* `needs review`, `in progress`, `help wanted`
* Custom labels triggering AI triage or bots

---

#### **Comment Command Triggers**

Make bots respond to “slash commands” (like `/deploy`) in issue comments:

```yaml
on:
  issue_comment:
    types: [created]
jobs:
  run:
    if: contains(github.event.comment.body, '/deploy')
```

Great for chat-ops style workflows. ([GitHub Docs][1])

---

#### **Triggered Actions After a Label Added**

Example: automatically post a comment when someone applies a label:

```yaml
name: Label Commenter
on:
  issues:
    types: [labeled]

jobs:
  comment:
    if: github.event.label.name == 'help wanted'
    run: gh issue comment ${{ github.event.issue.number }} --body "We’d love help �"
```

Useful for onboarding contributors or encouraging action. ([GitHub Docs][2])

---

### **3. Automated Issue Triage & Templates**

Boost quality & consistency with:

* **Issue Templates** → standardize bug reports, feature requests
* **Default Labels** on templates → seeds workflows
* **AI Triage Bot** → classify issues using ML + label
  (e.g., bug vs enhancement) to trigger different workflows. ([NamasteDev][3])

Tip: Pre-assign labels based on issue body or title using rules or bots.

---

### **4. Workflow Tips & Best Practices**

#### Structure

* Put workflows in `.github/workflows/`
* Name them clearly: `issue-triage.yml`, `comment-bot.yml`

#### Context & Conditions

Use `github.event` context to get data:

* `github.event.issue.title`, `.body`
* `github.event.comment.body`, `.user.login`
* `github.event.label.name`

#### Permissions

When your workflow modifies issues (comment, label, close), grant permission:

```yaml
permissions:
  issues: write
```

---

### **5. Workflow Triggers — Quick Reference**

| Trigger                 | Action            | Typical Use                      |
| ----------------------- | ----------------- | -------------------------------- |
| `issues.opened`         | New issue created | Auto-tag, bot reply, triage      |
| `issues.labeled`        | Label added       | Trigger review/test/deploy flows |
| `issues.closed`         | Issue closed      | Cleanup, notification            |
| `issue_comment.created` | Comment added     | Slash commands                   |
| `workflow_dispatch`     | Manual            | Run on demand                    |
| `schedule`              | Cron              | Periodic cleanup or rebase       |

Learn all events + activity types in the official workflow syntax docs. ([GitHub Docs][1])

---

### **6. Patterns for AI & Bots**

#### AI Triage Bot

Use issue body → AI → categorize → add label → trigger workflows
(Status: *work in progress for many teams, popular pattern*)

#### Stale Issue Cleanup

Schedule workflow to close “no activity” issues:

```yaml
on:
  schedule:
    - cron: '0 0 * * *'  # daily
```

---

### Bonus Tips

✔ Consistently use issue templates + labels to standardize data
✔ Use conditional job filters (`if:`) inside workflows to reduce runs
✔ Consider reusable workflows to avoid YAML duplication

---

[1]: https://docs.github.com/actions/using-workflows/events-that-trigger-workflows?utm_source=chatgpt.com "Events that trigger workflows"
[2]: https://docs.github.com/actions/tutorials/project-management/commenting-on-an-issue-when-a-label-is-added?utm_source=chatgpt.com "Commenting on an issue when a label is added"
[3]: https://namastedev.com/blog/using-github-issue-templates-and-labels-for-effective-project-management/?utm_source=chatgpt.com "Using GitHub Issue Templates and Labels for Effective ..."
