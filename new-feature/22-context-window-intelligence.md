# Feature: Context Window Intelligence

## Summary

Implement intelligent token budgeting and context management across the agent's entire information pipeline. Today, every session grows unboundedly — the largest session in this repo is already 1MB (818KB JSONL). Claude's context window is large but finite, and stuffing it with stale conversation turns degrades response quality. This feature adds: (1) session-aware token estimation so the agent knows how full its context is, (2) priority-based context loading that keeps the most relevant turns and summarizes the rest, (3) strategic injection of external context (KB articles, cross-issue results, skills) within a fixed token budget, and (4) real-time context pressure reporting so the user knows when the conversation is getting too long. This is the invisible infrastructure that determines how much the agent can *think about* at once — and getting it right makes every other feature work better.

## Why This Feature — The Deep Reasoning

### 1. The Largest Session Is Already 1MB and Growing

```
2026-02-22T03-27-07-838Z_ebeb1cf7.jsonl: 818,440 bytes, 119 lines, 303 assistant blocks
2026-02-20T12-59-41-491Z_4a0fa61d.jsonl: 408,278 bytes, 86 lines, 309 assistant blocks
2026-02-20T11-44-20-711Z_b1f6c294.jsonl: 214,195 bytes, 62 lines, 125 assistant blocks
```

The first session is 818KB of JSONL. That's approximately 200K tokens. Claude Opus has a 200K context window. This session is *already at capacity*. Every new turn pushes old turns out of the effective context, and the model's attention quality degrades as the window fills. Without management, the agent becomes progressively dumber within a single issue conversation.

### 2. Context Is a Zero-Sum Budget

The context window is a fixed resource. Every token spent on one thing is a token not available for another:
- **Session history**: previous conversation turns (grows unboundedly)
- **System prompt**: APPEND_SYSTEM.md, AGENTS.md, skills (fixed ~5-10K tokens)
- **User prompt**: the current request (variable, usually 100-2000 tokens)
- **KB articles** (feature 17): curated knowledge (0-5K tokens)
- **Cross-issue results** (feature 08): search results (0-5K tokens)
- **Tool results**: file contents, command outputs (grows with tool use)

Without budgeting, session history consumes the entire window, leaving no room for anything else. With budgeting, each category gets an allocation proportional to its value for the current turn.

### 3. Not All History Is Equally Valuable

A 50-turn conversation about refactoring a module has vastly different information density across turns:
- Turn 1: "Refactor the auth module" — **high value** (defines the task)
- Turn 5: "Here's the current code" (tool result: 3K tokens) — **medium value** (context)
- Turn 15: "I've updated the imports" — **low value** (superseded by later changes)
- Turn 30: "Actually, let's also add error handling" — **high value** (new instruction)
- Turn 45: intermediate tool calls — **low value** (the results are what matter, not the calls)
- Turn 50: the current state of the refactored file — **high value** (current reality)

A naive approach sends all 50 turns. A smart approach keeps turns 1, 30, 50 in full, summarizes turns 2-29 and 31-49, and drops tool call boilerplate entirely. Same effective knowledge, 80% fewer tokens.

### 4. It's the Foundation for Multi-Source Context

Features 08 (cross-issue search), 10 (personas), 17 (knowledge base), and 15 (skills) all inject additional context into the agent's prompt. Without budgeting, adding these features *makes the agent worse* by crowding the context window. With budgeting, each source gets a fair allocation and the total stays within bounds:

```
200K context window budget:
├── System prompt + skills:   10K  (5%)
├── Knowledge base articles:   5K  (2.5%)
├── Cross-issue context:       5K  (2.5%)
├── Session summary (old):    20K  (10%)
├── Session recent (last 10): 60K  (30%)
├── Current prompt:            5K  (2.5%)
└── Reserved for response:   95K  (47.5%)
```

### 5. Quality Degrades Silently Without Monitoring

When the context is 30% full, responses are sharp and focused. When it's 95% full, the model starts "forgetting" things mentioned earlier, repeating itself, and making inconsistent decisions. There's no error — the quality just drops. Without monitoring, nobody notices until the agent starts contradicting itself. Context pressure reporting makes this visible.

## Scope

### In Scope
- **Token estimation**: Fast, accurate token counting for sessions and prompts
- **Session trimming**: Compress old turns while preserving recent ones and key decisions
- **Context budget allocation**: Configurable budget for each context source
- **Priority-based loading**: Rank session turns by relevance and recency
- **Context pressure indicator**: Report context usage in issue comments
- **Smart summarization**: Use the LLM (or heuristics) to summarize old turns
- **Tool result compression**: Replace large tool outputs with summaries

### Out of Scope
- Changing the model's context window size (that's a provider/model choice)
- Conversation splitting (starting a new issue for long conversations)
- RAG-style retrieval over sessions (full semantic search over all turns)

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Token estimator** | Fast tiktoken-style estimation | ~1.5 hours |
| **Session trimmer** | Compress old turns, preserve recent | ~2.5 hours |
| **Context budget manager** | Allocate tokens across sources | ~2 hours |
| **Turn priority scorer** | Score turns by relevance/recency/type | ~1.5 hours |
| **Tool result compressor** | Summarize large tool outputs | ~1 hour |
| **Context pressure reporter** | Visual indicator in comments | ~30 min |
| **Agent orchestrator integration** | Apply trimming before running pi | ~1.5 hours |
| **Configuration** (`context.json`) | Budget allocations, thresholds | ~30 min |
| **Docs** | Document context management | ~30 min |
| **Testing** | Test estimation accuracy, trimming quality | ~1.5 hours |

**Total: ~13 hours.**

---

## AI Implementation Instructions

### Step 1: Token estimator

**New file:** `.GITCLAW/lifecycle/GITCLAW-CONTEXT.ts`

Fast token estimation without loading a full tokenizer:

```typescript
// Approximate token counting — avoids loading tiktoken (heavy dependency)
// Claude tokenization: ~4 characters per token for English, ~3.5 for code
export function estimateTokens(text: string): number {
  if (!text) return 0;
  
  // Count code blocks separately (more tokens per character)
  const codeBlockPattern = /```[\s\S]*?```/g;
  let codeTokens = 0;
  let nonCodeText = text;
  
  const codeBlocks = text.match(codeBlockPattern) || [];
  for (const block of codeBlocks) {
    codeTokens += Math.ceil(block.length / 3.5);
    nonCodeText = nonCodeText.replace(block, "");
  }
  
  // Non-code text
  const textTokens = Math.ceil(nonCodeText.length / 4);
  
  return textTokens + codeTokens;
}

export function estimateSessionTokens(sessionPath: string): {
  total: number;
  byRole: Record<string, number>;
  byType: Record<string, number>;
  turnCount: number;
} {
  const lines = readFileSync(sessionPath, "utf-8").split("\n").filter(Boolean);
  let total = 0;
  const byRole: Record<string, number> = {};
  const byType: Record<string, number> = { text: 0, toolCall: 0, toolResult: 0, thinking: 0 };
  let turnCount = 0;
  
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      const role = event.message?.role || "system";
      const content = event.message?.content || [];
      
      if (role === "user") turnCount++;
      
      for (const block of content) {
        let tokens = 0;
        if (block.type === "text") {
          tokens = estimateTokens(block.text || "");
          byType.text += tokens;
        } else if (block.type === "toolCall") {
          tokens = estimateTokens(JSON.stringify(block.arguments || {}));
          byType.toolCall += tokens;
        } else if (block.type === "toolResult") {
          tokens = estimateTokens(block.content || "");
          byType.toolResult += tokens;
        } else if (block.type === "thinking") {
          tokens = estimateTokens(block.text || "");
          byType.thinking += tokens;
        }
        
        byRole[role] = (byRole[role] || 0) + tokens;
        total += tokens;
      }
    } catch (e) { /* skip malformed lines */ }
  }
  
  return { total, byRole, byType, turnCount };
}
```

### Step 2: Context budget manager

```typescript
export interface ContextBudget {
  totalTokens: number;                // model's context window
  allocations: {
    systemPrompt: number;             // percentage
    skills: number;
    knowledgeBase: number;
    crossIssue: number;
    sessionSummary: number;           // compressed old turns
    sessionRecent: number;            // full recent turns
    currentPrompt: number;
    reservedForResponse: number;      // must be large enough for a quality response
  };
}

const DEFAULT_BUDGET: ContextBudget = {
  totalTokens: 200000,   // Claude Opus
  allocations: {
    systemPrompt: 5,      // 10K
    skills: 3,             // 6K
    knowledgeBase: 3,      // 6K
    crossIssue: 2,         // 4K
    sessionSummary: 10,    // 20K
    sessionRecent: 30,     // 60K
    currentPrompt: 2,      // 4K
    reservedForResponse: 45, // 90K
  },
};

export function calculateBudgets(config: ContextBudget): Record<string, number> {
  const budgets: Record<string, number> = {};
  for (const [key, pct] of Object.entries(config.allocations)) {
    budgets[key] = Math.floor(config.totalTokens * pct / 100);
  }
  return budgets;
}
```

### Step 3: Turn priority scorer

```typescript
export interface ScoredTurn {
  index: number;           // position in conversation
  role: string;
  tokens: number;
  priority: number;        // 0-100, higher = more important to keep
  content: string;         // raw text content
  type: "instruction" | "analysis" | "tool-use" | "response" | "clarification";
}

export function scoreTurns(sessionPath: string): ScoredTurn[] {
  const lines = readFileSync(sessionPath, "utf-8").split("\n").filter(Boolean);
  const turns: ScoredTurn[] = [];
  let index = 0;
  
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (!event.message?.content) continue;
      
      const role = event.message.role;
      const textBlocks = event.message.content.filter((b: any) => b.type === "text");
      const toolBlocks = event.message.content.filter((b: any) => 
        b.type === "toolCall" || b.type === "toolResult");
      
      const content = textBlocks.map((b: any) => b.text || "").join("\n");
      const tokens = estimateTokens(line);
      
      // Score based on multiple factors:
      let priority = 50; // base score
      
      // Recency: recent turns are more important
      // (will be adjusted after all turns are scored)
      
      // Role: user messages (instructions) are more important than assistant thinking
      if (role === "user") priority += 15;
      
      // Content signals:
      if (/(?:please|could you|I want|let's|we should|change|update|fix|add|remove|create|delete)/i.test(content)) {
        priority += 10; // instruction-bearing turn
      }
      if (/(?:decided|conclusion|result|summary|answer|the .+ is)/i.test(content)) {
        priority += 10; // conclusion-bearing turn
      }
      if (toolBlocks.length > 3 && textBlocks.length === 0) {
        priority -= 20; // pure tool call chain — low information density
      }
      
      // First and last turns are always important
      // (first = original context, last = current state)
      
      turns.push({
        index: index++,
        role,
        tokens,
        priority,
        content: content.slice(0, 500),
        type: role === "user" ? "instruction" : toolBlocks.length > 0 ? "tool-use" : "response",
      });
    } catch (e) { /* skip */ }
  }
  
  // Adjust for recency
  const totalTurns = turns.length;
  for (const turn of turns) {
    const recencyBonus = Math.floor((turn.index / totalTurns) * 30); // 0-30
    turn.priority += recencyBonus;
    
    // First turn always high priority
    if (turn.index === 0) turn.priority = Math.max(turn.priority, 90);
    // Last 5 turns always high priority
    if (turn.index >= totalTurns - 5) turn.priority = Math.max(turn.priority, 85);
  }
  
  // Cap at 100
  for (const turn of turns) {
    turn.priority = Math.min(100, turn.priority);
  }
  
  return turns;
}
```

### Step 4: Session trimmer

```typescript
export interface TrimmedSession {
  summary: string;           // summary of compressed turns
  recentTurns: string[];     // full content of high-priority turns
  totalOriginalTokens: number;
  totalTrimmedTokens: number;
  compressionRatio: number;
}

export async function trimSession(
  sessionPath: string,
  budgets: { summaryBudget: number; recentBudget: number },
  useLLM: boolean = false
): Promise<TrimmedSession> {
  const scored = scoreTurns(sessionPath);
  const totalOriginalTokens = scored.reduce((sum, t) => sum + t.tokens, 0);
  
  // Sort by priority (descending) for selection
  const sorted = [...scored].sort((a, b) => b.priority - a.priority);
  
  // Select recent turns (high priority) up to the recent budget
  let recentTokens = 0;
  const recentTurns: string[] = [];
  const summarizedIndices = new Set<number>();
  
  // Always include the last 5 turns verbatim
  const lastFive = scored.slice(-5);
  for (const turn of lastFive) {
    recentTurns.push(turn.content);
    recentTokens += turn.tokens;
  }
  
  // Fill remaining budget with highest-priority earlier turns
  for (const turn of sorted) {
    if (turn.index >= scored.length - 5) continue; // already included
    if (recentTokens >= budgets.recentBudget) break;
    
    if (turn.priority >= 70) {
      recentTurns.push(turn.content);
      recentTokens += turn.tokens;
    } else {
      summarizedIndices.add(turn.index);
    }
  }
  
  // Summarize the compressed turns
  const turnsToSummarize = scored.filter(t => 
    summarizedIndices.has(t.index) || (t.priority < 70 && t.index < scored.length - 5)
  );
  
  let summary: string;
  
  if (useLLM && turnsToSummarize.length > 5) {
    // LLM-powered summarization (more expensive, higher quality)
    summary = await llmSummarize(turnsToSummarize);
  } else {
    // Heuristic summarization
    summary = heuristicSummarize(turnsToSummarize);
  }
  
  // Ensure summary fits in budget
  const summaryTokens = estimateTokens(summary);
  if (summaryTokens > budgets.summaryBudget) {
    // Truncate summary to budget
    const ratio = budgets.summaryBudget / summaryTokens;
    summary = summary.slice(0, Math.floor(summary.length * ratio));
  }
  
  return {
    summary,
    recentTurns,
    totalOriginalTokens,
    totalTrimmedTokens: recentTokens + estimateTokens(summary),
    compressionRatio: 1 - ((recentTokens + estimateTokens(summary)) / totalOriginalTokens),
  };
}

function heuristicSummarize(turns: ScoredTurn[]): string {
  if (turns.length === 0) return "";
  
  // Extract key sentences from each turn
  const summaryParts: string[] = [];
  
  for (const turn of turns) {
    // Take the first sentence of each turn as a summary
    const firstSentence = turn.content.match(/^[^.!?\n]+[.!?]?/)?.[0];
    if (firstSentence && firstSentence.length > 10) {
      const rolePrefix = turn.role === "user" ? "User" : "Agent";
      summaryParts.push(`[${rolePrefix}] ${firstSentence.trim()}`);
    }
  }
  
  return [
    "[Earlier conversation summary — compressed to save context]",
    ...summaryParts.slice(0, 30), // max 30 summary lines
  ].join("\n");
}
```

### Step 5: Tool result compressor

Large tool results (file reads, command outputs) consume enormous context. Compress them:

```typescript
export function compressToolResults(sessionLines: string[]): string[] {
  return sessionLines.map(line => {
    try {
      const event = JSON.parse(line);
      if (!event.message?.content) return line;
      
      const compressed = event.message.content.map((block: any) => {
        if (block.type === "toolResult") {
          const content = block.content || "";
          const tokens = estimateTokens(content);
          
          if (tokens > 2000) {
            // Compress large tool results
            const lines = content.split("\n");
            const head = lines.slice(0, 10).join("\n");
            const tail = lines.slice(-10).join("\n");
            return {
              ...block,
              content: `${head}\n\n[... ${lines.length - 20} lines compressed (${tokens} tokens) ...]\n\n${tail}`,
            };
          }
        }
        return block;
      });
      
      return JSON.stringify({ ...event, message: { ...event.message, content: compressed } });
    } catch (e) {
      return line;
    }
  });
}
```

### Step 6: Context pressure reporter

Add a context usage indicator to the agent's response:

```typescript
export function formatContextPressure(
  sessionTokens: number,
  contextWindow: number
): string {
  const usage = sessionTokens / contextWindow;
  const pct = Math.round(usage * 100);
  
  if (pct < 30) return ""; // Don't show when low
  
  const bar = "█".repeat(Math.floor(pct / 5)) + "░".repeat(20 - Math.floor(pct / 5));
  
  let warning = "";
  if (pct > 80) {
    warning = "\n⚠️ Context is nearly full. Consider starting a new issue for fresh context, or I'll start compressing older conversation turns.";
  } else if (pct > 60) {
    warning = "\nℹ️ Older conversation turns are being summarized to preserve context quality.";
  }
  
  return `\n\n<sub>📊 Context: ${bar} ${pct}%${warning}</sub>`;
}
```

### Step 7: Integrate into agent orchestrator

In `GITCLAW-AGENT.ts`, before running `pi`:

```typescript
import { estimateSessionTokens, calculateBudgets, trimSession, formatContextPressure } from "./GITCLAW-CONTEXT";

// After session resolution, before running pi:
if (mode === "resume" && sessionPath) {
  const sessionStats = estimateSessionTokens(sessionPath);
  const contextConfig = loadContextConfig(gitclawDir);
  const budgets = calculateBudgets(contextConfig);
  
  console.log(`Session tokens: ~${sessionStats.total} (${Math.round(sessionStats.total / contextConfig.totalTokens * 100)}% of context)`);
  
  // If session exceeds the combined recent+summary budget, trim it
  const sessionBudget = budgets.sessionRecent + budgets.sessionSummary;
  
  if (sessionStats.total > sessionBudget) {
    console.log(`Session exceeds budget (${sessionStats.total} > ${sessionBudget}). Trimming...`);
    
    const trimmed = await trimSession(sessionPath, {
      summaryBudget: budgets.sessionSummary,
      recentBudget: budgets.sessionRecent,
    });
    
    console.log(`Trimmed: ${trimmed.totalOriginalTokens} → ${trimmed.totalTrimmedTokens} tokens (${Math.round(trimmed.compressionRatio * 100)}% compression)`);
    
    // Write trimmed session to a temp file for this run
    const trimmedPath = `/tmp/trimmed-session.jsonl`;
    // ... write trimmed session in JSONL format ...
    
    // Use trimmed session instead of original
    sessionPath = trimmedPath;
  }
  
  // Track context pressure for the response footer
  contextPressure = formatContextPressure(sessionStats.total, contextConfig.totalTokens);
}

// After agent response, append pressure indicator:
if (contextPressure) {
  agentText += contextPressure;
}
```

### Step 8: Configuration

**New file:** `.GITCLAW/context.json`

```json
{
  "totalTokens": 200000,
  "allocations": {
    "systemPrompt": 5,
    "skills": 3,
    "knowledgeBase": 3,
    "crossIssue": 2,
    "sessionSummary": 10,
    "sessionRecent": 30,
    "currentPrompt": 2,
    "reservedForResponse": 45
  },
  "compressionThreshold": 0.6,
  "showPressureAbove": 0.3,
  "useLLMSummarization": false
}
```

### Step 9: Test

- Create a long conversation (20+ turns) and verify token estimation
- Verify session trimming preserves the first turn and last 5 turns
- Verify tool results >2000 tokens are compressed
- Verify context pressure indicator appears when usage >30%
- Verify the agent still functions correctly with trimmed sessions
- Benchmark: compare response quality with and without trimming on a 50-turn conversation

## Design Decisions

**Why approximate token counting instead of exact?** Loading tiktoken or a model-specific tokenizer adds a heavy dependency and initialization time. The 4-chars-per-token approximation is within 10% accuracy for English text and code — good enough for budgeting decisions. Exact counting would cost more runtime than it saves in context precision.

**Why priority-based trimming instead of simple truncation?** Simple truncation (drop the oldest N turns) loses the original context that defines the task. Priority scoring keeps the first turn (task definition), recent turns (current state), and instruction-bearing turns (directional changes) while compressing intermediate tool calls and superseded analysis. The conversation's *intent* is preserved even when its *history* is compressed.

**Why reserve 45% for response?** The agent needs room to think. If the context window is 95% full of input, the model can only generate a short response — no room for extended reasoning, tool planning, or detailed analysis. 45% reservation ensures the agent always has ample space for high-quality output, even on complex tasks.

**Why report context pressure to the user?** Transparency. When the agent starts summarizing old turns, the user should know. They can choose to start a new issue (fresh context) or continue knowing that older context is compressed. Without reporting, the user doesn't understand why the agent "forgot" something discussed 30 turns ago.
