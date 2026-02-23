# Feature: Inline Code Suggestions

## Summary

When the agent proposes code changes, instead of (or in addition to) directly modifying files and committing, it posts GitHub-native suggestion blocks in issue comments that the user can apply, modify, or dismiss with a single click. For each proposed change, the agent shows the current code, the proposed replacement, and a brief rationale — all in a format that makes the diff instantly visible. For changes involving branch-per-task PRs (feature 07), the agent uses GitHub's native PR suggestion syntax, enabling one-click "Apply suggestion" commits. This gives the user surgical control over every change the agent proposes.

## Why This Feature — The Deep Reasoning

### 1. The All-or-Nothing Problem

Today, the agent either modifies a file (full commit) or explains what to change (the user has to do it manually). There's no middle ground. If the agent modifies 5 files and the user agrees with 4 but not the 5th, they have to use `/undo` (feature 11) to revert everything and then re-request just the 4 changes. Or they manually fix the 5th file. Both are friction.

Inline suggestions solve this: each change is an independent, reviewable unit. The user applies the ones they like and ignores the rest. This is how human code review already works — suggestions in PRs. The agent adopts the same pattern.

### 2. GitHub's Suggestion Syntax Is the Native Interface

In PR reviews, GitHub supports:

````markdown
```suggestion
replacement code here
```
````

When posted as a PR review comment on a specific line range, GitHub renders this as a diff with an "Apply suggestion" button. One click creates a commit with that exact change. It's the lowest-friction way to apply a code change.

For issue comments (not PR reviews), the suggestion syntax doesn't produce a clickable button, but it still renders as a clear diff-style block. The agent can use a custom format that shows before/after clearly:

````markdown
📝 **Suggested change** in `src/auth.ts:42-47`:

```diff
- function login(user: string) {
-   return authenticate(user);
+ function login(user: string, password: string) {
+   return authenticate(user, password);
  }
```

_Reason: The `login` function is missing the password parameter._
````

### 3. It Changes the Trust Dynamic

"The agent edited 8 files and committed" requires trust that all 8 edits are correct. "The agent proposes 8 changes for your review" requires trust only in the agent's analysis — the user makes the final call on each change. This is a fundamentally more trustworthy interaction model for code changes.

It creates a spectrum of trust:
- **Low trust**: Agent only suggests, never commits (suggestion mode)
- **Medium trust**: Agent suggests for high-risk changes, commits for low-risk (hybrid mode)
- **High trust**: Agent commits everything (current behavior, direct mode)

Teams can start at low trust and graduate to higher trust as confidence builds.

### 4. It Composes With PR Review (Feature 01) and Approval Gates (Feature 21)

When the agent creates a PR (feature 07) and reviews it (feature 01), the suggestions can be native GitHub PR suggestions — literally clickable "Apply suggestion" buttons. When approval gates (feature 21) require review for high-risk changes, suggestions provide the review mechanism: instead of a binary approve/reject, the user reviews each change individually.

### 5. Diff Visualization Is the Universal Code Review Language

Every developer reads diffs. A `- old / + new` format is the most universally understood way to communicate a code change. By presenting changes as diffs rather than paragraphs of explanation, the agent communicates in the language developers already use for code review.

## Scope

### In Scope
- **Suggestion generation**: For each file change, generate a before/after suggestion block
- **Issue comment suggestions**: Diff-formatted suggestions in issue comments
- **PR review suggestions**: Native GitHub suggestion syntax in PR review comments
- **Suggestion modes**: "suggest-only" (no commit), "suggest-and-commit" (both), "commit-only" (current)
- **Per-file granularity**: Each file change is a separate suggestion block
- **Rationale annotations**: Brief explanation of why each change is proposed
- **Batch apply**: User can reply with `/apply all` to commit all suggestions at once
- **Selective apply**: User can reply with `/apply 1,3,5` to apply specific suggestions

### Out of Scope
- Interactive editing of suggestions (user modifies the suggested code in-place)
- Suggestion merging (combining multiple suggestions into one commit)
- Cross-file suggestions (a single suggestion spanning multiple files)

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Diff generator** | Compare original vs modified files, produce diff blocks | ~2 hours |
| **Suggestion formatter** | Format diffs as GitHub-compatible suggestion blocks | ~1.5 hours |
| **Mode selector** | Choose between suggest/commit/hybrid based on config and risk | ~1 hour |
| **PR suggestion integration** | Post native suggestions in PR reviews | ~2 hours |
| **Batch/selective apply** | Handle `/apply` commands to commit suggestions | ~1.5 hours |
| **Agent orchestrator integration** | Intercept file changes, format as suggestions | ~1.5 hours |
| **Configuration** | Suggestion mode, risk thresholds | ~30 min |
| **Docs** | Document suggestion system | ~30 min |
| **Testing** | Test diff generation, formatting, apply commands | ~1.5 hours |

**Total: ~12 hours.**

---

## AI Implementation Instructions

### Step 1: Diff generator

**New file:** `.GITCLAW/lifecycle/GITCLAW-SUGGEST.ts`

```typescript
export interface FileSuggestion {
  file: string;
  action: "create" | "modify" | "delete";
  oldContent: string;
  newContent: string;
  hunks: DiffHunk[];
  rationale?: string;
}

export interface DiffHunk {
  oldStart: number;
  oldLines: string[];
  newStart: number;
  newLines: string[];
  context: string;             // brief description of what this hunk changes
}

export async function generateSuggestions(
  changedFiles: string[],
  repoRoot: string
): Promise<FileSuggestion[]> {
  const suggestions: FileSuggestion[] = [];
  
  for (const file of changedFiles) {
    // Skip state files
    if (file.startsWith(".GITCLAW/state/")) continue;
    
    const fullPath = resolve(repoRoot, file);
    
    // Get the original content from HEAD
    let oldContent = "";
    try {
      const { stdout } = await run(["git", "show", `HEAD:${file}`]);
      oldContent = stdout;
    } catch (e) {
      // File is new
    }
    
    // Get the current (modified) content
    let newContent = "";
    if (existsSync(fullPath)) {
      newContent = readFileSync(fullPath, "utf-8");
    }
    
    // Determine action
    let action: "create" | "modify" | "delete";
    if (!oldContent && newContent) action = "create";
    else if (oldContent && !newContent) action = "delete";
    else action = "modify";
    
    // Generate hunks (unified diff style)
    const hunks = generateDiffHunks(oldContent, newContent);
    
    suggestions.push({
      file,
      action,
      oldContent,
      newContent,
      hunks,
    });
  }
  
  return suggestions;
}

function generateDiffHunks(oldContent: string, newContent: string): DiffHunk[] {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const hunks: DiffHunk[] = [];
  
  // Simple LCS-based diff (for production, use a proper diff library)
  // Find changed regions by comparing line-by-line
  let i = 0, j = 0;
  
  while (i < oldLines.length || j < newLines.length) {
    // Skip matching lines
    if (i < oldLines.length && j < newLines.length && oldLines[i] === newLines[j]) {
      i++; j++;
      continue;
    }
    
    // Found a difference — collect the hunk
    const hunkOldStart = i + 1;
    const hunkNewStart = j + 1;
    const hunkOldLines: string[] = [];
    const hunkNewLines: string[] = [];
    
    // Collect different lines
    while (i < oldLines.length && (j >= newLines.length || oldLines[i] !== newLines[j])) {
      // Check if the old line appears later in new (deletion)
      const futureMatch = newLines.indexOf(oldLines[i], j);
      if (futureMatch === -1 || futureMatch - j > 10) {
        hunkOldLines.push(oldLines[i]);
        i++;
      } else {
        // Add new lines until we reach the match
        while (j < futureMatch) {
          hunkNewLines.push(newLines[j]);
          j++;
        }
        break;
      }
    }
    
    while (j < newLines.length && (i >= oldLines.length || oldLines[i] !== newLines[j])) {
      hunkNewLines.push(newLines[j]);
      j++;
    }
    
    if (hunkOldLines.length > 0 || hunkNewLines.length > 0) {
      hunks.push({
        oldStart: hunkOldStart,
        oldLines: hunkOldLines,
        newStart: hunkNewStart,
        newLines: hunkNewLines,
        context: `Lines ${hunkOldStart}-${hunkOldStart + hunkOldLines.length}`,
      });
    }
  }
  
  return hunks;
}
```

### Step 2: Suggestion formatter

```typescript
export function formatSuggestionsForIssue(
  suggestions: FileSuggestion[],
  includeNumbers: boolean = true
): string {
  const sections: string[] = [];
  
  sections.push("## 📝 Proposed Changes\n");
  sections.push(`_${suggestions.length} file(s) · Review each change and reply with \`/apply all\` or \`/apply 1,3\` to apply selectively._\n`);
  
  let num = 0;
  for (const suggestion of suggestions) {
    num++;
    const prefix = includeNumbers ? `**${num}.** ` : "";
    const icon = { create: "✨", modify: "📝", delete: "🗑️" }[suggestion.action];
    
    sections.push(`### ${prefix}${icon} \`${suggestion.file}\` (${suggestion.action})\n`);
    
    if (suggestion.action === "create") {
      // Show the full new file content
      const ext = suggestion.file.split(".").pop() || "text";
      sections.push("```" + ext);
      sections.push(suggestion.newContent.slice(0, 3000));
      if (suggestion.newContent.length > 3000) {
        sections.push(`\n... (${suggestion.newContent.split("\n").length} lines total)`);
      }
      sections.push("```\n");
    } else if (suggestion.action === "delete") {
      sections.push(`_This file will be deleted._\n`);
    } else {
      // Show diff hunks
      for (const hunk of suggestion.hunks.slice(0, 10)) {
        sections.push("```diff");
        for (const line of hunk.oldLines) {
          sections.push(`- ${line}`);
        }
        for (const line of hunk.newLines) {
          sections.push(`+ ${line}`);
        }
        sections.push("```\n");
      }
      if (suggestion.hunks.length > 10) {
        sections.push(`_...and ${suggestion.hunks.length - 10} more hunks._\n`);
      }
    }
    
    if (suggestion.rationale) {
      sections.push(`> 💡 ${suggestion.rationale}\n`);
    }
  }
  
  sections.push("---");
  sections.push("**Actions:**");
  sections.push("- `/apply all` — apply all suggestions and commit");
  sections.push("- `/apply 1,3,5` — apply specific suggestions by number");
  sections.push("- `/reject` — discard all suggestions");
  sections.push("- Reply with feedback to refine the suggestions");
  
  return sections.join("\n");
}
```

### Step 3: PR suggestion integration

For PRs (feature 07), use GitHub's native suggestion syntax in review comments:

```typescript
export async function postPRSuggestions(
  suggestions: FileSuggestion[],
  prNumber: number,
  repo: string,
  commitSha: string
): Promise<void> {
  const reviewComments: any[] = [];
  
  for (const suggestion of suggestions) {
    if (suggestion.action !== "modify") continue;
    
    for (const hunk of suggestion.hunks) {
      // GitHub PR suggestion format requires a specific line range
      const body = [
        suggestion.rationale ? `💡 ${suggestion.rationale}\n` : "",
        "```suggestion",
        ...hunk.newLines,
        "```",
      ].filter(Boolean).join("\n");
      
      reviewComments.push({
        path: suggestion.file,
        start_line: hunk.oldStart,
        line: hunk.oldStart + hunk.oldLines.length - 1,
        side: "RIGHT",
        body,
      });
    }
  }
  
  if (reviewComments.length === 0) return;
  
  // Post as a PR review with suggestions
  await run([
    "gh", "api", `repos/${repo}/pulls/${prNumber}/reviews`,
    "-X", "POST",
    "-f", `commit_id=${commitSha}`,
    "-f", `body=📝 I've reviewed the changes and have ${reviewComments.length} suggestion(s).`,
    "-f", `event=COMMENT`,
    "--input", "-",
  ]);
  // Note: actual implementation would use JSON body with comments array
}
```

### Step 4: Apply command handler

```typescript
export async function applySuggestions(
  indices: number[] | "all",
  suggestions: FileSuggestion[],
  repoRoot: string,
  issueNumber: number,
  repo: string
): Promise<{ applied: number; skipped: number }> {
  let applied = 0;
  let skipped = 0;
  
  const toApply = indices === "all"
    ? suggestions
    : suggestions.filter((_, i) => indices.includes(i + 1));
  
  for (const suggestion of toApply) {
    const fullPath = resolve(repoRoot, suggestion.file);
    
    try {
      if (suggestion.action === "create") {
        mkdirSync(path.dirname(fullPath), { recursive: true });
        writeFileSync(fullPath, suggestion.newContent);
      } else if (suggestion.action === "modify") {
        writeFileSync(fullPath, suggestion.newContent);
      } else if (suggestion.action === "delete") {
        if (existsSync(fullPath)) unlinkSync(fullPath);
      }
      applied++;
    } catch (e) {
      console.error(`Failed to apply suggestion for ${suggestion.file}: ${e}`);
      skipped++;
    }
  }
  
  if (applied > 0) {
    await run(["git", "add", "-A"]);
    await run(["git", "commit", "-m",
      `gitclaw: apply ${applied} suggestion(s) from issue #${issueNumber}`]);
    
    // Push with retry
    for (let i = 1; i <= 3; i++) {
      const push = await run(["git", "push", "origin", `HEAD:${defaultBranch}`]);
      if (push.exitCode === 0) break;
      await run(["git", "pull", "--rebase", "origin", defaultBranch]);
    }
  }
  
  return { applied, skipped };
}
```

### Step 5: Mode configuration and integration

```typescript
export type SuggestionMode = "suggest-only" | "suggest-and-commit" | "commit-only";

export function determineSuggestionMode(
  config: { defaultMode: SuggestionMode; riskThreshold: RiskLevel },
  riskLevel: RiskLevel
): SuggestionMode {
  if (config.defaultMode === "commit-only") return "commit-only";
  if (config.defaultMode === "suggest-only") return "suggest-only";
  
  // Hybrid: suggest for high-risk, commit for low-risk
  const riskOrder: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  const thresholdOrder: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2, critical: 3 };
  
  if (riskOrder[riskLevel] >= thresholdOrder[config.riskThreshold]) {
    return "suggest-only";
  }
  return "commit-only";
}
```

In `GITCLAW-AGENT.ts`:

```typescript
// After agent runs and changes are staged:
const suggestionConfig = loadSuggestionConfig(gitclawDir);
const mode = determineSuggestionMode(suggestionConfig, riskAssessment.level);

if (mode === "suggest-only" || mode === "suggest-and-commit") {
  const suggestions = await generateSuggestions(codeChanges, process.cwd());
  
  if (suggestions.length > 0) {
    const formatted = formatSuggestionsForIssue(suggestions);
    
    // Store suggestions for later apply
    writeFileSync(
      resolve(stateDir, "pending-suggestions.json"),
      JSON.stringify({ issueNumber, suggestions, createdAt: new Date().toISOString() }, null, 2)
    );
    
    if (mode === "suggest-only") {
      // Revert code changes, keep state
      for (const file of codeChanges) {
        await run(["git", "checkout", "HEAD", "--", file]);
      }
      agentText = formatted;
    } else {
      // suggest-and-commit: commit AND show suggestions
      agentText += "\n\n" + formatted;
    }
  }
}

// Handle /apply command:
if (parsed.isCommand && parsed.command === "apply") {
  const pendingFile = resolve(stateDir, "pending-suggestions.json");
  if (!existsSync(pendingFile)) {
    await gh("issue", "comment", String(issueNumber), "--body",
      "No pending suggestions to apply.");
    return;
  }
  
  const pending = JSON.parse(readFileSync(pendingFile, "utf-8"));
  const indices = parsed.args === "all" ? "all" : parsed.args.split(",").map(Number);
  const { applied, skipped } = await applySuggestions(
    indices, pending.suggestions, process.cwd(), issueNumber, repo
  );
  
  await gh("issue", "comment", String(issueNumber), "--body",
    `✅ Applied ${applied} suggestion(s)${skipped > 0 ? `, ${skipped} skipped` : ""}.`);
  
  unlinkSync(pendingFile);
  return;
}
```

### Step 6: Configuration

Add to `.GITCLAW/suggestions.json`:

```json
{
  "defaultMode": "suggest-and-commit",
  "riskThreshold": "high",
  "maxSuggestionsPerComment": 15,
  "showRationale": true,
  "enablePRSuggestions": true
}
```

### Step 7: Test

- Ask the agent to modify a file in suggest-only mode → verify diff is posted, file is NOT committed
- Reply with `/apply all` → verify the change is committed
- Reply with `/apply 1,3` → verify only those suggestions are applied
- In suggest-and-commit mode → verify both the diff display AND the commit happen
- In commit-only mode → verify normal behavior (no suggestion display)
- Create a PR with suggestions → verify native GitHub suggestion blocks with "Apply suggestion" buttons

## Design Decisions

**Why diff format instead of full file content?** Diffs show exactly what changes. Full file content requires the user to spot the differences. For a 200-line file with a 3-line change, a diff shows 3 lines; full content shows 200. Diffs are the universal language of code review.

**Why store pending suggestions in state?** Suggestions need to survive between the "propose" run and the "apply" run. The user reads the suggestions, decides, and posts `/apply` as a new comment — which triggers a new workflow run. The pending suggestions must be in git state for the next run to find them.

**Why three modes?** Different teams have different trust levels. An open-source project might want "suggest-only" for external contributors and "commit-only" for maintainers. A new GitClaw installation might start with "suggest-and-commit" (show what happened + commit it) and graduate to "commit-only" once trust is established.
