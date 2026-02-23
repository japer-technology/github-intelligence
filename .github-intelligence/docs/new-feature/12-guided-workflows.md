# Feature: Guided Multi-Step Workflows (Issue Template Automation)

## Summary

Generalize the "hatching" pattern into a configurable system for multi-step, agent-guided conversations. An issue template can define a sequence of phases — each with its own prompt, expected outputs, validation criteria, and branching logic. The agent guides the user through the workflow, tracks progress with checkboxes, and advances to the next step only when the current one is complete. This turns GitHub Issues into interactive workflow engines for onboarding, incident response, release checklists, design reviews, RFCs, and any other structured process.

## Why This Feature — The Deep Reasoning

**1. The hatching flow already proves the pattern works — but it's hardcoded.**

The `BOOTSTRAP.md` + `hatch` label mechanism is a beautiful interaction: a structured, multi-step conversation that results in concrete artifacts (updated AGENTS.md, user.md). But it's a one-off implementation. The conversation structure, the expected outputs, the file updates — all are hardwired into BOOTSTRAP.md. There's no way to create a *second* guided workflow without copying and modifying the bootstrap code. Generalizing this into a reusable system unlocks an entire category of use cases.

**2. Most valuable conversations follow a structure, even when they feel freeform.**

A bug report has a structure: reproduce → diagnose → fix → verify. A design review has a structure: context → proposal → tradeoff analysis → decision → documentation. An incident response has a structure: detect → triage → contain → fix → postmortem. Today, users have to carry this structure in their heads. A guided workflow makes the structure explicit, ensures steps aren't skipped, and tracks progress visually.

**3. It turns GitHub Issues into a lightweight process automation platform.**

Organizations pay for tools like Jira, Linear, Notion, and custom internal apps to implement structured workflows. GitClaw + guided workflows replicates 80% of that functionality with zero infrastructure — it's just Markdown templates and an AI agent. For teams that already live in GitHub, this eliminates an entire tool category.

**4. It's the bridge between "AI chatbot" and "AI-powered process."**

A chatbot responds to messages. A process automation system guides users through steps, validates outputs, and ensures completeness. Guided workflows are the feature that transforms GitClaw from the former to the latter. The agent isn't just answering questions — it's running a structured process with checkpoints and artifacts.

**5. It compounds with every persona.**

Each persona (feature 10) can have its own workflow templates. The `@security` persona gets an "incident response" workflow. The `@reviewer` persona gets a "design review" workflow. The `@docs` persona gets a "documentation review" workflow. Workflows × personas = a combinatorial space of specialized, structured interactions.

## Scope

### In Scope
- Workflow definition format (Markdown-based, in `.GITCLAW/workflows/`)
- Multi-step conversation with state tracking
- Checkbox-based progress visualization in the issue body
- Per-step agent prompts and expected artifacts
- Conditional branching (if step 2 produces X, go to step 3a; if Y, go to step 3b)
- Workflow completion with artifact summary
- Built-in workflows: bug-triage, design-review, release-checklist, incident-response
- Issue template integration (selecting a template starts the corresponding workflow)

### Out of Scope
- Visual workflow editor
- Parallel steps (steps are sequential)
- Cross-issue workflows (single issue per workflow instance)
- Workflow approval gates requiring multiple users
- Integration with GitHub Projects board columns

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Workflow definition format** | Design Markdown-based schema, parser | ~2 hours |
| **Workflow engine** (new `GITCLAW-WORKFLOW.ts`) | State machine: load workflow, track step, advance, branch | ~3 hours |
| **Issue body updater** | Edit the issue body to update checkboxes as steps complete | ~1 hour |
| **Agent orchestrator integration** | Detect workflow-labeled issues, inject step context into prompt | ~1.5 hours |
| **Built-in workflows** (4) | Bug triage, design review, release checklist, incident response | ~2 hours |
| **Issue templates** | Create templates that start each workflow | ~30 min |
| **Docs** | Document workflow system, how to create custom workflows | ~30 min |
| **Testing** | Test each built-in workflow end-to-end | ~1.5 hours |

**Total: ~12 hours.** This is the most complex feature in the set because it introduces a state machine into a system that was designed to be stateless-per-turn.

---

## AI Implementation Instructions

### Step 1: Define the workflow format

**New directory:** `.GITCLAW/workflows/`

Each workflow is a Markdown file with YAML frontmatter and step definitions:

**Example: `.GITCLAW/workflows/bug-triage.md`**

```markdown
---
name: bug-triage
label: workflow:bug-triage
title: "Bug Triage: {user_title}"
description: Guided bug triage and diagnosis workflow
steps: 5
---

# Bug Triage Workflow

## Step 1: Understand the Report

**Goal:** Ensure the bug report has enough information to investigate.

**Agent prompt:**
Read the issue description carefully. Assess whether it contains:
1. Steps to reproduce
2. Expected behavior
3. Actual behavior
4. Environment information

If any of these are missing, ask the user ONE targeted question to fill the gap.
If all are present, summarize your understanding and confirm with the user.

**Completion criteria:**
- User confirms the agent's understanding is correct, OR
- Agent has gathered all missing information

**Artifacts:** None

---

## Step 2: Reproduce and Diagnose

**Goal:** Trace the bug through the codebase and identify the root cause.

**Agent prompt:**
Based on the confirmed bug report, search the codebase for the relevant code paths.
Trace the execution from the entry point through to where the bug manifests.
Identify the root cause and explain your reasoning.

**Completion criteria:**
- Agent has identified a specific file and line (or code path) as the root cause
- User confirms the diagnosis makes sense

**Artifacts:**
- Root cause analysis (included in agent response)

---

## Step 3: Propose Fix

**Goal:** Design a fix and get user approval before implementing.

**Agent prompt:**
Propose a fix for the diagnosed root cause. Include:
1. What files need to change
2. What the change looks like (code snippets or pseudocode)
3. Any risks or side effects of the fix
4. Whether tests need to be updated

Do NOT implement the fix yet — wait for user approval.

**Completion criteria:**
- User approves the proposed fix

**Branch:** If user says "just fix it" or similar → skip to Step 4
**Branch:** If user wants to explore alternatives → repeat Step 3 with alternative approach

**Artifacts:**
- Fix proposal document

---

## Step 4: Implement Fix

**Goal:** Apply the approved fix to the codebase.

**Agent prompt:**
Implement the fix as approved in Step 3. Edit the relevant files.
If tests need updating, update them too.
Show a summary of all changes made.

**Completion criteria:**
- Changes are committed (or PR opened if branch-per-task is active)

**Artifacts:**
- Modified files (committed or in PR)

---

## Step 5: Verify and Close

**Goal:** Confirm the fix is complete and document the resolution.

**Agent prompt:**
Summarize the entire triage process:
1. Bug description
2. Root cause
3. Fix applied
4. Files changed
5. Any follow-up items

Ask the user if the issue can be closed.

**Completion criteria:**
- User confirms issue can be closed

**Artifacts:**
- Resolution summary
```

### Step 2: Create the workflow parser

**New file:** `.GITCLAW/lifecycle/GITCLAW-WORKFLOW.ts`

```typescript
export interface WorkflowStep {
  number: number;
  title: string;
  goal: string;
  agentPrompt: string;
  completionCriteria: string;
  branches: { condition: string; target: number | "repeat" }[];
  artifacts: string[];
}

export interface Workflow {
  name: string;
  label: string;
  titleTemplate: string;
  description: string;
  totalSteps: number;
  steps: WorkflowStep[];
}

export interface WorkflowState {
  workflowName: string;
  currentStep: number;
  completedSteps: number[];
  stepHistory: { step: number; completedAt: string; artifacts: string[] }[];
  startedAt: string;
  issueNumber: number;
}

export function parseWorkflow(path: string): Workflow
export function loadWorkflowState(issueNumber: number, stateDir: string): WorkflowState | null
export function saveWorkflowState(state: WorkflowState, stateDir: string): void
```

**`parseWorkflow`:**
- Read the Markdown file.
- Parse YAML frontmatter for metadata.
- Split on `## Step N:` headers.
- For each step, extract:
  - `**Goal:**` → `goal`
  - `**Agent prompt:**` → `agentPrompt` (everything until next bold header)
  - `**Completion criteria:**` → `completionCriteria`
  - `**Branch:**` lines → `branches` array
  - `**Artifacts:**` → `artifacts` array

**Workflow state storage:**
- Save to `state/workflows/<issueNumber>.json`
- Loaded on every agent run to determine the current step

### Step 3: Create the workflow engine

**In `GITCLAW-WORKFLOW.ts`:**

```typescript
export function buildWorkflowPrompt(
  workflow: Workflow,
  state: WorkflowState,
  userMessage: string
): string {
  const step = workflow.steps[state.currentStep - 1];
  
  const progressBar = workflow.steps.map((s, i) => {
    const num = i + 1;
    if (state.completedSteps.includes(num)) return `✅ Step ${num}`;
    if (num === state.currentStep) return `➡️ **Step ${num}** (current)`;
    return `⬜ Step ${num}`;
  }).join("\n");
  
  return [
    `## Workflow: ${workflow.name}`,
    ``,
    `### Progress`,
    progressBar,
    ``,
    `### Current Step: ${step.number} — ${step.title}`,
    `**Goal:** ${step.goal}`,
    ``,
    `### Instructions for this step`,
    step.agentPrompt,
    ``,
    `### Completion criteria`,
    step.completionCriteria,
    ``,
    `### User's message`,
    userMessage,
    ``,
    `---`,
    `After responding, assess whether the completion criteria for this step have been met.`,
    `If yes, end your response with: [STEP_COMPLETE]`,
    `If the user's response triggers a branch condition, end with: [BRANCH:step_number]`,
    `If the step needs more interaction, just respond normally.`,
  ].join("\n");
}

export function advanceWorkflow(
  state: WorkflowState,
  agentResponse: string,
  workflow: Workflow
): WorkflowState {
  const newState = { ...state };
  
  if (agentResponse.includes("[STEP_COMPLETE]")) {
    newState.completedSteps.push(state.currentStep);
    newState.stepHistory.push({
      step: state.currentStep,
      completedAt: new Date().toISOString(),
      artifacts: [],
    });
    
    if (state.currentStep < workflow.totalSteps) {
      newState.currentStep = state.currentStep + 1;
    }
    // else: workflow complete
  }
  
  // Check for branch directives
  const branchMatch = agentResponse.match(/\[BRANCH:(\d+)\]/);
  if (branchMatch) {
    newState.currentStep = parseInt(branchMatch[1]);
  }
  
  return newState;
}
```

### Step 4: Update the issue body with progress checkboxes

When a step completes, edit the issue body to update the progress:

```typescript
export async function updateIssueProgress(
  issueNumber: number,
  workflow: Workflow,
  state: WorkflowState,
  repo: string
): Promise<void> {
  // Build the progress checklist
  const checklist = workflow.steps.map((step, i) => {
    const num = i + 1;
    const checked = state.completedSteps.includes(num) ? "x" : " ";
    const current = num === state.currentStep ? " ← current" : "";
    return `- [${checked}] **Step ${num}:** ${step.title}${current}`;
  }).join("\n");
  
  const progressSection = [
    "",
    "---",
    `### 🔄 Workflow Progress: ${workflow.name}`,
    checklist,
    `_Started: ${state.startedAt}_`,
    "",
  ].join("\n");
  
  // Fetch current issue body
  const { stdout: currentBody } = await run([
    "gh", "issue", "view", String(issueNumber), "--json", "body", "--jq", ".body"
  ]);
  
  // Replace or append the progress section
  const progressMarker = "### 🔄 Workflow Progress:";
  let newBody: string;
  if (currentBody.includes(progressMarker)) {
    // Replace existing progress section
    const beforeProgress = currentBody.split("---\n" + progressMarker)[0];
    newBody = beforeProgress + progressSection;
  } else {
    // Append progress section
    newBody = currentBody + progressSection;
  }
  
  // Update the issue body
  await run([
    "gh", "issue", "edit", String(issueNumber), "--body", newBody
  ]);
}
```

### Step 5: Integrate into the agent orchestrator

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts`

After constructing the prompt and before running `pi`:

```typescript
import { parseWorkflow, loadWorkflowState, saveWorkflowState, buildWorkflowPrompt, advanceWorkflow, updateIssueProgress } from "./GITCLAW-WORKFLOW";

// Check if this issue has a workflow label
const issueLabels = (event.issue?.labels || []).map((l: any) => l.name);
const workflowLabel = issueLabels.find((l: string) => l.startsWith("workflow:"));

let activeWorkflow: Workflow | null = null;
let workflowState: WorkflowState | null = null;

if (workflowLabel) {
  const workflowName = workflowLabel.replace("workflow:", "");
  const workflowPath = resolve(gitclawDir, "workflows", `${workflowName}.md`);
  
  if (existsSync(workflowPath)) {
    activeWorkflow = parseWorkflow(workflowPath);
    workflowState = loadWorkflowState(issueNumber, stateDir);
    
    if (!workflowState) {
      // Initialize new workflow state
      workflowState = {
        workflowName,
        currentStep: 1,
        completedSteps: [],
        stepHistory: [],
        startedAt: new Date().toISOString(),
        issueNumber,
      };
    }
    
    // Augment the prompt with workflow context
    prompt = buildWorkflowPrompt(activeWorkflow, workflowState, prompt);
  }
}

// ... run pi agent with the augmented prompt ...

// After extracting agentText:
if (activeWorkflow && workflowState) {
  // Check if the step was completed
  const newState = advanceWorkflow(workflowState, agentText, activeWorkflow);
  
  // Save updated state
  saveWorkflowState(newState, stateDir);
  
  // Update issue body with progress
  await updateIssueProgress(issueNumber, activeWorkflow, newState, repo);
  
  // Strip the [STEP_COMPLETE] and [BRANCH:N] markers from the posted comment
  agentText = agentText
    .replace(/\[STEP_COMPLETE\]/g, "")
    .replace(/\[BRANCH:\d+\]/g, "")
    .trim();
  
  // If the workflow is now complete, add a completion banner
  if (newState.completedSteps.length === activeWorkflow.totalSteps) {
    agentText += "\n\n---\n✅ **Workflow complete!** All steps finished.\n";
    
    // Optionally close the issue
    // await run(["gh", "issue", "close", String(issueNumber)]);
  }
}
```

### Step 6: Create issue templates for built-in workflows

**New file:** `.github/ISSUE_TEMPLATE/bug-triage.md`

```markdown
---
name: "🐛 Bug Triage (Guided)"
about: "Step-by-step bug diagnosis with agent guidance"
labels: ["workflow:bug-triage"]
---

**Describe the bug:**

**Steps to reproduce:**

**Expected behavior:**

**Actual behavior:**

**Environment:**
```

**New file:** `.github/ISSUE_TEMPLATE/design-review.md`

```markdown
---
name: "🏗️ Design Review (Guided)"
about: "Structured design review with agent facilitation"
labels: ["workflow:design-review"]
---

**What are you proposing?**

**Why is this needed?**

**What alternatives did you consider?**
```

### Step 7: Create 4 built-in workflows

Create workflow definitions in `.GITCLAW/workflows/`:

1. **`bug-triage.md`** — Understand → Diagnose → Propose Fix → Implement → Verify (shown above)
2. **`design-review.md`** — Present Proposal → Analyze Tradeoffs → Gather Feedback → Decision → Document ADR
3. **`release-checklist.md`** — Verify CI → Generate Changelog → Review Notes → Tag & Publish → Announce
4. **`incident-response.md`** — Detect & Confirm → Triage Severity → Contain → Fix → Postmortem

Each follows the same Markdown format with step-by-step agent prompts.

### Step 8: Update documentation

**New file:** `.GITCLAW/docs/GITCLAW-Workflows.md`
- Workflow concept and philosophy
- How to use built-in workflows
- How to create custom workflows
- Workflow definition format reference
- How step advancement and branching work
- How progress tracking works

**File:** `.GITCLAW/README.md`
- Add "Guided Workflows" to capabilities table
- Link to the workflows doc

### Step 9: Test

- Open an issue with the `workflow:bug-triage` label:
  1. Verify the agent starts at Step 1 and asks the right questions.
  2. Respond with bug details → verify the agent advances to Step 2.
  3. Follow the workflow through all 5 steps.
  4. Verify the issue body shows updated checkboxes at each step.
  5. Verify the completion banner appears after Step 5.
- Open a `workflow:design-review` issue:
  1. Verify it follows the design review steps.
  2. Test branching: give a response that should trigger an alternative path.
- Start a workflow, then abandon it (stop responding):
  1. Verify the state persists — when you come back later, it resumes at the right step.
- Open a non-workflow issue:
  1. Verify behavior is completely unchanged (no regression).

## Design Decisions

**Why Markdown for workflow definitions instead of YAML/JSON?** Consistency with GitClaw's "everything is a readable file" philosophy. The agent prompts in each step are prose — they're natural in Markdown. YAML would require escaping multi-line strings, which makes the prompts harder to read and edit.

**Why `[STEP_COMPLETE]` markers instead of a separate assessment call?** Asking the agent to signal step completion in-band (as part of its response) is simpler and cheaper than a separate LLM call to assess completion. The marker is stripped before posting, so users never see it. The agent has enough context from the completion criteria to make this judgment accurately.

**Why update the issue body instead of posting progress as comments?** The issue body is the canonical "state" of the issue — it's what you see first when you open it. Progress checkboxes in the body give an instant overview without scrolling through comments. Comments are for the conversation; the body is for the status.

**Why sequential steps only?** Parallel steps would require the agent to manage multiple active contexts simultaneously, which conflicts with the single-session model. Sequential steps are simpler, match how conversations naturally flow, and cover the vast majority of structured workflows. Parallel workflows can be modeled as separate issues.
