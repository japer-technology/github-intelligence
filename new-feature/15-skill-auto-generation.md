# Feature: Skill Auto-Generation from Conversation Patterns

## Summary

The agent monitors its own usage patterns across sessions and detects when it repeatedly performs the same kind of task — similar prompts, same tool sequences, same output structures. When a pattern emerges (3+ instances), the agent drafts a new skill that formalizes the pattern: a SKILL.md with the common prompt structure, preferred tool sequences, output format, and domain knowledge distilled from successful executions. The draft is proposed to the user via an issue for review before being installed. This is genuine self-improvement — the agent evolves its own capabilities based on how it's actually used, not how someone imagined it would be used.

## Why This Feature — The Deep Reasoning

**1. The best skills can't be designed in advance — they emerge from usage.**

The skill-creator skill (already in the repo) tells you *how* to build a skill. But it can't tell you *which* skills to build. That knowledge comes from watching what people actually ask for. If 5 different issues ask the agent to "compare the codebase against upstream" or "generate a status report," that's a skill waiting to be born. The agent is the only entity that sees all conversations — it's uniquely positioned to detect these patterns.

Looking at this repo's actual sessions, the patterns are already visible:
- Multiple "How big is .GITCLAW?" / "What is the size of..." queries → a **repo-stats** skill
- Multiple "Compare to upstream" / "What changed since fork" queries → a **fork-comparison** skill  
- "Status report" requests → a **status-report** skill
- "Tell me about skills / how to add more" → the existing skill-creator partially covers this

These are real patterns from 21 sessions over 3 days. Imagine a repo with 500+ sessions — the patterns would be rich and specific to that project.

**2. It turns the session archive into a training dataset.**

Every session is a record of: what the user asked, what tools the agent used, what output it produced, and (implicitly via conversation flow) whether the user was satisfied. This is a natural training signal. The agent doesn't need external feedback — the structure of the conversation itself reveals what worked.

**3. It solves the cold-start problem for new repos.**

When GitClaw is installed in a new repo, it has generic skills but no project-specific knowledge. After a few weeks of use, auto-generated skills encode the project's unique patterns: how this team likes status reports formatted, what this codebase's architecture looks like, which files are most frequently discussed. The agent becomes more useful over time without any manual configuration.

**4. It composes with every other feature.**

Personas (feature 10) get persona-specific skills. Guided workflows (feature 12) can trigger skill generation for common workflow patterns. The event bridge (feature 13) might reveal that the same type of alert always requires the same investigation pattern — a skill is born. Cross-issue context (feature 08) provides the data; skill generation provides the synthesis.

**5. It makes the skill system self-sustaining.**

The skill-creator skill teaches the agent how to make skills when asked. Auto-generation means skills are proposed *without being asked* — proactively, based on evidence. This closes the loop: users interact → patterns emerge → skills are proposed → users approve → the agent gets better → users interact more effectively.

## Scope

### In Scope
- Pattern detection: analyze sessions for recurring task types (similar prompts, similar tool sequences)
- Skill drafting: generate a SKILL.md from the detected pattern using the skill-creator's format
- Proposal mechanism: open an issue with the draft skill for user review and approval
- Approval flow: user approves via comment or label → skill is installed to `.pi/skills/`
- Pattern detection runs on schedule (weekly) or on `/suggest-skills` command
- Minimum threshold: 3+ instances of a similar pattern before proposing

### Out of Scope
- Automatic installation without user approval
- Skill quality scoring or A/B testing
- Cross-repo skill sharing
- Embedding-based semantic pattern detection (use keyword + tool-sequence matching)

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Pattern analyzer** (new `GITCLAW-PATTERNS.ts`) | Scan sessions, cluster similar tasks, score patterns | ~3 hours |
| **Skill drafter** | Generate SKILL.md from a detected pattern using skill-creator conventions | ~2 hours |
| **Proposal mechanism** | Create issue with draft skill, handle approval flow | ~1.5 hours |
| **Installation flow** | On approval, write skill to `.pi/skills/` and commit | ~1 hour |
| **Scheduled/command trigger** | Weekly cron or `/suggest-skills` command | ~30 min |
| **Agent orchestrator integration** | Detect approval labels, trigger installation | ~1 hour |
| **Docs** | Document auto-generation system | ~30 min |
| **Testing** | Test pattern detection, test skill quality, test approval flow | ~1.5 hours |

**Total: ~11 hours.**

---

## AI Implementation Instructions

### Step 1: Build the pattern analyzer

**New file:** `.GITCLAW/lifecycle/GITCLAW-PATTERNS.ts`

```typescript
export interface TaskPattern {
  id: string;
  description: string;           // human-readable pattern description
  frequency: number;             // how many sessions match
  matchingIssues: number[];      // which issues exhibited this pattern
  commonPromptKeywords: string[];// recurring words in user prompts
  commonToolSequence: string[];  // typical tool call sequence (e.g., ["read", "bash", "read", "write"])
  commonFilePaths: string[];     // files frequently accessed
  typicalOutputStructure: string;// description of how the agent typically responds
  examplePrompts: string[];      // 3 representative user prompts
  exampleResponses: string[];    // 3 representative (truncated) agent responses
  confidence: number;            // 0-1 score for pattern strength
}

export async function detectPatterns(stateDir: string): Promise<TaskPattern[]>
```

**Pattern detection algorithm:**

1. **Extract task fingerprints from each session:**
   For each session JSONL, extract a "task fingerprint":
   ```typescript
   interface TaskFingerprint {
     issueNumber: number;
     userPromptKeywords: string[];    // top 10 non-stopword tokens from user messages
     toolSequence: string[];          // ordered list of tool names used
     filesAccessed: string[];         // files read/written
     responseLength: number;          // approximate response length
     responseHasCode: boolean;        // whether response included code blocks
     responseHasList: boolean;        // whether response included bullet lists
     responseHasTable: boolean;       // whether response included tables
   }
   ```

2. **Cluster fingerprints by similarity:**
   Use a simple keyword-overlap clustering:
   ```typescript
   function similarity(a: TaskFingerprint, b: TaskFingerprint): number {
     const keywordOverlap = intersect(a.userPromptKeywords, b.userPromptKeywords).length /
       union(a.userPromptKeywords, b.userPromptKeywords).length;
     const toolOverlap = longestCommonSubsequence(a.toolSequence, b.toolSequence).length /
       Math.max(a.toolSequence.length, b.toolSequence.length);
     const fileOverlap = intersect(a.filesAccessed, b.filesAccessed).length /
       Math.max(a.filesAccessed.length, b.filesAccessed.length, 1);
     const structureSimilarity = 
       (a.responseHasCode === b.responseHasCode ? 0.33 : 0) +
       (a.responseHasList === b.responseHasList ? 0.33 : 0) +
       (a.responseHasTable === b.responseHasTable ? 0.33 : 0);
     
     return (keywordOverlap * 0.4) + (toolOverlap * 0.25) + (fileOverlap * 0.2) + (structureSimilarity * 0.15);
   }
   ```
   
   Group fingerprints where similarity > 0.5 into clusters. Filter clusters with fewer than 3 members.

3. **Generate pattern descriptions from clusters:**
   For each cluster, extract the common elements (keywords that appear in >50% of members, tool sequences that are shared, files that recur) and build a `TaskPattern`.

4. **Filter against existing skills:**
   Check `.pi/skills/` for skills whose description already covers the detected pattern. Don't propose skills that duplicate existing ones.

5. **Sort by frequency × confidence** and return the top 5 patterns.

### Step 2: Draft skills from patterns

**In `GITCLAW-PATTERNS.ts`:**

```typescript
export function draftSkill(pattern: TaskPattern): { name: string; content: string }
```

**Implementation:**

```typescript
export function draftSkill(pattern: TaskPattern): { name: string; content: string } {
  // Generate a skill name from the pattern description
  const name = pattern.description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  
  // Build the SKILL.md content
  const content = `---
name: ${name}
description: ${pattern.description}. Use when the user asks about: ${pattern.commonPromptKeywords.slice(0, 5).join(", ")}. Auto-generated from ${pattern.frequency} similar conversations.
---

# ${pattern.description}

> 🤖 This skill was auto-generated by analyzing ${pattern.frequency} similar conversations
> across issues ${pattern.matchingIssues.map(n => `#${n}`).join(", ")}.

## When to Use

This skill is triggered when the user's request matches patterns like:
${pattern.examplePrompts.slice(0, 3).map(p => `- "${p.slice(0, 100)}"`).join("\n")}

## Approach

### Typical Tool Sequence
${pattern.commonToolSequence.map((tool, i) => `${i + 1}. \`${tool}\``).join("\n")}

### Key Files
${pattern.commonFilePaths.slice(0, 10).map(f => `- \`${f}\``).join("\n")}

## Response Format

${pattern.typicalOutputStructure}

## Example

Based on a representative past interaction:

**User asked:** "${pattern.examplePrompts[0]?.slice(0, 200) || 'N/A'}"

**Agent approach:**
1. ${pattern.commonToolSequence.slice(0, 5).map(t => `Used \`${t}\` tool`).join("\n1. ")}
2. Produced a response with ${[
    pattern.typicalOutputStructure.includes("code") ? "code blocks" : null,
    pattern.typicalOutputStructure.includes("list") ? "bullet lists" : null,
    pattern.typicalOutputStructure.includes("table") ? "tables" : null,
  ].filter(Boolean).join(", ") || "structured text"}

## Notes

- Confidence score: ${(pattern.confidence * 100).toFixed(0)}%
- Based on ${pattern.frequency} instances
- Review and refine this skill based on your specific needs
`;

  return { name, content };
}
```

### Step 3: Create the proposal mechanism

```typescript
export async function proposeSkills(
  patterns: TaskPattern[],
  repo: string,
  gitclawDir: string
): Promise<void> {
  for (const pattern of patterns.slice(0, 3)) { // max 3 proposals at once
    const { name, content } = draftSkill(pattern);
    
    // Check if this skill was already proposed (search for existing issues)
    const { stdout: existing } = await run([
      "gh", "issue", "list",
      "--label", "gitclaw:skill-proposal",
      "--search", `"${name}" in:title`,
      "--json", "number",
      "--jq", "length",
    ]);
    
    if (parseInt(existing.trim()) > 0) {
      console.log(`Skill "${name}" already proposed, skipping`);
      continue;
    }
    
    // Create the proposal issue
    const issueBody = [
      `## 🧠 Auto-Generated Skill Proposal: \`${name}\``,
      "",
      `I've detected a recurring pattern across ${pattern.frequency} conversations ` +
      `(issues ${pattern.matchingIssues.map(n => `#${n}`).join(", ")}):`,
      "",
      `> **${pattern.description}**`,
      "",
      `### Common Keywords`,
      pattern.commonPromptKeywords.map(k => `\`${k}\``).join(", "),
      "",
      `### Typical Tool Sequence`,
      pattern.commonToolSequence.map((t, i) => `${i + 1}. \`${t}\``).join("\n"),
      "",
      `### Frequently Accessed Files`,
      pattern.commonFilePaths.slice(0, 5).map(f => `- \`${f}\``).join("\n"),
      "",
      `### Proposed SKILL.md`,
      "```markdown",
      content,
      "```",
      "",
      `### How to Approve`,
      `- **Approve**: Add the \`gitclaw:skill-approved\` label to this issue`,
      `- **Reject**: Close this issue`,
      `- **Modify**: Comment with your changes and I'll update the draft`,
      "",
      `_Confidence: ${(pattern.confidence * 100).toFixed(0)}% · Based on ${pattern.frequency} instances_`,
    ].join("\n");
    
    // Ensure labels exist
    try {
      await run(["gh", "label", "create", "gitclaw:skill-proposal", "--color", "A855F7", "--force"]);
      await run(["gh", "label", "create", "gitclaw:skill-approved", "--color", "22C55E", "--force"]);
    } catch (e) { /* ignore */ }
    
    await run([
      "gh", "issue", "create",
      "--title", `🧠 Skill Proposal: ${name}`,
      "--body", issueBody,
      "--label", "gitclaw:skill-proposal",
    ]);
    
    console.log(`Proposed skill: ${name}`);
  }
}
```

### Step 4: Handle skill approval and installation

**In `GITCLAW-AGENT.ts`:**

When an issue with the `gitclaw:skill-approved` label is detected:

```typescript
// At the start of the try block, after event parsing:
const issueLabels = (event.issue?.labels || []).map((l: any) => l.name);

if (issueLabels.includes("gitclaw:skill-approved") && issueLabels.includes("gitclaw:skill-proposal")) {
  await installProposedSkill(issueNumber, repo);
  return; // Skip normal agent execution
}

async function installProposedSkill(issueNumber: number, repo: string): Promise<void> {
  // Fetch the issue body
  const body = await gh("issue", "view", String(issueNumber), "--json", "body", "--jq", ".body");
  
  // Extract the SKILL.md content from the code block
  const skillMatch = body.match(/```markdown\n(---\nname:[\s\S]*?)```/);
  if (!skillMatch) {
    await gh("issue", "comment", String(issueNumber), "--body",
      "❌ Could not extract SKILL.md content from this issue. Please ensure the skill definition is in a markdown code block.");
    return;
  }
  
  const skillContent = skillMatch[1];
  
  // Extract the skill name from frontmatter
  const nameMatch = skillContent.match(/name:\s*(.+)/);
  if (!nameMatch) {
    await gh("issue", "comment", String(issueNumber), "--body",
      "❌ Could not find skill name in frontmatter.");
    return;
  }
  
  const skillName = nameMatch[1].trim();
  const skillDir = resolve(gitclawDir, ".pi", "skills", skillName);
  
  // Install the skill
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(resolve(skillDir, "SKILL.md"), skillContent);
  
  // Commit and push
  await run(["git", "config", "user.name", "gitclaw[bot]"]);
  await run(["git", "config", "user.email", "gitclaw[bot]@users.noreply.github.com"]);
  await run(["git", "add", "-A"]);
  await run(["git", "commit", "-m", `gitclaw: install auto-generated skill "${skillName}" from issue #${issueNumber}`]);
  
  for (let i = 1; i <= 3; i++) {
    const push = await run(["git", "push", "origin", `HEAD:${defaultBranch}`]);
    if (push.exitCode === 0) break;
    await run(["git", "pull", "--rebase", "origin", defaultBranch]);
  }
  
  // Comment and close the issue
  await gh("issue", "comment", String(issueNumber), "--body",
    `✅ Skill \`${skillName}\` installed to \`.GITCLAW/.pi/skills/${skillName}/SKILL.md\`\n\n` +
    `The skill is now active and will be used by the agent when relevant conversations arise.\n\n` +
    `To modify it later, edit \`.GITCLAW/.pi/skills/${skillName}/SKILL.md\` directly.`);
  await gh("issue", "close", String(issueNumber));
}
```

### Step 5: Trigger pattern analysis

**Two trigger mechanisms:**

**A. Scheduled (weekly) — via scheduled cron runs (feature 04):**

Add a task to `scheduled-tasks.json`:
```json
{
  "id": "skill-suggestions",
  "title": "Weekly Skill Suggestions",
  "enabled": true,
  "prompt": "INTERNAL:detect-patterns"
}
```

In the scheduled task handler, detect the `INTERNAL:` prefix and route to pattern analysis instead of the LLM:
```typescript
if (task.prompt.startsWith("INTERNAL:detect-patterns")) {
  const patterns = await detectPatterns(stateDir);
  if (patterns.length > 0) {
    await proposeSkills(patterns, repo, gitclawDir);
  }
  continue; // skip normal agent execution for this task
}
```

**B. On-demand — via `/suggest-skills` command (if feature 02 is implemented):**

```typescript
if (parsed.isCommand && parsed.command === "suggest-skills") {
  const patterns = await detectPatterns(stateDir);
  if (patterns.length === 0) {
    await gh("issue", "comment", String(issueNumber), "--body",
      "No recurring patterns detected yet. I need more conversations to identify skill opportunities. " +
      "Try again after 10+ diverse interactions.");
  } else {
    await proposeSkills(patterns, repo, gitclawDir);
    await gh("issue", "comment", String(issueNumber), "--body",
      `🧠 Found ${patterns.length} recurring pattern(s). Opened proposal issues for review.`);
  }
  return;
}
```

### Step 6: Update documentation

**New file:** `.GITCLAW/docs/GITCLAW-Auto-Skills.md`
- How pattern detection works
- What constitutes a "pattern" (3+ similar sessions)
- How to approve, reject, or modify proposed skills
- How to trigger analysis manually
- How to disable auto-generation

**File:** `.GITCLAW/README.md`
- Add "Self-Improving Skills" to capabilities table

### Step 7: Test

- Create 4+ issues with similar requests (e.g., "How big is the .GITCLAW folder?", "What's the size of state/sessions?", "Show me repo size statistics", "Disk usage report"):
  1. Run `/suggest-skills` or trigger the weekly analysis.
  2. Verify a pattern is detected.
  3. Verify a skill proposal issue is created with the `gitclaw:skill-proposal` label.
  4. Verify the proposed SKILL.md is well-formed and references the source conversations.
- Add the `gitclaw:skill-approved` label to the proposal issue:
  1. Verify the skill is installed to `.pi/skills/`.
  2. Verify the proposal issue is closed with a confirmation comment.
- Ask a question matching the new skill:
  1. Verify the agent's response is influenced by the skill.
- Run analysis with fewer than 3 similar sessions:
  1. Verify no proposals are generated (threshold not met).

## Design Decisions

**Why require user approval instead of auto-installing?** Skills modify the agent's behavior for every future interaction. A bad skill could degrade quality, inject unwanted behavior, or consume excessive context window. Human review ensures that auto-generated skills meet the team's standards before they become active.

**Why keyword + tool-sequence clustering instead of embeddings?** Embeddings would require either a local model (slow on Actions runners) or an API call per session (expensive at scale). Keyword overlap + tool sequence matching is fast, deterministic, debuggable, and works well for the expected scale (hundreds of sessions). It catches the structural patterns that matter: "user asked about X, agent read files Y and Z, agent produced a table."

**Why propose via issues instead of PRs?** Skills are Markdown files, not code. An issue thread provides a better review interface for discussing the skill's scope, triggers, and instructions. If branch-per-task (feature 07) is active, the actual installation creates a PR anyway. The issue is for the *discussion*; the PR is for the *change*.

**Why limit to 3 proposals per analysis run?** Proposal fatigue. If the agent dumps 15 skill proposals at once, the user ignores all of them. 3 proposals per week is manageable — the user reviews them, approves the good ones, closes the bad ones, and the system learns from both signals.
