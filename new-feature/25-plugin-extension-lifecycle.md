# Feature: Plugin & Extension Lifecycle

## Summary

Create a lightweight plugin system that allows third-party extensions to hook into the agent's lifecycle — before execution, after execution, before commit, after commit, on error, and on schedule. Plugins are directories in `.GITCLAW/plugins/` containing a manifest (`plugin.json`) and executable scripts. They can add custom detectors to health scanning, custom stages to verification, custom formatters to output, custom triggers to the workflow, and custom commands to the slash command system. The plugin system transforms GitClaw from a closed agent into an open platform where the community can share reusable capabilities without modifying core code.

## Why This Feature — The Deep Reasoning

### 1. Features 01-24 Will Never Be Enough

Every feature spec in this directory addresses a specific need. But every project has unique needs that no pre-built feature covers:
- A fintech company needs SOC2 compliance checks before every commit
- A game studio needs asset pipeline validation
- An open-source project needs CLA verification on PRs
- A data team needs schema migration validation
- An ML team needs model size regression checks

These can't all be core features — they're too domain-specific. But they all follow the same pattern: "run something at a specific point in the agent's lifecycle and act on the result." A plugin system captures this pattern.

### 2. It Enables Composability Without Complexity

Right now, adding a new capability to GitClaw means modifying `GITCLAW-AGENT.ts` — the core orchestrator. That file is the single point of integration for features 01-24. Each feature adds code to the same file, increasing complexity and merge conflicts.

Plugins externalize this. Instead of modifying the orchestrator, a plugin registers hooks:

```json
{
  "hooks": {
    "pre-commit": "./check-compliance.sh",
    "post-response": "./format-output.sh"
  }
}
```

The orchestrator calls registered hooks at the right time. Plugins don't know about each other. The orchestrator doesn't know about plugin internals. Clean separation.

### 3. It Aligns With the Drop-In Philosophy

GitClaw itself is a "drop-in" — you add the `.GITCLAW/` folder to any repo and it works. Plugins extend this: you add a folder to `.GITCLAW/plugins/` and it works. No build steps. No dependency management. No registration servers. Just files in git.

This means plugins are:
- **Forkable**: Fork a repo, fork its plugins
- **Auditable**: `git log .GITCLAW/plugins/` shows every change
- **Reviewable**: PRs that add plugins are reviewable like any other code
- **Removable**: `rm -rf .GITCLAW/plugins/my-plugin/` disables it completely

### 4. It Creates Network Effects

A plugin for "Jira sync" written for one project can be copied to any GitClaw installation. A "Slack notification" plugin, a "Linear issue sync" plugin, a "Terraform plan validator" — once written, they're reusable. This creates a community of shared capabilities around GitClaw.

### 5. It Future-Proofs the Architecture

Every new feature added to the core increases maintenance burden. Plugins let non-core features exist outside the core, maintained by their authors, updated on their schedule. The core stays small and stable; capabilities grow unboundedly.

## Scope

### In Scope
- **Plugin manifest format**: `plugin.json` with name, hooks, commands, config
- **Lifecycle hooks**: pre-run, post-run, pre-commit, post-commit, on-error, on-schedule
- **Custom commands**: Plugins can register slash commands
- **Custom health detectors**: Plugins can add detectors to health scanning
- **Custom verification stages**: Plugins can add stages to the verification pipeline
- **Plugin discovery and loading**: Scan `.GITCLAW/plugins/` at startup
- **Plugin execution**: Run plugin scripts with standardized input/output
- **Plugin isolation**: Plugins run as subprocesses with limited environment
- **Plugin configuration**: Per-plugin config in the manifest or separate config file

### Out of Scope
- Plugin marketplace or registry
- Plugin versioning and auto-updates
- Plugin sandboxing (no filesystem or network isolation — trust model is same as the agent)
- Plugin dependency resolution (plugins are independent)
- TypeScript/compiled plugins (scripts only — bash, python, node)

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Plugin manifest schema** | Define plugin.json format and validation | ~1 hour |
| **Plugin loader** | Discover and validate plugins at startup | ~1.5 hours |
| **Lifecycle hook runner** | Execute hooks at correct points in the pipeline | ~2.5 hours |
| **Custom command registration** | Extend slash command system with plugin commands | ~1 hour |
| **Health detector registration** | Let plugins add detectors | ~1 hour |
| **Verification stage registration** | Let plugins add stages | ~1 hour |
| **Plugin execution environment** | Subprocess with env vars and stdin/stdout protocol | ~1.5 hours |
| **Agent orchestrator integration** | Insert hook calls at lifecycle points | ~1.5 hours |
| **Example plugins** | 2-3 example plugins demonstrating the system | ~1.5 hours |
| **Docs** | Document plugin system, API, examples | ~1 hour |
| **Testing** | Test loading, hooks, commands, error handling | ~1.5 hours |

**Total: ~15 hours.**

---

## AI Implementation Instructions

### Step 1: Plugin manifest format

**Schema for `.GITCLAW/plugins/{name}/plugin.json`:**

```json
{
  "name": "example-plugin",
  "version": "1.0.0",
  "description": "An example plugin that demonstrates the lifecycle",
  "author": "team-name",
  "enabled": true,
  
  "hooks": {
    "pre-run": {
      "script": "./pre-run.sh",
      "timeout": 30,
      "failBehavior": "warn"
    },
    "post-run": {
      "script": "./post-run.sh",
      "timeout": 30,
      "failBehavior": "warn"
    },
    "pre-commit": {
      "script": "./validate.sh",
      "timeout": 60,
      "failBehavior": "block"
    },
    "post-commit": {
      "script": "./notify.sh",
      "timeout": 15,
      "failBehavior": "ignore"
    },
    "on-error": {
      "script": "./alert.sh",
      "timeout": 15,
      "failBehavior": "ignore"
    }
  },
  
  "commands": {
    "my-command": {
      "script": "./my-command.sh",
      "description": "Does something useful",
      "timeout": 120
    }
  },
  
  "healthDetectors": [
    {
      "name": "custom-check",
      "script": "./detect.sh",
      "description": "Checks for custom issues",
      "category": "custom"
    }
  ],
  
  "verificationStages": [
    {
      "name": "custom-verify",
      "script": "./verify.sh",
      "description": "Custom verification step",
      "timeout": 120,
      "optional": true
    }
  ],
  
  "config": {
    "setting1": "default-value",
    "setting2": true
  }
}
```

### Step 2: Plugin loader

**New file:** `.GITCLAW/lifecycle/GITCLAW-PLUGINS.ts`

```typescript
export interface Plugin {
  name: string;
  dir: string;                    // absolute path to plugin directory
  manifest: PluginManifest;
}

export interface PluginManifest {
  name: string;
  version: string;
  description: string;
  author?: string;
  enabled: boolean;
  hooks?: Record<string, HookConfig>;
  commands?: Record<string, CommandConfig>;
  healthDetectors?: DetectorConfig[];
  verificationStages?: StageConfig[];
  config?: Record<string, any>;
}

export interface HookConfig {
  script: string;
  timeout?: number;               // seconds, default 30
  failBehavior?: "block" | "warn" | "ignore";  // default "warn"
}

export interface CommandConfig {
  script: string;
  description: string;
  timeout?: number;
}

export function loadPlugins(gitclawDir: string): Plugin[] {
  const pluginsDir = resolve(gitclawDir, "plugins");
  if (!existsSync(pluginsDir)) return [];
  
  const plugins: Plugin[] = [];
  const entries = readdirSync(pluginsDir, { withFileTypes: true });
  
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    
    const pluginDir = resolve(pluginsDir, entry.name);
    const manifestPath = resolve(pluginDir, "plugin.json");
    
    if (!existsSync(manifestPath)) {
      console.log(`Plugin ${entry.name}: no plugin.json, skipping`);
      continue;
    }
    
    try {
      const manifest: PluginManifest = JSON.parse(
        readFileSync(manifestPath, "utf-8")
      );
      
      if (!manifest.enabled) {
        console.log(`Plugin ${manifest.name}: disabled`);
        continue;
      }
      
      // Validate that referenced scripts exist
      const allScripts = [
        ...Object.values(manifest.hooks || {}).map(h => h.script),
        ...Object.values(manifest.commands || {}).map(c => c.script),
        ...(manifest.healthDetectors || []).map(d => d.script),
        ...(manifest.verificationStages || []).map(s => s.script),
      ];
      
      for (const script of allScripts) {
        const scriptPath = resolve(pluginDir, script);
        if (!existsSync(scriptPath)) {
          console.warn(`Plugin ${manifest.name}: script not found: ${script}`);
        }
      }
      
      plugins.push({ name: manifest.name, dir: pluginDir, manifest });
      console.log(`Plugin loaded: ${manifest.name} v${manifest.version}`);
    } catch (e) {
      console.error(`Plugin ${entry.name}: failed to load — ${e}`);
    }
  }
  
  return plugins;
}
```

### Step 3: Hook runner

```typescript
export type HookPoint = "pre-run" | "post-run" | "pre-commit" | "post-commit" | "on-error";

export interface HookResult {
  plugin: string;
  hook: HookPoint;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  blocked: boolean;            // true if failBehavior="block" and hook failed
}

export async function runHooks(
  plugins: Plugin[],
  hookPoint: HookPoint,
  context: HookContext
): Promise<HookResult[]> {
  const results: HookResult[] = [];
  
  for (const plugin of plugins) {
    const hookConfig = plugin.manifest.hooks?.[hookPoint];
    if (!hookConfig) continue;
    
    const scriptPath = resolve(plugin.dir, hookConfig.script);
    if (!existsSync(scriptPath)) continue;
    
    const timeout = (hookConfig.timeout || 30) * 1000;
    const failBehavior = hookConfig.failBehavior || "warn";
    
    console.log(`  🔌 ${plugin.name}:${hookPoint} running...`);
    const startTime = Date.now();
    
    try {
      // Make script executable
      chmodSync(scriptPath, 0o755);
      
      const proc = Bun.spawn(["bash", scriptPath], {
        cwd: plugin.dir,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          GITCLAW_HOOK: hookPoint,
          GITCLAW_ISSUE: String(context.issueNumber),
          GITCLAW_REPO: context.repo,
          GITCLAW_EVENT: context.eventName,
          GITCLAW_PROMPT: context.prompt?.slice(0, 1000) || "",
          GITCLAW_CHANGED_FILES: (context.changedFiles || []).join("\n"),
          GITCLAW_AGENT_TEXT: context.agentText?.slice(0, 5000) || "",
          GITCLAW_STATE_DIR: context.stateDir,
          GITCLAW_PLUGIN_DIR: plugin.dir,
          // Plugin-specific config as JSON
          GITCLAW_PLUGIN_CONFIG: JSON.stringify(plugin.manifest.config || {}),
        },
      });
      
      const timeoutPromise = new Promise<"timeout">(r => setTimeout(() => r("timeout"), timeout));
      const race = await Promise.race([proc.exited, timeoutPromise]);
      
      let exitCode: number;
      let stdout: string;
      let stderr: string;
      
      if (race === "timeout") {
        proc.kill();
        exitCode = -1;
        stdout = "";
        stderr = `Plugin timed out after ${timeout / 1000}s`;
      } else {
        exitCode = race;
        stdout = await new Response(proc.stdout).text();
        stderr = await new Response(proc.stderr).text();
      }
      
      const blocked = exitCode !== 0 && failBehavior === "block";
      
      results.push({
        plugin: plugin.name,
        hook: hookPoint,
        exitCode,
        stdout: stdout.slice(-2000),
        stderr: stderr.slice(-2000),
        durationMs: Date.now() - startTime,
        blocked,
      });
      
      if (exitCode !== 0) {
        if (failBehavior === "block") {
          console.log(`  ❌ ${plugin.name}:${hookPoint} BLOCKED (exit ${exitCode})`);
        } else if (failBehavior === "warn") {
          console.log(`  ⚠️ ${plugin.name}:${hookPoint} warning (exit ${exitCode})`);
        }
        // "ignore" — log nothing
      } else {
        console.log(`  ✅ ${plugin.name}:${hookPoint} passed (${Date.now() - startTime}ms)`);
      }
    } catch (e) {
      results.push({
        plugin: plugin.name,
        hook: hookPoint,
        exitCode: -1,
        stdout: "",
        stderr: `Error: ${e}`,
        durationMs: Date.now() - startTime,
        blocked: failBehavior === "block",
      });
    }
  }
  
  return results;
}

export interface HookContext {
  issueNumber: number;
  repo: string;
  eventName: string;
  prompt?: string;
  changedFiles?: string[];
  agentText?: string;
  stateDir: string;
  error?: string;
}
```

### Step 4: Integrate into agent orchestrator

In `GITCLAW-AGENT.ts`:

```typescript
import { loadPlugins, runHooks, HookContext } from "./GITCLAW-PLUGINS";

// Early in the try block:
const plugins = loadPlugins(gitclawDir);
console.log(`Loaded ${plugins.length} plugin(s)`);

const hookContext: HookContext = {
  issueNumber, repo, eventName: eventName,
  prompt, stateDir,
};

// Pre-run hooks
const preRunResults = await runHooks(plugins, "pre-run", hookContext);
if (preRunResults.some(r => r.blocked)) {
  const blockers = preRunResults.filter(r => r.blocked);
  await gh("issue", "comment", String(issueNumber), "--body",
    `⛔ Plugin(s) blocked execution:\n\n` +
    blockers.map(r => `- **${r.plugin}**: ${r.stderr.slice(0, 200)}`).join("\n"));
  return; // Don't run the agent
}

// ... run pi agent ...

// Post-run hooks
hookContext.agentText = agentText;
hookContext.changedFiles = changedFiles;
await runHooks(plugins, "post-run", hookContext);

// Pre-commit hooks
const preCommitResults = await runHooks(plugins, "pre-commit", hookContext);
if (preCommitResults.some(r => r.blocked)) {
  // Abort commit, report to user
  const blockers = preCommitResults.filter(r => r.blocked);
  agentText += `\n\n---\n⛔ Commit blocked by plugin(s):\n` +
    blockers.map(r => `- **${r.plugin}**: ${r.stderr.slice(0, 200)}`).join("\n");
  // Unstage code changes, keep state changes
  // ... similar to approval gate logic ...
}

// ... commit and push ...

// Post-commit hooks
await runHooks(plugins, "post-commit", hookContext);

// In the catch block:
} catch (e) {
  hookContext.error = String(e);
  await runHooks(plugins, "on-error", hookContext);
  throw e; // re-throw after running error hooks
}
```

### Step 5: Custom command registration

Extend the slash command system (feature 02):

```typescript
// In command parsing, check plugin commands:
for (const plugin of plugins) {
  for (const [cmdName, cmdConfig] of Object.entries(plugin.manifest.commands || {})) {
    if (parsed.command === cmdName) {
      const scriptPath = resolve(plugin.dir, cmdConfig.script);
      const proc = Bun.spawn(["bash", scriptPath], {
        cwd: plugin.dir,
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          GITCLAW_COMMAND: cmdName,
          GITCLAW_ARGS: parsed.args || "",
          GITCLAW_ISSUE: String(issueNumber),
          GITCLAW_REPO: repo,
          GITCLAW_PLUGIN_CONFIG: JSON.stringify(plugin.manifest.config || {}),
        },
      });
      
      const output = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;
      
      if (exitCode === 0 && output.trim()) {
        await gh("issue", "comment", String(issueNumber), "--body", output.trim());
      } else {
        await gh("issue", "comment", String(issueNumber), "--body",
          `Plugin command \`${cmdName}\` failed (exit ${exitCode}).`);
      }
      return;
    }
  }
}
```

### Step 6: Create example plugins

**Example 1: Slack notification plugin**

`.GITCLAW/plugins/slack-notify/plugin.json`:
```json
{
  "name": "slack-notify",
  "version": "1.0.0",
  "description": "Posts agent responses to a Slack channel",
  "enabled": false,
  "hooks": {
    "post-commit": {
      "script": "./notify.sh",
      "timeout": 15,
      "failBehavior": "ignore"
    }
  },
  "config": {
    "webhookUrl": "SLACK_WEBHOOK_URL",
    "channel": "#engineering"
  }
}
```

`.GITCLAW/plugins/slack-notify/notify.sh`:
```bash
#!/bin/bash
# Read config from environment
WEBHOOK_URL="${!GITCLAW_PLUGIN_CONFIG_webhookUrl:-$SLACK_WEBHOOK_URL}"
if [ -z "$WEBHOOK_URL" ]; then exit 0; fi

PAYLOAD=$(jq -n \
  --arg text "GitClaw processed issue #${GITCLAW_ISSUE} in ${GITCLAW_REPO}" \
  --arg channel "${GITCLAW_PLUGIN_CONFIG_channel:-#general}" \
  '{text: $text, channel: $channel}')

curl -s -X POST "$WEBHOOK_URL" -H 'Content-Type: application/json' -d "$PAYLOAD"
```

**Example 2: File size regression plugin**

`.GITCLAW/plugins/size-check/plugin.json`:
```json
{
  "name": "size-check",
  "version": "1.0.0",
  "description": "Blocks commits that increase bundle size beyond threshold",
  "enabled": true,
  "hooks": {
    "pre-commit": {
      "script": "./check-size.sh",
      "timeout": 30,
      "failBehavior": "block"
    }
  },
  "config": {
    "maxBundleSizeKB": 500,
    "trackFiles": ["dist/**/*.js"]
  }
}
```

**Example 3: CLA check plugin**

`.GITCLAW/plugins/cla-check/plugin.json`:
```json
{
  "name": "cla-check",
  "version": "1.0.0",
  "description": "Checks if the commenter has signed the CLA",
  "enabled": false,
  "hooks": {
    "pre-run": {
      "script": "./check-cla.sh",
      "timeout": 15,
      "failBehavior": "block"
    }
  },
  "config": {
    "claFile": "CLA-SIGNERS.md"
  }
}
```

### Step 7: Documentation

**New file:** `.GITCLAW/docs/GITCLAW-Plugins.md`
- Plugin directory structure and manifest format
- Available lifecycle hooks and when they fire
- Environment variables available to plugin scripts
- How to register custom commands
- How to add health detectors and verification stages
- Fail behavior: block vs warn vs ignore
- Examples: Slack notify, size check, CLA check
- Security considerations: plugins have the same access as the agent

**File:** `.GITCLAW/README.md`
- Add "Plugin System" to capabilities

### Step 8: Test

- Create a test plugin with a `pre-commit` hook that exits 1 → verify commit is blocked
- Create a test plugin with a `post-run` hook → verify it receives GITCLAW_AGENT_TEXT
- Create a plugin command `/test-cmd` → verify it's callable via issue comment
- Disable a plugin → verify its hooks don't run
- Test hook timeout → verify plugin is killed after timeout
- Test multiple plugins → verify all hooks run in order
- Test error in plugin → verify `failBehavior: "warn"` doesn't block execution

## Design Decisions

**Why bash scripts instead of a plugin API?** Bash scripts are the universal interface. They work with any language — a plugin can be written in Python, Node, Ruby, or pure shell. The environment variable protocol is dead simple: read `GITCLAW_ISSUE`, `GITCLAW_CHANGED_FILES`, etc., do your thing, exit 0 or exit 1. No SDK to learn, no dependencies to install, no build step.

**Why subprocess isolation instead of in-process hooks?** In-process hooks (JavaScript/TypeScript functions) would be faster but create coupling: plugins would depend on GitClaw's internal APIs, which might change. Subprocesses provide a stable boundary — the contract is environment variables in, exit code out. Plugins can't crash the agent.

**Why `failBehavior` instead of always blocking?** Different hooks have different criticality. A Slack notification failure shouldn't block the commit. A CLA check failure should. `failBehavior` lets each hook declare its own criticality, giving plugin authors and repo owners control over the impact of failures.

**Why not a plugin registry?** Premature infrastructure. When there are 3 plugins, a registry is overhead. When there are 300, it's necessary. Start with copy-paste distribution (clone the plugin directory from another repo). If the ecosystem grows, add a registry later.

**Why include example plugins that are disabled by default?** To demonstrate the pattern without affecting behavior. A user who wants Slack notifications enables the plugin and adds their webhook URL. The structure is there; the activation is explicit. This follows GitClaw's drop-in philosophy — capabilities are present but dormant until configured.
