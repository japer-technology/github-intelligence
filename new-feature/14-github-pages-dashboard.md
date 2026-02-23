# Feature: GitHub Pages Self-Maintaining Dashboard

## Summary

The agent auto-generates and deploys a live dashboard to GitHub Pages showing agent activity, conversation history, usage metrics, session summaries, configuration status, and health indicators. The dashboard is a static HTML site — rebuilt and deployed on every agent run (or on a schedule) — that gives teams a bird's-eye view of their GitClaw installation without opening individual issues. The repo already has `tools/chat.html` (a 977-line dark-themed chat UI); this feature extends that foundation into a comprehensive, auto-updating agent operations dashboard.

## Why This Feature — The Deep Reasoning

**1. All of GitClaw's state is invisible unless you dig for it.**

Session files are JSONL in `state/sessions/`. Issue mappings are JSON in `state/issues/`. Memory is an append-only log. Metrics (if feature 05 is implemented) are JSON files in `state/metrics/`. Configuration is scattered across `settings.json`, `AGENTS.md`, `PERSONAS.md`. A team using GitClaw has no centralized view of what the agent has done, how much it costs, or whether it's healthy. You have to grep through files or scroll issue histories. A dashboard surfaces all of this in one place.

**2. GitHub Pages is free, automatic, and requires zero infrastructure.**

Pages deploys from a branch or GitHub Actions. The agent can generate a static HTML file, push it to a `gh-pages` branch, and it's live. No servers, no hosting costs, no deployment pipeline. The dashboard is as zero-infrastructure as GitClaw itself.

**3. The existing `tools/chat.html` proves the design language works.**

The repo already contains a polished dark-themed chat interface (977 lines, responsive, with GitHub-style design tokens). This isn't starting from scratch — it's extending a proven design into additional views. The visual identity is established.

**4. Visibility drives adoption and trust.**

A dashboard URL in the README (`🦞 [Agent Dashboard](https://owner.github.io/repo/)`) is a powerful signal that GitClaw is a serious, observable system. It transforms the agent from an invisible background process into a visible team member with a public profile. Teams are more willing to adopt tools they can see into.

**5. It's a forcing function for data quality.**

Building a dashboard requires structured, consistent data. The process of making activity visible exposes gaps: "why don't we track when a session was last resumed?" or "we should log which skill was used." The dashboard drives improvements in the underlying data model.

## Scope

### In Scope
- Static HTML dashboard generated from `state/` data
- Pages: Activity feed, Session browser, Configuration viewer, Health status
- If cost tracking (feature 05) exists: Usage & cost page
- Auto-deploy to `gh-pages` branch on every agent run (or configurable schedule)
- Mobile-responsive, dark-themed (matching `tools/chat.html` design)
- Zero JavaScript dependencies — vanilla HTML/CSS/JS
- Configurable: enable/disable via `settings.json`

### Out of Scope
- Real-time updates (static site, rebuilds on each run)
- Interactive conversation replay (session browser shows summaries, not full transcripts)
- Authentication (Pages is public for public repos, private for private repos)
- Server-side rendering or dynamic content
- Custom domain configuration

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Dashboard generator** (new `GITCLAW-DASHBOARD.ts`) | Read state files, generate HTML | ~4 hours |
| **Activity feed page** | Recent issues, agent responses, timeline view | ~1.5 hours |
| **Session browser page** | List sessions with summaries, search, filter by issue | ~1.5 hours |
| **Config & health page** | Current settings, persona list, enabled/disabled status | ~1 hour |
| **Pages deployment** | Push to `gh-pages` branch via GitHub API | ~1 hour |
| **Agent orchestrator integration** | Trigger dashboard rebuild after each run | ~30 min |
| **Styling** | Extend `tools/chat.html` design system | ~1 hour |
| **Docs** | Document dashboard setup and customization | ~30 min |
| **Testing** | Verify generation, deployment, and rendering | ~1 hour |

**Total: ~12 hours.** Most of the effort is in the HTML generation — reading structured data and producing polished static pages.

---

## AI Implementation Instructions

### Step 1: Create the dashboard generator

**New file:** `.GITCLAW/lifecycle/GITCLAW-DASHBOARD.ts`

This script reads all state data and generates a set of static HTML files.

```typescript
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { resolve, basename } from "path";

const gitclawDir = resolve(import.meta.dir, "..");
const stateDir = resolve(gitclawDir, "state");
const outputDir = resolve(gitclawDir, "build", "dashboard");

interface DashboardData {
  generatedAt: string;
  agent: {
    name: string;
    emoji: string;
    provider: string;
    model: string;
    thinkingLevel: string;
  };
  issues: {
    number: number;
    sessionPath: string;
    updatedAt: string;
    turnCount: number;
    summary: string;
  }[];
  sessions: {
    path: string;
    issueNumber: number | null;
    createdAt: string;
    sizeBytes: number;
    lineCount: number;
  }[];
  metrics: {
    totalRuns: number;
    totalTokens: number;
    totalCostUSD: number;
    recentRuns: any[];
  } | null;
  memory: {
    entryCount: number;
    recentEntries: string[];
  };
}

export async function generateDashboard(): Promise<string>
```

**`generateDashboard` implementation outline:**

1. **Gather data:**
   - Read `.pi/settings.json` for agent config.
   - Read `AGENTS.md` and extract name/emoji from the Identity section.
   - Read all `state/issues/*.json` and parse each mapping.
   - For each session, get line count and file size.
   - Read the first user message from each session for summary.
   - Read `state/metrics/summary.json` if it exists (from feature 05).
   - Read `state/memory.log` — count entries, get last 10.

2. **Generate HTML pages:**

### Step 2: Design the HTML template

The dashboard is a single-page app with tab-based navigation (no framework, just vanilla JS tab switching).

```typescript
function generateIndexHTML(data: DashboardData): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${data.agent.emoji} ${data.agent.name} — GitClaw Dashboard</title>
  <style>
    ${getStyles()}
  </style>
</head>
<body>
  <header class="header">
    <div class="header-left">
      <span class="agent-emoji">${data.agent.emoji}</span>
      <div>
        <h1 class="agent-name">${data.agent.name}</h1>
        <span class="agent-subtitle">GitClaw Agent Dashboard</span>
      </div>
    </div>
    <div class="header-right">
      <span class="badge">${data.agent.provider}/${data.agent.model}</span>
      <span class="timestamp">Updated: ${data.generatedAt}</span>
    </div>
  </header>
  
  <nav class="tabs">
    <button class="tab active" data-tab="overview">Overview</button>
    <button class="tab" data-tab="activity">Activity</button>
    <button class="tab" data-tab="sessions">Sessions</button>
    <button class="tab" data-tab="config">Config</button>
    ${data.metrics ? '<button class="tab" data-tab="usage">Usage</button>' : ''}
  </nav>
  
  <main>
    <section id="overview" class="tab-content active">
      ${generateOverviewSection(data)}
    </section>
    <section id="activity" class="tab-content">
      ${generateActivitySection(data)}
    </section>
    <section id="sessions" class="tab-content">
      ${generateSessionsSection(data)}
    </section>
    <section id="config" class="tab-content">
      ${generateConfigSection(data)}
    </section>
    ${data.metrics ? `<section id="usage" class="tab-content">${generateUsageSection(data)}</section>` : ''}
  </main>
  
  <script>
    ${getScript()}
  </script>
</body>
</html>`;
}
```

**`getStyles()`:** Reuse the CSS variables and design tokens from `tools/chat.html`:
```css
:root {
  --bg: #0d1117;
  --surface: #161b22;
  --border: #30363d;
  --text: #e6edf3;
  --text-muted: #8b949e;
  --accent: #e8533f;
  /* ... etc from chat.html ... */
}
```

**`getScript()`:** Simple tab switching:
```javascript
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(tab.dataset.tab).classList.add('active');
  });
});
```

### Step 3: Generate each dashboard section

**Overview section:**
```typescript
function generateOverviewSection(data: DashboardData): string {
  const totalIssues = data.issues.length;
  const totalSessions = data.sessions.length;
  const totalMemories = data.memory.entryCount;
  const totalSize = data.sessions.reduce((sum, s) => sum + s.sizeBytes, 0);
  
  return `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${totalIssues}</div>
        <div class="stat-label">Issues Handled</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${totalSessions}</div>
        <div class="stat-label">Sessions</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${totalMemories}</div>
        <div class="stat-label">Memories</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${formatBytes(totalSize)}</div>
        <div class="stat-label">State Size</div>
      </div>
      ${data.metrics ? `
      <div class="stat-card">
        <div class="stat-value">${data.metrics.totalRuns}</div>
        <div class="stat-label">Total Runs</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">$${data.metrics.totalCostUSD.toFixed(2)}</div>
        <div class="stat-label">Total Cost</div>
      </div>
      ` : ''}
    </div>
    
    <h2>Recent Memories</h2>
    <div class="memory-list">
      ${data.memory.recentEntries.map(m => `<div class="memory-entry">${escapeHtml(m)}</div>`).join("\n")}
    </div>
  `;
}
```

**Activity section:**
```typescript
function generateActivitySection(data: DashboardData): string {
  // Sort issues by updatedAt descending
  const sorted = [...data.issues].sort((a, b) => 
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  
  return `
    <h2>Recent Activity</h2>
    <div class="activity-list">
      ${sorted.map(issue => `
        <div class="activity-item">
          <div class="activity-header">
            <a href="../../issues/${issue.number}" class="issue-link">#${issue.number}</a>
            <span class="activity-time">${formatRelativeTime(issue.updatedAt)}</span>
          </div>
          <div class="activity-summary">${escapeHtml(issue.summary)}</div>
          <div class="activity-meta">${issue.turnCount} turns</div>
        </div>
      `).join("\n")}
    </div>
  `;
}
```

**Sessions section:**
```typescript
function generateSessionsSection(data: DashboardData): string {
  return `
    <h2>Session Archive</h2>
    <div class="session-table">
      <table>
        <thead>
          <tr>
            <th>Issue</th>
            <th>Created</th>
            <th>Lines</th>
            <th>Size</th>
            <th>Session File</th>
          </tr>
        </thead>
        <tbody>
          ${data.sessions.map(s => `
            <tr>
              <td>${s.issueNumber ? `<a href="../../issues/${s.issueNumber}">#${s.issueNumber}</a>` : '—'}</td>
              <td>${formatDate(s.createdAt)}</td>
              <td>${s.lineCount}</td>
              <td>${formatBytes(s.sizeBytes)}</td>
              <td class="mono">${basename(s.path)}</td>
            </tr>
          `).join("\n")}
        </tbody>
      </table>
    </div>
  `;
}
```

**Config section:**
```typescript
function generateConfigSection(data: DashboardData): string {
  return `
    <h2>Agent Configuration</h2>
    <div class="config-grid">
      <div class="config-item">
        <span class="config-key">Name</span>
        <span class="config-value">${data.agent.emoji} ${data.agent.name}</span>
      </div>
      <div class="config-item">
        <span class="config-key">Provider</span>
        <span class="config-value">${data.agent.provider}</span>
      </div>
      <div class="config-item">
        <span class="config-key">Model</span>
        <span class="config-value">${data.agent.model}</span>
      </div>
      <div class="config-item">
        <span class="config-key">Thinking Level</span>
        <span class="config-value">${data.agent.thinkingLevel}</span>
      </div>
      <div class="config-item">
        <span class="config-key">Enabled</span>
        <span class="config-value ${existsSync(resolve(gitclawDir, 'GITCLAW-ENABLED.md')) ? 'status-ok' : 'status-off'}">
          ${existsSync(resolve(gitclawDir, 'GITCLAW-ENABLED.md')) ? '✅ Active' : '❌ Disabled'}
        </span>
      </div>
    </div>
  `;
}
```

### Step 4: Deploy to GitHub Pages

**In `GITCLAW-DASHBOARD.ts`:**

```typescript
export async function deployDashboard(repo: string, defaultBranch: string): Promise<void> {
  // Generate the dashboard
  mkdirSync(outputDir, { recursive: true });
  const html = await generateDashboard();
  writeFileSync(resolve(outputDir, "index.html"), html);
  
  // Deploy to gh-pages branch using the GitHub API
  // This avoids branch switching in the working directory
  const content = Buffer.from(html).toString("base64");
  
  try {
    // Try to update existing file
    const { stdout: existing } = await run([
      "gh", "api", `repos/${repo}/contents/index.html`,
      "--jq", ".sha",
      "-H", "Accept: application/vnd.github+json",
      "--method", "GET",
      "-f", "ref=gh-pages",
    ]);
    
    await run([
      "gh", "api", `repos/${repo}/contents/index.html`,
      "--method", "PUT",
      "-f", `message=gitclaw: update dashboard`,
      "-f", `content=${content}`,
      "-f", `branch=gh-pages`,
      "-f", `sha=${existing.trim()}`,
    ]);
  } catch (e) {
    // File or branch doesn't exist yet — create it
    try {
      await run([
        "gh", "api", `repos/${repo}/contents/index.html`,
        "--method", "PUT",
        "-f", `message=gitclaw: initialize dashboard`,
        "-f", `content=${content}`,
        "-f", `branch=gh-pages`,
      ]);
    } catch (e2) {
      // Branch doesn't exist — create it first
      // Create gh-pages branch as an orphan via the API
      const { stdout: mainSha } = await run([
        "gh", "api", `repos/${repo}/git/refs/heads/${defaultBranch}`,
        "--jq", ".object.sha"
      ]);
      
      // Create a tree with just the dashboard file
      const { stdout: treeResult } = await run([
        "gh", "api", `repos/${repo}/git/trees`,
        "--method", "POST",
        "-f", `tree[][path]=index.html`,
        "-f", `tree[][mode]=100644`,
        "-f", `tree[][type]=blob`,
        "-f", `tree[][content]=${html}`,
      ]);
      const treeSha = JSON.parse(treeResult).sha;
      
      // Create a commit
      const { stdout: commitResult } = await run([
        "gh", "api", `repos/${repo}/git/commits`,
        "--method", "POST",
        "-f", `message=gitclaw: initialize dashboard`,
        "-f", `tree=${treeSha}`,
      ]);
      const commitSha = JSON.parse(commitResult).sha;
      
      // Create the branch ref
      await run([
        "gh", "api", `repos/${repo}/git/refs`,
        "--method", "POST",
        "-f", `ref=refs/heads/gh-pages`,
        "-f", `sha=${commitSha}`,
      ]);
      
      console.log("Created gh-pages branch with dashboard");
    }
  }
}
```

### Step 5: Integrate into the agent orchestrator

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts`

After the commit/push step, rebuild the dashboard:

```typescript
import { deployDashboard } from "./GITCLAW-DASHBOARD";

// After successful push:
const dashboardEnabled = piSettings.dashboard?.enabled !== false;
if (dashboardEnabled) {
  try {
    await deployDashboard(repo, defaultBranch);
    console.log("Dashboard updated");
  } catch (e) {
    console.error("Failed to update dashboard:", e);
    // Non-fatal — dashboard is a nice-to-have
  }
}
```

Add configuration to `settings.json`:

```json
{
  "dashboard": {
    "enabled": true,
    "deployOnEveryRun": false,
    "deployOnSchedule": true
  }
}
```

If `deployOnEveryRun` is false (default), the dashboard only rebuilds on scheduled runs — reducing API calls and keeping per-issue response times fast.

### Step 6: Enable GitHub Pages on the repository

Document that Pages must be enabled manually (one-time setup):
1. Go to Settings → Pages
2. Source: Deploy from a branch
3. Branch: `gh-pages` / root
4. Save

The dashboard is then available at `https://owner.github.io/repo/`.

### Step 7: Update documentation

**File:** `.GITCLAW/README.md`
- Add "Agent Dashboard" to capabilities table
- Add the Pages URL badge: `[![Dashboard](https://img.shields.io/badge/dashboard-live-e8533f)](https://owner.github.io/repo/)`
- Document one-time Pages setup

**New file:** `.GITCLAW/docs/GITCLAW-Dashboard.md`
- Dashboard features and pages
- How to enable/disable
- How to customize appearance
- How often it updates
- Privacy considerations (public repos = public dashboard)

### Step 8: Test

- Run the dashboard generator manually:
  1. `bun .GITCLAW/lifecycle/GITCLAW-DASHBOARD.ts`
  2. Open `build/dashboard/index.html` in a browser.
  3. Verify all sections render correctly with real data.
- Trigger an agent run and verify dashboard deployment:
  1. Check that `gh-pages` branch is created/updated.
  2. Visit the Pages URL and verify the dashboard loads.
- Verify with no metrics data (feature 05 not installed):
  1. Usage tab should be hidden.
  2. Overview stats should show "N/A" for cost.
- Verify with no sessions:
  1. Dashboard should render gracefully with "No activity yet" messages.
- Test on mobile viewport:
  1. Verify responsive layout works.

## Design Decisions

**Why a static site instead of a dynamic app?** Zero infrastructure. A static HTML file deployed to Pages requires no server, no database, no JavaScript framework, and no build pipeline. It's rebuilt from scratch each time, which means it's always consistent with the actual state data. Dynamic apps require hosting, maintenance, and eventual bit-rot.

**Why deploy via the GitHub API instead of git push?** Pushing to `gh-pages` from within the agent workflow would require branch switching, which conflicts with the main agent's git operations (especially with branch-per-task). The API approach is atomic and doesn't touch the working tree.

**Why not deploy on every run by default?** Each dashboard deployment is an API call. On active repos with 10+ agent runs per day, that's significant API usage for a dashboard that most people check occasionally. Deploying on scheduled runs (e.g., daily) or on demand is more proportionate. Users who want real-time updates can enable `deployOnEveryRun`.

**Why vanilla HTML/CSS/JS instead of a framework?** The dashboard is generated by a TypeScript script that concatenates strings. Introducing React/Vue/Svelte would require a build step, `node_modules`, and framework knowledge. Vanilla HTML keeps the generator simple, the output small (~50KB), and the maintenance burden near zero. The `tools/chat.html` already proves this approach works at 977 lines.
