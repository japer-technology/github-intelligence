# Feature: Automated Release Management

## Summary

The agent manages the full release lifecycle: analyzing commits since the last release, classifying changes by type (feature/fix/breaking/chore), generating semantic version bumps, writing changelogs, and publishing GitHub Releases. On schedule or on command (`/release`), the agent reviews all work done since the last tag, composes a human-readable release summary enriched with issue references and contributor attributions, and either publishes directly or creates a release PR for approval. The agent becomes the project's release manager — the person who nobody wants to be but everybody needs.

## Why This Feature — The Deep Reasoning

### 1. Releases Are the Highest-Leverage Communication Channel

The Communication Channels doc (§10) reveals that GitHub Releases reach the widest audience: "Releases Only" watchers — users who have opted out of all other notifications — still receive release emails. A release is the only event that reaches people who explicitly said "only tell me about releases." It's the broadcast channel of last resort.

Yet GitClaw never publishes releases. All its work — features, fixes, analysis, documentation — is invisible to release watchers. Automated releases change this: every meaningful batch of work becomes a release that reaches the maximum audience.

### 2. Nobody Likes Writing Release Notes — But Everyone Reads Them

Release notes are the most-read, least-written artifact in software. Developers hate writing them because it requires:
- Reviewing every commit since the last release
- Classifying each change (feature? fix? breaking? docs?)
- Writing a human-readable summary
- Linking to relevant issues and PRs
- Crediting contributors

This is exactly the kind of structured synthesis that LLMs excel at. The agent has read every commit, participated in many of the discussions, and has access to the full issue history. It's better positioned to write release notes than any human.

### 3. It Closes the Feedback Loop on Agent Work

The agent does work across many issues. Without releases, that work is scattered across issue comments. With releases, the agent's cumulative output is periodically bundled into a coherent summary: "Here's everything that changed since v0.3.0." This gives stakeholders — especially those who don't follow individual issues — a single artifact that captures the project's progress.

### 4. Semantic Versioning Requires Judgment — the Agent Has Context

A version bump from 0.3.1 to 0.4.0 (minor) vs 1.0.0 (major) is a judgment call. What makes a change "breaking"? The agent has context that automated tools lack:
- It participated in the discussions that led to the changes
- It knows which issues were labeled `breaking-change`
- It can read the actual code diffs and assess API surface changes
- It can check the knowledge base for architectural decisions

Conventional commit parsers (`feat:` → minor, `fix:` → patch, `BREAKING CHANGE:` → major) work when developers follow the convention perfectly. The agent works when they don't — it classifies based on understanding, not just prefix matching.

### 5. It Composes With the Communication Stack

| Feature | Release Integration |
|---|---|
| **Dashboard (14)** | Release history feeds the dashboard timeline |
| **Notification Intelligence (20)** | Releases reach the widest audience per §10 |
| **Knowledge Base (17)** | Each release becomes a KB article (decisions bundled into a milestone) |
| **Health Scanning (19)** | Health scan results can gate releases ("don't release with critical findings") |
| **Cost Tracking (05)** | Per-release cost summaries show the cost of each version |
| **Branch-per-Task (07)** | PRs merged since last release form the changelog |

## Scope

### In Scope
- **Commit analysis**: Parse commits since last tag, classify by type
- **Version calculation**: Semantic version bump based on change types
- **Changelog generation**: Human-readable, categorized changelog with issue/PR links
- **GitHub Release publishing**: Create release via API with generated notes
- **Release PR mode**: Optionally create a PR with changelog updates for human review
- **Contributor attribution**: Credit all contributors in the release
- **Pre-release support**: Alpha/beta/RC tags
- **`/release` command**: On-demand release trigger
- **Scheduled releases**: Weekly/monthly release cadence

### Out of Scope
- NPM/PyPI/crates.io package publishing (that's CI's job)
- Git tag signing (requires GPG keys)
- Release branching strategies (release branches, hotfix branches)
- Artifact attachment (binaries, build outputs)

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Commit analyzer** | Parse commits, classify types, extract references | ~2 hours |
| **Version calculator** | Semantic version bump logic | ~1 hour |
| **Changelog generator** | Categorized, attributed, linked changelog | ~2 hours |
| **Release publisher** | Create GitHub Release via API | ~1 hour |
| **Release PR mode** | Create PR with CHANGELOG.md updates | ~1.5 hours |
| **Contributor extractor** | Git log analysis for attribution | ~30 min |
| **`/release` command** | On-demand trigger integration | ~30 min |
| **Configuration** (`release.json`) | Schedule, mode, categories | ~30 min |
| **Docs** | Document release management | ~30 min |
| **Testing** | Test classification, versioning, changelog format | ~1.5 hours |

**Total: ~12 hours.**

---

## AI Implementation Instructions

### Step 1: Commit analyzer

**New file:** `.GITCLAW/lifecycle/GITCLAW-RELEASE.ts`

```typescript
export type ChangeType = "feature" | "fix" | "breaking" | "docs" | "chore" | "refactor" | "perf" | "test";

export interface AnalyzedCommit {
  hash: string;
  shortHash: string;
  message: string;
  body: string;
  author: string;
  authorEmail: string;
  date: string;
  type: ChangeType;
  scope?: string;               // e.g., "lifecycle", "skills", "workflow"
  issueRefs: number[];          // referenced issue numbers
  prRef?: number;               // if this came from a PR
  isBreaking: boolean;
  files: string[];
}

export async function analyzeCommits(
  sinceTag: string | null,
  repoRoot: string
): Promise<AnalyzedCommit[]> {
  // Get commits since the last tag (or all commits if no tag exists)
  const range = sinceTag ? `${sinceTag}..HEAD` : "HEAD";
  
  const { stdout } = await run([
    "git", "log", range,
    "--format=%H|%h|%s|%b|%aN|%aE|%aI",
    "--no-merges",
  ]);
  
  const commits: AnalyzedCommit[] = [];
  
  for (const line of stdout.trim().split("\n").filter(Boolean)) {
    const [hash, shortHash, message, body, author, authorEmail, date] = line.split("|");
    
    // Get changed files for this commit
    const { stdout: filesRaw } = await run([
      "git", "diff-tree", "--no-commit-id", "--name-only", "-r", hash,
    ]);
    const files = filesRaw.trim().split("\n").filter(Boolean);
    
    // Classify the commit
    const type = classifyCommit(message, body, files);
    const isBreaking = /BREAKING[ _]CHANGE/i.test(body) || /^.*!:/.test(message);
    
    // Extract issue references
    const issueRefs = [...new Set(
      [...(message + " " + body).matchAll(/#(\d+)/g)].map(m => parseInt(m[1]))
    )];
    
    // Extract scope from conventional commit format
    const scopeMatch = message.match(/^\w+\(([^)]+)\)/);
    const scope = scopeMatch?.[1];
    
    // Skip gitclaw state-only commits
    if (files.every(f => f.startsWith(".GITCLAW/state/"))) continue;
    
    commits.push({
      hash, shortHash, message: message.trim(), body: body.trim(),
      author, authorEmail, date, type, scope, issueRefs,
      isBreaking, files,
    });
  }
  
  return commits;
}

function classifyCommit(message: string, body: string, files: string[]): ChangeType {
  // Conventional commits prefix
  const prefix = message.match(/^(\w+)[\(!:]/)?.[1]?.toLowerCase();
  const prefixMap: Record<string, ChangeType> = {
    feat: "feature", fix: "fix", docs: "docs", chore: "chore",
    refactor: "refactor", perf: "perf", test: "test", style: "chore",
    ci: "chore", build: "chore",
  };
  if (prefix && prefixMap[prefix]) return prefixMap[prefix];
  
  // Heuristic classification from message content
  if (/\b(fix|bug|patch|resolve|close)\b/i.test(message)) return "fix";
  if (/\b(add|new|feature|implement|support)\b/i.test(message)) return "feature";
  if (/\b(doc|readme|comment|typo)\b/i.test(message)) return "docs";
  if (/\b(refactor|restructure|reorganize|clean)\b/i.test(message)) return "refactor";
  if (/\b(perf|speed|fast|optimize)\b/i.test(message)) return "perf";
  if (/\b(test|spec|coverage)\b/i.test(message)) return "test";
  
  // Heuristic from changed files
  if (files.every(f => f.endsWith(".md") || f.endsWith(".txt"))) return "docs";
  if (files.every(f => f.includes("test") || f.includes("spec"))) return "test";
  
  return "chore";
}
```

### Step 2: Version calculator

```typescript
export function getLatestTag(repoRoot: string): { tag: string; version: string } | null {
  try {
    const { stdout } = execSync("git describe --tags --abbrev=0 2>/dev/null", {
      cwd: repoRoot, encoding: "utf-8"
    });
    const tag = stdout.trim();
    const version = tag.replace(/^v/, "");
    return { tag, version };
  } catch (e) {
    return null;
  }
}

export function calculateNextVersion(
  currentVersion: string | null,
  commits: AnalyzedCommit[]
): { version: string; bumpType: "major" | "minor" | "patch" } {
  const current = currentVersion
    ? currentVersion.split(".").map(Number)
    : [0, 0, 0];
  
  let [major, minor, patch] = current;
  
  const hasBreaking = commits.some(c => c.isBreaking);
  const hasFeature = commits.some(c => c.type === "feature");
  const hasFix = commits.some(c => c.type === "fix" || c.type === "perf" || c.type === "refactor");
  
  let bumpType: "major" | "minor" | "patch";
  
  if (hasBreaking && major >= 1) {
    major++; minor = 0; patch = 0;
    bumpType = "major";
  } else if (hasFeature || hasBreaking) {
    minor++; patch = 0;
    bumpType = "minor";
  } else if (hasFix) {
    patch++;
    bumpType = "patch";
  } else {
    patch++;
    bumpType = "patch";
  }
  
  return { version: `${major}.${minor}.${patch}`, bumpType };
}
```

### Step 3: Changelog generator

```typescript
export function generateChangelog(
  version: string,
  commits: AnalyzedCommit[],
  repo: string
): string {
  const categories: Record<ChangeType, AnalyzedCommit[]> = {
    breaking: commits.filter(c => c.isBreaking),
    feature: commits.filter(c => c.type === "feature" && !c.isBreaking),
    fix: commits.filter(c => c.type === "fix"),
    perf: commits.filter(c => c.type === "perf"),
    refactor: commits.filter(c => c.type === "refactor"),
    docs: commits.filter(c => c.type === "docs"),
    test: commits.filter(c => c.type === "test"),
    chore: commits.filter(c => c.type === "chore"),
  };
  
  const categoryLabels: Record<string, string> = {
    breaking: "⚠️ Breaking Changes",
    feature: "✨ Features",
    fix: "🐛 Bug Fixes",
    perf: "⚡ Performance",
    refactor: "♻️ Refactoring",
    docs: "📝 Documentation",
    test: "🧪 Tests",
    chore: "🔧 Chores",
  };
  
  const sections: string[] = [];
  const date = new Date().toISOString().slice(0, 10);
  
  sections.push(`## v${version} (${date})\n`);
  
  for (const [type, label] of Object.entries(categoryLabels)) {
    const typeCommits = categories[type as ChangeType];
    if (!typeCommits || typeCommits.length === 0) continue;
    
    sections.push(`### ${label}\n`);
    for (const commit of typeCommits) {
      const scope = commit.scope ? `**${commit.scope}:** ` : "";
      const refs = commit.issueRefs.map(n => `[#${n}](https://github.com/${repo}/issues/${n})`).join(", ");
      const refSuffix = refs ? ` (${refs})` : "";
      sections.push(`- ${scope}${commit.message}${refSuffix} — ${commit.shortHash}`);
    }
    sections.push("");
  }
  
  // Contributors
  const contributors = [...new Set(commits.map(c => c.author))];
  if (contributors.length > 0) {
    sections.push(`### 👥 Contributors\n`);
    sections.push(contributors.map(c => `- ${c}`).join("\n"));
    sections.push("");
  }
  
  // Stats
  const filesChanged = new Set(commits.flatMap(c => c.files)).size;
  sections.push(`### 📊 Stats\n`);
  sections.push(`- **${commits.length}** commits`);
  sections.push(`- **${filesChanged}** files changed`);
  sections.push(`- **${contributors.length}** contributor(s)`);
  
  return sections.join("\n");
}
```

### Step 4: Release publisher

```typescript
export async function publishRelease(
  version: string,
  changelog: string,
  repo: string,
  config: ReleaseConfig
): Promise<void> {
  const tagName = `v${version}`;
  
  if (config.mode === "direct") {
    // Tag and publish directly
    await run(["git", "tag", "-a", tagName, "-m", `Release ${tagName}`]);
    await run(["git", "push", "origin", tagName]);
    
    await run([
      "gh", "release", "create", tagName,
      "--title", `${tagName}`,
      "--notes", changelog,
      config.prerelease ? "--prerelease" : "",
    ].filter(Boolean));
    
    console.log(`Published release ${tagName}`);
    
  } else if (config.mode === "pr") {
    // Create a release PR
    const branchName = `release/${tagName}`;
    await run(["git", "checkout", "-b", branchName]);
    
    // Update CHANGELOG.md
    const changelogPath = "CHANGELOG.md";
    let existingChangelog = "";
    if (existsSync(changelogPath)) {
      existingChangelog = readFileSync(changelogPath, "utf-8");
    }
    
    const header = existingChangelog.startsWith("# Changelog")
      ? ""
      : "# Changelog\n\n";
    const insertPoint = existingChangelog.indexOf("\n## ");
    
    let newChangelog: string;
    if (insertPoint > 0) {
      // Insert after header, before first version section
      newChangelog = existingChangelog.slice(0, insertPoint) + "\n" + changelog + "\n" + existingChangelog.slice(insertPoint);
    } else {
      newChangelog = header + changelog + "\n\n" + existingChangelog;
    }
    
    writeFileSync(changelogPath, newChangelog);
    
    await run(["git", "add", "CHANGELOG.md"]);
    await run(["git", "commit", "-m", `chore: prepare release ${tagName}`]);
    await run(["git", "push", "origin", branchName]);
    
    await run([
      "gh", "pr", "create",
      "--title", `Release ${tagName}`,
      "--body", `## Release ${tagName}\n\n${changelog}\n\n---\n_Merge this PR to publish the release. The tag and GitHub Release will be created automatically._`,
      "--label", "gitclaw:release",
    ]);
    
    // Clean up
    const { stdout: defaultBranch } = await run(["git", "symbolic-ref", "refs/remotes/origin/HEAD", "--short"]);
    await run(["git", "checkout", defaultBranch.trim().replace("origin/", "")]);
  }
}
```

### Step 5: Integration and triggers

**`/release` command:**

```typescript
if (parsed.isCommand && parsed.command === "release") {
  const config = loadReleaseConfig(gitclawDir);
  const latest = getLatestTag(process.cwd());
  const commits = await analyzeCommits(latest?.tag || null, process.cwd());
  
  if (commits.length === 0) {
    await gh("issue", "comment", String(issueNumber), "--body",
      "No unreleased commits found since the last tag.");
    return;
  }
  
  const { version, bumpType } = calculateNextVersion(latest?.version || null, commits);
  const changelog = generateChangelog(version, commits, repo);
  
  // Show preview first
  const preview = [
    `## 📦 Release Preview: v${version} (${bumpType} bump)`,
    "",
    `Previous: ${latest ? `v${latest.version}` : "none"}`,
    `Commits: ${commits.length}`,
    "",
    changelog,
    "",
    `---`,
    `Reply with \`/release confirm\` to publish, or \`/release cancel\` to abort.`,
  ].join("\n");
  
  await gh("issue", "comment", String(issueNumber), "--body", preview);
  return;
}

if (parsed.isCommand && parsed.command === "release" && parsed.args?.includes("confirm")) {
  // Publish the release
  await publishRelease(version, changelog, repo, config);
  await gh("issue", "comment", String(issueNumber), "--body",
    `✅ Release v${version} published!\n\n[View release](https://github.com/${repo}/releases/tag/v${version})`);
  return;
}
```

**Scheduled releases (via feature 04):**

```json
{
  "id": "weekly-release",
  "title": "Weekly Release",
  "enabled": true,
  "prompt": "INTERNAL:release-check"
}
```

### Step 6: Configuration

**New file:** `.GITCLAW/release.json`

```json
{
  "enabled": true,
  "mode": "pr",
  "schedule": "weekly",
  "prerelease": false,
  "skipLabels": ["gitclaw:no-release"],
  "changelogFile": "CHANGELOG.md",
  "categories": {
    "feature": "✨ Features",
    "fix": "🐛 Bug Fixes",
    "breaking": "⚠️ Breaking Changes",
    "docs": "📝 Documentation",
    "chore": "🔧 Maintenance"
  }
}
```

### Step 7: Test

- Make several commits with different types, run `/release` → verify correct version bump and categorized changelog
- Verify breaking changes trigger a minor bump (pre-1.0) or major bump (post-1.0)
- Verify issue references are linked in changelog
- Verify contributor attribution
- Test PR mode: verify a release PR is created with CHANGELOG.md updates
- Test direct mode: verify tag and GitHub Release are created
- Test with no previous tags: verify starting from v0.1.0

## Design Decisions

**Why two-step release (preview then confirm)?** Releases are public and permanent. A bad release note is embarrassing; a wrong version number causes dependency confusion. The preview step lets the human review the changelog and version before publishing. For scheduled releases, the agent can be configured to auto-confirm (no preview).

**Why classify commits heuristically instead of requiring conventional commits?** Because most teams don't follow conventional commit conventions consistently. The heuristic classification (keyword matching + file analysis) works with natural commit messages. Teams that do use conventional commits get *better* classification (the prefix is checked first), but the system degrades gracefully for those that don't.

**Why PR mode as default instead of direct publishing?** PRs are reversible and reviewable. A release PR lets the team review the changelog, adjust the version if needed, and merge when ready. Direct mode is available for automated pipelines that trust the agent's judgment.
