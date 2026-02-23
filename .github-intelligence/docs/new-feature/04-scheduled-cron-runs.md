# Feature: Scheduled Cron Runs (Proactive Agent)

## Summary

Add a `schedule` trigger to the GitClaw workflow so the agent can perform periodic, autonomous tasks — weekly triage of stale/unlabeled issues, dependency freshness checks, documentation drift detection, and repo health reports. The agent opens a new issue with its findings, making all proactive work visible and discussable. This transforms GitClaw from a purely reactive assistant into a proactive team member.

## Why This Feature

1. **Opens an entirely new interaction model.** Today, GitClaw only acts when a human asks. Scheduled runs let the agent surface problems nobody thought to ask about — stale issues accumulating, dependencies falling behind, docs diverging from code. This is the difference between a tool and a teammate.

2. **It's the highest-value lowest-effort workflow expansion.** The agent pipeline already works end-to-end: run `pi` with a prompt, commit state, post output. A scheduled run is just a new trigger that supplies a prompt from configuration instead of from a human comment. The entire execution pipeline is reused unchanged.

3. **It makes GitClaw valuable even when no one is actively using it.** A repo can go weeks without anyone opening an issue. Scheduled runs mean the agent is still working — catching rot, tracking drift, maintaining hygiene. This turns GitClaw from "use it when you remember" to "always on."

4. **It's the foundation for Phase 2 triage.** The roadmap calls for auto-labeling, milestone tracking, and project board sync. All of these are naturally scheduled tasks. Building the cron infrastructure now unlocks the entire triage phase.

5. **GitHub Actions cron is free and reliable.** No external scheduler needed. The workflow file gains one `schedule:` block and everything else works.

## Scope

### In Scope
- Add `schedule` trigger with configurable cron expression
- Add `workflow_dispatch` trigger for on-demand runs of the same tasks
- New configuration file `.GITCLAW/scheduled-tasks.json` defining what the agent does on each run
- Agent opens a new issue with its report/findings (not a comment on an existing issue)
- Built-in task types: `triage` (stale/unlabeled issues), `health` (repo overview), `custom` (user-defined prompt)
- Each scheduled run creates its own session (no session reuse — each report is standalone)
- Task results are labeled with `gitclaw:scheduled` for easy filtering

### Out of Scope
- Multiple cron schedules for different tasks (single schedule, runs all configured tasks)
- Scheduled PR creation or auto-merging
- External webhook triggers (Phase 5 `repository_dispatch`)
- Cost budgets per scheduled run

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Workflow file** (`GITCLAW-WORKFLOW-AGENT.yml`) | Add `schedule` and `workflow_dispatch` triggers, handle missing issue context | ~45 min |
| **Task configuration** (new `scheduled-tasks.json`) | Define schema for task list, prompts, and labels | ~30 min |
| **Agent orchestrator** (`GITCLAW-AGENT.ts`) | New code path for schedule events: load tasks, create issue, run agent, post results | ~2.5 hours |
| **Built-in task prompts** | Craft effective prompts for triage, health, and custom task types | ~1 hour |
| **Label management** | Create `gitclaw:scheduled` label if it doesn't exist | ~15 min |
| **Docs** | Update README, add scheduled tasks reference doc | ~30 min |
| **Testing** | Trigger via `workflow_dispatch`, verify issue creation, verify report quality | ~1 hour |

**Total: ~6–7 hours of focused work.**

---

## AI Implementation Instructions

### Step 1: Create the task configuration file

**New file:** `.GITCLAW/scheduled-tasks.json`

```json
{
  "schedule": "0 9 * * 1",
  "tasks": [
    {
      "id": "triage",
      "title": "Weekly Issue Triage",
      "enabled": true,
      "prompt": "Perform a weekly triage of this repository's issues. Use `gh issue list` to fetch all open issues. Report:\n\n1. **Stale issues** — open issues with no activity in the last 14 days\n2. **Unlabeled issues** — open issues with no labels\n3. **Unassigned issues** — open issues with no assignee\n4. **Issue count trends** — total open vs closed\n\nFormat as a clear markdown report with actionable recommendations."
    },
    {
      "id": "health",
      "title": "Repository Health Check",
      "enabled": false,
      "prompt": "Perform a repository health check. Analyze:\n\n1. **Documentation** — Is the README up to date? Are there stale docs?\n2. **Dependencies** — Read package.json/requirements.txt/go.mod and note any obviously old dependencies\n3. **Code hygiene** — Any TODO/FIXME/HACK comments? Large files? Dead code signals?\n4. **CI/CD** — Are workflows passing? Any workflow files that look misconfigured?\n\nFormat as a concise health report with a severity rating for each finding."
    },
    {
      "id": "custom",
      "title": "Custom Scheduled Task",
      "enabled": false,
      "prompt": "Replace this with your own scheduled task prompt."
    }
  ]
}
```

**Schema rules:**
- `schedule`: A cron expression (GitHub Actions format). This is the source of truth — the workflow file references it but the agent reads it too for reporting.
- `tasks`: Array of task objects. Each has `id`, `title`, `enabled`, and `prompt`.
- Only tasks with `enabled: true` run on each schedule trigger.
- The `prompt` field is passed directly to `pi` as the user message.

### Step 2: Extend the workflow file

**File:** `.github/workflows/GITCLAW-WORKFLOW-AGENT.yml` and `.GITCLAW/install/GITCLAW-WORKFLOW-AGENT.yml`

Add to the `on:` block:

```yaml
on:
  issues:
    types: [opened]
  issue_comment:
    types: [created]
  schedule:
    - cron: '0 9 * * 1'    # Weekly Monday 9am UTC — sync with scheduled-tasks.json
  workflow_dispatch:
    inputs:
      task:
        description: 'Task ID to run (from scheduled-tasks.json), or "all" for all enabled tasks'
        required: false
        default: 'all'
```

Update the `if:` condition on the job. The current condition filters on `issues` and `issue_comment` events. For `schedule` and `workflow_dispatch`, there is no actor/comment to filter — the job should always run:

```yaml
if: >-
  (github.event_name == 'schedule')
  || (github.event_name == 'workflow_dispatch')
  || (github.event_name == 'issues')
  || (github.event_name == 'issue_comment' && github.event.comment.user.login != 'github-actions[bot]')
```

Update the Authorize step to skip authorization for `schedule` and `workflow_dispatch` events (they are trusted — only repo admins can configure schedules or trigger dispatches):

```yaml
- name: Authorize
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    if [[ "${{ github.event_name }}" == "schedule" || "${{ github.event_name }}" == "workflow_dispatch" ]]; then
      echo "Scheduled/dispatch run — authorization not required"
      exit 0
    fi
    PERM=$(gh api "repos/${{ github.repository }}/collaborators/${{ github.actor }}/permission" --jq '.permission' 2>/dev/null || echo "none")
    echo "Actor: ${{ github.actor }}, Permission: $PERM"
    if [[ "$PERM" != "admin" && "$PERM" != "maintain" && "$PERM" != "write" ]]; then
      echo "::error::Unauthorized: ${{ github.actor }} has '$PERM' permission"
      exit 1
    fi
```

Update the Preinstall (indicator) step to skip for schedule/dispatch events (there's no issue to react to yet):

```yaml
- name: Preinstall
  if: github.event_name != 'schedule' && github.event_name != 'workflow_dispatch'
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: bun .GITCLAW/lifecycle/GITCLAW-INDICATOR.ts
```

### Step 3: Extend the agent orchestrator for scheduled events

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts`

Add a new code path at the top of the `try` block, before the existing issue-handling logic:

```typescript
if (eventName === "schedule" || eventName === "workflow_dispatch") {
  await runScheduledTasks();
  // Exit early — scheduled runs don't go through the issue-comment pipeline
} else {
  // ... existing issue/comment handling code ...
}
```

**Implement `runScheduledTasks()`:**

```typescript
async function runScheduledTasks(): Promise<void> {
  // 1. Load task configuration
  const tasksConfigPath = resolve(gitclawDir, "scheduled-tasks.json");
  if (!existsSync(tasksConfigPath)) {
    console.log("No scheduled-tasks.json found, skipping scheduled run");
    return;
  }
  const config = JSON.parse(readFileSync(tasksConfigPath, "utf-8"));

  // 2. Determine which tasks to run
  let tasksToRun = config.tasks.filter((t: any) => t.enabled);

  // For workflow_dispatch, filter by the input task ID if provided
  if (eventName === "workflow_dispatch") {
    const requestedTask = process.env.INPUT_TASK || "all";  // GitHub sets INPUT_<name> for dispatch inputs
    if (requestedTask !== "all") {
      tasksToRun = tasksToRun.filter((t: any) => t.id === requestedTask);
      if (tasksToRun.length === 0) {
        console.error(`Task "${requestedTask}" not found or not enabled`);
        return;
      }
    }
  }

  if (tasksToRun.length === 0) {
    console.log("No enabled tasks to run");
    return;
  }

  // 3. Ensure the gitclaw:scheduled label exists
  try {
    await gh("label", "create", "gitclaw:scheduled",
      "--description", "Automated report from GitClaw scheduled tasks",
      "--color", "0E8A16",
      "--force");
  } catch (e) {
    console.log("Label already exists or creation failed:", e);
  }

  // 4. Configure git identity (same as existing code)
  await run(["git", "config", "user.name", "gitclaw[bot]"]);
  await run(["git", "config", "user.email", "gitclaw[bot]@users.noreply.github.com"]);

  // 5. Run each task sequentially
  for (const task of tasksToRun) {
    console.log(`\n=== Running scheduled task: ${task.id} (${task.title}) ===\n`);

    // Create a new issue for this task's report
    const today = new Date().toISOString().split("T")[0];
    const issueTitle = `${task.title} — ${today}`;

    const { stdout: issueUrl } = await run([
      "gh", "issue", "create",
      "--title", issueTitle,
      "--body", `_🕐 Scheduled task \`${task.id}\` started at ${new Date().toISOString()}_\n\n_Report will appear as a comment shortly..._`,
      "--label", "gitclaw:scheduled",
    ]);

    // Extract issue number from the URL (format: https://github.com/owner/repo/issues/123)
    const createdIssueNumber = parseInt(issueUrl.trim().split("/").pop() || "0");
    if (!createdIssueNumber) {
      console.error("Failed to create issue for scheduled task:", task.id);
      continue;
    }

    console.log(`Created issue #${createdIssueNumber} for task ${task.id}`);

    // Ensure state directories exist
    mkdirSync(issuesDir, { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });

    // Run the pi agent with the task's prompt
    const piBin = resolve(gitclawDir, "node_modules", ".bin", "pi");
    const piArgs = [
      piBin,
      "--mode", "json",
      "--provider", configuredProvider,
      "--model", configuredModel,
      "--session-dir", sessionsDirRelative,
      "-p", task.prompt,
    ];

    const pi = Bun.spawn(piArgs, { stdout: "pipe", stderr: "inherit" });
    const tee = Bun.spawn(["tee", "/tmp/agent-raw.jsonl"], { stdin: pi.stdout, stdout: "inherit" });
    await tee.exited;
    await pi.exited;

    // Extract agent text (same jq pipeline as existing code)
    const tac = Bun.spawn(["tac", "/tmp/agent-raw.jsonl"], { stdout: "pipe" });
    const jq = Bun.spawn(
      ["jq", "-r", "-s",
        '[ .[] | select(.type == "message_end" and .message.role == "assistant") | select((.message.content // []) | map(select(.type == "text")) | length > 0) ] | .[0].message.content[] | select(.type == "text") | .text'],
      { stdin: tac.stdout, stdout: "pipe" }
    );
    const agentText = await new Response(jq.stdout).text();
    await jq.exited;

    // Save session mapping for the created issue
    const { stdout: latestSession } = await run([
      "bash", "-c", `ls -t ${sessionsDirRelative}/*.jsonl 2>/dev/null | head -1`,
    ]);
    if (latestSession) {
      const mappingFile = resolve(issuesDir, `${createdIssueNumber}.json`);
      writeFileSync(mappingFile, JSON.stringify({
        issueNumber: createdIssueNumber,
        sessionPath: latestSession,
        updatedAt: new Date().toISOString(),
        scheduledTask: task.id,
      }, null, 2) + "\n");
    }

    // Post the report as a comment on the created issue
    const trimmedText = agentText.trim();
    const commentBody = trimmedText.length > 0
      ? trimmedText.slice(0, 60000)
      : `✅ Scheduled task \`${task.id}\` completed but produced no text output. Check the repo for any file changes.`;
    await gh("issue", "comment", String(createdIssueNumber), "--body", commentBody);
  }

  // 6. Commit and push all state changes
  await run(["git", "add", "-A"]);
  const { exitCode } = await run(["git", "diff", "--cached", "--quiet"]);
  if (exitCode !== 0) {
    await run(["git", "commit", "-m", "gitclaw: scheduled tasks run"]);
  }

  for (let i = 1; i <= 3; i++) {
    const push = await run(["git", "push", "origin", `HEAD:${defaultBranch}`]);
    if (push.exitCode === 0) break;
    console.log(`Push failed, rebasing and retrying (${i}/3)...`);
    await run(["git", "pull", "--rebase", "origin", defaultBranch]);
  }
}
```

**Important:** The `workflow_dispatch` input needs to be accessible. In GitHub Actions, dispatch inputs are available via the event payload. Read it from the event JSON:

```typescript
// At the top, when parsing the event:
const dispatchTaskInput = event.inputs?.task || "all";
```

Then use `dispatchTaskInput` instead of `process.env.INPUT_TASK` in the filter.

### Step 4: Handle the reaction cleanup for scheduled events

In the `finally` block, the reaction cleanup should be skipped for schedule/dispatch events since no reaction was created:

```typescript
finally {
  if (eventName !== "schedule" && eventName !== "workflow_dispatch" && reactionState?.reactionId) {
    // ... existing reaction cleanup ...
  }
}
```

Or more cleanly: the `reactionState` will already be `null` because the indicator script was skipped, so the existing `if (reactionState?.reactionId)` guard already handles this. Verify this is the case and add a comment noting it.

### Step 5: Update documentation

**New file:** `.GITCLAW/docs/GITCLAW-Scheduled-Tasks.md`

Document:
- How to configure `scheduled-tasks.json`
- Available built-in task types and their prompts
- How to write custom task prompts
- How to change the cron schedule
- How to trigger tasks manually via `workflow_dispatch`
- How to find scheduled reports (filter by `gitclaw:scheduled` label)
- Cost considerations (each task is a full agent run)

**File:** `.GITCLAW/README.md`
- Add a "Scheduled Tasks" section after "How It Works"
- Mention the `schedule` and `workflow_dispatch` triggers
- Link to the scheduled tasks doc

**File:** `.GITCLAW/docs/GITCLAW-Roadmap.md`
- Note that scheduled runs (from Phase 2 / Possibilities doc section 4.2) are implemented

### Step 6: Test

- Trigger via `workflow_dispatch` with `task: triage`:
  1. Verify a new issue is created with the triage report title and `gitclaw:scheduled` label
  2. Verify the agent runs and posts a triage report as a comment
  3. Verify session state is committed
- Trigger via `workflow_dispatch` with `task: all`:
  1. Verify issues are created for each enabled task
- Comment on a scheduled report issue:
  1. Verify the agent resumes the session (session mapping was saved)
  2. Verify follow-up conversation works normally
- Trigger via `workflow_dispatch` with a non-existent task ID:
  1. Verify graceful handling (log message, no crash)
- Verify the `schedule` cron syntax is valid by checking the Actions tab shows the next scheduled run
