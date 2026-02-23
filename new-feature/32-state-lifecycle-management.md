# Feature: State Lifecycle Management & Archival

## Summary

Implement a state lifecycle manager that prevents the `.GITCLAW/state/` directory from growing without bound. Sessions follow a lifecycle: **active** (currently in use) → **dormant** (issue closed, no activity in N days) → **archived** (moved to a git archive branch, removed from main) → **purged** (deleted after retention period). Dormant sessions are compressed (feature 31) before archival. Archived sessions are moved to a `gitclaw/archive` branch where they don't affect clone size for the main branch. The state directory includes an index of archived sessions so the agent can locate and restore them if an issue is reopened. This prevents the inevitable entropy of months of agent usage from degrading repository performance.

## Why This Feature — The Deep Reasoning

### 1. State Growth Is Unbounded and Accelerating

After **3 days** of usage, this repository has:
- 21 sessions totaling 2.9MB in `state/sessions/`
- 21 issue mappings totaling 88KB in `state/issues/`

Projected growth:

| Period | Sessions | State Size | Git Pack Size |
|---|---|---|---|
| 3 days (now) | 21 | 2.9 MB | 1.5 MB |
| 1 month | ~200 | ~30 MB | ~20 MB |
| 6 months | ~1,200 | ~180 MB | ~150 MB |
| 1 year | ~2,400 | ~350 MB | ~300 MB |

At the 6-month mark, `git clone` downloads 150MB+ of AI conversation transcripts. For a small project where the actual code is 500KB, the state data outweighs the code by 300×. This makes the repo impractical to clone, browse, or fork.

### 2. Git History Makes It Worse Than It Looks

Every commit that modifies a session file creates a new blob in git's object database. The largest session in this repo has been committed **7 times** in 3 days — once per turn where it grew. That's 7 copies:

```
1271 KB  session.jsonl (turn 12)
1139 KB  session.jsonl (turn 11)
 979 KB  session.jsonl (turn 10)
 841 KB  session.jsonl (turn 9)
 772 KB  session.jsonl (turn 8)
 710 KB  session.jsonl (turn 7)
 569 KB  session.jsonl (turn 6)
```

Total: **6.28MB of git objects for a single session.** Git's delta compression reduces this in pack files, but the raw data grows with every turn. After a year of active use, git history could reach gigabytes.

### 3. Most Sessions Are Dead Weight

Of the 21 sessions in this repo:
- **1** is currently active (this conversation)
- **3** are for issues with recent activity (last 24 hours)
- **17** are dormant (their issues are inactive or closed)

Those 17 dormant sessions consume 1.6MB on main and much more in git history. They serve no purpose for active work. They should be archived off main.

### 4. Archival ≠ Deletion

Archived sessions aren't deleted — they're moved to a `gitclaw/archive` branch. This means:
- **They're still in git** — accessible via `git checkout gitclaw/archive`
- **They don't affect clone** — `git clone` only fetches the default branch by default
- **They're restorable** — if an issue is reopened, the session can be restored from the archive
- **They're auditable** — the archive branch is a complete record of all past conversations

### 5. `.gitattributes` Already Excludes State From Exports

The repo's `.gitattributes` (checked during investigation) already has export-ignore patterns for state files. This feature extends that principle: state files should be as invisible as possible to non-agent workflows.

### 6. It Composes With Every State-Producing Feature

| Feature | State Lifecycle Impact |
|---|---|
| **Session Compression (31)** | Compress before archiving for maximum space savings |
| **Knowledge Base (17)** | Extract knowledge before archiving (don't lose insights) |
| **Cross-Issue Context (08)** | Archive index enables search across archived sessions |
| **Cost Tracking (05)** | Cost data survives archival (aggregated in separate metrics) |
| **Error Tracking (27)** | Error logs are separate from sessions and have their own retention |
| **Dashboard (14)** | Dashboard reads from aggregated metrics, not raw sessions |

## Scope

### In Scope
- **Session lifecycle states**: active, dormant, archived, purged
- **Dormancy detection**: Issue closed + no activity in N days = dormant
- **Compression before archival**: Apply session compression (feature 31) before moving
- **Archive branch management**: Create and maintain `gitclaw/archive` branch
- **Archive index**: `state/archive-index.json` mapping issue numbers to archive locations
- **Restoration**: When a closed issue is reopened, restore its session from archive
- **Retention policy**: Configurable retention periods per lifecycle stage
- **Scheduled execution**: Run lifecycle management on schedule (weekly)
- **Size monitoring**: Track and report state directory growth

### Out of Scope
- Git history rewriting (too dangerous — no `git filter-branch` or BFG)
- Compression of non-session state (issue mappings are small)
- External storage (S3, etc.) — stay within git
- Real-time archival (batch process, not per-commit)

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Lifecycle state detector** | Determine each session's lifecycle state | ~1.5 hours |
| **Dormancy analyzer** | Check issue status and last activity | ~1 hour |
| **Archive branch manager** | Create/maintain `gitclaw/archive`, move files | ~2 hours |
| **Archive index** | Track archived sessions for search and restoration | ~1 hour |
| **Restoration flow** | Restore archived sessions on issue reopen | ~1.5 hours |
| **Retention policy engine** | Configurable retention with purge after expiry | ~1 hour |
| **Size monitor** | Track and report state growth metrics | ~30 min |
| **Scheduled trigger** | Weekly lifecycle management run | ~30 min |
| **Agent orchestrator integration** | Auto-restore on issue reopen | ~1 hour |
| **Configuration** | Retention periods, thresholds, archive branch name | ~30 min |
| **Testing** | Test archival, restoration, index, size tracking | ~2 hours |

**Total: ~13 hours.**

---

## AI Implementation Instructions

### Step 1: Lifecycle state detector

**New file:** `.GITCLAW/lifecycle/GITCLAW-STATE-LIFECYCLE.ts`

```typescript
export type SessionState = "active" | "dormant" | "archived" | "purged";

export interface SessionInfo {
  sessionPath: string;
  issueNumber: number;
  state: SessionState;
  sizeBytes: number;
  lastModified: string;
  issueState: "open" | "closed";
  daysSinceActivity: number;
  turnCount: number;
}

export async function analyzeSessionStates(
  stateDir: string,
  repo: string,
  config: LifecycleConfig
): Promise<SessionInfo[]> {
  const sessionsDir = resolve(stateDir, "sessions");
  const issuesDir = resolve(stateDir, "issues");
  const sessions: SessionInfo[] = [];
  
  // Load all issue mappings
  const mappingFiles = readdirSync(issuesDir).filter(f => f.endsWith(".json"));
  
  for (const mappingFile of mappingFiles) {
    const mapping = JSON.parse(readFileSync(resolve(issuesDir, mappingFile), "utf-8"));
    const issueNumber = mapping.issueNumber;
    const sessionPath = mapping.sessionPath;
    
    if (!existsSync(sessionPath)) continue;
    
    const stat = statSync(sessionPath);
    const lastModified = stat.mtime.toISOString();
    const daysSinceModified = (Date.now() - stat.mtime.getTime()) / (1000 * 60 * 60 * 24);
    
    // Check issue state via GitHub API
    let issueState: "open" | "closed" = "open";
    try {
      const { stdout } = await run([
        "gh", "issue", "view", String(issueNumber),
        "--json", "state", "--jq", ".state",
      ]);
      issueState = stdout.trim().toLowerCase() as "open" | "closed";
    } catch (e) {
      // If we can't check, assume open (conservative)
    }
    
    // Count turns
    const content = readFileSync(sessionPath, "utf-8");
    const turnCount = content.split("\n").filter(line => {
      try { return JSON.parse(line).message?.role === "user"; } catch { return false; }
    }).length;
    
    // Determine lifecycle state
    let state: SessionState = "active";
    
    if (issueState === "closed" && daysSinceModified > config.dormantAfterDays) {
      state = "dormant";
    } else if (issueState === "closed") {
      state = "dormant"; // closed issues are immediately dormant
    } else if (daysSinceModified > config.dormantAfterDays * 3) {
      state = "dormant"; // open but very stale
    }
    
    sessions.push({
      sessionPath,
      issueNumber,
      state,
      sizeBytes: stat.size,
      lastModified,
      issueState,
      daysSinceActivity: Math.floor(daysSinceModified),
      turnCount,
    });
  }
  
  return sessions;
}
```

### Step 2: Archive branch manager

```typescript
export async function archiveSessions(
  dormantSessions: SessionInfo[],
  stateDir: string,
  repo: string,
  config: LifecycleConfig
): Promise<{ archived: number; bytesFreed: number }> {
  if (dormantSessions.length === 0) return { archived: 0, bytesFreed: 0 };
  
  const archiveBranch = config.archiveBranch || "gitclaw/archive";
  const defaultBranch = process.env.GITHUB_REF_NAME || "main";
  let bytesFreed = 0;
  let archived = 0;
  
  // Ensure archive branch exists
  const { exitCode: branchExists } = await run([
    "git", "rev-parse", "--verify", `refs/remotes/origin/${archiveBranch}`,
  ]);
  
  if (branchExists !== 0) {
    // Create orphan archive branch
    await run(["git", "checkout", "--orphan", archiveBranch]);
    await run(["git", "rm", "-rf", "."]);
    writeFileSync("ARCHIVE-README.md",
      `# GitClaw Session Archive\n\nThis branch contains archived session transcripts.\nDo not merge this branch into main.\n`);
    await run(["git", "add", "ARCHIVE-README.md"]);
    await run(["git", "commit", "-m", "gitclaw: initialize archive branch"]);
    await run(["git", "push", "origin", archiveBranch]);
    await run(["git", "checkout", defaultBranch]);
  }
  
  // For each dormant session, move it to the archive branch
  for (const session of dormantSessions) {
    try {
      // Read the session content
      const content = readFileSync(session.sessionPath, "utf-8");
      
      // Create a temporary directory for the archive operation
      const archivePath = `.GITCLAW/archive/${session.issueNumber}/${basename(session.sessionPath)}`;
      
      // Switch to archive branch, add file, switch back
      await run(["git", "stash", "--include-untracked"]);
      await run(["git", "checkout", archiveBranch]);
      
      // Create directory and write file
      const dirPath = resolve(process.cwd(), `.GITCLAW/archive/${session.issueNumber}`);
      mkdirSync(dirPath, { recursive: true });
      writeFileSync(resolve(process.cwd(), archivePath), content);
      
      // Also write metadata
      writeFileSync(resolve(dirPath, "metadata.json"), JSON.stringify({
        issueNumber: session.issueNumber,
        archivedAt: new Date().toISOString(),
        originalPath: session.sessionPath,
        originalSize: session.sizeBytes,
        turnCount: session.turnCount,
        issueState: session.issueState,
      }, null, 2));
      
      await run(["git", "add", "-A"]);
      await run(["git", "commit", "-m",
        `gitclaw: archive session for issue #${session.issueNumber} (${Math.round(session.sizeBytes / 1024)}KB)`]);
      
      // Switch back to main
      await run(["git", "checkout", defaultBranch]);
      await run(["git", "stash", "pop"]);
      
      // Remove the session from main
      unlinkSync(session.sessionPath);
      
      // Update the issue mapping to reference the archive
      const mappingPath = resolve(stateDir, "issues", `${session.issueNumber}.json`);
      if (existsSync(mappingPath)) {
        const mapping = JSON.parse(readFileSync(mappingPath, "utf-8"));
        mapping.archived = true;
        mapping.archiveBranch = archiveBranch;
        mapping.archivePath = archivePath;
        mapping.archivedAt = new Date().toISOString();
        writeFileSync(mappingPath, JSON.stringify(mapping, null, 2) + "\n");
      }
      
      bytesFreed += session.sizeBytes;
      archived++;
      
      console.log(`Archived: issue #${session.issueNumber} (${Math.round(session.sizeBytes / 1024)}KB)`);
    } catch (e) {
      console.error(`Failed to archive issue #${session.issueNumber}: ${e}`);
      // Ensure we're back on the right branch
      try { await run(["git", "checkout", defaultBranch]); } catch (e2) {}
      try { await run(["git", "stash", "pop"]); } catch (e2) {}
    }
  }
  
  // Push archive branch
  if (archived > 0) {
    await run(["git", "push", "origin", archiveBranch]);
  }
  
  return { archived, bytesFreed };
}
```

### Step 3: Archive index

```typescript
export interface ArchiveIndex {
  lastUpdated: string;
  totalArchived: number;
  totalSizeBytes: number;
  entries: ArchiveEntry[];
}

export interface ArchiveEntry {
  issueNumber: number;
  sessionFile: string;
  archiveBranch: string;
  archivePath: string;
  archivedAt: string;
  originalSizeBytes: number;
  turnCount: number;
}

export function updateArchiveIndex(stateDir: string, newEntries: ArchiveEntry[]): void {
  const indexPath = resolve(stateDir, "archive-index.json");
  let index: ArchiveIndex;
  
  if (existsSync(indexPath)) {
    index = JSON.parse(readFileSync(indexPath, "utf-8"));
  } else {
    index = { lastUpdated: "", totalArchived: 0, totalSizeBytes: 0, entries: [] };
  }
  
  for (const entry of newEntries) {
    // Don't duplicate
    if (index.entries.some(e => e.issueNumber === entry.issueNumber)) continue;
    index.entries.push(entry);
  }
  
  index.lastUpdated = new Date().toISOString();
  index.totalArchived = index.entries.length;
  index.totalSizeBytes = index.entries.reduce((sum, e) => sum + e.originalSizeBytes, 0);
  
  writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
}
```

### Step 4: Restoration flow

When an issue is reopened and its session was archived:

```typescript
export async function restoreArchivedSession(
  issueNumber: number,
  stateDir: string,
  config: LifecycleConfig
): Promise<string | null> {
  const mappingPath = resolve(stateDir, "issues", `${issueNumber}.json`);
  if (!existsSync(mappingPath)) return null;
  
  const mapping = JSON.parse(readFileSync(mappingPath, "utf-8"));
  if (!mapping.archived) return null;
  
  const archiveBranch = mapping.archiveBranch;
  const archivePath = mapping.archivePath;
  
  try {
    // Fetch the session from the archive branch
    const { stdout: content } = await run([
      "git", "show", `origin/${archiveBranch}:${archivePath}`,
    ]);
    
    if (!content.trim()) {
      console.log(`Archive content empty for issue #${issueNumber}`);
      return null;
    }
    
    // Restore to sessions directory
    const sessionsDir = resolve(stateDir, "sessions");
    const restoredPath = resolve(sessionsDir, basename(archivePath));
    writeFileSync(restoredPath, content);
    
    // Update mapping
    mapping.archived = false;
    mapping.sessionPath = restoredPath;
    mapping.restoredAt = new Date().toISOString();
    writeFileSync(mappingPath, JSON.stringify(mapping, null, 2) + "\n");
    
    console.log(`Restored archived session for issue #${issueNumber}`);
    return restoredPath;
  } catch (e) {
    console.error(`Failed to restore session for issue #${issueNumber}: ${e}`);
    return null;
  }
}
```

### Step 5: Integrate into agent orchestrator

In `GITCLAW-AGENT.ts`:

```typescript
import { restoreArchivedSession } from "./GITCLAW-STATE-LIFECYCLE";

// During session resolution:
if (existsSync(mappingFile)) {
  const mapping = JSON.parse(readFileSync(mappingFile, "utf-8"));
  
  if (mapping.archived) {
    // Session was archived — restore it
    console.log(`Session for issue #${issueNumber} was archived. Restoring...`);
    const restoredPath = await restoreArchivedSession(issueNumber, stateDir, lifecycleConfig);
    if (restoredPath) {
      mode = "resume";
      sessionPath = restoredPath;
      console.log(`Restored session: ${restoredPath}`);
    } else {
      console.log("Restoration failed, starting fresh");
    }
  } else if (existsSync(mapping.sessionPath)) {
    mode = "resume";
    sessionPath = mapping.sessionPath;
  }
}
```

**Scheduled lifecycle management** (via feature 04):

```json
{
  "id": "state-lifecycle",
  "title": "Weekly State Lifecycle Management",
  "enabled": true,
  "prompt": "INTERNAL:state-lifecycle"
}
```

```typescript
if (task.prompt === "INTERNAL:state-lifecycle") {
  const sessions = await analyzeSessionStates(stateDir, repo, lifecycleConfig);
  const dormant = sessions.filter(s => s.state === "dormant");
  
  if (dormant.length > 0) {
    // Compress before archiving
    for (const session of dormant) {
      compressSession(session.sessionPath, compressionConfig);
    }
    
    const { archived, bytesFreed } = await archiveSessions(dormant, stateDir, repo, lifecycleConfig);
    updateArchiveIndex(stateDir, dormant.map(s => ({
      issueNumber: s.issueNumber,
      sessionFile: basename(s.sessionPath),
      archiveBranch: lifecycleConfig.archiveBranch,
      archivePath: `.GITCLAW/archive/${s.issueNumber}/${basename(s.sessionPath)}`,
      archivedAt: new Date().toISOString(),
      originalSizeBytes: s.sizeBytes,
      turnCount: s.turnCount,
    })));
    
    console.log(`Lifecycle: archived ${archived} sessions, freed ${Math.round(bytesFreed / 1024)}KB`);
  }
}
```

### Step 6: Size monitoring

```typescript
export function getStateMetrics(stateDir: string): {
  totalSizeBytes: number;
  sessionCount: number;
  activeCount: number;
  dormantCount: number;
  archivedCount: number;
  largestSessionKB: number;
  avgSessionKB: number;
} {
  const sessionsDir = resolve(stateDir, "sessions");
  const files = readdirSync(sessionsDir).filter(f => f.endsWith(".jsonl"));
  
  let totalSize = 0;
  let largestSize = 0;
  
  for (const file of files) {
    const size = statSync(resolve(sessionsDir, file)).size;
    totalSize += size;
    largestSize = Math.max(largestSize, size);
  }
  
  const indexPath = resolve(stateDir, "archive-index.json");
  const archivedCount = existsSync(indexPath)
    ? JSON.parse(readFileSync(indexPath, "utf-8")).totalArchived
    : 0;
  
  return {
    totalSizeBytes: totalSize,
    sessionCount: files.length,
    activeCount: files.length, // refined by lifecycle analysis
    dormantCount: 0,
    archivedCount,
    largestSessionKB: Math.round(largestSize / 1024),
    avgSessionKB: files.length > 0 ? Math.round(totalSize / files.length / 1024) : 0,
  };
}
```

### Step 7: Configuration

```json
{
  "lifecycle": {
    "enabled": true,
    "dormantAfterDays": 7,
    "archiveAfterDays": 14,
    "purgeAfterDays": 180,
    "archiveBranch": "gitclaw/archive",
    "compressBeforeArchive": true,
    "maxStateSizeMB": 50,
    "runSchedule": "weekly"
  }
}
```

### Step 8: Test

- Close an issue, wait for lifecycle run → verify session is marked dormant
- Run archival → verify session is moved to `gitclaw/archive` branch
- Verify session is removed from main branch
- Verify archive-index.json is updated
- Reopen the archived issue → verify session is restored from archive
- Verify restored session resumes correctly with pi
- Verify size metrics are accurate before and after archival
- Verify the archive branch exists and contains the session with metadata

## Design Decisions

**Why an orphan branch instead of a subdirectory?** An orphan branch has no shared history with main. `git clone` fetches only the default branch by default, so archive data doesn't affect clone speed. A subdirectory on main would require `.gitattributes` export-ignore tricks and would still inflate clone size.

**Why not just delete old sessions?** Audit trails. In regulated environments, deleting AI conversation records may violate compliance requirements. The archive preserves everything while removing it from the active codebase. The purge step (180 days by default) is the final deletion, giving ample time for compliance.

**Why compress before archiving instead of after?** Compression reduces the data transferred to the archive branch. A 1.27MB session compressed to 150KB means the archive branch grows 88% slower. Since archiving involves cross-branch git operations, smaller files mean faster operations.

**Why an archive index on main?** The agent on main needs to know which sessions are archived and where. Without the index, it would need to checkout the archive branch and search — expensive and slow. The index is a small JSON file (<10KB even with 1,000 entries) that enables instant lookup.
