# Feature: Issue Lifecycle Intelligence

## Summary

The agent actively manages the issue it's working on — not just the conversation, but the issue itself as a GitHub object. It auto-labels issues based on content analysis (bug, feature, question, docs, refactor), updates the issue title when the topic drifts from the original, links related issues it discovers during research, adds task list checkboxes that track multi-step work, sets milestones for long-running tasks, closes issues when work is complete (with a closing summary), and reopens when new activity suggests unfinished business. The issue thread transforms from a passive container for comments into an actively managed work item that always reflects the current state of the conversation.

## Why This Feature — The Deep Reasoning

### 1. Issues Are GitHub's Unit of Work — But the Agent Treats Them as Chat Rooms

Today, an issue starts with a title and body. The agent responds. The user replies. More responses. By turn 15, the title says "Help with auth module" but the conversation has moved to database migration. The labels say nothing (no labels were added). There are no task lists. The issue is open but the original question was answered 10 turns ago. Related issues were mentioned in comments but never linked.

The issue is technically active but informationally stale. Anyone looking at the issue list sees outdated titles, missing labels, and no way to tell which issues are actually in progress vs. answered vs. abandoned.

### 2. Issue Metadata Is a Communication Channel

The issue list is a dashboard. Product managers scan titles and labels to understand project status. Engineers filter by label to find relevant work. Milestones show release progress. Task lists show completion percentage.

None of this works if the metadata is wrong. And it's usually wrong because nobody maintains it — maintaining issue metadata is tedious administrative work that developers deprioritize. The agent can do it automatically, on every turn, at zero human cost.

### 3. Every Label, Title Update, and Link Is a Searchable Artifact

When the agent adds a `bug` label, that issue appears in `label:bug` searches forever. When it links issue #42 to #85, GitHub shows the relationship on both issues. When it updates the title, the new title appears in search results, email notifications, and project boards. Each metadata change is a permanent improvement to the repository's information architecture.

### 4. Auto-Closing Is the Most Neglected Issue Hygiene Problem

GitHub repos accumulate zombie issues: questions that were answered but never closed, feature requests that were implemented but never resolved, discussions that reached consensus but were abandoned. The issue count grows unboundedly, making the issue tracker less useful over time.

The agent knows when work is done — it just completed it. It can close the issue with a structured summary: what was asked, what was done, and what the outcome was. This is the most natural point to close: immediately after the work, while the context is fresh.

### 5. It Composes With Every Issue-Oriented Feature

| Feature | Issue Lifecycle Enhancement |
|---|---|
| **Slash Commands (02)** | `/close` command with auto-summary |
| **Health Scanning (19)** | Auto-label health findings by category |
| **Approval Gates (21)** | Label issues as `pending-approval` during gate |
| **Personas (10)** | Different personas apply different label schemes |
| **Guided Workflows (12)** | Workflow steps become task list checkboxes |
| **Cross-Issue Context (08)** | Auto-link related issues found during search |
| **Notification Intelligence (20)** | Label changes trigger subscriber notifications (§23) |
| **Dashboard (14)** | Accurate labels enable accurate dashboard metrics |

## Scope

### In Scope
- **Auto-labeling**: Analyze issue content and apply relevant labels
- **Title updates**: Detect topic drift and update the title to reflect current focus
- **Related issue linking**: Discover and link related issues mentioned in conversation
- **Task list management**: Add/update task list checkboxes for multi-step work
- **Auto-close with summary**: Close issues when work is complete, with a structured summary
- **Auto-reopen**: Detect new activity on closed issues and reopen if warranted
- **Milestone assignment**: Assign to milestones based on content or configuration
- **State indicators**: Apply status labels (`in-progress`, `waiting-for-response`, `completed`)

### Out of Scope
- Project board management (GitHub Projects API is separate and complex)
- Issue templates beyond the existing hatch template
- Issue assignment (that's notification intelligence territory)
- Issue prioritization (the agent doesn't know business priority)

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Content analyzer** | Classify issue content for labeling | ~1.5 hours |
| **Auto-labeler** | Apply labels based on classification, create missing labels | ~1.5 hours |
| **Title updater** | Detect topic drift, propose title updates | ~1.5 hours |
| **Related issue linker** | Find and link related issues | ~1 hour |
| **Task list manager** | Add/update checkboxes in the issue body | ~1.5 hours |
| **Auto-closer** | Detect completion, generate closing summary, close | ~1.5 hours |
| **Status label manager** | Apply status labels at lifecycle transitions | ~1 hour |
| **Agent orchestrator integration** | Insert lifecycle management into the pipeline | ~1 hour |
| **Configuration** | Label schemes, auto-close settings, title update thresholds | ~30 min |
| **Docs** | Document issue lifecycle management | ~30 min |
| **Testing** | Test each lifecycle action | ~1.5 hours |

**Total: ~13 hours.**

---

## AI Implementation Instructions

### Step 1: Content analyzer for auto-labeling

**New file:** `.GITCLAW/lifecycle/GITCLAW-ISSUES.ts`

```typescript
export interface ContentClassification {
  type: "bug" | "feature" | "question" | "docs" | "refactor" | "discussion" | "task";
  confidence: number;
  keywords: string[];
  suggestedLabels: string[];
}

export function classifyIssueContent(
  title: string,
  body: string,
  comments: string[]
): ContentClassification {
  const fullText = `${title}\n${body}\n${comments.join("\n")}`.toLowerCase();
  
  const typeScores: Record<string, { score: number; keywords: string[] }> = {
    bug: { score: 0, keywords: [] },
    feature: { score: 0, keywords: [] },
    question: { score: 0, keywords: [] },
    docs: { score: 0, keywords: [] },
    refactor: { score: 0, keywords: [] },
    discussion: { score: 0, keywords: [] },
    task: { score: 0, keywords: [] },
  };
  
  const patterns: Record<string, { regex: RegExp; weight: number }[]> = {
    bug: [
      { regex: /\b(bug|error|crash|fail|broken|doesn't work|not working|issue|problem)\b/g, weight: 2 },
      { regex: /\b(fix|patch|resolve|debug|troubleshoot)\b/g, weight: 1.5 },
      { regex: /\b(stack trace|exception|traceback|segfault|panic)\b/g, weight: 3 },
    ],
    feature: [
      { regex: /\b(feature|add|implement|support|enable|new|enhance|improve)\b/g, weight: 2 },
      { regex: /\b(would be nice|suggestion|proposal|request)\b/g, weight: 1.5 },
      { regex: /\b(could we|can we|is it possible|I'd like)\b/g, weight: 1 },
    ],
    question: [
      { regex: /\b(how|what|why|when|where|which|who)\b/g, weight: 1 },
      { regex: /\?/g, weight: 1.5 },
      { regex: /\b(explain|help|understand|clarify|confused)\b/g, weight: 2 },
    ],
    docs: [
      { regex: /\b(document|readme|guide|tutorial|example|wiki)\b/g, weight: 2.5 },
      { regex: /\b(typo|spelling|grammar|formatting)\b/g, weight: 2 },
    ],
    refactor: [
      { regex: /\b(refactor|restructure|reorganize|clean up|simplify|optimize)\b/g, weight: 2.5 },
      { regex: /\b(tech debt|technical debt|code quality|DRY|SOLID)\b/g, weight: 2 },
    ],
    task: [
      { regex: /\b(todo|task|checklist|steps|plan|implement|build|create|set up)\b/g, weight: 1.5 },
      { regex: /- \[ \]/g, weight: 3 }, // task list checkboxes
    ],
  };
  
  for (const [type, typePatterns] of Object.entries(patterns)) {
    for (const { regex, weight } of typePatterns) {
      const matches = fullText.match(regex) || [];
      if (matches.length > 0) {
        typeScores[type].score += matches.length * weight;
        typeScores[type].keywords.push(...matches.slice(0, 3));
      }
    }
  }
  
  // Find the highest-scoring type
  const sorted = Object.entries(typeScores).sort((a, b) => b[1].score - a[1].score);
  const [topType, topScore] = sorted[0];
  
  // Map types to labels
  const labelMap: Record<string, string[]> = {
    bug: ["bug", "needs-triage"],
    feature: ["enhancement"],
    question: ["question"],
    docs: ["documentation"],
    refactor: ["refactor", "tech-debt"],
    discussion: ["discussion"],
    task: ["task"],
  };
  
  return {
    type: topType as ContentClassification["type"],
    confidence: Math.min(1, topScore.score / 10),
    keywords: [...new Set(topScore.keywords)].slice(0, 5),
    suggestedLabels: labelMap[topType] || [],
  };
}
```

### Step 2: Auto-labeler

```typescript
export async function autoLabel(
  issueNumber: number,
  classification: ContentClassification,
  repo: string,
  config: IssueLifecycleConfig
): Promise<string[]> {
  if (!config.autoLabel) return [];
  if (classification.confidence < config.labelConfidenceThreshold) return [];
  
  const labelsToAdd = classification.suggestedLabels;
  const addedLabels: string[] = [];
  
  // Get current labels
  const { stdout: currentLabelsJson } = await run([
    "gh", "issue", "view", String(issueNumber),
    "--json", "labels", "--jq", ".labels[].name",
  ]);
  const currentLabels = currentLabelsJson.trim().split("\n").filter(Boolean);
  
  for (const label of labelsToAdd) {
    if (currentLabels.includes(label)) continue;
    
    // Ensure label exists
    const labelColors: Record<string, string> = {
      bug: "D73A4A", enhancement: "A2EEEF", question: "D876E3",
      documentation: "0075CA", refactor: "E4E669", "tech-debt": "FBCA04",
      discussion: "C5DEF5", task: "0E8A16",
      "in-progress": "F9D0C4", "waiting-for-response": "FEF2C0",
      completed: "0E8A16",
    };
    
    try {
      await run(["gh", "label", "create", label,
        "--color", labelColors[label] || "EDEDED", "--force"]);
    } catch (e) { /* ignore */ }
    
    await run(["gh", "issue", "edit", String(issueNumber),
      "--add-label", label]);
    addedLabels.push(label);
  }
  
  return addedLabels;
}
```

### Step 3: Title updater

```typescript
export async function checkTitleDrift(
  issueNumber: number,
  currentTitle: string,
  conversationFocus: string,
  agentText: string,
  repo: string,
  config: IssueLifecycleConfig
): Promise<boolean> {
  if (!config.autoUpdateTitle) return false;
  
  // Calculate similarity between current title and conversation focus
  const titleWords = new Set(currentTitle.toLowerCase().split(/\s+/));
  const focusWords = new Set(conversationFocus.toLowerCase().split(/\s+/));
  
  const intersection = [...titleWords].filter(w => focusWords.has(w)).length;
  const similarity = intersection / Math.max(titleWords.size, focusWords.size);
  
  // If similarity is low, the topic has drifted
  if (similarity < 0.2 && conversationFocus.length > 10) {
    // Generate a new title from the current focus
    // Take the first meaningful clause
    const newTitle = conversationFocus
      .replace(/^(please |could you |i want to |let's |help with )/i, "")
      .slice(0, 80)
      .trim();
    
    if (newTitle.length > 10 && newTitle !== currentTitle) {
      // Preserve the original title in a comment
      await run(["gh", "issue", "edit", String(issueNumber),
        "--title", newTitle]);
      
      console.log(`Updated issue title: "${currentTitle}" → "${newTitle}"`);
      return true;
    }
  }
  
  return false;
}
```

### Step 4: Related issue linker

```typescript
export async function linkRelatedIssues(
  issueNumber: number,
  agentText: string,
  sessionContent: string,
  repo: string
): Promise<number[]> {
  // Find issue references in agent output and session
  const combined = `${agentText}\n${sessionContent}`;
  const refs = [...new Set(
    [...combined.matchAll(/#(\d+)/g)].map(m => parseInt(m[1]))
  )].filter(n => n !== issueNumber && n > 0);
  
  const linked: number[] = [];
  
  for (const ref of refs.slice(0, 5)) { // max 5 links
    try {
      // Check if the issue exists
      const { stdout } = await run([
        "gh", "issue", "view", String(ref),
        "--json", "number", "--jq", ".number",
      ]);
      
      if (stdout.trim()) {
        // Add a cross-reference comment (GitHub auto-creates the backlink)
        // Only if we haven't already linked this issue
        const { stdout: existingComments } = await run([
          "gh", "api", `repos/${repo}/issues/${issueNumber}/comments`,
          "--jq", `[.[] | select(.body | contains("Related: #${ref}"))] | length`,
        ]);
        
        if (parseInt(existingComments.trim()) === 0) {
          // GitHub automatically creates bidirectional links when you reference an issue
          // Just mentioning #N in a comment is enough
          linked.push(ref);
        }
      }
    } catch (e) { /* issue doesn't exist or no access */ }
  }
  
  return linked;
}
```

### Step 5: Task list manager

```typescript
export async function updateTaskList(
  issueNumber: number,
  steps: { description: string; completed: boolean }[],
  repo: string
): Promise<void> {
  // Get current issue body
  const { stdout: body } = await run([
    "gh", "issue", "view", String(issueNumber),
    "--json", "body", "--jq", ".body",
  ]);
  
  // Build task list
  const taskList = steps.map(s =>
    `- [${s.completed ? "x" : " "}] ${s.description}`
  ).join("\n");
  
  // Check if there's already a task list
  const taskListPattern = /### Progress\n([\s\S]*?)(?=\n###|\n---|\Z)/;
  
  let newBody: string;
  if (taskListPattern.test(body)) {
    newBody = body.replace(taskListPattern, `### Progress\n${taskList}`);
  } else {
    // Append task list to the issue body
    newBody = body + `\n\n### Progress\n${taskList}`;
  }
  
  if (newBody !== body) {
    await run(["gh", "issue", "edit", String(issueNumber), "--body", newBody]);
  }
}
```

### Step 6: Auto-closer with summary

```typescript
export async function autoCloseIfComplete(
  issueNumber: number,
  agentText: string,
  prompt: string,
  conversationState: ConversationState,
  repo: string,
  config: IssueLifecycleConfig
): Promise<boolean> {
  if (!config.autoClose) return false;
  
  // Detect completion signals
  const completionSignals = [
    /(?:that's|this is|here's) (?:all|everything|the answer|your|what you)/i,
    /(?:done|complete|finished|resolved|fixed|implemented|created|updated)/i,
    /(?:let me know if|anything else|further questions|hope this helps)/i,
  ];
  
  const signalCount = completionSignals.filter(p => p.test(agentText)).length;
  
  // Also check if the user's request was a simple question (not ongoing work)
  const isSimpleQuestion = /^(?:how|what|why|when|where|which|can you|could you|is it|does it)/i.test(prompt);
  
  // Auto-close if: simple question + answer given, or 2+ completion signals
  if ((isSimpleQuestion && signalCount >= 1) || signalCount >= 2) {
    // Generate closing summary
    const summary = [
      `## ✅ Issue Resolved`,
      ``,
      `**Original request:** ${conversationState.originalRequest}`,
      ``,
    ];
    
    if (conversationState.decisions.length > 0) {
      summary.push(`**Key decisions:**`);
      for (const d of conversationState.decisions.slice(-5)) {
        summary.push(`- ${d.description}`);
      }
      summary.push("");
    }
    
    summary.push(`_Closing automatically. Reopen if you need more help._`);
    
    // Apply completion label
    try {
      await run(["gh", "label", "create", "completed", "--color", "0E8A16", "--force"]);
      await run(["gh", "issue", "edit", String(issueNumber), "--add-label", "completed"]);
      await run(["gh", "issue", "edit", String(issueNumber), "--remove-label", "in-progress"]);
    } catch (e) { /* ignore */ }
    
    // Post summary and close
    await gh("issue", "comment", String(issueNumber), "--body", summary.join("\n"));
    await gh("issue", "close", String(issueNumber));
    
    console.log(`Auto-closed issue #${issueNumber}`);
    return true;
  }
  
  return false;
}
```

### Step 7: Status label management

```typescript
export async function updateStatusLabel(
  issueNumber: number,
  status: "in-progress" | "waiting-for-response" | "completed",
  repo: string
): Promise<void> {
  const statusLabels = ["in-progress", "waiting-for-response", "completed"];
  
  // Ensure labels exist
  const colors: Record<string, string> = {
    "in-progress": "F9D0C4",
    "waiting-for-response": "FEF2C0",
    "completed": "0E8A16",
  };
  
  for (const label of statusLabels) {
    try {
      await run(["gh", "label", "create", label, "--color", colors[label], "--force"]);
    } catch (e) { /* ignore */ }
  }
  
  // Remove other status labels
  for (const label of statusLabels) {
    if (label !== status) {
      try {
        await run(["gh", "issue", "edit", String(issueNumber), "--remove-label", label]);
      } catch (e) { /* ignore */ }
    }
  }
  
  // Add current status
  await run(["gh", "issue", "edit", String(issueNumber), "--add-label", status]);
}
```

### Step 8: Integrate into agent orchestrator

In `GITCLAW-AGENT.ts`, after the agent responds:

```typescript
import { classifyIssueContent, autoLabel, checkTitleDrift, linkRelatedIssues, autoCloseIfComplete, updateStatusLabel } from "./GITCLAW-ISSUES";

const issueConfig = loadIssueLifecycleConfig(gitclawDir);

if (issueConfig.enabled) {
  // Auto-label on first run
  if (mode === "new") {
    const classification = classifyIssueContent(title, body, []);
    const addedLabels = await autoLabel(issueNumber, classification, repo, issueConfig);
    if (addedLabels.length > 0) {
      console.log(`Auto-labeled: ${addedLabels.join(", ")}`);
    }
  }
  
  // Status label: mark as in-progress while we're working
  await updateStatusLabel(issueNumber, "in-progress", repo);
  
  // After agent responds:
  
  // Check for title drift
  if (convState && convState.turnCount > 3) {
    await checkTitleDrift(issueNumber, title, prompt, agentText, repo, issueConfig);
  }
  
  // Link related issues
  const linked = await linkRelatedIssues(issueNumber, agentText, "", repo);
  if (linked.length > 0) {
    console.log(`Linked related issues: ${linked.map(n => `#${n}`).join(", ")}`);
  }
  
  // Auto-close if complete
  const closed = await autoCloseIfComplete(
    issueNumber, agentText, prompt, convState, repo, issueConfig
  );
  
  if (!closed) {
    // Mark as waiting for response
    await updateStatusLabel(issueNumber, "waiting-for-response", repo);
  }
}
```

### Step 9: Configuration

**New file:** `.GITCLAW/issue-lifecycle.json`

```json
{
  "enabled": true,
  "autoLabel": true,
  "labelConfidenceThreshold": 0.5,
  "autoUpdateTitle": true,
  "autoClose": true,
  "autoCloseQuestions": true,
  "autoCloseAfterTurns": null,
  "linkRelatedIssues": true,
  "statusLabels": true,
  "taskListTracking": true
}
```

### Step 10: Test

- Open an issue titled "Bug: login doesn't work" → verify `bug` label is applied
- Open an issue with "How do I configure X?" → verify `question` label, auto-close after answer
- Start a conversation that drifts from topic A to topic B → verify title is updated
- Reference #42 in conversation → verify cross-link is created
- Verify status label transitions: new → `in-progress` → `waiting-for-response` → `completed`
- Reopen a closed issue with a new comment → verify status reverts to `in-progress`
- Ask a multi-step question → verify task list checkboxes appear in the issue body

## Design Decisions

**Why auto-label with a confidence threshold?** False labeling is worse than no labeling. A `bug` label on a feature request misleads everyone who filters by label. The confidence threshold (default 0.5) ensures labels are only applied when the classification is reasonably certain. Ambiguous issues remain unlabeled for manual triage.

**Why update titles cautiously?** The original title was written by the human — it's their intent. Overwriting it frivolously is disrespectful. The drift check (similarity < 0.2) ensures the title is only updated when the conversation has genuinely moved far from the original topic. And the new title is derived from the user's own words, not the agent's summary.

**Why auto-close questions but not tasks?** Questions have a natural completion point: the answer was given. Tasks don't — "implement auth module" might be partially done, and premature closing would lose the thread. Questions auto-close with the answer as the closing summary. Tasks close only when the agent detects multiple strong completion signals.

**Why status labels instead of GitHub Projects?** Labels are visible everywhere: issue list, search, email notifications, API queries. GitHub Projects require separate navigation. Status labels provide the most widely visible state tracking with the simplest implementation. Teams using Projects can add their own automation on top.
