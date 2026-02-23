/**
 * Phase 0 validation tests — verify that all Foundation-layer features
 * described in .github-intelligence/docs/github-intelligence-Roadmap.md are structurally present.
 *
 * Run with: node --test .github-intelligence/tests/phase0.test.js
 *        or: bun test .github-intelligence/tests/phase0.test.js
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const ISSUE_INTELLIGENCE = path.resolve(REPO_ROOT, ".github-intelligence");

function readFile(relPath) {
  return fs.readFileSync(path.resolve(REPO_ROOT, relPath), "utf-8");
}

// ── 1. Trigger on issues.opened and issue_comment.created ──────────────────

describe("Workflow triggers", () => {
  const workflow = readFile(".github/workflows/github-intelligence-WORKFLOW-AGENT.yml");

  it("triggers on issues.opened", () => {
    assert.match(workflow, /issues:\s*\n\s*types:\s*\[.*opened.*\]/);
  });

  it("triggers on issue_comment.created", () => {
    assert.match(workflow, /issue_comment:\s*\n\s*types:\s*\[.*created.*\]/);
  });

  it("workflow template also has correct triggers", () => {
    const template = readFile(".github-intelligence/install/github-intelligence-WORKFLOW-AGENT.yml");
    assert.match(template, /issues:\s*\n\s*types:\s*\[.*opened.*\]/);
    assert.match(template, /issue_comment:\s*\n\s*types:\s*\[.*created.*\]/);
  });
});

// ── 2. Authorization gating ────────────────────────────────────────────────

describe("Authorization gating", () => {
  const workflow = readFile(".github/workflows/github-intelligence-WORKFLOW-AGENT.yml");

  it("has an Authorize step that checks collaborator permission", () => {
    assert.ok(workflow.includes("name: Authorize"));
    assert.ok(workflow.includes("collaborators"));
    assert.ok(workflow.includes("permission"));
  });

  it("gates on admin permission", () => {
    assert.ok(workflow.includes("admin"));
  });

  it("gates on write permission", () => {
    assert.ok(workflow.includes("write"));
  });

  it("excludes github-actions[bot] from comment triggers", () => {
    assert.ok(workflow.includes("github-actions[bot]"));
  });

  it("Authorize step runs before Checkout", () => {
    const authorizeIdx = workflow.indexOf("name: Authorize");
    const checkoutIdx = workflow.indexOf("name: Checkout");
    assert.ok(authorizeIdx > 0 && checkoutIdx > 0);
    assert.ok(
      authorizeIdx < checkoutIdx,
      "Authorize must run before Checkout"
    );
  });
});

// ── 3. Multi-turn sessions persisted as JSONL in state/sessions/ ───────────

describe("Session persistence", () => {
  it("state/sessions directory exists", () => {
    assert.ok(fs.existsSync(path.join(ISSUE_INTELLIGENCE, "state", "sessions")));
  });

  it("agent script references sessions directory", () => {
    const agent = readFile(".github-intelligence/lifecycle/github-intelligence-AGENT.ts");
    assert.ok(agent.includes("state/sessions"));
  });

  it("agent script uses JSONL session format", () => {
    const agent = readFile(".github-intelligence/lifecycle/github-intelligence-AGENT.ts");
    assert.ok(agent.includes(".jsonl"));
  });

  it("agent script handles session resumption", () => {
    const agent = readFile(".github-intelligence/lifecycle/github-intelligence-AGENT.ts");
    assert.ok(agent.includes("--session"));
    assert.ok(agent.includes('mode = "resume"'));
  });
});

// ── 4. Issue → session mapping in state/issues/ ────────────────────────────

describe("Issue-session mapping", () => {
  it("state/issues directory exists", () => {
    assert.ok(fs.existsSync(path.join(ISSUE_INTELLIGENCE, "state", "issues")));
  });

  it("agent script writes mapping files", () => {
    const agent = readFile(".github-intelligence/lifecycle/github-intelligence-AGENT.ts");
    assert.ok(agent.includes("mappingFile"));
    assert.ok(agent.includes("writeFileSync"));
  });

  it("mapping includes issueNumber and sessionPath", () => {
    const agent = readFile(".github-intelligence/lifecycle/github-intelligence-AGENT.ts");
    assert.ok(agent.includes("issueNumber"));
    assert.ok(agent.includes("sessionPath"));
  });
});

// ── 5. 👀 reaction indicator while working ─────────────────────────────────

describe("Reaction indicator", () => {
  it("indicator script exists", () => {
    assert.ok(
      fs.existsSync(path.join(ISSUE_INTELLIGENCE, "lifecycle", "github-intelligence-INDICATOR.ts"))
    );
  });

  it("indicator adds eyes reaction", () => {
    const indicator = readFile(".github-intelligence/lifecycle/github-intelligence-INDICATOR.ts");
    assert.ok(indicator.includes("content=eyes"));
  });

  it("indicator persists reaction state to /tmp", () => {
    const indicator = readFile(".github-intelligence/lifecycle/github-intelligence-INDICATOR.ts");
    assert.ok(indicator.includes("/tmp/reaction-state.json"));
  });

  it("agent script removes reaction in finally block", () => {
    const agent = readFile(".github-intelligence/lifecycle/github-intelligence-AGENT.ts");
    assert.ok(agent.includes("finally"));
    assert.ok(agent.includes("reactionId"));
    assert.ok(agent.includes("DELETE"));
  });

  it("workflow runs indicator before install", () => {
    const workflow = readFile(".github/workflows/github-intelligence-WORKFLOW-AGENT.yml");
    const indicatorIdx = workflow.indexOf("github-intelligence-INDICATOR");
    const installIdx = workflow.indexOf("bun install");
    assert.ok(indicatorIdx > 0 && installIdx > 0);
    assert.ok(
      indicatorIdx < installIdx,
      "Indicator must run before dependency install"
    );
  });
});

// ── 6. Commit + push state to main with retry-on-conflict ──────────────────

describe("Commit and push with retry", () => {
  const agent = readFile(".github-intelligence/lifecycle/github-intelligence-AGENT.ts");

  it("stages all changes with git add", () => {
    assert.ok(agent.includes('"git", "add"'));
  });

  it("commits with descriptive message", () => {
    assert.ok(agent.includes("git commit"));
    assert.ok(agent.includes("github-intelligence: work on issue"));
  });

  it("pushes to default branch", () => {
    assert.ok(agent.includes("git push"));
    assert.ok(agent.includes("defaultBranch"));
  });

  it("retries push on conflict", () => {
    assert.ok(agent.includes("retrying"));
    assert.ok(agent.includes('"git", "pull"'));
    assert.ok(agent.includes('"--rebase"'));
  });

  it("has a retry limit", () => {
    assert.match(agent, /for\s*\(\s*let\s+i\s*=\s*1;\s*i\s*<=\s*5/);
  });

  it("uses exponential back-off with jitter between retries", () => {
    assert.ok(agent.includes("Math.pow(2, i - 1)"), "Should use exponential back-off");
    assert.ok(agent.includes("Math.random()"), "Should include random jitter");
    assert.ok(agent.includes("setTimeout"), "Should delay between retries");
  });

  it("pulls latest before committing to reduce conflicts", () => {
    // There should be a git pull --rebase BEFORE git add -A
    const pullBeforeAdd = agent.indexOf('git", "pull", "--rebase"');
    const gitAdd = agent.indexOf('"git", "add", "-A"');
    assert.ok(pullBeforeAdd > 0 && gitAdd > 0);
    assert.ok(
      pullBeforeAdd < gitAdd,
      "Should pull latest changes before staging to minimise conflicts"
    );
  });
});

// ── 7. Modular skill system and configurable personality ───────────────────

describe("Skill system", () => {
  const skillsDir = path.join(ISSUE_INTELLIGENCE, ".pi", "skills");

  it("skills directory exists", () => {
    assert.ok(fs.existsSync(skillsDir));
  });

  it("memory skill exists with SKILL.md", () => {
    const skillFile = path.join(skillsDir, "memory", "SKILL.md");
    assert.ok(fs.existsSync(skillFile));
    const content = fs.readFileSync(skillFile, "utf-8");
    assert.ok(content.startsWith("---"), "SKILL.md must have YAML frontmatter");
    assert.ok(content.includes("name:"));
    assert.ok(content.includes("description:"));
  });

  it("skill-creator skill exists with SKILL.md", () => {
    const skillFile = path.join(skillsDir, "skill-creator", "SKILL.md");
    assert.ok(fs.existsSync(skillFile));
    const content = fs.readFileSync(skillFile, "utf-8");
    assert.ok(content.startsWith("---"), "SKILL.md must have YAML frontmatter");
    assert.ok(content.includes("name:"));
    assert.ok(content.includes("description:"));
  });
});

describe("Configurable personality", () => {
  it("settings.json exists with provider and model config", () => {
    const settings = JSON.parse(
      readFile(".github-intelligence/.pi/settings.json")
    );
    assert.ok(settings.defaultProvider);
    assert.ok(settings.defaultModel);
    assert.ok(settings.defaultThinkingLevel);
  });

  it("APPEND_SYSTEM.md exists (system prompt)", () => {
    assert.ok(
      fs.existsSync(path.join(ISSUE_INTELLIGENCE, ".pi", "APPEND_SYSTEM.md"))
    );
  });

  it("BOOTSTRAP.md exists (first-run identity)", () => {
    assert.ok(
      fs.existsSync(path.join(ISSUE_INTELLIGENCE, ".pi", "BOOTSTRAP.md"))
    );
  });

  it("AGENTS.md exists (agent identity)", () => {
    assert.ok(fs.existsSync(path.join(ISSUE_INTELLIGENCE, "AGENTS.md")));
  });
});

// ── Fail-closed guard (prerequisite for all Phase 0 features) ──────────────

describe("Fail-closed guard", () => {
  it("sentinel file exists", () => {
    assert.ok(
      fs.existsSync(path.join(ISSUE_INTELLIGENCE, "github-intelligence-ENABLED.md"))
    );
  });

  it("guard script exists", () => {
    assert.ok(
      fs.existsSync(path.join(ISSUE_INTELLIGENCE, "lifecycle", "github-intelligence-ENABLED.ts"))
    );
  });

  it("guard checks for sentinel file", () => {
    const guard = readFile(".github-intelligence/lifecycle/github-intelligence-ENABLED.ts");
    assert.ok(guard.includes("github-intelligence-ENABLED.md"));
    assert.ok(guard.includes("existsSync"));
  });

  it("guard exits non-zero when sentinel missing", () => {
    const guard = readFile(".github-intelligence/lifecycle/github-intelligence-ENABLED.ts");
    assert.ok(guard.includes("process.exit(1)"));
  });

  it("workflow runs guard before indicator and agent", () => {
    const workflow = readFile(".github/workflows/github-intelligence-WORKFLOW-AGENT.yml");
    const guardIdx = workflow.indexOf("github-intelligence-ENABLED");
    const indicatorIdx = workflow.indexOf("github-intelligence-INDICATOR");
    const agentIdx = workflow.indexOf("github-intelligence-AGENT");
    assert.ok(guardIdx > 0);
    assert.ok(guardIdx < indicatorIdx, "Guard must run before indicator");
    assert.ok(guardIdx < agentIdx, "Guard must run before agent");
  });
});

// ── Install template integrity ─────────────────────────────────────────────

describe("Install templates", () => {
  it("hatch template has valid frontmatter", () => {
    const template = readFile(
      ".github-intelligence/install/github-intelligence-TEMPLATE-HATCH.md"
    );
    assert.ok(
      template.startsWith("---"),
      "Hatch template must start with YAML frontmatter delimiter"
    );
    assert.ok(template.includes('name: "🥚 Hatch"'));
    assert.ok(template.includes("labels:"));
  });

  it("workflow template has checkout with ref and fetch-depth", () => {
    const template = readFile(
      ".github-intelligence/install/github-intelligence-WORKFLOW-AGENT.yml"
    );
    assert.ok(
      template.includes("github.event.repository.default_branch"),
      "Checkout should reference default_branch"
    );
    assert.ok(
      template.includes("fetch-depth: 0"),
      "Checkout should fetch full history"
    );
  });

  it("workflow template matches live workflow triggers", () => {
    const template = readFile(
      ".github-intelligence/install/github-intelligence-WORKFLOW-AGENT.yml"
    );
    const live = readFile(".github/workflows/github-intelligence-WORKFLOW-AGENT.yml");
    // Both should have the same trigger structure
    assert.ok(template.includes("issues:"));
    assert.ok(template.includes("issue_comment:"));
    assert.ok(live.includes("issues:"));
    assert.ok(live.includes("issue_comment:"));
  });

  it("workflow template name matches live workflow name", () => {
    const template = readFile(
      ".github-intelligence/install/github-intelligence-WORKFLOW-AGENT.yml"
    );
    const live = readFile(".github/workflows/github-intelligence-WORKFLOW-AGENT.yml");
    const templateName = template.match(/^name:\s*(.+)$/m)?.[1];
    const liveName = live.match(/^name:\s*(.+)$/m)?.[1];
    assert.ok(templateName, "Template should have a name field");
    assert.ok(liveName, "Live workflow should have a name field");
    assert.strictEqual(liveName, templateName, "Live workflow name must match template");
  });
});

// ── Requires-heart gate ────────────────────────────────────────────────────

describe("Requires-heart gate", () => {
  const guard = readFile(".github-intelligence/lifecycle/github-intelligence-ENABLED.ts");

  it("guard script checks for github-intelligence-HEART-REQUIRED.md file", () => {
    assert.ok(guard.includes("github-intelligence-HEART-REQUIRED.md"));
    assert.ok(guard.includes("existsSync"));
  });

  it("guard only applies heart check on issues event (not comments)", () => {
    assert.ok(guard.includes('GITHUB_EVENT_NAME === "issues"'));
  });

  it("guard checks for heart reaction via gh API", () => {
    assert.ok(guard.includes('"heart"'));
    assert.ok(guard.includes("repos/${repo}/issues/${issueNumber}/reactions"));
  });

  it("guard exits non-zero when heart reaction is missing", () => {
    assert.ok(guard.includes("process.exit(1)"));
    assert.ok(guard.includes("requires-heart gate"));
  });

  it("workflow passes GITHUB_TOKEN to Guard step", () => {
    const workflow = readFile(".github/workflows/github-intelligence-WORKFLOW-AGENT.yml");
    // Find the Guard step section and verify it has GITHUB_TOKEN
    const guardSection = workflow.slice(
      workflow.indexOf("name: Guard"),
      workflow.indexOf("name: Preinstall")
    );
    assert.ok(
      guardSection.includes("GITHUB_TOKEN"),
      "Guard step must have GITHUB_TOKEN env for requires-heart API check"
    );
  });

  it("workflow template also passes GITHUB_TOKEN to Guard step", () => {
    const template = readFile(".github-intelligence/install/github-intelligence-WORKFLOW-AGENT.yml");
    const guardSection = template.slice(
      template.indexOf("name: Guard"),
      template.indexOf("name: Preinstall")
    );
    assert.ok(
      guardSection.includes("GITHUB_TOKEN"),
      "Template Guard step must have GITHUB_TOKEN env for requires-heart API check"
    );
  });
});

// ── Error handling and observability ───────────────────────────────────────

describe("Error handling", () => {
  const agent = readFile(".github-intelligence/lifecycle/github-intelligence-AGENT.ts");

  it("gh() helper checks exit code", () => {
    assert.ok(agent.includes("exitCode !== 0"));
    assert.ok(agent.includes("throw new Error"));
  });

  it("pi agent stderr is not silenced", () => {
    assert.ok(
      !agent.includes('stderr: "ignore"'),
      "pi agent stderr should not be silenced — use 'inherit' for observability"
    );
  });

  it("validates provider API key is set", () => {
    assert.ok(
      agent.includes("providerKeyMap"),
      "Agent should validate that the required API key for the configured provider is present"
    );
    assert.ok(agent.includes("ANTHROPIC_API_KEY"));
  });

  it("checks pi agent exit code and throws on failure", () => {
    assert.ok(agent.includes("piExitCode"));
    assert.ok(agent.includes("throw new Error") && agent.includes("piExitCode"));
  });

  it("handles empty agent response", () => {
    assert.ok(
      agent.includes("did not produce a text response"),
      "Agent should post an error message when response is empty"
    );
  });
});

// ── Concurrency handling for parallel issue processing ─────────────────────

describe("Concurrency handling", () => {
  const workflow = readFile(".github/workflows/github-intelligence-WORKFLOW-AGENT.yml");
  const template = readFile(".github-intelligence/install/github-intelligence-WORKFLOW-AGENT.yml");

  it("workflow has concurrency group scoped to issue number", () => {
    assert.ok(
      workflow.includes("concurrency:"),
      "Workflow must have a concurrency configuration"
    );
    assert.ok(
      workflow.includes("github.event.issue.number"),
      "Concurrency group must be scoped to the issue number"
    );
  });

  it("workflow does not cancel in-progress runs", () => {
    assert.ok(
      workflow.includes("cancel-in-progress: false"),
      "cancel-in-progress must be false to queue same-issue runs instead of cancelling them"
    );
  });

  it("workflow template has matching concurrency configuration", () => {
    assert.ok(
      template.includes("concurrency:"),
      "Template must have a concurrency configuration"
    );
    assert.ok(
      template.includes("github.event.issue.number"),
      "Template concurrency group must be scoped to the issue number"
    );
    assert.ok(
      template.includes("cancel-in-progress: false"),
      "Template cancel-in-progress must be false"
    );
  });
});

// ── Requires-heart help documentation ─────────────────────────────────────

describe("Requires-heart help documentation", () => {
  it("dedicated requires-heart help file exists", () => {
    assert.ok(
      fs.existsSync(path.join(ISSUE_INTELLIGENCE, "help", "requires-heart.md"))
    );
  });

  it("requires-heart help explains how to enable the gate", () => {
    const doc = readFile(".github-intelligence/help/requires-heart.md");
    assert.ok(doc.includes("requires-heart"), "Should mention the requires-heart feature");
    assert.ok(doc.includes("❤️"), "Should mention the heart emoji");
  });

  it("requires-heart help explains it only applies to new issues", () => {
    const doc = readFile(".github-intelligence/help/requires-heart.md");
    assert.ok(
      doc.includes("newly opened issues"),
      "Should explain the gate only applies to newly opened issues"
    );
  });

  it("help README links to requires-heart documentation", () => {
    const readme = readFile(".github-intelligence/help/README.md");
    assert.ok(
      readme.includes("requires-heart.md"),
      "Help README should link to requires-heart.md"
    );
  });

  it("issues-management help references requires-heart", () => {
    const issuesMgmt = readFile(".github-intelligence/help/issues-management.md");
    assert.ok(
      issuesMgmt.includes("requires-heart"),
      "Issues management help should reference the requires-heart feature"
    );
  });

  it("configure help references requires-heart", () => {
    const configure = readFile(".github-intelligence/help/configure.md");
    assert.ok(
      configure.includes("requires-heart"),
      "Configure help should reference the requires-heart feature"
    );
  });
});

// ── Intelligence capability folders ────────────────────────────────────────

describe("Intelligence capability folders", () => {
  const expectedFolders = [
    { dir: ".github-intelligence-cron", title: "GitHub Intelligence Cron" },
    { dir: ".github-intelligence-swarm", title: "GitHub Intelligence Swarm" },
    { dir: ".github-intelligence-dashboard", title: "GitHub Intelligence Dashboard" },
    { dir: ".github-intelligence-bridge", title: "GitHub Intelligence Bridge" },
    { dir: ".github-intelligence-plugin", title: "GitHub Intelligence Plugin" },
    { dir: ".github-intelligence-guardrail", title: "GitHub Intelligence Guardrail" },
    { dir: ".github-intelligence-knowledge", title: "GitHub Intelligence Knowledge" },
    { dir: ".github-intelligence-health", title: "GitHub Intelligence Health" },
  ];

  for (const { dir, title } of expectedFolders) {
    it(`${dir}/ directory exists`, () => {
      assert.ok(
        fs.existsSync(path.join(REPO_ROOT, dir)),
        `${dir}/ directory should exist`
      );
    });

    it(`${dir}/README.md exists with correct title`, () => {
      const readmePath = path.join(REPO_ROOT, dir, "README.md");
      assert.ok(fs.existsSync(readmePath), `${dir}/README.md should exist`);
      const content = fs.readFileSync(readmePath, "utf-8");
      assert.ok(
        content.includes(`# ${title}`),
        `${dir}/README.md should have title "# ${title}"`
      );
    });

    it(`${dir}/README.md includes the project logo`, () => {
      const content = fs.readFileSync(
        path.join(REPO_ROOT, dir, "README.md"),
        "utf-8"
      );
      assert.ok(
        content.includes("logo.png"),
        `${dir}/README.md should reference the project logo`
      );
    });
  }
});
