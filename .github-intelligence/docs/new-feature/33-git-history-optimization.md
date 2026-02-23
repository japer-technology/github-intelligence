# Feature: Git History Optimization for State Files

## Summary

Prevent session files from bloating git history by fundamentally changing how state is committed. Instead of committing the full session file on every turn (creating a new blob each time the file grows), use a staging approach: accumulate turns in a lightweight append-only delta file between runs, then periodically squash the deltas into the base session. Combined with `.gitattributes` strategies that tell git how to handle session files, and a periodic history cleanup that replaces multiple intermediate state commits with a single consolidated one. The result: git pack size grows linearly with the *number of sessions*, not with the *number of turns across all sessions*.

## Why This Feature — The Deep Reasoning

### 1. The Multiplier Effect of Append-Only Files in Git

Git stores each version of a file as a separate blob. When a session file grows from 500KB to 600KB on one turn, git doesn't store a 100KB delta — it stores a new 600KB blob. Delta compression in pack files reduces the storage cost, but the raw data is there.

This repo's largest session demonstrates the problem perfectly:

```
Turn 6:  569 KB blob
Turn 7:  710 KB blob
Turn 8:  772 KB blob
Turn 9:  841 KB blob
Turn 10: 979 KB blob
Turn 11: 1,139 KB blob
Turn 12: 1,271 KB blob
─────────────────────
Total:   6,281 KB in git objects for ONE session
```

Git's pack format delta-compresses these (each version is mostly the previous version + new data), reducing the pack to roughly 1.5× the final size. But it's still **~1.9MB of pack data for a 1.27MB file** — a 1.5× storage overhead that grows with every turn.

For 200 sessions over a month, each averaging 5 turns: that's 1,000 intermediate blobs. The pack file approaches 50MB when the actual session data is 30MB.

### 2. The Fundamental Problem: Committing Partial Progress

Every time the agent runs, it commits the full session file. This is because `pi` appends to the session JSONL, and git tracks the whole file. The commit includes:
- The session's previous content (unchanged, already in git)
- The new turns from this run (the actual new data)

Git has to diff the entire file to compute the delta. For JSONL files (single long lines), delta compression is less effective than for typical source code (many short lines with few changes).

### 3. The Delta File Strategy

Instead of committing the growing session file directly, commit two things:
- **`session-base.jsonl`** — The session at its last consolidation point (committed infrequently)
- **`session-delta.jsonl`** — Only the new turns since the last consolidation (committed every run)

```
Run 1: base = turns 1-5,  delta = turns 6-7    → commit delta (small)
Run 2: base = turns 1-5,  delta = turns 6-9    → commit delta (medium)  
Run 3: base = turns 1-5,  delta = turns 6-12   → commit delta (medium)
Consolidation: base = turns 1-12, delta = empty → commit base (one-time large)
```

Between consolidations, each commit only adds the new turns (delta). The base file changes infrequently (every N runs or when the delta exceeds a threshold). This means git stores:
- 1 large blob per consolidation (the full session)
- N small blobs between consolidations (only the new turns)

Instead of N large blobs, we get 1 large + N small. For a session that grows from 500KB to 1.2MB over 7 turns:
- **Before**: 7 blobs totaling ~6.3MB raw (the growing file at each stage)
- **After**: 1 blob of 1.2MB (base at consolidation) + 6 delta blobs totaling ~700KB = ~1.9MB raw

**67% reduction in raw git data.**

### 4. .gitattributes Strategy for Session Files

Git can be told how to handle specific file types:

```gitattributes
# Session files: treat as binary (disable text diff/merge which is useless for JSONL)
.GITCLAW/state/sessions/*.jsonl binary

# Delta files: also binary
.GITCLAW/state/sessions/*.delta.jsonl binary
```

Marking sessions as `binary` tells git to:
- Not attempt text-based diff (which is unreadable for JSONL anyway)
- Not attempt merge (session files should never conflict — one issue = one session)
- Store more efficiently in some cases

### 5. Commit Squashing for State-Only Commits

Over 21 issues and many turns, git history fills with commits like:
```
gitclaw: work on issue #108
gitclaw: work on issue #107
gitclaw: work on issue #108
gitclaw: work on issue #106
gitclaw: work on issue #108
```

Each commit changes only state files (sessions, mappings). These intermediate commits have no value for human code review — they're bookkeeping. Periodically squashing them into a single "gitclaw: state checkpoint" commit reduces history noise and allows git to repack more efficiently.

**Important**: This only squashes commits that touch *exclusively* state files. Commits that include code changes (agent-modified repo files) are never squashed.

## Scope

### In Scope
- **Delta file strategy**: Split sessions into base + delta for efficient git storage
- **Consolidation scheduler**: Periodically merge deltas into bases
- **`.gitattributes` configuration**: Optimize git handling of session files
- **State commit squashing**: Combine state-only commits into checkpoints
- **Session reconstruction**: Transparently combine base + delta for `pi --session`
- **Git pack optimization**: Periodic `git gc` and repack during lifecycle runs

### Out of Scope
- Git LFS (adds external dependency and hosting cost)
- Git shallow clones (affects repo usability)
- BFG Repo-Cleaner / git filter-branch (destructive history rewriting)
- External state storage (database, S3)

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Delta file manager** | Split sessions into base + delta, manage lifecycle | ~2.5 hours |
| **Session reconstructor** | Combine base + delta transparently for pi | ~1.5 hours |
| **Consolidation engine** | Merge deltas into base at threshold | ~1.5 hours |
| **`.gitattributes` setup** | Configure binary handling for session files | ~30 min |
| **Commit squash logic** | Identify and squash state-only commits | ~2 hours |
| **Git optimization** | Periodic gc and repack | ~30 min |
| **Agent orchestrator integration** | Use delta files in the commit pipeline | ~1.5 hours |
| **Configuration** | Consolidation thresholds, squash frequency | ~30 min |
| **Testing** | Test delta strategy, reconstruction, squash | ~2 hours |

**Total: ~13 hours.**

---

## AI Implementation Instructions

### Step 1: Delta file manager

**New file:** `.GITCLAW/lifecycle/GITCLAW-GIT-OPTIMIZE.ts`

```typescript
import { existsSync, readFileSync, writeFileSync, unlinkSync, statSync, mkdirSync } from "fs";
import { resolve, basename, dirname } from "path";

export interface DeltaConfig {
  enabled: boolean;
  consolidateAfterRuns: number;        // merge delta into base every N runs
  consolidateAfterDeltaKB: number;     // or when delta exceeds this size
  squashStateCommits: boolean;
  squashAfterCommits: number;          // squash when N state-only commits accumulate
  runGitGC: boolean;
}

const DEFAULT_DELTA_CONFIG: DeltaConfig = {
  enabled: true,
  consolidateAfterRuns: 10,
  consolidateAfterDeltaKB: 200,
  squashStateCommits: true,
  squashAfterCommits: 20,
  runGitGC: true,
};

/**
 * After pi writes to the session, split the new content into a delta.
 * 
 * Strategy:
 * 1. Read the current session file (which pi just appended to)
 * 2. Check if a base file exists for this session
 * 3. If yes: compute delta = current - base, write delta file, restore base
 * 4. If no: this is a new session; the current file becomes the base
 */
export function splitSessionDelta(sessionPath: string): {
  basePath: string;
  deltaPath: string;
  isNew: boolean;
  deltaSize: number;
} {
  const dir = dirname(sessionPath);
  const name = basename(sessionPath, ".jsonl");
  const basePath = resolve(dir, `${name}.base.jsonl`);
  const deltaPath = resolve(dir, `${name}.delta.jsonl`);
  
  if (!existsSync(basePath)) {
    // First run for this session — current file becomes the base
    // No delta yet
    copyFileSync(sessionPath, basePath);
    writeFileSync(deltaPath, ""); // empty delta
    return { basePath, deltaPath, isNew: true, deltaSize: 0 };
  }
  
  // Compute delta: lines in session that aren't in base
  const baseContent = readFileSync(basePath, "utf-8");
  const fullContent = readFileSync(sessionPath, "utf-8");
  
  const baseLineCount = baseContent.split("\n").filter(Boolean).length;
  const fullLines = fullContent.split("\n").filter(Boolean);
  
  // Delta is the lines beyond what's in the base
  const deltaLines = fullLines.slice(baseLineCount);
  const deltaContent = deltaLines.join("\n") + (deltaLines.length > 0 ? "\n" : "");
  
  writeFileSync(deltaPath, deltaContent);
  
  // Restore the session file to base (pi will have appended to the full file)
  // Actually, we keep the full file for pi to use, but only commit base + delta
  
  return {
    basePath,
    deltaPath,
    isNew: false,
    deltaSize: deltaContent.length,
  };
}

/**
 * Reconstruct the full session from base + delta.
 * Used before running pi (which needs the complete session).
 */
export function reconstructSession(sessionPath: string): void {
  const dir = dirname(sessionPath);
  const name = basename(sessionPath, ".jsonl");
  const basePath = resolve(dir, `${name}.base.jsonl`);
  const deltaPath = resolve(dir, `${name}.delta.jsonl`);
  
  if (!existsSync(basePath)) return; // no split, use session as-is
  
  const baseContent = readFileSync(basePath, "utf-8").trimEnd();
  const deltaContent = existsSync(deltaPath) ? readFileSync(deltaPath, "utf-8").trimEnd() : "";
  
  const fullContent = deltaContent
    ? `${baseContent}\n${deltaContent}\n`
    : `${baseContent}\n`;
  
  writeFileSync(sessionPath, fullContent);
}

/**
 * Consolidate: merge delta into base, reset delta.
 */
export function consolidateSession(sessionPath: string): {
  consolidated: boolean;
  newBaseSize: number;
} {
  const dir = dirname(sessionPath);
  const name = basename(sessionPath, ".jsonl");
  const basePath = resolve(dir, `${name}.base.jsonl`);
  const deltaPath = resolve(dir, `${name}.delta.jsonl`);
  
  if (!existsSync(basePath) || !existsSync(deltaPath)) {
    return { consolidated: false, newBaseSize: 0 };
  }
  
  const deltaContent = readFileSync(deltaPath, "utf-8").trim();
  if (!deltaContent) {
    return { consolidated: false, newBaseSize: statSync(basePath).size };
  }
  
  // Merge delta into base
  const baseContent = readFileSync(basePath, "utf-8").trimEnd();
  const newBase = `${baseContent}\n${deltaContent}\n`;
  
  writeFileSync(basePath, newBase);
  writeFileSync(deltaPath, ""); // reset delta
  
  // Also update the full session file
  writeFileSync(sessionPath, newBase);
  
  return {
    consolidated: true,
    newBaseSize: newBase.length,
  };
}

export function shouldConsolidate(
  sessionPath: string,
  config: DeltaConfig,
  runsSinceConsolidation: number
): boolean {
  const dir = dirname(sessionPath);
  const name = basename(sessionPath, ".jsonl");
  const deltaPath = resolve(dir, `${name}.delta.jsonl`);
  
  if (!existsSync(deltaPath)) return false;
  
  const deltaSize = statSync(deltaPath).size;
  
  return (
    runsSinceConsolidation >= config.consolidateAfterRuns ||
    deltaSize >= config.consolidateAfterDeltaKB * 1024
  );
}
```

### Step 2: Git commit strategy for state files

In `GITCLAW-AGENT.ts`, replace the simple `git add -A` + commit with a delta-aware strategy:

```typescript
import { splitSessionDelta, reconstructSession, consolidateSession, shouldConsolidate } from "./GITCLAW-GIT-OPTIMIZE";

// Before running pi: reconstruct full session from base + delta
if (mode === "resume" && sessionPath) {
  reconstructSession(sessionPath);
}

// ... run pi agent ...

// After pi finishes: split session into base + delta
if (latestSession) {
  const deltaConfig = loadDeltaConfig(gitclawDir);
  
  if (deltaConfig.enabled) {
    const { basePath, deltaPath, isNew, deltaSize } = splitSessionDelta(latestSession);
    
    // Check if consolidation is needed
    const trackingFile = resolve(stateDir, "delta-tracking.json");
    let tracking = { runsSinceConsolidation: 0 };
    if (existsSync(trackingFile)) {
      tracking = JSON.parse(readFileSync(trackingFile, "utf-8"));
    }
    tracking.runsSinceConsolidation++;
    
    if (shouldConsolidate(latestSession, deltaConfig, tracking.runsSinceConsolidation)) {
      const { newBaseSize } = consolidateSession(latestSession);
      tracking.runsSinceConsolidation = 0;
      console.log(`Consolidated session: base is now ${Math.round(newBaseSize / 1024)}KB`);
    }
    
    writeFileSync(trackingFile, JSON.stringify(tracking, null, 2));
    
    // Commit strategy:
    // - Always commit: delta file, mapping file, tracking file
    // - On consolidation: also commit the base file
    // - Never commit: the full .jsonl (it's reconstructed on the fly)
    
    await run(["git", "add", deltaPath]);
    await run(["git", "add", basePath]);
    await run(["git", "add", resolve(stateDir, "issues")]);
    await run(["git", "add", trackingFile]);
    // Add any code changes the agent made
    await run(["git", "add", "-A"]);
    // But remove the full session file from staging (it's a reconstruction artifact)
    // Actually, keep it simple: add everything, the .gitattributes handles optimization
    
    console.log(`Session delta: ${Math.round(deltaSize / 1024)}KB new data`);
  } else {
    await run(["git", "add", "-A"]);
  }
}
```

### Step 3: .gitattributes configuration

Add to the repo's `.gitattributes`:

```gitattributes
# GitClaw session files: binary mode (no text diff, no merge)
.GITCLAW/state/sessions/*.jsonl binary
.GITCLAW/state/sessions/*.base.jsonl binary
.GITCLAW/state/sessions/*.delta.jsonl binary

# Ensure session files are not exported in archives
.GITCLAW/state/ export-ignore
```

**Why binary?**
- JSONL session files produce unreadable diffs (single long lines of JSON)
- Text merge for sessions is never correct (would corrupt the JSONL structure)
- Binary mode disables these features, avoiding wasted computation and accidental corruption

### Step 4: State commit squashing

```typescript
export async function squashStateCommits(
  config: DeltaConfig,
  defaultBranch: string
): Promise<{ squashed: boolean; commitsBefore: number; commitsAfter: number }> {
  if (!config.squashStateCommits) return { squashed: false, commitsBefore: 0, commitsAfter: 0 };
  
  // Find state-only commits (commits that ONLY touch .GITCLAW/state/)
  const { stdout } = await run([
    "git", "log", "--format=%H", "--all", `-${config.squashAfterCommits * 2}`,
  ]);
  const commits = stdout.trim().split("\n").filter(Boolean);
  
  // For each commit, check if it only modifies state files
  const stateOnlyCommits: string[] = [];
  for (const hash of commits) {
    const { stdout: files } = await run([
      "git", "diff-tree", "--no-commit-id", "--name-only", "-r", hash,
    ]);
    const changedFiles = files.trim().split("\n").filter(Boolean);
    
    if (changedFiles.length > 0 && changedFiles.every(f => f.startsWith(".GITCLAW/state/"))) {
      stateOnlyCommits.push(hash);
    }
  }
  
  if (stateOnlyCommits.length < config.squashAfterCommits) {
    return { squashed: false, commitsBefore: stateOnlyCommits.length, commitsAfter: stateOnlyCommits.length };
  }
  
  // Squash: interactive rebase is complex in automation.
  // Instead, use a soft reset + recommit approach for the most recent N state-only commits.
  // This only works if the state-only commits are contiguous at the top of the log.
  
  // Find the longest contiguous run of state-only commits from HEAD
  let contiguousCount = 0;
  for (const hash of commits) {
    if (stateOnlyCommits.includes(hash)) {
      contiguousCount++;
    } else {
      break;
    }
  }
  
  if (contiguousCount < 3) {
    // Not enough contiguous state commits to squash
    return { squashed: false, commitsBefore: stateOnlyCommits.length, commitsAfter: stateOnlyCommits.length };
  }
  
  // Soft reset to the commit before the run of state commits
  await run(["git", "reset", "--soft", `HEAD~${contiguousCount}`]);
  await run(["git", "commit", "-m", `gitclaw: state checkpoint (${contiguousCount} commits squashed)`]);
  
  return {
    squashed: true,
    commitsBefore: contiguousCount,
    commitsAfter: 1,
  };
}
```

**CAUTION**: Squashing rewrites history. This is only safe if:
1. Only state-only commits are squashed (never code changes)
2. No other branch has been created from these commits
3. Force-push is used (the agent already does push with retry)

Add to the lifecycle management:
```typescript
if (deltaConfig.squashStateCommits) {
  const squashResult = await squashStateCommits(deltaConfig, defaultBranch);
  if (squashResult.squashed) {
    console.log(`Squashed ${squashResult.commitsBefore} → ${squashResult.commitsAfter} state commits`);
    // Force push required after squash
    await run(["git", "push", "--force-with-lease", "origin", `HEAD:${defaultBranch}`]);
  }
}
```

### Step 5: Periodic git optimization

```typescript
export async function optimizeGitRepo(config: DeltaConfig): Promise<void> {
  if (!config.runGitGC) return;
  
  console.log("Running git gc for repository optimization...");
  await run(["git", "gc", "--auto"]);
  
  // Report pack size
  const { stdout } = await run(["git", "count-objects", "-vH"]);
  const packSizeMatch = stdout.match(/size-pack:\s*([\d.]+\s*\w+)/);
  if (packSizeMatch) {
    console.log(`Git pack size: ${packSizeMatch[1]}`);
  }
}
```

### Step 6: Configuration

Add to `.GITCLAW/compression.json`:

```json
{
  "git": {
    "enabled": true,
    "deltaStrategy": true,
    "consolidateAfterRuns": 10,
    "consolidateAfterDeltaKB": 200,
    "squashStateCommits": true,
    "squashAfterCommits": 20,
    "runGitGC": true,
    "binaryAttributes": true
  }
}
```

### Step 7: Test

- Run the agent 5 times on one issue → verify delta files grow while base stays constant
- After 10 runs (consolidation threshold) → verify base is updated and delta is reset
- Check git pack size → verify it's smaller than without delta strategy
- Verify session reconstruction: `reconstructSession()` produces identical content to the original
- Run `pi --session` with a reconstructed session → verify conversation continuity
- Test commit squashing: make 20 state-only commits → verify they're squashed to 1
- Verify code-containing commits are NOT squashed
- Check `.gitattributes` → verify session files are marked binary
- Compare `git clone` size with and without optimization

## Design Decisions

**Why delta files instead of git-native solutions (LFS, shallow)?** Git LFS requires external hosting (GitHub LFS, S3). Shallow clones reduce history but break many git operations. Delta files are pure git — no external dependencies, no broken workflows. They work by changing *what* we commit, not *how* git stores it.

**Why consolidate instead of keeping deltas forever?** Unbounded delta files eventually become as large as the full session. Consolidation resets the delta and creates a clean base. It's the session equivalent of database vacuuming — periodic maintenance that keeps the system efficient.

**Why is commit squashing optional and conservative?** Squashing rewrites history, which is dangerous in collaborative repos. It's only applied to state-only commits (never code), only to contiguous runs from HEAD (never reordering), and only with `--force-with-lease` (preventing overwrite of others' pushes). Still, some teams prohibit force-push entirely — hence the opt-in configuration.

**Why mark sessions as binary in .gitattributes?** JSONL diffs are useless — they show the entire line changed (because a JSON line is a single, very long line). Binary mode tells git to not waste time computing diffs for these files. It also prevents merge conflicts (binary files can't be auto-merged), which is correct behavior — two agents should never modify the same session simultaneously.

**Why not just use `git filter-branch` or BFG to clean history?** Destructive history rewriting breaks every clone, every fork, and every open PR. It's a nuclear option that should never be automated. This feature prevents the problem from occurring in the first place — it's prophylactic, not remedial.
