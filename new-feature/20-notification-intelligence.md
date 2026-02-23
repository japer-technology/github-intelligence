# Feature: Notification Intelligence & Escalation Engine

## Summary

Activate the full communication surface documented in `GITCLAW-Communication-Channels.md` — the 1,500-line analysis that currently sits inert. The agent gains awareness of *who* it's communicating with, *how* they receive notifications, and *when* to escalate. It formats responses for email readability (most users read agent responses as notification emails, not on GitHub). It implements escalation chains: if a critical finding goes unacknowledged, the agent @mentions the assignee, then the team, then creates a high-priority issue. It uses assignment, review requests, labels, and releases as targeted communication channels — each reaching a different audience. The agent becomes a communication-aware entity that uses GitHub's notification system as a precision messaging platform.

## Why This Feature — The Deep Reasoning

### 1. Most Users Read Agent Responses as Emails — But the Agent Writes for GitHub

When the agent posts a comment on an issue, GitHub sends a notification email to every thread subscriber. For many developers, that email is how they read the agent's response — they never open GitHub. But the agent's output is optimized for GitHub's Markdown renderer: collapsible sections, mermaid diagrams, task lists, syntax-highlighted code blocks. In email, many of these render poorly or not at all.

The Communication Channels doc (§26) reveals the email anatomy: GitHub renders Markdown to HTML for the email body, but advanced features (mermaid, `<details>`, GitHub-specific shortcodes) are stripped or broken. The agent should know this and adapt.

### 2. The Agent Has 27 Communication Mechanisms and Uses Exactly 1

The Communication Channels doc catalogs 27 distinct mechanisms by which GitHub sends email notifications. The agent uses one: issue comments (§3). It never:
- @mentions specific users who need to see something (§7)
- Mentions teams for broadcast (§8)
- Assigns issues to route responsibility (§22)
- Requests PR reviews for targeted notifications (§5b)
- Creates releases for community-wide announcements (§10)
- Uses labels to reach label-subscribers (§23)
- Posts commit comments to notify commit authors (§9)

Each mechanism reaches a different audience through a different channel with different urgency. The agent should choose the mechanism that matches the communication need.

### 3. The Reply-To Channel Creates Bidirectional Email Conversations

The most profound insight in the Communication Channels doc (§25): when a user receives a notification email and replies via their email client, GitHub converts that email reply into an issue comment. The agent then processes it as a normal comment event. The entire conversation can happen over email — the user never opens GitHub.

This already works at the transport level. What's missing is:
- Agent awareness that the user might be replying from email (parsing quoted reply artifacts)
- Response formatting that works well in email clients
- Explicit invitation to reply via email ("You can reply to this email directly")

### 4. Escalation Chains Are Critical for Proactive Features

Feature 19 (Health Scanning) finds problems and opens issues. Feature 04 (Cron) runs scheduled tasks. Feature 13 (Event Bridge) handles external events. All of these can discover *urgent* things. But an issue that nobody reads is just noise.

Escalation chains (Pattern 10 in the Communication Channels doc) solve this:
1. Post a comment → reaches thread subscribers
2. No response in 1 hour → @mention the issue assignee
3. No response in 4 hours → @mention @org/team
4. No response in 24 hours → create a new high-priority issue assigned to the team lead

Each step uses a more aggressive notification mechanism, widening the audience until someone responds.

### 5. It Transforms the Agent from a Responder to a Communicator

All other features focus on what the agent *does*. This feature focuses on *how the agent reaches people*. A brilliant analysis that nobody reads is worthless. An urgent finding that gets buried in notification noise is dangerous. Communication intelligence means the agent matches the message to the medium — low-severity findings go in batch reports, high-severity findings @mention the right person, critical findings escalate until acknowledged.

## Scope

### In Scope
- **Email-aware formatting**: Detect content that renders poorly in email; provide email-safe alternatives
- **Reply-To handling**: Parse email reply artifacts (quoted text, signatures) from comments
- **Targeted notifications**: @mention specific users or teams when the situation warrants
- **Escalation chains**: Configurable escalation with timeouts and progressive notification widening
- **Assignment routing**: Assign issues to the most appropriate person based on file ownership (git blame)
- **Communication budget**: Rate-limit notifications to prevent fatigue (max N @mentions per day)
- **Release announcements**: For community-wide broadcasts (e.g., agent capability updates)
- **Label-based routing**: Apply labels that trigger subscribed users' notifications

### Out of Scope
- Custom email templates (GitHub controls the template)
- Sending to non-GitHub email addresses
- Slack/Discord/external service integration (that's feature 13's territory)
- Read receipts or delivery confirmation (GitHub doesn't support this)

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Email-aware formatter** | Markdown sanitization for email compatibility | ~2 hours |
| **Reply-To parser** | Strip quoted text, signatures, and email artifacts | ~1.5 hours |
| **Targeted mention engine** | Decide when and who to @mention | ~2 hours |
| **Escalation chain manager** | Track acknowledgment, schedule escalation steps | ~2.5 hours |
| **Assignment router** | Git blame analysis for file ownership | ~1 hour |
| **Communication budget** | Rate limiting for notifications | ~1 hour |
| **Configuration** (`notifications.json`) | Escalation rules, budget, team mappings | ~30 min |
| **Agent orchestrator integration** | Post-processing of agent output for email compatibility | ~1 hour |
| **Docs** | Document communication system | ~30 min |
| **Testing** | Test formatting, escalation, reply parsing | ~1.5 hours |

**Total: ~14 hours.**

---

## AI Implementation Instructions

### Step 1: Email-aware output formatter

**New file:** `.GITCLAW/lifecycle/GITCLAW-NOTIFY.ts`

The formatter post-processes agent output before posting as a comment, ensuring it renders well in email clients.

```typescript
export function formatForEmail(markdown: string): string {
  let result = markdown;
  
  // 1. Replace <details>/<summary> with visible sections
  // Email clients strip <details> — content becomes invisible
  result = result.replace(
    /<details>\s*<summary>(.*?)<\/summary>([\s\S]*?)<\/details>/g,
    (_, summary, content) => `**${summary.trim()}**\n${content.trim()}`
  );
  
  // 2. Replace mermaid code blocks with text descriptions
  // Mermaid doesn't render in email
  result = result.replace(
    /```mermaid\n([\s\S]*?)```/g,
    (_, content) => `*[Diagram — view on GitHub for rendering]*\n\`\`\`\n${content}\`\`\``
  );
  
  // 3. Ensure code blocks have language tags (helps some email renderers)
  result = result.replace(/```\n/g, "```text\n");
  
  // 4. Replace GitHub-specific shortcodes
  // :+1: etc. — most email clients handle standard emoji but not shortcodes
  const emojiMap: Record<string, string> = {
    ":+1:": "👍", ":-1:": "👎", ":smile:": "😄", ":tada:": "🎉",
    ":rocket:": "🚀", ":warning:": "⚠️", ":x:": "❌", ":white_check_mark:": "✅",
  };
  for (const [code, emoji] of Object.entries(emojiMap)) {
    result = result.replaceAll(code, emoji);
  }
  
  // 5. Replace task lists with simple checkmarks
  // GitHub task lists render as checkboxes on web but may not in email
  result = result.replace(/^- \[ \] /gm, "☐ ");
  result = result.replace(/^- \[x\] /gm, "☑ ");
  
  // 6. Add email reply invitation at the end
  result += "\n\n---\n_Reply to this email to continue the conversation._";
  
  return result;
}
```

### Step 2: Reply-To artifact parser

When users reply to notification emails, their responses include quoted text, signatures, and email client artifacts:

```typescript
export function parseEmailReply(commentBody: string): {
  cleanBody: string;
  isEmailReply: boolean;
  quotedContent: string;
} {
  let isEmailReply = false;
  let quotedContent = "";
  
  // GitHub adds a marker for email replies
  // The replied-to content appears as quoted blockquotes
  
  // Pattern 1: GitHub's email reply separator
  // "On <date>, <user> wrote:" followed by quoted blocks
  const emailSeparator = /^On .+, .+ wrote:\s*$/m;
  const separatorMatch = commentBody.match(emailSeparator);
  
  if (separatorMatch) {
    isEmailReply = true;
    const separatorIndex = commentBody.indexOf(separatorMatch[0]);
    quotedContent = commentBody.slice(separatorIndex);
    const cleanBody = commentBody.slice(0, separatorIndex).trim();
    return { cleanBody, isEmailReply, quotedContent };
  }
  
  // Pattern 2: Lines starting with > (quoted text from email clients)
  // If more than half the lines are quoted, it's likely an email reply
  const lines = commentBody.split("\n");
  const quotedLines = lines.filter(l => l.startsWith(">") || l.startsWith("&gt;"));
  
  if (quotedLines.length > lines.length * 0.4) {
    isEmailReply = true;
    const nonQuoted = lines.filter(l => !l.startsWith(">") && !l.startsWith("&gt;")).join("\n").trim();
    quotedContent = quotedLines.join("\n");
    return { cleanBody: nonQuoted || commentBody, isEmailReply, quotedContent };
  }
  
  // Pattern 3: Signature markers
  // "-- " on its own line (standard email signature delimiter)
  const sigIndex = commentBody.indexOf("\n-- \n");
  if (sigIndex !== -1) {
    isEmailReply = true;
    return {
      cleanBody: commentBody.slice(0, sigIndex).trim(),
      isEmailReply,
      quotedContent: commentBody.slice(sigIndex),
    };
  }
  
  return { cleanBody: commentBody, isEmailReply: false, quotedContent: "" };
}
```

**Integrate into `GITCLAW-AGENT.ts`:**

```typescript
// In the prompt construction section:
if (eventName === "issue_comment") {
  const { cleanBody, isEmailReply } = parseEmailReply(event.comment.body);
  prompt = cleanBody;
  if (isEmailReply) {
    console.log("Detected email reply — stripped quoted content and signatures");
  }
}
```

### Step 3: Targeted mention engine

```typescript
export interface MentionDecision {
  target: string;           // username or @org/team
  reason: string;           // why this person should be mentioned
  urgency: "low" | "medium" | "high" | "critical";
}

export async function decideMentions(
  context: {
    issueNumber: number;
    severity?: string;
    changedFiles?: string[];
    category?: string;
    repo: string;
  }
): Promise<MentionDecision[]> {
  const mentions: MentionDecision[] = [];
  
  // Rule 1: If changed files have a clear owner (via git blame), mention them for review
  if (context.changedFiles && context.changedFiles.length > 0) {
    const owners = await getFileOwners(context.changedFiles, context.repo);
    for (const [file, owner] of Object.entries(owners)) {
      if (owner) {
        mentions.push({
          target: owner,
          reason: `Primary author of \`${file}\``,
          urgency: "low",
        });
      }
    }
  }
  
  // Rule 2: If severity is critical, mention the issue assignee
  if (context.severity === "critical") {
    mentions.push({
      target: "ASSIGNEE", // resolved at post time
      reason: "Critical severity finding requires attention",
      urgency: "critical",
    });
  }
  
  // Deduplicate
  return [...new Map(mentions.map(m => [m.target, m])).values()];
}

async function getFileOwners(
  files: string[],
  repo: string
): Promise<Record<string, string | null>> {
  const owners: Record<string, string | null> = {};
  
  for (const file of files.slice(0, 5)) { // limit to 5 files
    try {
      const { stdout } = await run([
        "git", "log", "--format=%aN", "-1", file,
      ]);
      const author = stdout.trim();
      // Map git author to GitHub username (best effort — exact mapping requires API)
      owners[file] = author || null;
    } catch (e) {
      owners[file] = null;
    }
  }
  
  return owners;
}
```

### Step 4: Escalation chain manager

Escalation requires state across workflow runs. Store escalation state in `state/escalations/`.

```typescript
export interface EscalationChain {
  id: string;
  issueNumber: number;
  severity: "high" | "critical";
  createdAt: string;
  steps: EscalationStep[];
  currentStep: number;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
}

export interface EscalationStep {
  action: "comment" | "mention-assignee" | "mention-team" | "create-issue" | "mention-user";
  target?: string;        // @user or @org/team
  delayMinutes: number;   // wait this long after previous step
  executed: boolean;
  executedAt?: string;
}

export function createEscalation(
  issueNumber: number,
  severity: "high" | "critical",
  config: EscalationConfig
): EscalationChain {
  const defaultSteps: EscalationStep[] = [
    { action: "comment", delayMinutes: 0, executed: false },
    { action: "mention-assignee", delayMinutes: 60, executed: false },
    { action: "mention-team", target: config.defaultTeam, delayMinutes: 240, executed: false },
    { action: "create-issue", delayMinutes: 1440, executed: false },
  ];
  
  return {
    id: `esc-${issueNumber}-${Date.now()}`,
    issueNumber,
    severity,
    createdAt: new Date().toISOString(),
    steps: severity === "critical" ? defaultSteps : defaultSteps.slice(0, 2), // critical gets full chain
    currentStep: 0,
    acknowledged: false,
  };
}

export async function processEscalations(
  stateDir: string,
  repo: string
): Promise<void> {
  const escDir = resolve(stateDir, "escalations");
  if (!existsSync(escDir)) return;
  
  const files = readdirSync(escDir).filter(f => f.endsWith(".json"));
  
  for (const file of files) {
    const chain: EscalationChain = JSON.parse(
      readFileSync(resolve(escDir, file), "utf-8")
    );
    
    if (chain.acknowledged) continue;
    
    // Check if any comments on the issue indicate acknowledgment
    const acknowledged = await checkAcknowledgment(chain.issueNumber, chain.createdAt, repo);
    if (acknowledged) {
      chain.acknowledged = true;
      chain.acknowledgedBy = acknowledged.user;
      chain.acknowledgedAt = acknowledged.at;
      writeFileSync(resolve(escDir, file), JSON.stringify(chain, null, 2));
      continue;
    }
    
    // Execute the next step if its delay has elapsed
    const nextStep = chain.steps[chain.currentStep];
    if (!nextStep || nextStep.executed) continue;
    
    const previousStepTime = chain.currentStep === 0
      ? new Date(chain.createdAt).getTime()
      : new Date(chain.steps[chain.currentStep - 1].executedAt!).getTime();
    
    const elapsed = (Date.now() - previousStepTime) / (1000 * 60);
    
    if (elapsed >= nextStep.delayMinutes) {
      await executeEscalationStep(nextStep, chain, repo);
      nextStep.executed = true;
      nextStep.executedAt = new Date().toISOString();
      chain.currentStep++;
      writeFileSync(resolve(escDir, file), JSON.stringify(chain, null, 2));
    }
  }
}

async function executeEscalationStep(
  step: EscalationStep,
  chain: EscalationChain,
  repo: string
): Promise<void> {
  switch (step.action) {
    case "comment":
      await gh("issue", "comment", String(chain.issueNumber), "--body",
        `⏰ **Escalation notice:** This ${chain.severity}-severity issue has not been acknowledged.\n\n` +
        `Please respond or react to acknowledge.`);
      break;
    case "mention-assignee":
      const { stdout } = await run([
        "gh", "issue", "view", String(chain.issueNumber),
        "--json", "assignees", "--jq", ".assignees[].login",
      ]);
      const assignees = stdout.trim().split("\n").filter(Boolean);
      if (assignees.length > 0) {
        await gh("issue", "comment", String(chain.issueNumber), "--body",
          `🚨 **Escalation (step 2):** ${assignees.map(a => `@${a}`).join(" ")} — this ${chain.severity}-severity issue needs your attention.`);
      }
      break;
    case "mention-team":
      if (step.target) {
        await gh("issue", "comment", String(chain.issueNumber), "--body",
          `🚨🚨 **Escalation (step 3):** ${step.target} — this ${chain.severity}-severity issue has been unacknowledged for hours. Please investigate.`);
      }
      break;
    case "create-issue":
      await run(["gh", "issue", "create",
        "--title", `🚨 UNACKNOWLEDGED: Escalation from #${chain.issueNumber}`,
        "--body", `A ${chain.severity}-severity issue (#${chain.issueNumber}) has been unacknowledged for 24+ hours.\n\nOriginal issue: #${chain.issueNumber}`,
        "--label", "gitclaw:escalation,gitclaw:health:critical",
      ]);
      break;
  }
}

async function checkAcknowledgment(
  issueNumber: number,
  sinceTimestamp: string,
  repo: string
): Promise<{ user: string; at: string } | null> {
  // Check for human comments after the escalation was created
  const { stdout } = await run([
    "gh", "api", `repos/${repo}/issues/${issueNumber}/comments`,
    "--jq", `.[] | select(.created_at > "${sinceTimestamp}") | select(.user.login != "github-actions[bot]") | {user: .user.login, at: .created_at}`,
  ]);
  
  if (stdout.trim()) {
    try {
      return JSON.parse(stdout.trim().split("\n")[0]);
    } catch (e) { /* ignore */ }
  }
  
  // Also check for reactions on the escalation comment (thumbs up = acknowledged)
  // (simplified — would need to track the escalation comment ID)
  return null;
}
```

### Step 5: Communication budget

```typescript
export interface CommBudget {
  maxMentionsPerDay: number;
  maxIssuesPerDay: number;
  maxEscalationsPerDay: number;
}

export function checkBudget(
  stateDir: string,
  action: "mention" | "issue" | "escalation",
  budget: CommBudget
): boolean {
  const budgetFile = resolve(stateDir, "comm-budget.json");
  const today = new Date().toISOString().slice(0, 10);
  
  let state: Record<string, Record<string, number>> = {};
  if (existsSync(budgetFile)) {
    state = JSON.parse(readFileSync(budgetFile, "utf-8"));
  }
  
  if (!state[today]) state[today] = { mention: 0, issue: 0, escalation: 0 };
  
  const limits: Record<string, number> = {
    mention: budget.maxMentionsPerDay,
    issue: budget.maxIssuesPerDay,
    escalation: budget.maxEscalationsPerDay,
  };
  
  if (state[today][action] >= limits[action]) {
    console.log(`Communication budget exhausted: ${action} (${state[today][action]}/${limits[action]})`);
    return false;
  }
  
  state[today][action]++;
  writeFileSync(budgetFile, JSON.stringify(state, null, 2));
  return true;
}
```

### Step 6: Configuration

**New file:** `.GITCLAW/notifications.json`

```json
{
  "emailFormatting": true,
  "replyToParsing": true,
  "escalation": {
    "enabled": true,
    "defaultTeam": "@org/engineering",
    "criticalSteps": [
      { "action": "comment", "delayMinutes": 0 },
      { "action": "mention-assignee", "delayMinutes": 60 },
      { "action": "mention-team", "delayMinutes": 240 },
      { "action": "create-issue", "delayMinutes": 1440 }
    ]
  },
  "budget": {
    "maxMentionsPerDay": 10,
    "maxIssuesPerDay": 5,
    "maxEscalationsPerDay": 3
  }
}
```

### Step 7: Integrate into agent orchestrator

In `GITCLAW-AGENT.ts`:

```typescript
import { formatForEmail, parseEmailReply, processEscalations } from "./GITCLAW-NOTIFY";

// Before prompt construction:
if (eventName === "issue_comment") {
  const { cleanBody } = parseEmailReply(event.comment.body);
  prompt = cleanBody;
}

// After agent text extraction:
const formattedText = formatForEmail(agentText.trim());
const commentBody = formattedText.slice(0, MAX_COMMENT_LENGTH);

// Process pending escalations on every run (opportunistic):
try {
  await processEscalations(stateDir, repo);
} catch (e) {
  console.error("Escalation processing failed:", e);
}
```

### Step 8: Test

- Post an email-style reply (with quoted text and signature) as a comment and verify the agent parses only the new content
- Verify `<details>` blocks are expanded in the formatted output
- Configure an escalation chain and verify each step fires at the correct interval
- Verify the communication budget prevents more than N mentions per day
- Verify the agent adds "Reply to this email" footer to every response

## Design Decisions

**Why format for email instead of just for GitHub?** Because empirically, most developers read notification emails more than they visit GitHub. The agent's response needs to be useful in *both* contexts. Email-safe formatting is a superset of web-safe formatting — everything that works in email also works on GitHub, but not vice versa.

**Why escalation chains instead of just @mentioning immediately?** Because @mentions are expensive social currency. An agent that @mentions people on every finding becomes noise and gets muted. Escalation chains start with the lowest-impact notification (thread comment) and progressively widen the audience only if the issue is truly unacknowledged. This respects people's attention.

**Why a communication budget?** GitHub's abuse detection will throttle or flag accounts that generate excessive @mentions. More importantly, human tolerance for automated notifications has a hard limit. The budget encodes that limit explicitly. When the budget is exhausted, the agent queues notifications for the next day rather than burning through goodwill.
