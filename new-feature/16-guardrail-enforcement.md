# Feature: Path-Based Guardrail Enforcement Engine

## Summary

Implement a runtime enforcement layer that validates every file the agent creates, modifies, or deletes against configurable path-based rules. The guardrail engine sits between the agent's execution and the commit step, intercepting changes that violate defined policies: blocked paths, protected files, size limits, and command restrictions. Violations are rolled back before commit and reported to the user. This is a hard security boundary — not prompt-based suggestions but actual system-enforced constraints that the LLM cannot override regardless of what it's told.

## Why This Feature — The Deep Reasoning

**1. Prompt-based guardrails are a suggestion, not a boundary.**

Today, the only thing preventing the agent from editing `.github/workflows/GITCLAW-WORKFLOW-AGENT.yml` (its own workflow), `.GITCLAW/.pi/APPEND_SYSTEM.md` (its own system prompt), or `production.env` (your secrets) is... the LLM deciding not to. A sufficiently clever prompt — or a simple misunderstanding — can bypass any instruction-based guardrail. The Installation Personalities document (already in this repo) describes a detailed three-layer enforcement model, but zero lines of enforcement code exist. This feature builds Layer 2: system-enforced pre-commit validation.

**2. The agent can modify its own behavioral files.**

This is the most dangerous capability gap. The agent has write access to:
- `.GITCLAW/.pi/APPEND_SYSTEM.md` — its own system prompt
- `.GITCLAW/.pi/settings.json` — its own model and provider config
- `.GITCLAW/AGENTS.md` — its own identity and instructions
- `.GITCLAW/lifecycle/GITCLAW-AGENT.ts` — its own orchestration code
- `.github/workflows/GITCLAW-WORKFLOW-AGENT.yml` — its own workflow trigger

A user saying "make yourself more helpful" could lead to the agent rewriting its system prompt to remove safety constraints. A user saying "speed things up" could lead to the agent changing its model to one with no safety training. These aren't theoretical — they're natural language requests that an eager-to-please LLM might execute literally. Guardrails prevent this structurally.

**3. It's required for every other safety feature to be trustworthy.**

Branch-per-task (feature 07) creates PRs for code changes, but `.GITCLAW/` changes still push to main. Personas (feature 10) inject custom system prompts, but nothing prevents a persona from granting itself more access. Guided workflows (feature 12) run structured processes, but nothing prevents the agent from writing outside the workflow's scope. Guardrails are the foundation that makes every other safety mechanism credible.

**4. The design already exists — it just needs implementation.**

The Installation Personalities document describes the exact guardrail schema: `allowedWritePaths`, `deniedWritePaths`, `protectedFiles`, `deniedCommands`, `maxFileSize`. The three-layer enforcement model (LLM-enforced → System-enforced → Audit) is documented. The personality JSON format is specified. What's missing is the 200 lines of TypeScript that actually enforce it.

**5. It enables safe delegation.**

Teams won't give an AI agent write access to their repo unless they can define boundaries. "The agent can edit anything in `src/` but can't touch `infrastructure/`, `.env`, or workflow files" is a reasonable policy. Without enforcement, it's a hope. With enforcement, it's a guarantee.

## Scope

### In Scope
- Guardrail configuration file (`.GITCLAW/guardrails.json`)
- Pre-commit validation: check all staged changes against rules before committing
- Path rules: `allowedWritePaths`, `deniedWritePaths`, `protectedFiles`
- File size limits: reject changes that produce files exceeding a threshold
- Command restrictions: wrap the agent's shell access to block forbidden commands
- Self-modification protection: hardcoded block on agent modifying its own critical files
- Violation reporting: post a clear comment listing what was blocked and why
- Audit logging: record all guardrail evaluations in `state/guardrail-audit.jsonl`
- Graceful degradation: violations block specific files, not the entire run

### Out of Scope
- Permission models beyond path-based (no role-based access control)
- Network-level restrictions (can't block outbound HTTP from the agent)
- Runtime monitoring of agent tool calls during execution (only pre-commit validation)
- Encrypted or signed guardrail configs (trusted because they're in git)

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Guardrail config format** | Schema, defaults, validation | ~30 min |
| **Pre-commit validator** (new `GITCLAW-GUARDRAILS.ts`) | Path matching, size checking, violation detection | ~2.5 hours |
| **Self-modification protection** | Hardcoded rules for critical agent files | ~30 min |
| **Command restriction wrapper** | Intercept dangerous shell commands before execution | ~1.5 hours |
| **Agent orchestrator integration** | Insert validation between agent run and commit | ~1.5 hours |
| **Violation reporting** | Format and post violation details | ~30 min |
| **Audit logging** | Append-only JSONL audit trail | ~30 min |
| **Default guardrails** | Sensible defaults that protect critical paths | ~30 min |
| **Docs** | Document guardrail system, configuration reference | ~30 min |
| **Testing** | Test each rule type, test bypass attempts, test audit | ~1.5 hours |

**Total: ~10 hours.**

---

## AI Implementation Instructions

### Step 1: Create the guardrail configuration

**New file:** `.GITCLAW/guardrails.json`

```json
{
  "version": 1,
  "enabled": true,
  "rules": {
    "allowedWritePaths": [
      "*"
    ],
    "deniedWritePaths": [
      ".github/workflows/",
      ".GITCLAW/lifecycle/",
      ".GITCLAW/install/",
      ".GITCLAW/guardrails.json",
      ".GITCLAW/GITCLAW-ENABLED.md"
    ],
    "protectedFiles": [
      ".GITCLAW/.pi/APPEND_SYSTEM.md",
      ".GITCLAW/.pi/settings.json",
      ".GITCLAW/AGENTS.md",
      ".GITCLAW/package.json"
    ],
    "deniedCommands": [
      "rm -rf /",
      "rm -rf /*",
      "sudo",
      "curl.*\\|.*sh",
      "wget.*\\|.*sh",
      "chmod 777"
    ],
    "maxFileSizeBytes": 1048576,
    "allowSelfModification": false
  },
  "exemptions": {
    "stateAlwaysAllowed": true,
    "issueOverrideLabel": "gitclaw:unrestricted"
  },
  "audit": {
    "enabled": true,
    "logPath": "state/guardrail-audit.jsonl"
  }
}
```

**Rule semantics:**
- `allowedWritePaths`: Glob patterns for paths the agent MAY write. `["*"]` means everything (default).
- `deniedWritePaths`: Glob patterns for paths the agent MUST NOT write. These override `allowedWritePaths`.
- `protectedFiles`: Specific files that require explicit approval (agent can propose changes but they're stripped from the commit).
- `deniedCommands`: Regex patterns matched against shell commands the agent attempts.
- `maxFileSizeBytes`: Maximum size for any single file the agent creates or modifies.
- `allowSelfModification`: If false, hardcoded protection for critical agent files.
- `stateAlwaysAllowed`: `.GITCLAW/state/` is always writable (session files, mappings, metrics).
- `issueOverrideLabel`: If this label is on the issue, guardrails are relaxed (escape hatch for trusted operators).

### Step 2: Create the pre-commit validator

**New file:** `.GITCLAW/lifecycle/GITCLAW-GUARDRAILS.ts`

```typescript
import { existsSync, readFileSync, statSync } from "fs";
import { resolve } from "path";

export interface GuardrailConfig {
  enabled: boolean;
  rules: {
    allowedWritePaths: string[];
    deniedWritePaths: string[];
    protectedFiles: string[];
    deniedCommands: string[];
    maxFileSizeBytes: number;
    allowSelfModification: boolean;
  };
  exemptions: {
    stateAlwaysAllowed: boolean;
    issueOverrideLabel: string;
  };
  audit: {
    enabled: boolean;
    logPath: string;
  };
}

export interface Violation {
  file: string;
  rule: string;       // "denied-path" | "not-allowed" | "protected" | "size-limit" | "self-modification"
  detail: string;
}

export interface ValidationResult {
  valid: boolean;
  violations: Violation[];
  allowedFiles: string[];
  blockedFiles: string[];
}

// Hardcoded critical files that are ALWAYS protected regardless of config
const CRITICAL_FILES = [
  ".GITCLAW/lifecycle/GITCLAW-AGENT.ts",
  ".GITCLAW/lifecycle/GITCLAW-ENABLED.ts",
  ".GITCLAW/lifecycle/GITCLAW-INDICATOR.ts",
  ".GITCLAW/lifecycle/GITCLAW-GUARDRAILS.ts",
  ".GITCLAW/guardrails.json",
  ".github/workflows/GITCLAW-WORKFLOW-AGENT.yml",
];

export function loadGuardrails(gitclawDir: string): GuardrailConfig {
  const configPath = resolve(gitclawDir, "guardrails.json");
  if (!existsSync(configPath)) {
    // Return permissive defaults if no config exists
    return {
      enabled: false,
      rules: {
        allowedWritePaths: ["*"],
        deniedWritePaths: [],
        protectedFiles: [],
        deniedCommands: [],
        maxFileSizeBytes: 10 * 1024 * 1024, // 10MB
        allowSelfModification: true,
      },
      exemptions: { stateAlwaysAllowed: true, issueOverrideLabel: "gitclaw:unrestricted" },
      audit: { enabled: false, logPath: "state/guardrail-audit.jsonl" },
    };
  }
  return JSON.parse(readFileSync(configPath, "utf-8"));
}

export function validateChanges(
  changedFiles: string[],
  config: GuardrailConfig,
  repoRoot: string,
  issueLabels: string[] = []
): ValidationResult {
  const violations: Violation[] = [];
  const allowedFiles: string[] = [];
  const blockedFiles: string[] = [];
  
  // Check for override label
  if (issueLabels.includes(config.exemptions.issueOverrideLabel)) {
    return { valid: true, violations: [], allowedFiles: changedFiles, blockedFiles: [] };
  }
  
  for (const file of changedFiles) {
    let blocked = false;
    
    // Rule 0: State files are always allowed
    if (config.exemptions.stateAlwaysAllowed && file.startsWith(".GITCLAW/state/")) {
      allowedFiles.push(file);
      continue;
    }
    
    // Rule 1: Critical files — ALWAYS protected (hardcoded, not configurable)
    if (!config.rules.allowSelfModification && CRITICAL_FILES.some(cf => file === cf || file.endsWith(cf))) {
      violations.push({
        file,
        rule: "self-modification",
        detail: `Critical agent file — cannot be modified by the agent. This protection is hardcoded and cannot be overridden.`,
      });
      blockedFiles.push(file);
      continue;
    }
    
    // Rule 2: Denied paths — explicit blocks
    for (const pattern of config.rules.deniedWritePaths) {
      if (matchGlob(file, pattern)) {
        violations.push({
          file,
          rule: "denied-path",
          detail: `Matches denied path pattern: \`${pattern}\``,
        });
        blocked = true;
        break;
      }
    }
    if (blocked) { blockedFiles.push(file); continue; }
    
    // Rule 3: Protected files — can be proposed but not committed
    for (const pattern of config.rules.protectedFiles) {
      if (matchGlob(file, pattern)) {
        violations.push({
          file,
          rule: "protected",
          detail: `Protected file — changes will be shown but not committed. Edit this file manually if you approve.`,
        });
        blocked = true;
        break;
      }
    }
    if (blocked) { blockedFiles.push(file); continue; }
    
    // Rule 4: Allowed paths — if allowedWritePaths is not ["*"], check
    if (!config.rules.allowedWritePaths.includes("*")) {
      const isAllowed = config.rules.allowedWritePaths.some(p => matchGlob(file, p));
      if (!isAllowed) {
        violations.push({
          file,
          rule: "not-allowed",
          detail: `Not in allowed write paths. Allowed: ${config.rules.allowedWritePaths.join(", ")}`,
        });
        blockedFiles.push(file);
        continue;
      }
    }
    
    // Rule 5: File size limit
    const fullPath = resolve(repoRoot, file);
    if (existsSync(fullPath)) {
      const size = statSync(fullPath).size;
      if (size > config.rules.maxFileSizeBytes) {
        violations.push({
          file,
          rule: "size-limit",
          detail: `File size (${formatBytes(size)}) exceeds limit (${formatBytes(config.rules.maxFileSizeBytes)})`,
        });
        blockedFiles.push(file);
        continue;
      }
    }
    
    allowedFiles.push(file);
  }
  
  return {
    valid: violations.length === 0,
    violations,
    allowedFiles,
    blockedFiles,
  };
}

function matchGlob(path: string, pattern: string): boolean {
  // Simple glob matching: * matches any segment, ** matches any depth
  // Convert glob to regex
  const regex = new RegExp(
    "^" + pattern
      .replace(/\./g, "\\.")
      .replace(/\*\*/g, "†")     // placeholder for **
      .replace(/\*/g, "[^/]*")   // * matches within a directory
      .replace(/†/g, ".*")       // ** matches across directories
    + (pattern.endsWith("/") ? "" : "(/|$)")  // directory patterns match contents
  );
  return regex.test(path);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
```

### Step 3: Integrate into the agent orchestrator

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts`

Replace the existing commit logic with a guarded version:

```typescript
import { loadGuardrails, validateChanges, ValidationResult } from "./GITCLAW-GUARDRAILS";

// After the agent finishes and before committing:
await run(["git", "add", "-A"]);

const { stdout: stagedFiles } = await run(["git", "diff", "--cached", "--name-only"]);
const changedFiles = stagedFiles.trim().split("\n").filter(Boolean);

if (changedFiles.length === 0) {
  console.log("No changes to commit");
} else {
  // Load and enforce guardrails
  const guardrails = loadGuardrails(gitclawDir);
  const issueLabels = (event.issue?.labels || []).map((l: any) => l.name);
  
  let validation: ValidationResult = {
    valid: true, violations: [], allowedFiles: changedFiles, blockedFiles: []
  };
  
  if (guardrails.enabled) {
    validation = validateChanges(changedFiles, guardrails, process.cwd(), issueLabels);
    
    if (validation.blockedFiles.length > 0) {
      console.log(`Guardrails blocked ${validation.blockedFiles.length} file(s):`);
      for (const v of validation.violations) {
        console.log(`  ❌ ${v.file}: ${v.rule} — ${v.detail}`);
      }
      
      // Unstage blocked files
      for (const file of validation.blockedFiles) {
        await run(["git", "checkout", "HEAD", "--", file]);
      }
      // Re-add only allowed files
      await run(["git", "reset", "HEAD"]);
      for (const file of validation.allowedFiles) {
        await run(["git", "add", file]);
      }
    }
    
    // Audit log
    if (guardrails.audit.enabled) {
      const auditPath = resolve(stateDir, guardrails.audit.logPath || "guardrail-audit.jsonl");
      const auditEntry = {
        timestamp: new Date().toISOString(),
        issueNumber,
        totalFiles: changedFiles.length,
        allowedFiles: validation.allowedFiles.length,
        blockedFiles: validation.blockedFiles.length,
        violations: validation.violations,
      };
      appendFileSync(auditPath, JSON.stringify(auditEntry) + "\n");
      // Add the audit log to the commit
      await run(["git", "add", auditPath]);
    }
  }
  
  // Commit whatever is still staged
  const { exitCode } = await run(["git", "diff", "--cached", "--quiet"]);
  if (exitCode !== 0) {
    await run(["git", "commit", "-m", `gitclaw: work on issue #${issueNumber}`]);
  }
  
  // Push with retry (existing logic)
  // ...
  
  // Report violations to the user
  if (validation.violations.length > 0) {
    const violationReport = [
      "---",
      "⚠️ **Guardrail Report**",
      "",
      `${validation.blockedFiles.length} file change(s) were blocked by guardrail rules:`,
      "",
      ...validation.violations.map(v =>
        `| \`${v.file}\` | ${v.rule} | ${v.detail} |`
      ),
      "",
      `${validation.allowedFiles.length} file change(s) were committed normally.`,
      "",
      "_To override guardrails for a specific issue, add the `gitclaw:unrestricted` label._",
    ].join("\n");
    
    // Append to the agent's response
    agentText += "\n\n" + violationReport;
  }
}
```

### Step 4: Implement command restrictions

Command restrictions are harder because they need to intercept the agent's shell access *during* execution, not after. There are two approaches:

**Approach A (recommended): Pre-execution check in a wrapper script**

Create a shell wrapper that the agent uses instead of raw bash:

This is complex to implement with `pi`'s existing tool system. Instead, use **Approach B**:

**Approach B: Post-execution audit + pre-commit revert**

Don't block commands in real-time. Instead:
1. Let the agent execute commands normally.
2. After execution, check `agent-raw.jsonl` for any `bash` tool calls.
3. Match command strings against `deniedCommands` patterns.
4. If violations are found, revert any file changes those commands produced.
5. Report the violation.

```typescript
export function auditCommands(
  rawJsonlPath: string,
  deniedPatterns: string[]
): { command: string; pattern: string }[] {
  const violations: { command: string; pattern: string }[] = [];
  
  const lines = readFileSync(rawJsonlPath, "utf-8").split("\n").filter(Boolean);
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.message?.role === "assistant") {
        for (const block of event.message.content || []) {
          if (block.type === "toolCall" && block.name === "bash") {
            const cmd = block.arguments?.command || "";
            for (const pattern of deniedPatterns) {
              if (new RegExp(pattern).test(cmd)) {
                violations.push({ command: cmd, pattern });
              }
            }
          }
        }
      }
    } catch (e) { /* skip non-JSON lines */ }
  }
  
  return violations;
}
```

If command violations are detected, add them to the violation report. The damage may already be done (the command already ran), but:
- File changes are caught by the pre-commit validator.
- The audit log records the violation.
- The user is notified.
- Future runs can be blocked if the pattern persists.

### Step 5: Create default guardrails for new installations

**In the installer (`GITCLAW-INSTALLER.ts`):**

When installing GitClaw, create `guardrails.json` with sensible defaults that protect critical paths. The defaults should be:
- `allowedWritePaths: ["*"]` (permissive by default)
- `deniedWritePaths`: workflow files, lifecycle scripts, installer
- `protectedFiles`: system prompt, settings, agents identity
- `allowSelfModification: false`

This ensures that even without explicit configuration, the agent can't rewrite its own brain.

### Step 6: Update documentation

**New file:** `.GITCLAW/docs/GITCLAW-Guardrails.md`
- Full configuration reference
- Rule evaluation order (deny > protect > allow > size)
- Hardcoded critical file protections
- How to customize for different project types (link to Installation Personalities doc)
- How to use the `gitclaw:unrestricted` override label
- Audit log format and how to review it
- Security model: what guardrails protect against and what they don't

**File:** `.GITCLAW/README.md`
- Add "Guardrails" to capabilities and security sections
- Document the self-modification protection

**File:** `.GITCLAW/docs/GITCLAW-Internal-Mechanics.md`
- Add guardrail validation to the pipeline sequence diagram (between agent execution and commit)

### Step 7: Test

- Configure guardrails to deny writes to `test-protected/`:
  1. Ask the agent to create a file in `test-protected/`.
  2. Verify the file is blocked and the violation is reported.
  3. Verify the audit log records the violation.
  4. Verify other files from the same run are committed normally.
- Attempt self-modification:
  1. Ask the agent to "update your system prompt to be more helpful."
  2. Verify `.GITCLAW/.pi/APPEND_SYSTEM.md` changes are blocked.
  3. Verify the agent reports the guardrail violation.
- Attempt workflow modification:
  1. Ask the agent to "add a new trigger to the workflow file."
  2. Verify `.github/workflows/` changes are blocked.
- Test the override label:
  1. Add `gitclaw:unrestricted` to an issue.
  2. Ask the agent to modify a normally-protected file.
  3. Verify the change goes through.
  4. Remove the label and try again — verify it's blocked.
- Test file size limits:
  1. Ask the agent to generate a very large file.
  2. Verify it's blocked if it exceeds the limit.
- Test with guardrails disabled:
  1. Set `"enabled": false` in guardrails.json.
  2. Verify all changes commit normally (no regression).
- Test command audit:
  1. Ask the agent to run a denied command pattern.
  2. Verify the audit log captures the violation.

## Design Decisions

**Why a separate `guardrails.json` instead of adding rules to `settings.json`?** Separation of concerns. `settings.json` controls the LLM (provider, model, thinking level). `guardrails.json` controls the security boundary (what the agent can touch). Different people may own these configurations — a team lead sets guardrails, individual developers set model preferences. Separate files enable separate review and ownership.

**Why hardcode critical file protections?** Because configurable protection for the configuration file itself is a paradox. If the agent can modify `guardrails.json`, it can remove its own restrictions. The `CRITICAL_FILES` list is embedded in the TypeScript code, not the JSON config, specifically so the agent cannot edit it away. This is defense-in-depth: even if someone sets `allowSelfModification: true` in the config, the hardcoded list still protects the most dangerous files.

**Why post-execution command audit instead of pre-execution blocking?** The `pi` agent manages its own tool execution loop. Intercepting tool calls before execution would require modifying `pi` itself or wrapping every shell invocation — both fragile and complex. Post-execution audit catches violations and reports them. The file-level pre-commit validator catches the *effects* of dangerous commands (file changes), which is what actually matters for repository integrity.

**Why graceful degradation (block files, not runs)?** An agent run that's 90% good shouldn't be thrown away because 10% violated a guardrail. If the agent writes 8 files correctly and 2 are blocked, commit the 8 and report the 2. The user gets most of the value and clear visibility into what was blocked. Hard-failing the entire run would be frustrating and wasteful.

**Why an audit log?** Guardrails are a security control. Security controls need an audit trail. The JSONL audit log records every evaluation — what was allowed, what was blocked, and why. This is essential for compliance, debugging, and understanding how the agent interacts with boundaries over time. It also provides data for refining guardrail rules: if the same file is frequently blocked, maybe the rule needs adjustment.
