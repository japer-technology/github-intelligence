# Feature: Interactive Approval Gates

## Summary

Before making high-risk changes, the agent pauses its execution, posts a structured approval request describing exactly what it intends to do, and waits for explicit human approval before proceeding. The approval request includes a risk assessment, a preview of planned changes, and an approve/reject mechanism via reactions or comments. This is fundamentally different from guardrails (which block silently after the fact) — approval gates create a **dialogue about risk** before the action happens. The agent proposes; the human decides; the agent executes or stands down.

## Why This Feature — The Deep Reasoning

### 1. Guardrails Are Necessary but Insufficient

Guardrails (feature 16) enforce hard boundaries: the agent *cannot* modify workflow files, *cannot* touch protected paths. But between "obviously safe" (editing a README) and "obviously dangerous" (modifying the workflow) lies a vast gray zone:
- Refactoring a core module that 15 other files depend on
- Deleting files that might still be referenced elsewhere
- Changing configuration that affects production behavior
- Modifying shared types or interfaces
- Creating database migrations

These actions aren't forbidden — they *should* happen. But they should happen with human awareness and approval, not as a surprise in a commit.

### 2. The Current Model Is "Do First, Explain Later"

Today, the agent executes, commits, and pushes — then posts a comment explaining what it did. The human reviews *after the fact*. For low-risk actions (answering questions, writing documentation), this is fine. For high-risk actions (refactoring core code, modifying CI, changing dependencies), the human should review *before the action*, not after.

The approval gate inverts the flow:
```
Current:    Execute → Commit → Push → Explain
With gates: Analyze → Propose → Wait → Approve → Execute → Commit → Push → Confirm
```

### 3. It Bridges the Trust Gap for Team Adoption

The #1 blocker for team adoption of AI agents is trust. "What if it breaks something?" Approval gates provide a concrete answer: "It will ask you before doing anything risky." This lets teams start with tight gates (approve everything) and gradually loosen them as trust builds (only approve high-risk actions, then only approve critical ones).

### 4. Approval State Must Survive Across Workflow Runs

This is the architectural challenge that makes this feature deep. GitHub Actions workflow runs are stateless — each run is a fresh container. An approval gate needs to:
1. Run A: Agent analyzes the request, determines it needs approval, posts the request, and exits.
2. Human reviews and approves (via reaction or comment).
3. Run B: Agent detects the approval, loads the saved execution plan, and continues.

This requires persisting the execution plan in git state, then resuming from it. The agent needs a concept of "pending" work that bridges workflow runs.

### 5. It Composes With Every Risk-Bearing Feature

| Feature | Approval Gate Integration |
|---|---|
| **Branch-per-Task (07)** | Gate before creating a PR that modifies critical paths |
| **Guided Workflows (12)** | Gate before executing destructive workflow steps |
| **Health Scanning (19)** | Gate before auto-fixing findings |
| **Personas (10)** | Different personas have different gate thresholds |
| **Event Bridge (13)** | Gate before responding to external events with code changes |
| **Undo (11)** | Gates reduce the need for undo — prevention > cure |

## Scope

### In Scope
- **Risk assessment engine**: Classify pending actions by risk level (low/medium/high/critical)
- **Approval request format**: Structured comment with risk level, planned changes, file list, and impact analysis
- **Approval mechanisms**: Reaction-based (👍 to approve, 👎 to reject) and comment-based (`/approve`, `/reject`)
- **Cross-run state**: Persist pending approval plans in `state/approvals/`
- **Approval detection**: On next workflow run, check if pending approvals have been granted
- **Risk rules**: Configurable rules for what triggers an approval gate
- **Auto-approve for low risk**: Configurable threshold below which changes proceed automatically
- **Timeout**: Approvals expire after a configurable period

### Out of Scope
- Multi-approver requirements (single approval is sufficient)
- GitHub environment-based approval (that's a different mechanism)
- Cryptographic verification of approver identity (trust GitHub's auth)
- Approval for non-code actions (questions, analysis — only code/config changes)

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Risk assessment engine** | Classify actions by risk based on file paths, scope, impact | ~2.5 hours |
| **Approval request formatter** | Generate structured approval comments | ~1 hour |
| **Cross-run state** | Persist/load approval plans in `state/approvals/` | ~1.5 hours |
| **Approval detection** | Check reactions/comments for approval signals | ~1.5 hours |
| **Agent orchestrator integration** | Insert approval gate into the execution pipeline | ~2 hours |
| **Risk rules configuration** | `approvals.json` with configurable thresholds | ~30 min |
| **Timeout handling** | Expire stale approvals | ~30 min |
| **Docs** | Document approval system | ~30 min |
| **Testing** | Test risk assessment, approval flow, cross-run state | ~2 hours |

**Total: ~12 hours.**

---

## AI Implementation Instructions

### Step 1: Risk assessment engine

**New file:** `.GITCLAW/lifecycle/GITCLAW-APPROVALS.ts`

```typescript
export type RiskLevel = "low" | "medium" | "high" | "critical";

export interface RiskAssessment {
  level: RiskLevel;
  score: number;              // 0-100
  factors: RiskFactor[];
  requiresApproval: boolean;
  summary: string;
}

export interface RiskFactor {
  name: string;
  weight: number;             // contribution to total score
  detail: string;
}

export function assessRisk(
  changedFiles: string[],
  deletedFiles: string[],
  config: ApprovalConfig
): RiskAssessment {
  const factors: RiskFactor[] = [];
  let score = 0;
  
  // Factor 1: Number of files changed
  const fileCount = changedFiles.length;
  if (fileCount > 10) {
    const weight = Math.min(20, fileCount * 2);
    factors.push({ name: "large-changeset", weight, detail: `${fileCount} files modified` });
    score += weight;
  }
  
  // Factor 2: File deletions
  if (deletedFiles.length > 0) {
    const weight = deletedFiles.length * 10;
    factors.push({ name: "file-deletions", weight: Math.min(30, weight), detail: `${deletedFiles.length} file(s) deleted` });
    score += Math.min(30, weight);
  }
  
  // Factor 3: Critical path modifications
  const criticalPaths = config.criticalPaths || [
    "package.json", "tsconfig.json", "Cargo.toml", "go.mod",
    "Dockerfile", "docker-compose.yml",
    ".env*", "*.config.js", "*.config.ts",
    "migrations/", "schema/", "prisma/",
  ];
  
  const criticalChanges = changedFiles.filter(f =>
    criticalPaths.some(p => matchGlob(f, p))
  );
  if (criticalChanges.length > 0) {
    factors.push({
      name: "critical-paths",
      weight: 25,
      detail: `Modified critical files: ${criticalChanges.join(", ")}`,
    });
    score += 25;
  }
  
  // Factor 4: Broad impact (files in many different directories)
  const dirs = new Set(changedFiles.map(f => f.split("/").slice(0, -1).join("/")));
  if (dirs.size > 5) {
    factors.push({ name: "broad-impact", weight: 15, detail: `Changes span ${dirs.size} directories` });
    score += 15;
  }
  
  // Factor 5: Infrastructure/CI files
  const infraChanges = changedFiles.filter(f =>
    f.startsWith(".github/") || f.startsWith("infrastructure/") ||
    f.startsWith("terraform/") || f.startsWith("k8s/") ||
    f.includes("Makefile") || f.includes("Dockerfile")
  );
  if (infraChanges.length > 0) {
    factors.push({ name: "infrastructure", weight: 30, detail: `Infrastructure files: ${infraChanges.join(", ")}` });
    score += 30;
  }
  
  // Factor 6: Dependency changes
  const depChanges = changedFiles.filter(f =>
    f.endsWith("package.json") || f.endsWith("Cargo.toml") ||
    f.endsWith("go.mod") || f.endsWith("requirements.txt") ||
    f.endsWith("pyproject.toml") || f.endsWith("Gemfile")
  );
  if (depChanges.length > 0) {
    factors.push({ name: "dependency-changes", weight: 20, detail: `Dependency files: ${depChanges.join(", ")}` });
    score += 20;
  }
  
  // Cap score at 100
  score = Math.min(100, score);
  
  // Determine risk level
  let level: RiskLevel;
  if (score >= 70) level = "critical";
  else if (score >= 40) level = "high";
  else if (score >= 15) level = "medium";
  else level = "low";
  
  // Check if approval is required
  const threshold = config.approvalThreshold || "high";
  const thresholdOrder: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  const requiresApproval = thresholdOrder[level] >= thresholdOrder[threshold];
  
  return {
    level,
    score,
    factors,
    requiresApproval,
    summary: `Risk: ${level} (${score}/100) — ${factors.map(f => f.name).join(", ")}`,
  };
}
```

### Step 2: Approval request format

```typescript
export interface ApprovalRequest {
  id: string;
  issueNumber: number;
  createdAt: string;
  expiresAt: string;
  riskAssessment: RiskAssessment;
  plannedChanges: { file: string; action: "create" | "modify" | "delete" }[];
  prompt: string;                  // the original user request
  commentId?: number;              // the approval comment's ID
  status: "pending" | "approved" | "rejected" | "expired";
  approvedBy?: string;
  approvedAt?: string;
}

export function formatApprovalRequest(request: ApprovalRequest): string {
  const riskIcon = { low: "🟢", medium: "🟡", high: "🟠", critical: "🔴" }[request.riskAssessment.level];
  
  return [
    `## ${riskIcon} Approval Required — Risk: ${request.riskAssessment.level.toUpperCase()} (${request.riskAssessment.score}/100)`,
    "",
    `I've analyzed your request and determined it requires approval before I proceed.`,
    "",
    `### Your Request`,
    `> ${request.prompt.slice(0, 300)}`,
    "",
    `### Risk Factors`,
    ...request.riskAssessment.factors.map(f =>
      `- **${f.name}** (+${f.weight}): ${f.detail}`
    ),
    "",
    `### Planned Changes`,
    "| Action | File |",
    "|---|---|",
    ...request.plannedChanges.slice(0, 20).map(c =>
      `| ${c.action === "delete" ? "🗑️ delete" : c.action === "create" ? "✨ create" : "📝 modify"} | \`${c.file}\` |`
    ),
    request.plannedChanges.length > 20 ? `\n_...and ${request.plannedChanges.length - 20} more files_` : "",
    "",
    `### How to Respond`,
    `- **Approve**: React with 👍 to this comment, or reply with \`/approve\``,
    `- **Reject**: React with 👎 to this comment, or reply with \`/reject\``,
    `- **Modify**: Reply with adjusted instructions and I'll re-analyze`,
    "",
    `⏰ _This approval request expires at ${request.expiresAt}._`,
    "",
    `---`,
    `_Approval ID: \`${request.id}\`_`,
  ].filter(Boolean).join("\n");
}
```

### Step 3: Cross-run state persistence

```typescript
export function saveApprovalRequest(stateDir: string, request: ApprovalRequest): void {
  const approvalsDir = resolve(stateDir, "approvals");
  mkdirSync(approvalsDir, { recursive: true });
  writeFileSync(
    resolve(approvalsDir, `${request.id}.json`),
    JSON.stringify(request, null, 2) + "\n"
  );
}

export function loadPendingApprovals(stateDir: string, issueNumber: number): ApprovalRequest[] {
  const approvalsDir = resolve(stateDir, "approvals");
  if (!existsSync(approvalsDir)) return [];
  
  return readdirSync(approvalsDir)
    .filter(f => f.endsWith(".json"))
    .map(f => JSON.parse(readFileSync(resolve(approvalsDir, f), "utf-8")))
    .filter((a: ApprovalRequest) =>
      a.issueNumber === issueNumber &&
      a.status === "pending" &&
      new Date(a.expiresAt) > new Date()
    );
}
```

### Step 4: Approval detection

```typescript
export async function checkApproval(
  request: ApprovalRequest,
  repo: string
): Promise<{ approved: boolean; rejected: boolean; by?: string }> {
  // Check reactions on the approval comment
  if (request.commentId) {
    const { stdout: reactions } = await run([
      "gh", "api", `repos/${repo}/issues/comments/${request.commentId}/reactions`,
      "--jq", `.[] | select(.user.login != "github-actions[bot]") | {content: .content, user: .user.login}`,
    ]);
    
    for (const line of reactions.trim().split("\n").filter(Boolean)) {
      try {
        const reaction = JSON.parse(line);
        if (reaction.content === "+1" || reaction.content === "rocket") {
          return { approved: true, rejected: false, by: reaction.user };
        }
        if (reaction.content === "-1") {
          return { approved: false, rejected: true, by: reaction.user };
        }
      } catch (e) { /* skip */ }
    }
  }
  
  // Check for /approve or /reject comments after the approval request
  const { stdout: comments } = await run([
    "gh", "api", `repos/${repo}/issues/${request.issueNumber}/comments`,
    "--jq", `.[] | select(.created_at > "${request.createdAt}") | select(.user.login != "github-actions[bot]") | {body: .body, user: .user.login}`,
  ]);
  
  for (const line of comments.trim().split("\n").filter(Boolean)) {
    try {
      const comment = JSON.parse(line);
      if (/^\s*\/approve\b/i.test(comment.body)) {
        return { approved: true, rejected: false, by: comment.user };
      }
      if (/^\s*\/reject\b/i.test(comment.body)) {
        return { approved: false, rejected: true, by: comment.user };
      }
    } catch (e) { /* skip */ }
  }
  
  return { approved: false, rejected: false };
}
```

### Step 5: Integrate into agent orchestrator

The critical flow in `GITCLAW-AGENT.ts`:

```typescript
import { assessRisk, loadPendingApprovals, checkApproval, saveApprovalRequest, formatApprovalRequest } from "./GITCLAW-APPROVALS";

// ── Check for pending approvals ──────────────────────────────────────────
const pendingApprovals = loadPendingApprovals(stateDir, issueNumber);

if (pendingApprovals.length > 0) {
  const pending = pendingApprovals[0]; // most recent
  const result = await checkApproval(pending, repo);
  
  if (result.approved) {
    console.log(`Approval ${pending.id} granted by ${result.by}. Proceeding...`);
    pending.status = "approved";
    pending.approvedBy = result.by;
    pending.approvedAt = new Date().toISOString();
    saveApprovalRequest(stateDir, pending);
    
    // Use the original prompt and continue with normal execution
    prompt = pending.prompt;
    // Fall through to normal agent execution
    
  } else if (result.rejected) {
    console.log(`Approval ${pending.id} rejected by ${result.by}.`);
    pending.status = "rejected";
    saveApprovalRequest(stateDir, pending);
    
    await gh("issue", "comment", String(issueNumber), "--body",
      `✋ Approval rejected by @${result.by}. I will not proceed with the planned changes.\n\n` +
      `If you'd like to try a different approach, post a new comment with modified instructions.`);
    return; // Exit without running the agent
    
  } else {
    // Still pending — don't run the agent, just remind
    console.log(`Approval ${pending.id} still pending.`);
    // Don't post a reminder on every comment — only if this is a new unrelated comment
    return;
  }
}

// ── Normal agent execution ───────────────────────────────────────────────
// ... run pi agent as normal ...

// ── Post-execution risk assessment ───────────────────────────────────────
// After agent runs, before commit, assess the risk of changes
const { stdout: stagedRaw } = await run(["git", "diff", "--cached", "--name-only"]);
const { stdout: deletedRaw } = await run(["git", "diff", "--cached", "--name-only", "--diff-filter=D"]);
const staged = stagedRaw.trim().split("\n").filter(Boolean);
const deleted = deletedRaw.trim().split("\n").filter(Boolean);

// Filter out state files — they never require approval
const codeChanges = staged.filter(f => !f.startsWith(".GITCLAW/state/"));

if (codeChanges.length > 0) {
  const config = loadApprovalConfig(gitclawDir);
  const risk = assessRisk(codeChanges, deleted, config);
  
  if (risk.requiresApproval) {
    console.log(`Risk assessment: ${risk.summary} — APPROVAL REQUIRED`);
    
    // Unstage all code changes (keep state changes)
    for (const file of codeChanges) {
      await run(["git", "checkout", "HEAD", "--", file]);
    }
    await run(["git", "reset", "HEAD"]);
    // Re-add only state files
    for (const file of staged.filter(f => f.startsWith(".GITCLAW/state/"))) {
      await run(["git", "add", file]);
    }
    
    // Create approval request
    const request: ApprovalRequest = {
      id: `apr-${issueNumber}-${Date.now()}`,
      issueNumber,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + (config.expiryHours || 48) * 3600 * 1000).toISOString(),
      riskAssessment: risk,
      plannedChanges: codeChanges.map(f => ({
        file: f,
        action: deleted.includes(f) ? "delete" as const : "modify" as const,
      })),
      prompt,
      status: "pending",
    };
    
    // Post approval request and capture comment ID
    const approvalBody = formatApprovalRequest(request);
    const { stdout: commentJson } = await run([
      "gh", "api", `repos/${repo}/issues/${issueNumber}/comments`,
      "-X", "POST", "-f", `body=${approvalBody}`,
      "--jq", ".id",
    ]);
    request.commentId = parseInt(commentJson.trim());
    
    saveApprovalRequest(stateDir, request);
    
    // Commit only state changes
    const { exitCode } = await run(["git", "diff", "--cached", "--quiet"]);
    if (exitCode !== 0) {
      await run(["git", "commit", "-m", `gitclaw: approval pending for issue #${issueNumber}`]);
    }
    
    // Don't post the normal agent response — the approval request IS the response
    return;
  }
}

// If risk is below threshold, continue with normal commit and response
```

### Step 6: Configuration

**New file:** `.GITCLAW/approvals.json`

```json
{
  "enabled": true,
  "approvalThreshold": "high",
  "expiryHours": 48,
  "criticalPaths": [
    "package.json", "tsconfig.json",
    "Dockerfile", "docker-compose.yml",
    "migrations/", "schema/",
    ".env*", "*.config.js"
  ],
  "alwaysApprove": [
    ".github/workflows/",
    "infrastructure/",
    "terraform/"
  ],
  "neverApprove": [
    "docs/", "*.md", ".GITCLAW/state/"
  ]
}
```

### Step 7: Test

- Ask the agent to modify `package.json` → verify approval gate triggers
- Approve via 👍 reaction → verify agent proceeds and commits
- Reject via `/reject` → verify agent stands down
- Ask the agent to edit a README → verify no gate (low risk)
- Let an approval expire → verify it's marked expired
- Verify state files (sessions) are committed even when code changes are gated

## Design Decisions

**Why post-execution gating instead of pre-execution analysis?** The agent needs to actually attempt the work to know what files it will change. Pre-execution analysis would require a separate "planning" LLM call. Post-execution assessment looks at the actual `git diff`, which is the ground truth. The code changes are staged but not committed — if gated, they're unstaged and the plan is preserved for after approval.

**Why reaction-based approval?** It's the lowest-friction approval mechanism. A 👍 reaction takes one click. For users reading via email, `/approve` as a comment reply works equally well. Both are detected on the next workflow trigger.

**Why expire approvals?** Context drifts. An approval granted 2 weeks ago for a refactoring plan may no longer be valid if the codebase has changed significantly. A 48-hour default expiry ensures approvals are fresh. The user can re-request if needed.

**Why separate from guardrails?** Guardrails are unconditional blocks — the agent *cannot* modify certain files regardless of context. Approval gates are conditional holds — the agent *can* modify those files, but only with human awareness. Guardrails protect critical infrastructure from any change. Gates protect the codebase from *unreviewed* high-impact changes. They operate on different risk levels and serve different purposes.
