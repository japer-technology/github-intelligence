# Feature: Multi-Agent Specialization via Labels

## Summary

Support multiple agent personas within the same repository, dispatched by issue/PR labels. A `@reviewer` label triggers a strict code review agent. A `@docs` label triggers a documentation specialist. A `@security` label triggers a security auditor. Each persona has its own identity section in `AGENTS.md`, its own skill set, and optionally its own model configuration. The default (unlabeled) behavior remains unchanged. This turns a single GitClaw installation into a team of specialized agents that users invoke by choosing a label.

## Why This Feature — The Deep Reasoning

**1. One-size-fits-all agents are mediocre at everything.**

The current agent has a single personality (Spock 🖖), a single skill set, and a single model. When asked to review code, it reviews code. When asked to write docs, it writes docs. But the optimal tone, thoroughness, model, and system prompt are *different* for each task. A code reviewer should be terse and critical. A documentation writer should be thorough and pedagogical. A security auditor should be paranoid and exhaustive. A single prompt can't optimize for all of these simultaneously.

**2. Labels are GitHub's native dispatch mechanism — and they're free.**

GitClaw already has the issue template system. Labels already exist on every issue. The Actions workflow already has access to `event.issue.labels`. Using labels as a dispatch key requires zero new infrastructure — it's a conditional branch in the existing pipeline that selects which configuration to load.

**3. It's the architectural foundation for multi-agent collaboration.**

The roadmap envisions agent-to-agent conversations where a triage agent labels an issue, a reviewer agent picks it up, and a human approves the result. Multi-agent specialization is the prerequisite: before agents can collaborate, they need to be distinguishable. Each persona is a named entity with defined capabilities and boundaries.

**4. It solves the "prompt engineering at scale" problem.**

Today, if a team wants the agent to behave differently for different task types, they have to include instructions in every issue: "Please be thorough and check for security issues" vs. "Please be concise and just fix the typo." This is fragile and inconsistent. Labels externalize this configuration — the prompt engineering lives in the persona definition, not in every user message.

**5. It enables organizational customization without forking.**

Different teams want different agent behaviors. The security team wants a paranoid auditor. The docs team wants a friendly writer. The infra team wants a terse operator. Multi-agent personas let each team define their ideal agent configuration within the same repo, selected by label. No forks, no multiple installations, no configuration drift.

## Scope

### In Scope
- Multi-persona configuration in `AGENTS.md` or a new `PERSONAS.md` file
- Label-based dispatch: `@<persona-name>` labels select the persona
- Per-persona: name, system prompt additions, skill overrides, model/provider overrides
- Default persona for unlabeled issues (current behavior)
- `/persona` slash command to switch personas mid-conversation
- Persona indicator in the agent's response (e.g., a header or footer showing which persona responded)

### Out of Scope
- Per-persona session isolation (all personas share the same session — context is valuable)
- Per-persona cost budgets
- Automatic persona selection based on issue content (future follow-up)
- Agent-to-agent handoff within a single issue

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Persona configuration format** | Define schema, create example personas | ~1 hour |
| **Label detection & dispatch** | Read issue labels, match to personas, load config | ~1.5 hours |
| **Prompt augmentation** | Inject persona-specific system prompt and skill references | ~1.5 hours |
| **Model/provider override** | Override `pi` args when persona specifies a different model | ~30 min |
| **Agent orchestrator** | Integrate persona dispatch into the prompt construction pipeline | ~1.5 hours |
| **Persona indicator** | Add header/footer to agent comments showing active persona | ~30 min |
| **Default personas** | Create 3-4 useful default personas (reviewer, docs, security, triage) | ~1.5 hours |
| **Docs** | Document persona system, how to create custom personas | ~30 min |
| **Testing** | Test label dispatch, test model override, test default fallback | ~1 hour |

**Total: ~9–10 hours.** The complexity is in designing the persona configuration format well enough that it's both powerful and simple.

---

## AI Implementation Instructions

### Step 1: Define the persona configuration format

**New file:** `.GITCLAW/PERSONAS.md`

Personas are defined as Markdown sections in a single file, making them human-readable, diffable, and version-controlled:

```markdown
# GitClaw Personas

## Default

The default persona when no label-based dispatch matches. Falls back to the identity in `AGENTS.md`.

- **Label**: _(none — this is the fallback)_
- **Skills**: _(all available skills)_
- **Model**: _(use settings.json defaults)_

---

## Reviewer

A strict, thorough code reviewer focused on correctness, security, and maintainability.

- **Label**: `@reviewer`
- **Skills**: cross-reference
- **Model**: _(use settings.json defaults)_

### System Prompt Addition

You are operating in **code review mode**. Be thorough and critical. Your job is to find problems, not to be nice.

**Review checklist — check every item:**
1. **Correctness**: Does the code do what it claims? Edge cases? Off-by-one errors?
2. **Security**: Input validation? Injection risks? Auth checks? Secret exposure?
3. **Performance**: O(n²) loops? Unnecessary allocations? Missing caching?
4. **Error handling**: Are errors caught? Are they handled meaningfully? Fail modes?
5. **Testing**: Is this change tested? Are edge cases covered? Are tests meaningful?
6. **Style**: Naming conventions? Code organization? Comments where needed?
7. **Dependencies**: New dependencies justified? Version pinned? License compatible?

For each issue found, rate its severity: 🔴 Critical, 🟡 Warning, 🔵 Info.

Be specific. Reference file names and line numbers. Propose fixes, not just complaints.

---

## Docs

A thorough, pedagogical documentation writer focused on clarity and completeness.

- **Label**: `@docs`
- **Skills**: cross-reference
- **Model**: _(use settings.json defaults)_

### System Prompt Addition

You are operating in **documentation mode**. Write for humans who will read this months from now.

**Documentation principles:**
- Start with the "why" before the "how"
- Use concrete examples for every abstract concept
- Structure with clear headers, bullet points, and code blocks
- Define jargon the first time it appears
- Include both happy-path and error-case documentation
- Link to related documentation and code
- Prefer brevity, but never sacrifice clarity for it

When creating docs, check for existing documentation that should be updated rather than duplicated.

---

## Security

A paranoid security auditor focused on threat modeling and vulnerability detection.

- **Label**: `@security`
- **Skills**: cross-reference
- **Model**: _(use settings.json defaults)_
- **Thinking Level**: high

### System Prompt Addition

You are operating in **security audit mode**. Assume attackers are sophisticated and motivated.

**Security review framework:**
1. **Threat modeling**: Who are the adversaries? What are they after? What's the attack surface?
2. **Input validation**: Every external input is hostile until proven otherwise
3. **Authentication & authorization**: Every action requires both — verify both are present and correct
4. **Data exposure**: What data could leak? Through errors? Logs? Timing? Side channels?
5. **Dependencies**: Known CVEs? Maintainer trust? Supply chain risks?
6. **Secrets management**: Hardcoded secrets? Rotation? Least privilege?
7. **Cryptography**: Appropriate algorithms? Proper key management? No custom crypto?

Rate findings: 🔴 **Critical** (exploit now), 🟡 **High** (exploit with effort), 🔵 **Medium** (defense in depth), ⚪ **Low** (hardening)

Always recommend specific mitigations, not just "fix this."

---

## Triage

A concise issue triager focused on classification, prioritization, and routing.

- **Label**: `@triage`
- **Skills**: cross-reference, memory
- **Model**: _(use a cheaper model for cost efficiency)_
- **Model Override**: gemini-2.5-flash
- **Provider Override**: google

### System Prompt Addition

You are operating in **triage mode**. Be fast and decisive.

**Triage workflow:**
1. Read the issue title and body carefully
2. Classify: bug, feature request, question, documentation, performance, security
3. Assess priority: P0 (production down), P1 (high impact), P2 (normal), P3 (low/nice-to-have)
4. Check for duplicates: search past issues for similar reports
5. Suggest labels that should be applied
6. If the issue is unclear, ask ONE targeted clarifying question
7. If the issue references code, read the relevant files and verify the claim

Be concise. Triage comments should be under 200 words unless the issue requires detailed investigation.
```

### Step 2: Parse the persona configuration

**New file:** `.GITCLAW/lifecycle/GITCLAW-PERSONAS.ts`

```typescript
export interface Persona {
  name: string;
  label: string | null;        // null for default persona
  skills: string[];            // skill names to prioritize
  modelOverride: string | null;
  providerOverride: string | null;
  thinkingLevelOverride: string | null;
  systemPromptAddition: string;
}

export function parsePersonas(personasPath: string): Persona[]
export function matchPersona(personas: Persona[], labels: string[]): Persona
```

**`parsePersonas`:**
- Read `PERSONAS.md`.
- Split on `---` horizontal rules to find persona sections.
- For each section:
  - Extract the `## Name` heading → `name`.
  - Parse `- **Label**: \`@xyz\`` → `label` (strip backticks and `@` prefix).
  - Parse `- **Skills**: skill1, skill2` → `skills` array.
  - Parse `- **Model Override**: model-name` → `modelOverride`.
  - Parse `- **Provider Override**: provider-name` → `providerOverride`.
  - Parse `- **Thinking Level**: high` → `thinkingLevelOverride`.
  - Extract everything under `### System Prompt Addition` until the next `---` or `##` → `systemPromptAddition`.

**`matchPersona`:**
- Take the list of parsed personas and the issue's labels.
- For each persona with a non-null label, check if the issue has a matching label (with or without `@` prefix — match both `@reviewer` and `reviewer`).
- If a match is found, return that persona.
- If no match, return the default persona (the one with `label: null`).
- If multiple labels match, use the first match (or could allow priority ordering).

### Step 3: Integrate persona dispatch into the agent orchestrator

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts`

After constructing the prompt and before running `pi`:

```typescript
import { parsePersonas, matchPersona, Persona } from "./GITCLAW-PERSONAS";

// Load personas
const personasPath = resolve(gitclawDir, "PERSONAS.md");
let activePersona: Persona | null = null;

if (existsSync(personasPath)) {
  const personas = parsePersonas(personasPath);
  const issueLabels = (event.issue?.labels || []).map((l: any) => l.name);
  activePersona = matchPersona(personas, issueLabels);
  
  if (activePersona && activePersona.label) {
    console.log(`Matched persona: ${activePersona.name} (label: ${activePersona.label})`);
  }
}

// Apply persona overrides
let effectiveProvider = configuredProvider;
let effectiveModel = configuredModel;

if (activePersona?.providerOverride) {
  effectiveProvider = activePersona.providerOverride;
  console.log(`Persona overrides provider: ${effectiveProvider}`);
}
if (activePersona?.modelOverride) {
  effectiveModel = activePersona.modelOverride;
  console.log(`Persona overrides model: ${effectiveModel}`);
}

// Augment the prompt with persona context
if (activePersona?.systemPromptAddition) {
  prompt = `[Persona: ${activePersona.name}]\n\n${activePersona.systemPromptAddition}\n\n---\n\n${prompt}`;
}

// Update piArgs to use effective provider/model
const piArgs = [
  piBin,
  "--mode", "json",
  "--provider", effectiveProvider,
  "--model", effectiveModel,
  "--session-dir", sessionsDirRelative,
  "-p", prompt,
];
```

### Step 4: Add a persona indicator to the agent's response

When posting the agent's comment, prepend a subtle persona indicator:

```typescript
let personaHeader = "";
if (activePersona && activePersona.label) {
  const personaEmoji: Record<string, string> = {
    reviewer: "🔍",
    docs: "📚",
    security: "🛡️",
    triage: "📋",
  };
  const emoji = personaEmoji[activePersona.name.toLowerCase()] || "🤖";
  personaHeader = `${emoji} **${activePersona.name}** mode\n\n`;
}

const commentBody = personaHeader + trimmedText.slice(0, MAX_COMMENT_LENGTH - personaHeader.length);
```

This produces comments like:
> 🔍 **Reviewer** mode
>
> Here's my analysis of the changes...

### Step 5: Handle the `/persona` slash command (if slash commands feature is implemented)

If feature 02 (slash commands) is implemented, add a `/persona` command:

```typescript
// In GITCLAW-COMMANDS.ts
const BUILT_IN_COMMANDS = {
  // ... existing commands ...
  persona: { description: "Switch to a specific persona for this response", usage: "/persona <name>" },
};
```

When `/persona reviewer` is used:
- Override the label-based dispatch for this specific response.
- Load the `reviewer` persona's system prompt addition and model overrides.
- Apply them to this run only (don't change the issue's labels).

### Step 6: Pass persona-specific API keys

Different providers need different API keys. If a persona overrides the provider, the corresponding API key must be available.

**File:** `.github/workflows/GITCLAW-WORKFLOW-AGENT.yml`

Add all supported provider keys to the Run step's environment:

```yaml
- name: Run
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
    OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
    GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
    XAI_API_KEY: ${{ secrets.XAI_API_KEY }}
    OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
    MISTRAL_API_KEY: ${{ secrets.MISTRAL_API_KEY }}
    GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: bun .GITCLAW/lifecycle/GITCLAW-AGENT.ts
```

Update the API key validation in GITCLAW-AGENT.ts to check the *effective* provider (after persona override), not just the configured provider:

```typescript
const providerKeyMap: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GEMINI_API_KEY",
  xai: "XAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  mistral: "MISTRAL_API_KEY",
  groq: "GROQ_API_KEY",
};
const requiredKeyName = providerKeyMap[effectiveProvider];
```

### Step 7: Create the label creation helper

On first install (or first use of a persona), the required labels should exist. Add a step to the installer or a helper in the agent:

```typescript
// Ensure persona labels exist
if (activePersona && activePersona.label) {
  try {
    await gh("label", "create", `@${activePersona.label}`,
      "--description", `GitClaw persona: ${activePersona.name}`,
      "--color", "7B61FF",
      "--force");
  } catch (e) {
    // Label might already exist
  }
}
```

Or better: add a one-time setup script that creates all persona labels from `PERSONAS.md`:

```typescript
// In the installer or a setup command
const personas = parsePersonas(personasPath);
for (const p of personas) {
  if (p.label) {
    await gh("label", "create", `@${p.label}`, ...);
  }
}
```

### Step 8: Update documentation

**File:** `.GITCLAW/README.md`
- Add "Agent Personas" section with the label-dispatch mechanism
- List default personas and their labels
- Document how to create custom personas

**New file:** `.GITCLAW/docs/GITCLAW-Personas.md`
- Full persona configuration reference
- How to create a custom persona
- How persona system prompt additions work
- How model/provider overrides work
- How to combine personas with slash commands
- Best practices for persona design

**File:** `.GITCLAW/AGENTS.md`
- Add a note that AGENTS.md defines the base identity, while PERSONAS.md defines specialized modes
- The base identity (Spock 🖖) is always present; personas add to it, they don't replace it

### Step 9: Test

- Create an issue with the `@reviewer` label:
  1. Verify the reviewer persona is activated.
  2. Verify the response has the 🔍 Reviewer mode header.
  3. Verify the response follows the review checklist.
- Create an issue with no persona label:
  1. Verify the default persona is used.
  2. Verify behavior is identical to current (no regression).
- Create an issue with the `@triage` label:
  1. Verify the triage persona is activated.
  2. Verify the model override works (if Google Gemini key is available).
  3. Verify the response is concise per the triage system prompt.
- Add a `@security` label to an existing issue mid-conversation:
  1. Verify the next response uses the security persona.
  2. Verify the session is preserved (conversation context isn't lost).
- Create a custom persona in PERSONAS.md:
  1. Add a new section with custom label, system prompt, and model.
  2. Create an issue with the custom label.
  3. Verify the custom persona is activated.

## Design Decisions

**Why labels instead of issue templates?** Labels can be added or changed at any time, including mid-conversation. Issue templates lock the persona at issue creation time. Labels are also visible in issue lists, filterable in search, and familiar to all GitHub users. Templates would work for initial dispatch but not for persona switching.

**Why Markdown for persona configuration instead of JSON/YAML?** GitClaw's philosophy is "configuration as readable files." A Markdown file with persona definitions is human-readable, diffable, and can include rich formatting in the system prompt additions. JSON would be more structured but less pleasant to author. The Markdown parsing is straightforward since the format uses consistent heading and bullet patterns.

**Why inject persona system prompts into the user message instead of the actual system prompt?** The `pi` agent's system prompt is controlled by `.pi/APPEND_SYSTEM.md` and the skill system. Modifying those files per-run would require file writes and be fragile. Prepending persona context to the user prompt is simpler, doesn't modify any files, and achieves the same effect — the LLM sees the persona instructions before the user's actual message.

**Why share sessions across personas?** A user might start an investigation with the default persona, then add `@security` to get a security-focused follow-up, then add `@reviewer` for a code review of the fix. Sharing the session means each persona has the full conversation context. Isolating sessions would force the user to re-explain everything when switching personas.

**Why include a model override per persona?** Different tasks have different cost/quality tradeoffs. Code review benefits from the best model (catch subtle bugs). Triage can use a cheap, fast model (it's classification, not reasoning). Security audit needs deep reasoning (threat modeling is hard). Letting each persona choose its model turns cost optimization into a configuration decision, not a per-interaction manual choice.
