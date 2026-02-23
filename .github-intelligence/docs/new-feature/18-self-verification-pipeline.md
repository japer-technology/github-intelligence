# Feature: Self-Verification Pipeline

## Summary

Between agent execution and git commit, insert a multi-stage verification pipeline that validates the agent's own work: detect the project's tooling → run type-checks, linters, tests, and build → if any stage fails, feed the errors back to the agent for a second pass → only commit changes that pass verification. The agent applies the scientific method to its own output: hypothesis (the code change works), experiment (run the verification suite), conclusion (commit or iterate). This transforms the agent from "write and pray" to "write, verify, fix, then commit."

## Why This Feature — The Deep Reasoning

### 1. The Current Pipeline Has a Trust Hole

Look at what `GITCLAW-AGENT.ts` does today:

```
User comment → Build prompt → Run pi agent → Extract text → git add -A → git commit → git push → Post comment
```

Between "Run pi agent" and "git commit," there is *nothing*. No validation. No testing. No type-checking. The agent can write syntactically invalid TypeScript, introduce a function that breaks existing tests, produce a build that doesn't compile, or violate every lint rule in the project — and it all gets committed and pushed to main.

This is fine for conversational responses (text is text). It's not fine for code changes. And code changes are GitClaw's highest-value capability — the reason it has write access to the repo at all.

### 2. The Agent Already Has the Tools — It Just Doesn't Use Them Systematically

The `pi` agent has `bash` access. It *can* run `bun test`, `npx tsc --noEmit`, `npx eslint`, or `bun run build`. Sometimes it does — when the user asks "make sure the tests pass" or when the agent is diligent. But there's no guarantee. The verification isn't systematic; it's vibes-based.

This feature makes verification *structural*. It happens after every run that modifies code, regardless of whether the agent remembered to test, regardless of the prompt, regardless of the model's mood.

### 3. Failed Verification + Iteration Is More Valuable Than Prevention

Naive safety says: "If the tests fail, don't commit." But that wastes the 90% of the work that was correct. Smart safety says: "If the tests fail, tell the agent what failed and let it fix the problem — *then* commit."

This is the key insight. The verification pipeline doesn't just gate commits — it creates a **feedback loop**. The agent writes code, the pipeline runs tests, tests fail, the agent reads the failures, the agent fixes the code, the pipeline runs tests again. This happens within a single workflow run. The user sees the final result: working code.

This is exactly what a good developer does: write code → run tests → fix failures → run tests again → commit when green. The pipeline automates this discipline.

### 4. It Learns the Project's Definition of "Correct"

Different projects have different quality bars:
- A TypeScript project needs `tsc --noEmit` to pass.
- A React project needs `eslint` with specific rules.
- A Python project needs `pytest` and `mypy`.
- A Rust project needs `cargo check` and `cargo test`.
- Some projects just need `npm run build` to succeed.

The pipeline auto-detects the project's tooling from `package.json` scripts, config files (`tsconfig.json`, `.eslintrc`, `pyproject.toml`, `Cargo.toml`), and CI workflow definitions. It runs what the project already defines as "correct" — no configuration needed.

### 5. It Composes With Every Safety Feature

| Feature | How Verification Helps |
|---|---|
| **Branch-per-task (07)** | PRs created from verified branches have higher merge confidence |
| **Guardrails (16)** | Guardrails block path violations; verification blocks logical violations |
| **Undo (11)** | Fewer undo requests because fewer broken commits |
| **PR Auto-Review (01)** | Agent reviews PRs *and* verifies its own changes |
| **Cost Tracking (05)** | Failed verification iterations are tracked — visible if iteration is too expensive |
| **Live Progress (03)** | Progress comment shows "🔬 Running verification..." during the pipeline |

### 6. The Existing Test Infrastructure Proves the Need

This repo has `.GITCLAW/tests/phase0.test.js` — 250 lines of structural validation tests. They're never run by the agent. The agent could modify `GITCLAW-AGENT.ts` in a way that breaks every assertion in that test file, and nothing would catch it before commit. The verification pipeline would catch it.

## Scope

### In Scope
- Tooling auto-detection: scan the repo for `package.json`, `tsconfig.json`, `.eslintrc*`, `pyproject.toml`, `Cargo.toml`, `Makefile`, `go.mod`, CI workflow test commands
- Verification stages: type-check → lint → test → build (configurable, all optional)
- Iterative fix loop: on failure, feed errors back to the agent for a second attempt (max 2 iterations)
- Selective verification: only run when the agent has modified code files (not for pure conversation/state changes)
- Verification config: `.GITCLAW/verify.json` for custom commands and overrides
- Timeout enforcement: kill verification stages that exceed a time limit
- Result reporting: include verification results in the issue comment

### Out of Scope
- Security scanning (SAST/DAST) — that's a separate concern
- Performance benchmarking
- Visual regression testing
- Installing missing test dependencies (use what the project already has)
- Running the full CI pipeline (just the fast, local checks)

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Tooling detector** | Scan for config files, detect available commands | ~2 hours |
| **Verification runner** | Execute each stage with timeout and output capture | ~2 hours |
| **Iterative fix loop** | Feed failures to agent, re-run verification | ~2.5 hours |
| **Agent orchestrator integration** | Insert pipeline between execution and commit | ~1.5 hours |
| **Configuration** (`verify.json`) | Custom commands, stage enable/disable, timeout | ~30 min |
| **Result reporting** | Format and include results in issue comment | ~30 min |
| **Selective trigger** | Detect code changes vs. state-only changes | ~30 min |
| **Docs** | Document verification system | ~30 min |
| **Testing** | Test detection, test failure loop, test timeout | ~1.5 hours |

**Total: ~12 hours.**

---

## AI Implementation Instructions

### Step 1: Create the tooling detector

**New file:** `.GITCLAW/lifecycle/GITCLAW-VERIFY.ts`

```typescript
import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

export interface VerificationStage {
  name: string;                // "typecheck" | "lint" | "test" | "build"
  command: string;             // the shell command to run
  description: string;         // human-readable description
  timeout: number;             // max seconds
  optional: boolean;           // if true, failure doesn't block commit
  detected: boolean;           // whether this was auto-detected or manually configured
}

export interface VerificationConfig {
  enabled: boolean;
  stages: VerificationStage[];
  maxIterations: number;       // how many fix attempts (default: 2)
  skipPatterns: string[];      // file patterns that don't trigger verification
  codeExtensions: string[];    // file extensions considered "code"
}

export function detectTooling(repoRoot: string): VerificationStage[] {
  const stages: VerificationStage[] = [];
  
  // ── Node.js / TypeScript / Bun ──────────────────────────────────────────
  const pkgJsonPath = resolve(repoRoot, "package.json");
  const gitclawPkgJsonPath = resolve(repoRoot, ".GITCLAW", "package.json");
  
  // Check for tsconfig.json (TypeScript type checking)
  const tsconfigPaths = [
    resolve(repoRoot, "tsconfig.json"),
    resolve(repoRoot, "tsconfig.build.json"),
  ];
  for (const tsconfig of tsconfigPaths) {
    if (existsSync(tsconfig)) {
      stages.push({
        name: "typecheck",
        command: "npx tsc --noEmit",
        description: "TypeScript type checking",
        timeout: 120,
        optional: false,
        detected: true,
      });
      break;
    }
  }
  
  // Check package.json scripts
  if (existsSync(pkgJsonPath)) {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    const scripts = pkg.scripts || {};
    
    if (scripts.lint) {
      stages.push({
        name: "lint",
        command: "npm run lint",
        description: `Linting (${scripts.lint})`,
        timeout: 60,
        optional: true,
        detected: true,
      });
    } else {
      // Check for eslint config files
      const eslintConfigs = [".eslintrc", ".eslintrc.json", ".eslintrc.js", ".eslintrc.yml", "eslint.config.js", "eslint.config.mjs"];
      for (const config of eslintConfigs) {
        if (existsSync(resolve(repoRoot, config))) {
          stages.push({
            name: "lint",
            command: "npx eslint . --max-warnings=0",
            description: "ESLint",
            timeout: 60,
            optional: true,
            detected: true,
          });
          break;
        }
      }
    }
    
    if (scripts.test) {
      stages.push({
        name: "test",
        command: "npm test",
        description: `Tests (${scripts.test})`,
        timeout: 300,
        optional: false,
        detected: true,
      });
    }
    
    if (scripts.build) {
      stages.push({
        name: "build",
        command: "npm run build",
        description: `Build (${scripts.build})`,
        timeout: 300,
        optional: false,
        detected: true,
      });
    }
  }
  
  // Check for .GITCLAW's own test infrastructure
  if (existsSync(resolve(repoRoot, ".GITCLAW", "tests"))) {
    stages.push({
      name: "test",
      command: "node --test .GITCLAW/tests/*.test.js",
      description: "GitClaw structural tests",
      timeout: 60,
      optional: false,
      detected: true,
    });
  }
  
  // ── Python ──────────────────────────────────────────────────────────────
  const pyprojectPath = resolve(repoRoot, "pyproject.toml");
  const setupPyPath = resolve(repoRoot, "setup.py");
  
  if (existsSync(pyprojectPath) || existsSync(setupPyPath)) {
    // Check for mypy
    if (existsSync(resolve(repoRoot, "mypy.ini")) || existsSync(pyprojectPath)) {
      const pyproject = existsSync(pyprojectPath) ? readFileSync(pyprojectPath, "utf-8") : "";
      if (pyproject.includes("[tool.mypy]") || existsSync(resolve(repoRoot, "mypy.ini"))) {
        stages.push({
          name: "typecheck",
          command: "python -m mypy .",
          description: "mypy type checking",
          timeout: 120,
          optional: false,
          detected: true,
        });
      }
    }
    
    // Check for pytest
    if (existsSync(resolve(repoRoot, "pytest.ini")) ||
        existsSync(resolve(repoRoot, "conftest.py")) ||
        (existsSync(pyprojectPath) && readFileSync(pyprojectPath, "utf-8").includes("[tool.pytest"))) {
      stages.push({
        name: "test",
        command: "python -m pytest",
        description: "pytest",
        timeout: 300,
        optional: false,
        detected: true,
      });
    }
    
    // Check for ruff or flake8
    if (existsSync(resolve(repoRoot, "ruff.toml")) ||
        (existsSync(pyprojectPath) && readFileSync(pyprojectPath, "utf-8").includes("[tool.ruff"))) {
      stages.push({
        name: "lint",
        command: "python -m ruff check .",
        description: "Ruff linting",
        timeout: 60,
        optional: true,
        detected: true,
      });
    }
  }
  
  // ── Rust ────────────────────────────────────────────────────────────────
  if (existsSync(resolve(repoRoot, "Cargo.toml"))) {
    stages.push(
      { name: "typecheck", command: "cargo check", description: "Cargo check", timeout: 300, optional: false, detected: true },
      { name: "test", command: "cargo test", description: "Cargo test", timeout: 300, optional: false, detected: true },
    );
  }
  
  // ── Go ──────────────────────────────────────────────────────────────────
  if (existsSync(resolve(repoRoot, "go.mod"))) {
    stages.push(
      { name: "typecheck", command: "go vet ./...", description: "Go vet", timeout: 120, optional: false, detected: true },
      { name: "test", command: "go test ./...", description: "Go test", timeout: 300, optional: false, detected: true },
    );
  }
  
  // ── CI workflow mining ──────────────────────────────────────────────────
  // As a fallback, look at the project's CI workflow for test commands
  // This catches custom setups that don't follow standard conventions
  // (Implementation: parse .github/workflows/*.yml for `run:` steps containing
  //  "test", "lint", "check", "build" — but only if no stages were detected above)
  
  return stages;
}
```

### Step 2: Load configuration

```typescript
export function loadVerifyConfig(gitclawDir: string, repoRoot: string): VerificationConfig {
  const configPath = resolve(gitclawDir, "verify.json");
  
  // Auto-detect stages
  const detectedStages = detectTooling(repoRoot);
  
  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    return {
      enabled: config.enabled ?? true,
      stages: config.stages ?? detectedStages,
      maxIterations: config.maxIterations ?? 2,
      skipPatterns: config.skipPatterns ?? [".GITCLAW/state/**", "*.md", "*.txt", "*.json"],
      codeExtensions: config.codeExtensions ?? [".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java", ".c", ".cpp", ".h"],
    };
  }
  
  // Default config: use auto-detected stages
  return {
    enabled: detectedStages.length > 0, // only enable if we detected something
    stages: detectedStages,
    maxIterations: 2,
    skipPatterns: [".GITCLAW/state/**", "*.md", "*.txt", "*.json"],
    codeExtensions: [".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java", ".c", ".cpp", ".h"],
  };
}
```

**Default `verify.json` (optional, for customization):**

```json
{
  "enabled": true,
  "maxIterations": 2,
  "skipPatterns": [".GITCLAW/state/**", "*.md", "*.txt"],
  "stages": [
    {
      "name": "typecheck",
      "command": "npx tsc --noEmit",
      "timeout": 120,
      "optional": false
    },
    {
      "name": "test",
      "command": "node --test .GITCLAW/tests/*.test.js",
      "timeout": 60,
      "optional": false
    }
  ]
}
```

### Step 3: Build the verification runner

```typescript
export interface StageResult {
  stage: VerificationStage;
  passed: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface VerificationResult {
  passed: boolean;
  stages: StageResult[];
  totalDurationMs: number;
  failedStages: StageResult[];
  iteration: number;
}

export async function runVerification(
  config: VerificationConfig,
  repoRoot: string,
  iteration: number = 1
): Promise<VerificationResult> {
  const results: StageResult[] = [];
  const startTime = Date.now();
  
  for (const stage of config.stages) {
    console.log(`🔬 [${iteration}/${config.maxIterations}] Running ${stage.name}: ${stage.command}`);
    const stageStart = Date.now();
    
    try {
      const proc = Bun.spawn(["bash", "-c", stage.command], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, CI: "true", NODE_ENV: "test" },
      });
      
      // Implement timeout
      const timeoutPromise = new Promise<"timeout">((resolve) =>
        setTimeout(() => resolve("timeout"), stage.timeout * 1000)
      );
      
      const exitPromise = proc.exited;
      const race = await Promise.race([exitPromise, timeoutPromise]);
      
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let exitCode = 0;
      
      if (race === "timeout") {
        proc.kill();
        timedOut = true;
        exitCode = -1;
        stderr = `TIMEOUT: Stage exceeded ${stage.timeout}s limit`;
      } else {
        exitCode = race;
        stdout = await new Response(proc.stdout).text();
        stderr = await new Response(proc.stderr).text();
      }
      
      // Truncate output to avoid memory issues
      const MAX_OUTPUT = 5000;
      stdout = stdout.slice(-MAX_OUTPUT);
      stderr = stderr.slice(-MAX_OUTPUT);
      
      const result: StageResult = {
        stage,
        passed: exitCode === 0,
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - stageStart,
        timedOut,
      };
      
      results.push(result);
      
      if (!result.passed) {
        console.log(`  ❌ ${stage.name} failed (exit ${exitCode})`);
        if (!stage.optional) {
          // Stop running further stages if a required stage fails
          // (no point running tests if type-check fails)
          break;
        }
      } else {
        console.log(`  ✅ ${stage.name} passed (${result.durationMs}ms)`);
      }
      
    } catch (e) {
      results.push({
        stage,
        passed: false,
        exitCode: -1,
        stdout: "",
        stderr: `Error running stage: ${e}`,
        durationMs: Date.now() - stageStart,
        timedOut: false,
      });
    }
  }
  
  const failedStages = results.filter(r => !r.passed && !r.stage.optional);
  
  return {
    passed: failedStages.length === 0,
    stages: results,
    totalDurationMs: Date.now() - startTime,
    failedStages,
    iteration,
  };
}
```

### Step 4: Build the iterative fix loop

This is the critical innovation. When verification fails, the agent gets another chance.

```typescript
export async function verifyAndFix(
  config: VerificationConfig,
  repoRoot: string,
  gitclawDir: string,
  sessionPath: string,
  prompt: string,
  piArgs: string[],
): Promise<{ finalResult: VerificationResult; iterations: VerificationResult[] }> {
  const iterations: VerificationResult[] = [];
  
  for (let i = 1; i <= config.maxIterations; i++) {
    const result = await runVerification(config, repoRoot, i);
    iterations.push(result);
    
    if (result.passed) {
      console.log(`✅ Verification passed on iteration ${i}`);
      return { finalResult: result, iterations };
    }
    
    if (i === config.maxIterations) {
      console.log(`❌ Verification failed after ${i} iterations`);
      return { finalResult: result, iterations };
    }
    
    // ── Feed errors back to the agent ─────────────────────────────────────
    console.log(`🔄 Verification failed on iteration ${i}, asking agent to fix...`);
    
    const fixPrompt = buildFixPrompt(result);
    
    // Run the agent again with the fix prompt, resuming the same session
    const fixArgs = [
      ...piArgs.filter(a => a !== "-p"), // remove old prompt
      "--session", sessionPath,          // resume same session
      "-p", fixPrompt,                   // new prompt with error details
    ];
    
    const pi = Bun.spawn(fixArgs, { stdout: "pipe", stderr: "inherit" });
    const tee = Bun.spawn(["tee", `/tmp/agent-fix-${i}.jsonl`], { stdin: pi.stdout, stdout: "inherit" });
    await tee.exited;
    
    const exitCode = await pi.exited;
    if (exitCode !== 0) {
      console.log(`Agent fix attempt ${i} failed with exit code ${exitCode}`);
      // Continue to the next verification attempt anyway — maybe a partial fix helped
    }
  }
  
  // Should not reach here, but safety return
  return { finalResult: iterations[iterations.length - 1], iterations };
}

function buildFixPrompt(result: VerificationResult): string {
  const failureDetails = result.failedStages.map(stage => {
    const output = [stage.stderr, stage.stdout].filter(Boolean).join("\n").trim();
    return [
      `### ❌ ${stage.stage.name} failed`,
      `**Command:** \`${stage.stage.command}\``,
      `**Exit code:** ${stage.exitCode}`,
      stage.timedOut ? `**Timed out** after ${stage.stage.timeout}s` : "",
      "**Output:**",
      "```",
      output.slice(-3000), // last 3000 chars of output — the errors are usually at the end
      "```",
    ].filter(Boolean).join("\n");
  }).join("\n\n");
  
  return [
    "⚠️ VERIFICATION FAILED — Please fix the following errors.",
    "",
    "The verification pipeline detected failures in your changes.",
    "Please fix the errors below and ensure your changes are correct.",
    "Do NOT explain what went wrong — just fix the code.",
    "",
    failureDetails,
    "",
    "Fix the issues above. Only modify the files necessary to resolve these errors.",
    "Do not introduce new features or changes beyond what's needed for the fix.",
  ].join("\n");
}
```

### Step 5: Integrate into the agent orchestrator

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts`

Insert the verification pipeline between agent execution and commit:

```typescript
import { loadVerifyConfig, runVerification, verifyAndFix, VerificationResult } from "./GITCLAW-VERIFY";

// ... after pi agent finishes and agent text is extracted ...

// ── Verification Pipeline ────────────────────────────────────────────────
let verificationResult: VerificationResult | null = null;
let verificationReport = "";

// Check if the agent modified any code files
const { stdout: changedFilesRaw } = await run(["git", "diff", "--name-only", "HEAD"]);
const changedFiles = changedFilesRaw.trim().split("\n").filter(Boolean);

const verifyConfig = loadVerifyConfig(gitclawDir, process.cwd());

if (verifyConfig.enabled && changedFiles.length > 0) {
  // Check if any changed files are "code" (not just state/docs)
  const codeChanges = changedFiles.filter(f => {
    // Skip state files and files matching skip patterns
    if (verifyConfig.skipPatterns.some(p => matchGlob(f, p))) return false;
    // Check if file extension is a code extension
    return verifyConfig.codeExtensions.some(ext => f.endsWith(ext));
  });
  
  if (codeChanges.length > 0) {
    console.log(`\n🔬 Verification: ${codeChanges.length} code file(s) changed, running pipeline...`);
    
    const { finalResult, iterations } = await verifyAndFix(
      verifyConfig,
      process.cwd(),
      gitclawDir,
      sessionPath,
      prompt,
      piArgs,
    );
    
    verificationResult = finalResult;
    
    // Build the verification report for the issue comment
    verificationReport = formatVerificationReport(finalResult, iterations);
    
    if (!finalResult.passed) {
      console.log(`⚠️ Verification failed after ${iterations.length} iteration(s). Committing with warnings.`);
      // We still commit — but the report warns the user
    } else {
      console.log(`✅ Verification passed after ${iterations.length} iteration(s).`);
    }
  } else {
    console.log("No code files changed, skipping verification");
  }
}

// ── Commit and push (existing logic) ─────────────────────────────────────
await run(["git", "add", "-A"]);
// ... existing commit/push logic ...

// ── Post reply with verification results ─────────────────────────────────
const commentBody = trimmedText.slice(0, MAX_COMMENT_LENGTH - verificationReport.length - 100)
  + (verificationReport ? "\n\n" + verificationReport : "");
```

### Step 6: Format the verification report

```typescript
function formatVerificationReport(
  finalResult: VerificationResult,
  iterations: VerificationResult[]
): string {
  if (iterations.length === 0) return "";
  
  const icon = finalResult.passed ? "✅" : "⚠️";
  const status = finalResult.passed ? "All checks passed" : "Some checks failed";
  
  const stageLines = finalResult.stages.map(r => {
    const icon = r.passed ? "✅" : r.stage.optional ? "⚡" : "❌";
    const time = `${(r.durationMs / 1000).toFixed(1)}s`;
    const timeout = r.timedOut ? " (timed out)" : "";
    return `| ${icon} | ${r.stage.name} | \`${r.stage.command}\` | ${r.passed ? "pass" : "fail"}${timeout} | ${time} |`;
  }).join("\n");
  
  const iterationNote = iterations.length > 1
    ? `\n\n_The agent iterated ${iterations.length} time(s) to fix verification failures._`
    : "";
  
  return [
    "---",
    `${icon} **Verification: ${status}** (${(finalResult.totalDurationMs / 1000).toFixed(1)}s)`,
    "",
    "| | Stage | Command | Result | Time |",
    "|---|---|---|---|---|",
    stageLines,
    iterationNote,
  ].join("\n");
}
```

### Step 7: Handle edge cases

**A. Agent modifies only .GITCLAW/state/ files:**
Skip verification entirely. State changes (sessions, mappings) don't need type-checking.

**B. Verification stages not available (no test infra in repo):**
`detectTooling` returns empty stages → `enabled` defaults to `false` → pipeline is skipped. Zero overhead for repos without test infrastructure.

**C. Verification takes too long:**
Each stage has a per-stage timeout. Total verification is bounded by `sum(stage timeouts) × maxIterations`. For the default config (typecheck 120s + test 60s × 2 iterations), worst case is ~6 minutes. GitHub Actions has a 6-hour default timeout — this is well within bounds.

**D. Agent's fix attempt makes things worse:**
The fix loop runs verification after each fix attempt. If the fix introduces new failures, those are reported. After `maxIterations`, the pipeline stops and commits with a warning. The user sees the verification report and knows the commit needs attention.

**E. No `bun`/`node`/`python` available on the runner:**
GitHub Actions ubuntu-latest has Node.js pre-installed. Bun is installed by the workflow. Python is pre-installed. For other languages, the user should add setup steps to the workflow. Tooling detection only proposes stages for tools that exist.

**F. The iteration loop and cost:**
Each fix iteration is a full agent invocation — it consumes API tokens. With `maxIterations: 2`, the worst case is 3× the normal cost (1 original + 2 fix attempts). The cost tracking feature (05) captures this. Users can set `maxIterations: 0` to disable iteration (just report, don't fix).

### Step 8: Add a verification-only mode

For existing code (not just agent-written code), add a `/verify` slash command:

```typescript
if (parsed.isCommand && parsed.command === "verify") {
  const config = loadVerifyConfig(gitclawDir, process.cwd());
  if (!config.enabled || config.stages.length === 0) {
    await gh("issue", "comment", String(issueNumber), "--body",
      "No verification stages detected. Add a `verify.json` or ensure the project has standard tooling (package.json scripts, tsconfig.json, etc.).");
    return;
  }
  
  const result = await runVerification(config, process.cwd());
  const report = formatVerificationReport(result, [result]);
  await gh("issue", "comment", String(issueNumber), "--body",
    `## 🔬 Verification Results\n\n${report}`);
  return;
}
```

### Step 9: Update documentation

**New file:** `.GITCLAW/docs/GITCLAW-Verification.md`
- How auto-detection works
- Supported ecosystems (Node, Python, Rust, Go)
- Configuration reference (`verify.json`)
- The iterative fix loop explained
- How to add custom verification stages
- How to disable verification
- Cost implications of iteration

**File:** `.GITCLAW/README.md`
- Add "Self-Verification" to capabilities

### Step 10: Test

- In a repo with `tsconfig.json`, introduce a type error via the agent:
  1. Ask the agent to write a function with a deliberate type issue (or observe natural type errors).
  2. Verify that `tsc --noEmit` catches it.
  3. Verify the agent gets a second chance and fixes the type error.
  4. Verify the final commit has correct types.
  5. Verify the issue comment includes the verification report.
- In a repo with tests, introduce a test failure:
  1. Ask the agent to modify code in a way that breaks an existing test.
  2. Verify the test failure is caught.
  3. Verify the agent's fix attempt addresses the specific failure.
- Test the timeout mechanism:
  1. Configure a stage with a 5-second timeout.
  2. Use a command that runs for 30 seconds.
  3. Verify it's killed and reported as timed out.
- Test with no tooling:
  1. Remove all config files and package.json.
  2. Verify detection returns empty stages.
  3. Verify the pipeline is skipped (no error, no delay).
- Test `/verify` command:
  1. Post `/verify` on an issue.
  2. Verify the verification runs against the current repo state.
  3. Verify results are posted as a comment.
- Test iteration limit:
  1. Set `maxIterations: 1` (no fix attempts).
  2. Introduce a failure.
  3. Verify it's reported but no fix is attempted.

## Design Decisions

**Why auto-detect instead of requiring configuration?**
GitClaw is a drop-in. It should work without configuration. A TypeScript project has `tsconfig.json` — that's enough information to know that `tsc --noEmit` is a valid check. A project with `package.json` scripts named `test` and `lint` — those are the checks. Auto-detection makes verification zero-config for standard projects. The `verify.json` override exists for non-standard setups.

**Why iterate instead of just blocking?**
Because the agent can usually fix its own mistakes when told what went wrong. A type error is often a missing import or a wrong parameter type. A test failure is often a missed edge case. The agent is an LLM — it's good at reading error messages and fixing code. Blocking without iteration wastes the work. Iterating with feedback usually produces a correct result.

**Why limit iterations to 2 (configurable)?**
Diminishing returns. If the agent can't fix it in 2 attempts, it probably can't fix it in 10. Each iteration costs API tokens and wall-clock time. 2 iterations is the sweet spot: enough for simple fixes (1 attempt usually works), bounded enough to prevent runaway costs.

**Why still commit if verification fails?**
Two reasons: (1) The agent may have made valuable non-code changes (documentation, configuration, analysis) alongside the broken code. Blocking the entire commit discards everything. (2) The verification report in the issue comment warns the user explicitly. They can review and fix manually, or use `/undo` (feature 11). This follows the "graceful degradation" principle from the guardrails feature: report problems, don't silently discard work.

**Why run GitClaw's own tests (`phase0.test.js`) as a stage?**
Self-consistency. If the agent modifies its own lifecycle code, the structural tests catch regressions. This is a concrete case of the self-modification problem (feature 16 addresses path-based guardrails; this addresses logical correctness). The agent can't accidentally break its own session model or commit pipeline because the tests verify it.

**Why separate from CI?**
CI runs on push — after the commit. Verification runs before the commit. CI is the safety net for the team; verification is the agent's personal discipline. They complement each other: verification catches most issues pre-commit, CI catches whatever slips through and also runs heavier checks (integration tests, deployment validation) that don't belong in a fast feedback loop.
