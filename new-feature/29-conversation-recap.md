# Feature: Conversation Recap & Orientation

## Summary

At the start of every response in a long conversation (beyond a configurable turn threshold), the agent prepends a brief, structured "orientation block" — a 3-5 line summary of where the conversation stands: what the original request was, what key decisions have been made, what actions have been taken, and what's currently being discussed. Think of it as meeting minutes at the top of every email in a long thread. For the user returning to an issue after hours or days, the recap eliminates the need to re-read the entire conversation history. For the agent itself, composing the recap forces it to organize its own understanding before responding.

## Why This Feature — The Deep Reasoning

### 1. Conversations Get Long. Humans Lose Track.

This repo's sessions show conversations of 12, 65, 86, and 119 JSONL events. The 119-event session spans multiple topics: the user asked about different things, the agent investigated, decisions were made and sometimes revised. By turn 30, neither the user nor a new reader can tell what the current state of the conversation is without re-reading everything.

Email threads have the same problem — except email clients solve it with thread summaries, read/unread markers, and conversation views. GitHub issue threads have none of this. The agent must provide the orientation that the platform doesn't.

### 2. Returning to a Conversation After Hours Is Disorienting

A common pattern: the user asks a question at 9am, the agent responds, the user asks a follow-up at 9:15am. Then they go to lunch, attend meetings, and return at 3pm to continue the conversation. They've lost the mental model of where things stood. They re-read the last 2-3 comments, but those reference decisions from turn 5 that they've forgotten.

The recap solves this: every response starts with "Here's where we are" — and the user is re-oriented in 5 seconds instead of 5 minutes.

### 3. It Forces the Agent to Maintain Coherent Understanding

Writing a recap requires the agent to synthesize its understanding of the conversation. This is a form of self-discipline: before answering the current question, the agent must demonstrate that it understands the context. If the recap is incoherent, it signals that the agent's context has drifted — a canary for context window pressure (feature 22).

### 4. It Serves Multiple Audiences

In a team setting, multiple people might follow an issue thread. The person who opened the issue has full context. A teammate who gets @mentioned at turn 20 has none. The recap serves both:
- For the original user: a quick refresher
- For new participants: a complete orientation
- For future readers: a timeline of how the conversation evolved

### 5. It's a Natural Extension of the Knowledge Base

The recap is a micro-version of a knowledge base article (feature 17) — a curated summary of a single conversation's state. Over time, the accumulated recaps serve as checkpoints in the conversation timeline. If the knowledge base is the "what we know" artifact, recaps are the "where we are right now" artifact.

## Scope

### In Scope
- **Recap generation**: Produce a structured 3-5 line orientation at the start of responses
- **Turn threshold**: Only show recaps after a configurable number of turns (default: 5)
- **Recap structure**: Original request, key decisions, recent actions, current focus
- **Collapsible format**: Wrap in `<details>` so users who don't need it can collapse it
- **Decision tracking**: Extract and track decisions as the conversation evolves
- **Recap consistency**: Ensure recaps evolve naturally (not contradicting previous recaps)
- **Format variations**: Short recap (3 lines), full recap (with timeline), and decision list

### Out of Scope
- Interactive recap editing (user modifies the recap)
- Cross-issue recaps (summary across multiple issues — that's the knowledge base)
- Audio/visual recaps

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Recap generator** | Produce structured recaps from conversation state | ~2.5 hours |
| **Decision tracker** | Extract decisions from conversation turns | ~1.5 hours |
| **Turn counter and threshold** | Track conversation depth, trigger recaps | ~30 min |
| **Recap formatter** | Multiple format options (short, full, decision list) | ~1 hour |
| **Agent prompt injection** | Ask the agent to generate the recap as part of its response | ~1 hour |
| **Collapsible rendering** | Wrap in GitHub-compatible collapsible sections | ~30 min |
| **Configuration** | Threshold, format, enable/disable | ~30 min |
| **Agent orchestrator integration** | Inject recap instructions into prompt | ~1 hour |
| **Docs** | Document recap system | ~30 min |
| **Testing** | Test at various conversation lengths, test consistency | ~1.5 hours |

**Total: ~11 hours.**

---

## AI Implementation Instructions

### Step 1: Decision tracker

**New file:** `.GITCLAW/lifecycle/GITCLAW-RECAP.ts`

Track decisions and key events as the conversation evolves:

```typescript
export interface ConversationState {
  issueNumber: number;
  turnCount: number;
  originalRequest: string;         // the first user message
  decisions: Decision[];
  recentActions: string[];         // last 3 actions the agent took
  currentFocus: string;            // what the current turn is about
  lastRecap?: string;              // the most recent recap (to avoid repetition)
}

export interface Decision {
  turn: number;
  description: string;
  madeBy: "user" | "agent" | "collaborative";
}

export function loadConversationState(
  stateDir: string,
  issueNumber: number
): ConversationState | null {
  const statePath = resolve(stateDir, "recaps", `${issueNumber}.json`);
  if (!existsSync(statePath)) return null;
  return JSON.parse(readFileSync(statePath, "utf-8"));
}

export function saveConversationState(
  stateDir: string,
  state: ConversationState
): void {
  const recapsDir = resolve(stateDir, "recaps");
  mkdirSync(recapsDir, { recursive: true });
  writeFileSync(
    resolve(recapsDir, `${state.issueNumber}.json`),
    JSON.stringify(state, null, 2) + "\n"
  );
}
```

### Step 2: Build conversation state from session

```typescript
export function buildConversationState(
  sessionPath: string,
  issueNumber: number,
  currentPrompt: string
): ConversationState {
  const lines = readFileSync(sessionPath, "utf-8").split("\n").filter(Boolean);
  
  let turnCount = 0;
  let originalRequest = "";
  const decisions: Decision[] = [];
  const recentActions: string[] = [];
  
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      const role = event.message?.role;
      const textBlocks = (event.message?.content || [])
        .filter((b: any) => b.type === "text")
        .map((b: any) => b.text || "");
      const text = textBlocks.join("\n");
      
      if (role === "user") {
        turnCount++;
        if (turnCount === 1) {
          originalRequest = text.slice(0, 200);
        }
      }
      
      if (role === "assistant" && text) {
        // Detect decisions
        const decisionPatterns = [
          /(?:I'll|I will|Let's|We should|Going with|Decided to|The plan is)\s+(.{10,100})/gi,
          /(?:✅|Decision:|Conclusion:)\s*(.{10,100})/gi,
        ];
        
        for (const pattern of decisionPatterns) {
          let match;
          while ((match = pattern.exec(text)) !== null) {
            decisions.push({
              turn: turnCount,
              description: match[1].trim().replace(/[.!]$/, ""),
              madeBy: "agent",
            });
          }
        }
        
        // Detect actions (tool use summaries)
        const actionPatterns = [
          /(?:Created|Modified|Updated|Deleted|Wrote|Read|Ran|Executed|Analyzed)\s+(.{10,80})/gi,
        ];
        
        for (const pattern of actionPatterns) {
          let match;
          while ((match = pattern.exec(text)) !== null) {
            recentActions.push(match[0].trim().slice(0, 100));
          }
        }
      }
    } catch (e) { /* skip */ }
  }
  
  // Deduplicate decisions (similar descriptions within 5 turns)
  const uniqueDecisions = decisions.reduce((acc: Decision[], d) => {
    const isDuplicate = acc.some(existing =>
      Math.abs(existing.turn - d.turn) < 5 &&
      similarity(existing.description, d.description) > 0.6
    );
    if (!isDuplicate) acc.push(d);
    return acc;
  }, []);
  
  return {
    issueNumber,
    turnCount,
    originalRequest,
    decisions: uniqueDecisions.slice(-10), // keep last 10 decisions
    recentActions: recentActions.slice(-5),  // keep last 5 actions
    currentFocus: currentPrompt.slice(0, 150),
  };
}

function similarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
  return intersection / Math.max(wordsA.size, wordsB.size);
}
```

### Step 3: Recap generator

```typescript
export type RecapFormat = "short" | "full" | "decisions";

export function generateRecap(
  state: ConversationState,
  format: RecapFormat = "short"
): string {
  if (state.turnCount < 3) return ""; // Too early for a recap
  
  if (format === "short") {
    // 3-5 lines, always fits
    const lines: string[] = [
      `📍 **Where we are** (turn ${state.turnCount}):`,
    ];
    
    if (state.originalRequest) {
      lines.push(`- **Started with:** ${state.originalRequest.slice(0, 100)}${state.originalRequest.length > 100 ? "..." : ""}`);
    }
    
    if (state.decisions.length > 0) {
      const recentDecision = state.decisions[state.decisions.length - 1];
      lines.push(`- **Last decision:** ${recentDecision.description}`);
    }
    
    if (state.recentActions.length > 0) {
      lines.push(`- **Recent:** ${state.recentActions.slice(-2).join("; ")}`);
    }
    
    lines.push(`- **Now discussing:** ${state.currentFocus.slice(0, 100)}`);
    
    return lines.join("\n");
  }
  
  if (format === "full") {
    const sections: string[] = [
      `<details>`,
      `<summary>📍 Conversation Recap (turn ${state.turnCount})</summary>`,
      ``,
      `**Original request:** ${state.originalRequest}`,
      ``,
    ];
    
    if (state.decisions.length > 0) {
      sections.push(`**Key decisions:**`);
      for (const d of state.decisions.slice(-5)) {
        sections.push(`- Turn ${d.turn}: ${d.description}`);
      }
      sections.push("");
    }
    
    if (state.recentActions.length > 0) {
      sections.push(`**Recent actions:**`);
      for (const a of state.recentActions.slice(-3)) {
        sections.push(`- ${a}`);
      }
      sections.push("");
    }
    
    sections.push(`**Current focus:** ${state.currentFocus}`);
    sections.push(``, `</details>`, ``);
    
    return sections.join("\n");
  }
  
  if (format === "decisions") {
    if (state.decisions.length === 0) return "";
    
    return [
      `<details>`,
      `<summary>📋 Decisions made so far (${state.decisions.length})</summary>`,
      ``,
      ...state.decisions.map((d, i) => `${i + 1}. **Turn ${d.turn}:** ${d.description}`),
      ``,
      `</details>`,
      ``,
    ].join("\n");
  }
  
  return "";
}
```

### Step 4: Agent prompt injection

The recap can be generated in two ways:

**Approach A: Pre-computed recap (injected before the agent runs)**

In `GITCLAW-AGENT.ts`:

```typescript
import { buildConversationState, generateRecap, saveConversationState, loadConversationState } from "./GITCLAW-RECAP";

const recapConfig = loadRecapConfig(gitclawDir);

if (recapConfig.enabled && mode === "resume" && sessionPath) {
  const convState = buildConversationState(sessionPath, issueNumber, prompt);
  
  if (convState.turnCount >= recapConfig.turnThreshold) {
    // Option 1: Inject recap instruction into the prompt
    prompt = [
      `[SYSTEM: Before responding, include a brief orientation recap at the top of your response.`,
      `The conversation is at turn ${convState.turnCount}.`,
      `Original request: "${convState.originalRequest}"`,
      convState.decisions.length > 0
        ? `Key decisions: ${convState.decisions.map(d => d.description).join("; ")}`
        : "",
      `Recent actions: ${convState.recentActions.slice(-3).join("; ")}`,
      `Format the recap as 3-5 bullet points under a "📍 Where we are" header. Keep it under 100 words. Then respond to the user's message normally.]`,
      "",
      prompt,
    ].filter(Boolean).join("\n");
  }
  
  saveConversationState(stateDir, convState);
}
```

**Approach B: Post-computed recap (prepended after the agent responds)**

```typescript
// After extracting agentText:
if (recapConfig.enabled && convState && convState.turnCount >= recapConfig.turnThreshold) {
  const recap = generateRecap(convState, recapConfig.format);
  if (recap) {
    agentText = recap + "\n\n---\n\n" + agentText;
  }
}
```

**Approach A is preferred** because the agent generates the recap with awareness of the full conversation context, producing a more accurate and natural summary. Approach B is the fallback for cases where prompt injection is undesirable.

### Step 5: Configuration

Add to `.GITCLAW/recap.json`:

```json
{
  "enabled": true,
  "turnThreshold": 5,
  "format": "short",
  "showDecisions": true,
  "collapsible": false,
  "maxRecapTokens": 200
}
```

| Setting | Effect |
|---|---|
| `turnThreshold` | Don't show recaps until this many turns |
| `format` | `"short"` (3-5 lines), `"full"` (collapsible detail), `"decisions"` (decision list only) |
| `collapsible` | If true, wrap in `<details>` tag (saves space but email-unfriendly) |
| `maxRecapTokens` | Hard cap on recap length |

### Step 6: Test

- Have a 3-turn conversation → verify no recap appears (below threshold)
- Have a 6-turn conversation → verify recap appears at turn 6
- Make a decision at turn 3, check recap at turn 7 → verify decision is captured
- Have the agent perform actions → verify recent actions appear in recap
- Return to a conversation after a gap → verify recap accurately reflects the state
- Test with `format: "full"` → verify collapsible details section
- Test with `format: "decisions"` → verify decision list only
- Have a 30-turn conversation with topic changes → verify recap tracks the evolution
- Verify recap doesn't repeat verbatim from previous recap

## Design Decisions

**Why inject into the prompt (Approach A) instead of prepending heuristically?** The agent generates better recaps than heuristic extraction because it has the full conversation in context. It can synthesize, prioritize, and phrase naturally. Heuristic extraction (Approach B) catches keywords but misses nuance. The injected instruction asks the agent to spend ~50 tokens on orientation before responding — a negligible cost for significant UX value.

**Why track decisions explicitly instead of just summarizing?** Decisions are the most important conversational artifact. A conversation might wander through analysis, speculation, and exploration — but the *decisions* are what determine the project's direction. Explicit decision tracking ensures they're never lost in a recap, even when other details are trimmed.

**Why default to short format?** Long recaps become noise. A 5-line recap that's always visible is more useful than a 20-line recap that users skip. The full format exists for complex conversations where more detail is needed, but the default respects the user's attention.

**Why a turn threshold instead of always showing recaps?** On turn 1, a recap saying "We just started" is pointless. On turn 3, the conversation is still fresh in the user's mind. By turn 5+, the recap adds genuine value — there's enough history to summarize and enough distance that the user might have forgotten earlier context.

**Why collapsible is false by default?** Feature 20 (Notification Intelligence) reveals that `<details>` tags don't render well in email clients — the content becomes invisible. Since many users read agent responses as notification emails, defaulting to visible (non-collapsible) ensures the recap is always readable regardless of the medium.
