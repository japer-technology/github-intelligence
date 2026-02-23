# Feature: Proactive Issue Detection & Codebase Health Scanning

## Summary

The agent doesn't just respond to issues — it *discovers* them. On a schedule (or on push), the agent scans the entire codebase for problems that humans haven't noticed yet: stale TODOs that have been there for months, tests that are permanently skipped, documentation that references deleted files, dependencies with known vulnerabilities, dead code, configuration drift, and convention violations. For each finding, the agent opens a categorized, prioritized GitHub issue with the evidence, the location, and a suggested fix. The agent becomes the codebase's immune system — continuously scanning for infections that the team is too busy to notice.

## Why This Feature — The Deep Reasoning

### 1. Every Other Feature Is Reactive. This One Is Proactive.

Look at all 18 features:
- PR Review (01): triggered by PR
- Slash Commands (02): triggered by user command
- Progress Comments (03): triggered by agent execution
- Cron Runs (04): triggered by schedule — *but the user defines the task*
- Cost Tracking (05): triggered by agent run
- Session Summarization (06): triggered by session growth
- Branch-per-Task (07): triggered by code changes
- Cross-Issue Context (08): triggered by search query
- Concurrency Control (09): triggered by parallel runs
- Personas (10): triggered by issue labels
- Undo (11): triggered by user command
- Guided Workflows (12): triggered by user starting a workflow
- Event Bridge (13): triggered by external events
- Dashboard (14): triggered by data accumulation
- Skill Auto-Generation (15): triggered by pattern detection
- Guardrails (16): triggered by agent attempting changes
- Knowledge Base (17): triggered by session curation threshold
- Self-Verification (18): triggered by agent making code changes

Every single feature waits for something to happen. Feature 04 (Cron) runs on a schedule, but the *content* of what it does is user-defined. This feature is the first where the agent *decides what to investigate* based on its own analysis of the codebase.

The difference matters. Reactive systems fix problems after someone notices them. Proactive systems find problems before anyone is looking. The gap between "noticing" and "fixing" can be weeks or months — that's how stale TODOs accumulate, how skipped tests become permanent, how documentation drifts from reality.

### 2. The Codebase Is a Living Organism. It Needs Regular Health Checks.

A healthy codebase has:
- No TODO comments older than 2 weeks (they're either done or tracked as issues)
- No permanently skipped tests (they're either fixed or deleted)
- No documentation referencing files/functions that don't exist
- No dependencies with known critical vulnerabilities
- No dead imports or unreachable code
- No configuration files that contradict each other
- No drift between what CI tests and what the docs claim is tested

No team achieves this consistently. The cognitive overhead of scanning for these problems is too high — there's always a more urgent feature to build. But an AI agent on a schedule can scan the entire codebase weekly at near-zero cost.

### 3. It Creates a Virtuous Feedback Loop With Every Other Feature

| Feature | How Proactive Detection Composes |
|---|---|
| **Knowledge Base (17)** | Findings become KB articles ("known technical debt", "recurring patterns") |
| **Guided Workflows (12)** | Each finding type becomes a remediation workflow |
| **Personas (10)** | A "code health" persona specializes in scanning |
| **Cost Tracking (05)** | Health scan costs are tracked; optimize scan frequency |
| **Branch-per-Task (07)** | Auto-fix PRs for simple findings (dead imports, formatting) |
| **Dashboard (14)** | Codebase health metrics feed the dashboard |
| **Cross-Issue Context (08)** | Link findings to related past issues ("this TODO was discussed in #42") |
| **Skill Auto-Generation (15)** | If the same finding type recurs, a specialized detection skill is born |

### 4. It's the Missing Half of CI/CD

CI checks whether new code breaks things. Proactive detection checks whether *existing* code has problems. CI is triggered by pushes. Proactive detection is triggered by time (entropy accumulates). CI validates the delta; proactive detection validates the whole.

Together, they cover both dimensions of code quality:
- **CI (existing)**: "Does this change break anything?"
- **Proactive Detection (this feature)**: "Is there anything already broken that nobody noticed?"

### 5. The Agent Has Read Access to Everything — It Should Use It

The agent can read every file in the repo. It can run `git log` and `git blame`. It can check when files were last modified. It can parse dependency manifests. It can cross-reference documentation with actual code. It has all the raw material needed to detect problems — it just never looks unless asked.

This feature changes "the agent can read everything" from a passive capability to an active one.

## Scope

### In Scope
- **Detectors**: Pluggable detection modules, each scanning for a specific class of problems
- **Built-in detectors**: Stale TODOs, skipped tests, dead documentation links, dependency issues, dead imports, large files, long-untouched critical files
- **Issue creation**: One issue per finding (or one issue per finding category, configurable)
- **Deduplication**: Don't re-open issues for findings that already have open issues
- **Prioritization**: Critical / Warning / Info severity levels
- **Configuration**: `.GITCLAW/health.json` for enabling/disabling detectors, setting thresholds
- **Scheduling**: Run weekly via cron (feature 04) or on-demand via `/health-scan`
- **Auto-fix PRs**: For trivial findings (dead imports, formatting), optionally open a fix PR

### Out of Scope
- Security vulnerability scanning (use Dependabot/Snyk — don't reinvent)
- Performance profiling
- Runtime error detection (requires running the application)
- Cross-repo health aggregation

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Detection framework** (new `GITCLAW-HEALTH.ts`) | Detector interface, runner, result aggregation | ~2 hours |
| **Stale TODO detector** | Parse TODOs, cross-reference with git blame for age | ~1.5 hours |
| **Skipped test detector** | Find `.skip`, `@pytest.mark.skip`, `#[ignore]` patterns | ~1 hour |
| **Dead documentation link detector** | Parse Markdown links, verify targets exist | ~1.5 hours |
| **Dead import detector** | Parse imports, check if imported symbols are used | ~1.5 hours |
| **File staleness detector** | Find critical files not touched in N months | ~30 min |
| **Large file detector** | Find files exceeding size thresholds | ~30 min |
| **Issue creation & deduplication** | Create issues, check for existing, apply labels | ~1.5 hours |
| **Auto-fix for trivial findings** | Dead import removal, formatting fixes | ~1.5 hours |
| **Configuration** (`health.json`) | Detector enable/disable, thresholds, schedules | ~30 min |
| **Agent orchestrator integration** | Schedule trigger, `/health-scan` command | ~30 min |
| **Docs** | Document health scanning system | ~30 min |
| **Testing** | Test each detector, test deduplication, test issue creation | ~1.5 hours |

**Total: ~14 hours.**

---

## AI Implementation Instructions

### Step 1: Define the detector framework

**New file:** `.GITCLAW/lifecycle/GITCLAW-HEALTH.ts`

```typescript
export type Severity = "critical" | "warning" | "info";

export interface Finding {
  detector: string;           // which detector found this
  severity: Severity;
  title: string;              // concise finding title
  description: string;        // detailed description with evidence
  file: string;               // primary file involved
  line?: number;              // line number if applicable
  category: string;           // "tech-debt" | "test-health" | "doc-drift" | "code-quality" | "dependency"
  suggestedFix?: string;      // human-readable fix suggestion
  autoFixable: boolean;       // can this be fixed automatically?
  autoFixPatch?: string;      // if autoFixable, the patch content
  evidence: string;           // the raw evidence (the TODO text, the skipped test, etc.)
}

export interface Detector {
  name: string;
  description: string;
  category: string;
  detect(repoRoot: string, config: DetectorConfig): Promise<Finding[]>;
}

export interface DetectorConfig {
  enabled: boolean;
  [key: string]: any;         // detector-specific config
}

export interface HealthConfig {
  enabled: boolean;
  issueMode: "per-finding" | "per-category" | "single-report";
  autoFix: boolean;
  detectors: Record<string, DetectorConfig>;
}

export interface HealthReport {
  timestamp: string;
  findings: Finding[];
  bySeverity: { critical: number; warning: number; info: number };
  byCategory: Record<string, number>;
  scanDurationMs: number;
}
```

### Step 2: Implement built-in detectors

#### Detector 1: Stale TODOs

```typescript
import { execSync } from "child_process";

const StaleTodoDetector: Detector = {
  name: "stale-todos",
  description: "Finds TODO/FIXME/HACK comments that have been in the codebase for too long",
  category: "tech-debt",
  
  async detect(repoRoot: string, config: DetectorConfig): Promise<Finding[]> {
    const maxAgeDays = config.maxAgeDays ?? 14;
    const findings: Finding[] = [];
    
    // Find all TODO/FIXME/HACK comments
    const grepResult = execSync(
      `rg -n --no-heading "(?i)(TODO|FIXME|HACK|XXX|TEMP|TEMPORARY)\\b" --type-not binary --glob "!node_modules" --glob "!.git" --glob "!*.lock" --glob "!.GITCLAW/state" || true`,
      { cwd: repoRoot, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
    ).trim();
    
    if (!grepResult) return findings;
    
    for (const line of grepResult.split("\n")) {
      const match = line.match(/^(.+?):(\d+):(.+)$/);
      if (!match) continue;
      
      const [, file, lineNum, content] = match;
      
      // Use git blame to find when this line was introduced
      try {
        const blame = execSync(
          `git blame -L ${lineNum},${lineNum} --porcelain "${file}" 2>/dev/null | head -1`,
          { cwd: repoRoot, encoding: "utf-8" }
        ).trim();
        
        const commitHash = blame.split(" ")[0];
        if (!commitHash || commitHash === "0000000000000000000000000000000000000000") continue;
        
        const commitDate = execSync(
          `git show -s --format=%ci ${commitHash} 2>/dev/null`,
          { cwd: repoRoot, encoding: "utf-8" }
        ).trim();
        
        const ageMs = Date.now() - new Date(commitDate).getTime();
        const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
        
        if (ageDays >= maxAgeDays) {
          const todoMatch = content.match(/(?:TODO|FIXME|HACK|XXX|TEMP|TEMPORARY)[:\s]*(.{0,100})/i);
          const todoText = todoMatch?.[1]?.trim() || content.trim();
          
          findings.push({
            detector: "stale-todos",
            severity: ageDays > 90 ? "warning" : "info",
            title: `Stale TODO in \`${file}\` (${ageDays} days old)`,
            description: `A TODO comment has been in the codebase for ${ageDays} days without being addressed.\n\n` +
              `**File:** \`${file}:${lineNum}\`\n` +
              `**Content:** \`${todoText}\`\n` +
              `**Introduced:** ${commitDate} (${ageDays} days ago)\n` +
              `**Commit:** ${commitHash.slice(0, 8)}`,
            file,
            line: parseInt(lineNum),
            category: "tech-debt",
            suggestedFix: "Either complete the TODO, convert it to a tracked issue, or remove it if no longer relevant.",
            autoFixable: false,
            evidence: content.trim(),
          });
        }
      } catch (e) {
        // Skip files that git blame can't process
      }
    }
    
    return findings;
  },
};
```

#### Detector 2: Skipped Tests

```typescript
const SkippedTestDetector: Detector = {
  name: "skipped-tests",
  description: "Finds tests that are permanently skipped/disabled",
  category: "test-health",
  
  async detect(repoRoot: string, config: DetectorConfig): Promise<Finding[]> {
    const findings: Finding[] = [];
    
    // Patterns for skipped tests across languages
    const skipPatterns = [
      // JavaScript/TypeScript
      { pattern: "\\b(it|test|describe)\\.skip\\s*\\(", language: "JS/TS" },
      { pattern: "\\bxit\\s*\\(|\\bxdescribe\\s*\\(", language: "JS/TS (Jasmine)" },
      { pattern: "\\b(it|test)\\.todo\\s*\\(", language: "JS/TS" },
      // Python
      { pattern: "@pytest\\.mark\\.skip", language: "Python" },
      { pattern: "@unittest\\.skip", language: "Python" },
      // Rust
      { pattern: "#\\[ignore\\]", language: "Rust" },
      // Go
      { pattern: "t\\.Skip\\(", language: "Go" },
      // Java
      { pattern: "@Disabled|@Ignore", language: "Java" },
    ];
    
    for (const { pattern, language } of skipPatterns) {
      const grepResult = execSync(
        `rg -n --no-heading "${pattern}" --glob "!node_modules" --glob "!.git" --glob "!*.lock" || true`,
        { cwd: repoRoot, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }
      ).trim();
      
      if (!grepResult) continue;
      
      for (const line of grepResult.split("\n")) {
        const match = line.match(/^(.+?):(\d+):(.+)$/);
        if (!match) continue;
        
        const [, file, lineNum, content] = match;
        
        // Check how long it's been skipped (git blame)
        let ageDays = 0;
        try {
          const blame = execSync(
            `git blame -L ${lineNum},${lineNum} --porcelain "${file}" 2>/dev/null | head -1`,
            { cwd: repoRoot, encoding: "utf-8" }
          ).trim();
          const commitHash = blame.split(" ")[0];
          const commitDate = execSync(
            `git show -s --format=%ci ${commitHash} 2>/dev/null`,
            { cwd: repoRoot, encoding: "utf-8" }
          ).trim();
          ageDays = Math.floor((Date.now() - new Date(commitDate).getTime()) / (1000 * 60 * 60 * 24));
        } catch (e) { /* ignore */ }
        
        findings.push({
          detector: "skipped-tests",
          severity: ageDays > 30 ? "warning" : "info",
          title: `Skipped test in \`${file}\` (${language})${ageDays > 0 ? ` — ${ageDays} days` : ""}`,
          description: `A test has been disabled.\n\n` +
            `**File:** \`${file}:${lineNum}\`\n` +
            `**Pattern:** \`${content.trim()}\`\n` +
            (ageDays > 0 ? `**Skipped for:** ${ageDays} days\n` : ""),
          file,
          line: parseInt(lineNum),
          category: "test-health",
          suggestedFix: "Either fix the test, remove it, or track the underlying issue.",
          autoFixable: false,
          evidence: content.trim(),
        });
      }
    }
    
    return findings;
  },
};
```

#### Detector 3: Dead Documentation Links

```typescript
const DeadDocLinkDetector: Detector = {
  name: "dead-doc-links",
  description: "Finds Markdown links that point to files or headings that don't exist",
  category: "doc-drift",
  
  async detect(repoRoot: string, config: DetectorConfig): Promise<Finding[]> {
    const findings: Finding[] = [];
    
    // Find all Markdown files
    const mdFiles = execSync(
      `find . -name "*.md" -not -path "*/node_modules/*" -not -path "*/.git/*"`,
      { cwd: repoRoot, encoding: "utf-8" }
    ).trim().split("\n").filter(Boolean);
    
    for (const mdFile of mdFiles) {
      const content = readFileSync(resolve(repoRoot, mdFile), "utf-8");
      
      // Match relative Markdown links: [text](path) and [text](path#anchor)
      const linkPattern = /\[([^\]]*)\]\((?!https?:\/\/|mailto:|#)([^)]+)\)/g;
      let match;
      
      while ((match = linkPattern.exec(content)) !== null) {
        const [fullMatch, linkText, linkTarget] = match;
        const [filePath, anchor] = linkTarget.split("#");
        
        if (!filePath) continue; // pure anchor link
        
        // Resolve relative to the Markdown file's directory
        const dir = path.dirname(resolve(repoRoot, mdFile));
        const resolvedPath = resolve(dir, filePath);
        
        if (!existsSync(resolvedPath)) {
          // Calculate line number
          const beforeMatch = content.slice(0, match.index);
          const lineNum = (beforeMatch.match(/\n/g) || []).length + 1;
          
          findings.push({
            detector: "dead-doc-links",
            severity: "warning",
            title: `Dead link in \`${mdFile}\`: \`${filePath}\` not found`,
            description: `A Markdown link points to a file that doesn't exist.\n\n` +
              `**File:** \`${mdFile}:${lineNum}\`\n` +
              `**Link text:** "${linkText}"\n` +
              `**Target:** \`${filePath}\`\n` +
              `**Resolved to:** \`${resolvedPath}\``,
            file: mdFile,
            line: lineNum,
            category: "doc-drift",
            suggestedFix: `Update the link to point to the correct file, or remove the link if the target was intentionally deleted.`,
            autoFixable: false,
            evidence: fullMatch,
          });
        }
      }
    }
    
    return findings;
  },
};
```

#### Detector 4: Large Files

```typescript
const LargeFileDetector: Detector = {
  name: "large-files",
  description: "Finds files that are unusually large and may not belong in the repo",
  category: "code-quality",
  
  async detect(repoRoot: string, config: DetectorConfig): Promise<Finding[]> {
    const maxSizeKB = config.maxSizeKB ?? 500;
    const findings: Finding[] = [];
    
    const result = execSync(
      `find . -type f -size +${maxSizeKB}k -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/vendor/*" -not -name "*.lock" -not -name "bun.lock" -not -name "package-lock.json" | head -50`,
      { cwd: repoRoot, encoding: "utf-8" }
    ).trim();
    
    if (!result) return findings;
    
    for (const file of result.split("\n")) {
      const stat = statSync(resolve(repoRoot, file));
      const sizeKB = Math.round(stat.size / 1024);
      
      findings.push({
        detector: "large-files",
        severity: sizeKB > 5000 ? "warning" : "info",
        title: `Large file: \`${file}\` (${sizeKB}KB)`,
        description: `File exceeds the ${maxSizeKB}KB threshold.\n\n` +
          `**File:** \`${file}\`\n` +
          `**Size:** ${sizeKB}KB\n` +
          `Consider whether this file should be in the repository, or if it should use Git LFS.`,
        file,
        category: "code-quality",
        suggestedFix: "Move to Git LFS, add to .gitignore, or verify this file is intentionally committed.",
        autoFixable: false,
        evidence: `${file}: ${sizeKB}KB`,
      });
    }
    
    return findings;
  },
};
```

#### Detector 5: Configuration Drift (GitClaw-specific)

```typescript
const GitClawDriftDetector: Detector = {
  name: "gitclaw-drift",
  description: "Checks for drift between GitClaw install templates and live files",
  category: "code-quality",
  
  async detect(repoRoot: string, config: DetectorConfig): Promise<Finding[]> {
    const findings: Finding[] = [];
    
    // Check if live workflow matches template
    const templatePath = resolve(repoRoot, ".GITCLAW/install/GITCLAW-WORKFLOW-AGENT.yml");
    const livePath = resolve(repoRoot, ".github/workflows/GITCLAW-WORKFLOW-AGENT.yml");
    
    if (existsSync(templatePath) && existsSync(livePath)) {
      const template = readFileSync(templatePath, "utf-8");
      const live = readFileSync(livePath, "utf-8");
      
      if (template !== live) {
        // Count differences
        const templateLines = template.split("\n");
        const liveLines = live.split("\n");
        const diffCount = templateLines.reduce((count, line, i) => {
          return count + (line !== liveLines[i] ? 1 : 0);
        }, Math.abs(templateLines.length - liveLines.length));
        
        findings.push({
          detector: "gitclaw-drift",
          severity: "info",
          title: "Workflow drift: live workflow differs from template",
          description: `The live workflow file has ${diffCount} line(s) different from the install template.\n\n` +
            `**Template:** \`.GITCLAW/install/GITCLAW-WORKFLOW-AGENT.yml\`\n` +
            `**Live:** \`.github/workflows/GITCLAW-WORKFLOW-AGENT.yml\`\n\n` +
            `This may be intentional (local customization) or accidental (template was updated but live file wasn't).`,
          file: livePath,
          category: "code-quality",
          suggestedFix: "If the template was updated, sync the live workflow. If the live file has intentional customizations, document them.",
          autoFixable: false,
          evidence: `${diffCount} lines differ`,
        });
      }
    }
    
    // Check if issue template matches
    const hatchTemplateSrc = resolve(repoRoot, ".GITCLAW/install/GITCLAW-TEMPLATE-HATCH.md");
    const hatchTemplateDst = resolve(repoRoot, ".github/ISSUE_TEMPLATE/GITCLAW-TEMPLATE-HATCH.md");
    
    if (existsSync(hatchTemplateSrc) && existsSync(hatchTemplateDst)) {
      const src = readFileSync(hatchTemplateSrc, "utf-8");
      const dst = readFileSync(hatchTemplateDst, "utf-8");
      
      if (src !== dst) {
        findings.push({
          detector: "gitclaw-drift",
          severity: "info",
          title: "Hatch template drift: live template differs from install source",
          description: "The hatch issue template has drifted from its install source.",
          file: hatchTemplateDst,
          category: "code-quality",
          suggestedFix: "Sync the templates if the change was unintentional.",
          autoFixable: false,
          evidence: "Templates differ",
        });
      }
    }
    
    return findings;
  },
};
```

### Step 3: Build the detection runner

```typescript
const ALL_DETECTORS: Detector[] = [
  StaleTodoDetector,
  SkippedTestDetector,
  DeadDocLinkDetector,
  LargeFileDetector,
  GitClawDriftDetector,
];

export function loadHealthConfig(gitclawDir: string): HealthConfig {
  const configPath = resolve(gitclawDir, "health.json");
  if (existsSync(configPath)) {
    return JSON.parse(readFileSync(configPath, "utf-8"));
  }
  
  // Default: all detectors enabled, one issue per category
  return {
    enabled: true,
    issueMode: "per-category",
    autoFix: false,
    detectors: Object.fromEntries(
      ALL_DETECTORS.map(d => [d.name, { enabled: true }])
    ),
  };
}

export async function runHealthScan(
  repoRoot: string,
  config: HealthConfig
): Promise<HealthReport> {
  const startTime = Date.now();
  const allFindings: Finding[] = [];
  
  for (const detector of ALL_DETECTORS) {
    const detectorConfig = config.detectors[detector.name];
    if (!detectorConfig?.enabled) {
      console.log(`  ⏭️  ${detector.name}: disabled`);
      continue;
    }
    
    console.log(`  🔍 ${detector.name}: scanning...`);
    try {
      const findings = await detector.detect(repoRoot, detectorConfig);
      console.log(`  📋 ${detector.name}: ${findings.length} finding(s)`);
      allFindings.push(...findings);
    } catch (e) {
      console.error(`  ❌ ${detector.name}: error — ${e}`);
    }
  }
  
  // Sort by severity
  const severityOrder: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  allFindings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  
  return {
    timestamp: new Date().toISOString(),
    findings: allFindings,
    bySeverity: {
      critical: allFindings.filter(f => f.severity === "critical").length,
      warning: allFindings.filter(f => f.severity === "warning").length,
      info: allFindings.filter(f => f.severity === "info").length,
    },
    byCategory: allFindings.reduce((acc, f) => {
      acc[f.category] = (acc[f.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
    scanDurationMs: Date.now() - startTime,
  };
}
```

### Step 4: Implement issue creation with deduplication

```typescript
export async function reportFindings(
  report: HealthReport,
  config: HealthConfig,
  repo: string
): Promise<{ created: number; skipped: number }> {
  let created = 0;
  let skipped = 0;
  
  // Ensure labels exist
  const labels = [
    { name: "gitclaw:health", color: "FF6B6B" },
    { name: "gitclaw:health:critical", color: "DC2626" },
    { name: "gitclaw:health:warning", color: "F59E0B" },
    { name: "gitclaw:health:info", color: "3B82F6" },
    { name: "gitclaw:tech-debt", color: "8B5CF6" },
    { name: "gitclaw:test-health", color: "10B981" },
    { name: "gitclaw:doc-drift", color: "6366F1" },
    { name: "gitclaw:code-quality", color: "EC4899" },
  ];
  
  for (const label of labels) {
    try {
      await run(["gh", "label", "create", label.name, "--color", label.color, "--force"]);
    } catch (e) { /* ignore */ }
  }
  
  if (config.issueMode === "single-report") {
    // One issue with all findings
    if (report.findings.length === 0) return { created: 0, skipped: 0 };
    
    const body = formatHealthReport(report);
    const title = `🏥 Codebase Health Report — ${report.findings.length} finding(s)`;
    
    // Check for existing open report
    const existing = await checkExistingIssue(repo, "Codebase Health Report");
    if (existing) {
      // Update existing issue
      await run(["gh", "issue", "comment", String(existing), "--body", body]);
      skipped++;
    } else {
      await run(["gh", "issue", "create", "--title", title, "--body", body,
        "--label", "gitclaw:health"]);
      created++;
    }
    
  } else if (config.issueMode === "per-category") {
    // One issue per category
    for (const [category, findings] of Object.entries(groupByCategory(report.findings))) {
      const maxSeverity = findings.reduce((max, f) =>
        severityOrder[f.severity] < severityOrder[max] ? f.severity : max, "info" as Severity);
      
      const title = `🏥 ${categoryTitle(category)} — ${findings.length} finding(s)`;
      const body = formatCategoryReport(category, findings);
      
      const existing = await checkExistingIssue(repo, categoryTitle(category));
      if (existing) {
        await run(["gh", "issue", "comment", String(existing), "--body",
          `**Updated scan (${new Date().toISOString()}):**\n\n${body}`]);
        skipped++;
      } else {
        await run(["gh", "issue", "create", "--title", title, "--body", body,
          "--label", `gitclaw:health,gitclaw:health:${maxSeverity},gitclaw:${category}`]);
        created++;
      }
    }
    
  } else {
    // Per-finding: one issue per finding
    for (const finding of report.findings) {
      // Check for existing issue with same title
      const existing = await checkExistingIssue(repo, finding.title.slice(0, 60));
      if (existing) {
        skipped++;
        continue;
      }
      
      const body = formatFindingIssue(finding);
      await run(["gh", "issue", "create",
        "--title", `🏥 ${finding.title}`,
        "--body", body,
        "--label", `gitclaw:health,gitclaw:health:${finding.severity},gitclaw:${finding.category}`]);
      created++;
      
      // Rate limit: don't create more than 5 issues per scan
      if (created >= 5) {
        console.log("Rate limit: max 5 issues per scan. Remaining findings will be reported next scan.");
        break;
      }
    }
  }
  
  return { created, skipped };
}

async function checkExistingIssue(repo: string, titleFragment: string): Promise<number | null> {
  try {
    const { stdout } = await run([
      "gh", "issue", "list",
      "--label", "gitclaw:health",
      "--state", "open",
      "--search", `"${titleFragment.slice(0, 60)}" in:title`,
      "--json", "number",
      "--jq", ".[0].number // empty",
    ]);
    const num = parseInt(stdout.trim());
    return isNaN(num) ? null : num;
  } catch (e) {
    return null;
  }
}

function formatFindingIssue(finding: Finding): string {
  const severityIcon = { critical: "🔴", warning: "🟡", info: "🔵" }[finding.severity];
  return [
    `## ${severityIcon} ${finding.title}`,
    "",
    `**Severity:** ${finding.severity}`,
    `**Detector:** \`${finding.detector}\``,
    `**Category:** ${finding.category}`,
    `**File:** \`${finding.file}${finding.line ? `:${finding.line}` : ""}\``,
    "",
    finding.description,
    "",
    "### Evidence",
    "```",
    finding.evidence,
    "```",
    "",
    "### Suggested Fix",
    finding.suggestedFix || "No specific fix suggested.",
    "",
    finding.autoFixable ? "💡 _This finding can be auto-fixed. Add the `gitclaw:autofix` label to this issue._" : "",
    "",
    "---",
    `_Detected by GitClaw health scan at ${new Date().toISOString()}_`,
  ].filter(Boolean).join("\n");
}

function formatHealthReport(report: HealthReport): string {
  return [
    `## 🏥 Codebase Health Report`,
    "",
    `**Scan date:** ${report.timestamp}`,
    `**Duration:** ${(report.scanDurationMs / 1000).toFixed(1)}s`,
    `**Findings:** ${report.findings.length} (🔴 ${report.bySeverity.critical} critical, 🟡 ${report.bySeverity.warning} warning, 🔵 ${report.bySeverity.info} info)`,
    "",
    "### Summary by Category",
    "",
    "| Category | Count |",
    "|---|---|",
    ...Object.entries(report.byCategory).map(([cat, count]) => `| ${cat} | ${count} |`),
    "",
    "### All Findings",
    "",
    ...report.findings.map(f => {
      const icon = { critical: "🔴", warning: "🟡", info: "🔵" }[f.severity];
      return `- ${icon} **${f.title}** — \`${f.file}${f.line ? `:${f.line}` : ""}\``;
    }),
    "",
    "---",
    `_Run \`/health-scan\` to trigger a new scan._`,
  ].join("\n");
}
```

### Step 5: Integrate triggers

**A. Scheduled — via feature 04 (cron runs):**

Add to `scheduled-tasks.json`:
```json
{
  "id": "health-scan",
  "title": "Weekly Health Scan",
  "enabled": true,
  "prompt": "INTERNAL:health-scan"
}
```

In the scheduler:
```typescript
if (task.prompt === "INTERNAL:health-scan") {
  const config = loadHealthConfig(gitclawDir);
  if (!config.enabled) continue;
  
  console.log("🏥 Running scheduled health scan...");
  const report = await runHealthScan(process.cwd(), config);
  
  if (report.findings.length > 0) {
    const { created, skipped } = await reportFindings(report, config, repo);
    console.log(`Health scan: ${report.findings.length} findings, ${created} issues created, ${skipped} deduplicated`);
  } else {
    console.log("Health scan: no findings. Codebase is healthy! 🎉");
  }
  
  // Save report to state
  appendFileSync(
    resolve(stateDir, "health-reports.jsonl"),
    JSON.stringify(report) + "\n"
  );
  
  continue;
}
```

**B. On-demand — via `/health-scan` command:**

```typescript
if (parsed.isCommand && parsed.command === "health-scan") {
  const config = loadHealthConfig(gitclawDir);
  
  console.log("🏥 Running on-demand health scan...");
  const report = await runHealthScan(process.cwd(), config);
  
  const summary = formatHealthReport(report);
  await gh("issue", "comment", String(issueNumber), "--body", summary);
  
  if (report.findings.length > 0 && parsed.args?.includes("--create-issues")) {
    const { created } = await reportFindings(report, config, repo);
    await gh("issue", "comment", String(issueNumber), "--body",
      `Created ${created} issue(s) from health scan findings.`);
  }
  
  return;
}
```

### Step 6: Auto-fix for trivial findings

When the `gitclaw:autofix` label is added to a health finding issue:

```typescript
// In GITCLAW-AGENT.ts, detect autofix label:
if (issueLabels.includes("gitclaw:autofix") && issueLabels.includes("gitclaw:health")) {
  // Parse the finding from the issue body
  const body = event.issue.body;
  const fileMatch = body.match(/\*\*File:\*\*\s*`([^`]+)`/);
  const evidenceMatch = body.match(/### Evidence\n```\n([\s\S]*?)```/);
  
  if (fileMatch && evidenceMatch) {
    const file = fileMatch[1].split(":")[0];
    const evidence = evidenceMatch[1].trim();
    
    // Let the agent handle the fix with full context
    prompt = [
      `Fix the following codebase health finding:`,
      ``,
      `**File:** \`${file}\``,
      `**Issue:** ${event.issue.title}`,
      `**Evidence:** \`${evidence}\``,
      ``,
      `Make the minimal change needed to fix this issue.`,
      `Do not change anything else. Do not add new features.`,
    ].join("\n");
    
    // Continue with normal agent execution using this focused prompt
  }
}
```

### Step 7: Configuration

**Default `health.json`:**

```json
{
  "enabled": true,
  "issueMode": "per-category",
  "autoFix": false,
  "detectors": {
    "stale-todos": {
      "enabled": true,
      "maxAgeDays": 14
    },
    "skipped-tests": {
      "enabled": true
    },
    "dead-doc-links": {
      "enabled": true
    },
    "large-files": {
      "enabled": true,
      "maxSizeKB": 500
    },
    "gitclaw-drift": {
      "enabled": true
    }
  }
}
```

### Step 8: Update documentation

**New file:** `.GITCLAW/docs/GITCLAW-Health-Scanning.md`
- What each detector checks for
- How to configure detectors and thresholds
- How deduplication works (won't re-open existing issues)
- How to add custom detectors
- The issue creation rate limit (max 5 per scan)
- How to use `/health-scan` for on-demand scans
- How auto-fix works for trivial findings

**File:** `.GITCLAW/README.md`
- Add "Proactive Health Scanning" to capabilities

### Step 9: Test

- Create a file with an old TODO and verify detection:
  1. Add `// TODO: fix this later` to a file.
  2. Commit it.
  3. Run `/health-scan`.
  4. Verify the TODO is found (it won't be "stale" yet since it's new — set `maxAgeDays: 0` for testing).
- Add a skipped test:
  1. Create a test file with `it.skip("test name", () => {})`.
  2. Run health scan.
  3. Verify the skipped test is detected.
- Create a dead documentation link:
  1. Write `[link](non-existent-file.md)` in a Markdown file.
  2. Run health scan.
  3. Verify the dead link is found.
- Test deduplication:
  1. Run health scan twice.
  2. Verify only one issue is created per finding (second run updates, doesn't duplicate).
- Test per-category mode:
  1. Create findings across multiple categories.
  2. Verify one issue per category.
- Test the rate limit:
  1. Create 10+ findings.
  2. Verify max 5 issues are created per scan.
- Test GitClaw drift detection:
  1. Modify the live workflow to differ from the template.
  2. Run health scan.
  3. Verify drift is detected.

## Design Decisions

**Why pluggable detectors instead of one monolithic scanner?**
Each type of problem requires different scanning logic. TODOs need `git blame` for age. Dead links need Markdown parsing. Skipped tests need language-specific regex patterns. Pluggable detectors can be enabled/disabled independently, configured with different thresholds, and extended with custom detectors. The framework provides the scaffolding; each detector is a focused, testable unit.

**Why `per-category` as the default issue mode instead of `per-finding`?**
Finding volume. A codebase with 50 stale TODOs doesn't need 50 issues — that's as bad as the TODOs themselves. One issue per category ("Tech Debt: 12 stale TODOs") is actionable. The user can drill down in the issue body. `per-finding` mode exists for teams that want fine-grained tracking, and `single-report` mode exists for teams that want minimal noise.

**Why limit to 5 issues per scan?**
Issue fatigue. If the first scan dumps 30 issues, the team ignores all of them and disables the scanner. 5 issues per scan creates a manageable trickle. The most severe findings are reported first (sorted by severity). Over multiple weekly scans, the full backlog surfaces gradually — at a pace the team can absorb.

**Why use `git blame` for age detection?**
Because file modification time is unreliable in CI (git clone resets timestamps). `git blame` tells you when a specific *line* was introduced — that's the true age of a TODO or skipped test. It's more accurate than file-level timestamps and survives refactoring (if the TODO moves to a different line but isn't changed, blame still shows the original commit).

**Why deduplication via title search instead of a tracking file?**
Simplicity. A tracking file (`state/health-findings.json`) would need to be maintained, could get stale, and adds complexity. Searching for existing open issues with matching titles is self-healing: if someone closes the issue, the next scan can re-open it or create a new one. If someone changes the title, it might create a duplicate — but that's an edge case, and duplicates are easy to close manually.

**Why not use Dependabot/CodeQL for dependency/security scanning?**
Those tools already exist, are mature, and are free for public repos. GitClaw's health scanner focuses on problems those tools *don't* catch: stale TODOs, skipped tests, documentation drift, configuration drift, and GitClaw-specific issues. It complements rather than competes with GitHub's native security features.

**Why is this proactive and not reactive?**
Because no human asked. No issue was opened. No comment was posted. The agent *decided* to look, *found* problems, and *reported* them. This is a fundamental shift from "assistant that waits for instructions" to "colleague who notices things and brings them up." The codebase gets healthier over time not because someone remembered to check, but because the agent always checks.
