# Feature: Cross-Issue Context Search

## Summary

Give the agent the ability to search and reference conversations from other issues when working on the current one. When a user says "remember what we decided in #42" or the agent encounters a problem it suspects was discussed before, it can query the session archive across all issues — not just the current one. This transforms the agent's memory from linear-per-issue to a searchable knowledge graph spanning the entire repository's conversational history.

## Why This Feature — The Deep Reasoning

**1. The current memory model has an isolation problem that gets worse as it succeeds.**

GitClaw's brilliant insight is `issue #N → session`. But this means every conversation is a silo. Issue #42 might contain a 20-turn debugging session where you and the agent figured out a critical race condition in the auth module. When you open issue #45 about a related problem, the agent has *zero* knowledge of that prior investigation. It starts from scratch. You end up repeating context, re-explaining decisions, re-discovering the same code paths.

The more you use GitClaw, the more knowledge is trapped in isolated sessions. The agent gets *collectively dumber* as it accumulates *individually smart* conversations. This is the opposite of what should happen.

**2. The data already exists — it's just not queryable across sessions.**

All sessions are JSONL files in `state/sessions/`. All issue mappings are in `state/issues/`. The raw conversational data — decisions, investigations, code references, user preferences — is already committed to git. The agent just can't *see* across session boundaries. This feature doesn't require new data collection; it requires a new *access pattern*.

**3. It's what makes the "institutional memory" vision real.**

The Idea doc says: "When you fork the repo, you fork the agent's mind." But right now, the agent's "mind" is more like a filing cabinet of separate folders. Cross-issue search turns it into an actual knowledge base — where decisions reference their reasons, investigations build on prior art, and nothing discovered once needs to be discovered again.

**4. It enables genuine multi-issue reasoning.**

Consider: "We discussed three different caching strategies across issues #30, #35, and #42. Summarize what we decided and why." Today, this is impossible without the user manually copying content from three issue threads. With cross-issue search, the agent can find all three sessions, extract the relevant discussions, and synthesize a coherent answer.

**5. It's the prerequisite for the agent to become a team member rather than a tool.**

A team member who remembers nothing from yesterday's meetings is useless, no matter how smart they are in the moment. Cross-issue context is the difference between "a smart tool you use per-issue" and "a team member who accumulates institutional knowledge."

## Scope

### In Scope
- A `search-sessions` tool/capability the agent can use to search across all session transcripts
- An `issue-context` tool that loads the summary or full conversation from a specific issue number
- Automatic cross-reference detection: when the agent sees `#42` in a prompt, it proactively pulls context from issue 42's session
- A session index file (`state/session-index.json`) that maps keywords, issue numbers, and summaries for fast search
- Index is updated on every session commit

### Out of Scope
- Semantic/embedding-based search (too heavy for Actions; use grep + jq for now)
- Cross-repo session search
- Automatic cross-issue linking (the agent references them, doesn't create GitHub cross-links)
- Full-text indexing service

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Session index builder** (new `GITCLAW-INDEX.ts`) | Scan sessions, extract summaries and keywords, build index | ~2 hours |
| **Search tool** | Grep-based search across sessions with result formatting | ~1.5 hours |
| **Issue context loader** | Load a specific issue's session and extract key content | ~1 hour |
| **Auto-reference detection** | Parse prompts for `#N` patterns and inject context | ~1 hour |
| **Agent orchestrator** | Integrate index update into commit pipeline, inject cross-issue context | ~1.5 hours |
| **Skill** | Create a `cross-reference` skill that teaches the agent when/how to search | ~1 hour |
| **Docs** | Document the cross-issue capability | ~30 min |
| **Testing** | Test search, test auto-reference, test with long histories | ~1.5 hours |

**Total: ~10 hours.** The complexity here is in making the search fast and relevant on a GitHub Actions runner with no persistent services — everything must be file-based and complete within seconds.

---

## AI Implementation Instructions

### Step 1: Create the session index

**New file:** `.GITCLAW/lifecycle/GITCLAW-INDEX.ts`

The index is a JSON file that provides fast lookup across all sessions without reading every JSONL file on every query.

```typescript
export interface SessionIndexEntry {
  issueNumber: number;
  sessionPath: string;
  title: string;           // issue title (from first user message or mapping)
  createdAt: string;
  lastUpdatedAt: string;
  turnCount: number;
  summary: string;         // first 500 chars of the first assistant response
  keywords: string[];      // extracted from user messages
  filesDiscussed: string[];// file paths mentioned in tool calls
  decisions: string[];     // lines containing "decided", "agreed", "conclusion", etc.
}

export interface SessionIndex {
  version: 1;
  lastUpdated: string;
  entries: Record<number, SessionIndexEntry>;  // keyed by issue number
}
```

**`buildIndex()` function:**

1. Read all files in `state/issues/`. For each `<N>.json`:
   - Parse the mapping to get the session path.
   - If the session file exists, parse it.
2. For each session JSONL file:
   - Extract the first user message text → use as `title` (or a truncated version).
   - Extract the first assistant response text → use first 500 chars as `summary`.
   - Count message pairs → `turnCount`.
   - Extract all file paths from `toolCall` blocks (read, edit, write tools) → `filesDiscussed`.
   - Extract all words from user messages, filter stopwords, take top 20 → `keywords`.
   - Search assistant messages for decision-indicator phrases ("we decided", "the conclusion is", "agreed on", "chose", "going with", "selected") → extract those sentences as `decisions`.
   - Record timestamps from first and last JSONL entries.
3. Write the index to `state/session-index.json`.

**`updateIndex(issueNumber, sessionPath)` function:**

Instead of rebuilding the entire index, update only the entry for the given issue number. Read the existing index, replace or add the entry, write back. This is called after every agent run.

### Step 2: Create the search functions

**In `GITCLAW-INDEX.ts`:**

```typescript
export function searchIndex(query: string, index: SessionIndex): SearchResult[]
export function getIssueContext(issueNumber: number, index: SessionIndex): string | null
```

**`searchIndex`:**
- Tokenize the query into words.
- For each index entry, score it by:
  - Exact match in keywords (weight: 3)
  - Match in title (weight: 5)
  - Match in summary (weight: 2)
  - Match in decisions (weight: 4)
  - Match in filesDiscussed (weight: 3)
- Return entries sorted by score, top 10.
- Format results as:
  ```
  Issue #42 (score: 12) — "Authentication refactoring discussion"
  Summary: We discussed migrating from JWT to session-based auth...
  Decisions: Decided to keep JWT for API clients but use sessions for web UI.
  Files: auth/jwt.ts, auth/session.ts, middleware/auth.ts
  ```

**`getIssueContext`:**
- Look up the issue in the index.
- If found, read the actual session JSONL file.
- Extract all user messages and assistant text responses (skip tool calls and thinking blocks).
- Format as a condensed conversation transcript, truncated to 5000 characters.
- Prepend the index entry's summary and decisions.

### Step 3: Detect `#N` references in prompts and inject context

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts`

After constructing the `prompt` variable, scan it for issue references:

```typescript
import { loadIndex, getIssueContext } from "./GITCLAW-INDEX";

// Detect issue references like #42, #100, etc.
const issueRefs = [...prompt.matchAll(/#(\d+)/g)].map(m => parseInt(m[1]));

// Filter out the current issue and deduplicate
const crossRefs = [...new Set(issueRefs.filter(n => n !== issueNumber))];

if (crossRefs.length > 0) {
  const indexPath = resolve(stateDir, "session-index.json");
  if (existsSync(indexPath)) {
    const index = JSON.parse(readFileSync(indexPath, "utf-8"));
    
    let contextBlock = "\n\n---\n**Cross-referenced issue context:**\n\n";
    for (const ref of crossRefs.slice(0, 3)) {  // max 3 cross-refs to limit context size
      const ctx = getIssueContext(ref, index);
      if (ctx) {
        contextBlock += `### Issue #${ref}\n${ctx}\n\n`;
      } else {
        contextBlock += `### Issue #${ref}\n_No session data found for this issue._\n\n`;
      }
    }
    contextBlock += "---\n";
    
    // Append cross-reference context to the prompt
    prompt = prompt + contextBlock;
  }
}
```

**Limit to 3 cross-references** to prevent the context from exploding. Each reference adds up to 5000 chars, so max 15K chars of cross-reference context — significant but manageable.

### Step 4: Create a cross-reference skill

**New file:** `.GITCLAW/.pi/skills/cross-reference/SKILL.md`

```markdown
---
name: cross-reference
description: Search and reference conversations from other issues. Use when the user asks about prior discussions, references other issue numbers, says "remember when we...", asks "what did we decide about...", or when you need context from a previous investigation. Also use proactively when you suspect a topic was discussed before.
---

# Cross-Reference

You have access to a session index that tracks all past conversations across issues.

## When to Search

- User explicitly references another issue (#42, "in that other issue", "we talked about this before")
- User asks about a prior decision ("what did we decide about caching?")
- You encounter a topic that seems like it was discussed before
- User asks for a summary across multiple conversations

## How to Search

The session index is at `state/session-index.json`. Read it to find relevant past conversations.

```bash
# Search the index for keywords
jq '.entries[] | select(.keywords[] | test("caching|cache"; "i")) | {issueNumber, title, summary, decisions}' .GITCLAW/state/session-index.json

# Search full session transcripts for specific terms
rg -i "race condition" .GITCLAW/state/sessions/ --json | head -20

# Get a specific issue's conversation
jq -r 'select(.message.role == "user" or .message.role == "assistant") | .message.content[]? | select(.type == "text") | .text' .GITCLAW/state/sessions/<session-file>.jsonl | head -100
```

## How to Present Cross-References

When referencing prior conversations:
1. Cite the issue number: "In issue #42, we discussed..."
2. Summarize the relevant finding, don't dump raw transcripts
3. Note if the prior context might be outdated
4. Link the issues conceptually: "This relates to the decision in #42 because..."

## Proactive Search

Before diving into a complex topic, quickly check if it's been discussed:

```bash
rg -i -l "topic keywords" .GITCLAW/state/sessions/
```

If you find relevant prior conversations, mention them upfront: "I found that we discussed this in issue #42. Here's what was established..."
```

### Step 5: Update the index after every agent run

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts`

After determining the latest session and saving the mapping, update the index:

```typescript
import { updateIndex } from "./GITCLAW-INDEX";

// After saving the issue mapping:
if (latestSession) {
  try {
    updateIndex(issueNumber, latestSession, title, stateDir);
  } catch (e) {
    console.error("Failed to update session index:", e);
    // Non-fatal — the index is a convenience, not a dependency
  }
}
```

The updated index is included in the `git add -A` and committed with the rest of the state changes.

### Step 6: Bootstrap the index for existing sessions

**New script:** `.GITCLAW/lifecycle/GITCLAW-INDEX-REBUILD.ts`

A one-time script that rebuilds the entire index from scratch:

```typescript
import { buildIndex } from "./GITCLAW-INDEX";

const stateDir = resolve(import.meta.dir, "..", "state");
buildIndex(stateDir);
console.log("Session index rebuilt");
```

Run with: `bun .GITCLAW/lifecycle/GITCLAW-INDEX-REBUILD.ts`

This is needed for repos with existing sessions that predate the index feature. Document it in the migration guide.

### Step 7: Handle large session histories efficiently

For repos with hundreds of issues and sessions:

- The index file stays small (each entry is ~500 bytes, so 1000 issues ≈ 500KB).
- Index lookups are O(n) scans through the entries object — fast enough for <10K issues.
- Full session search (`rg` across session files) is the fallback for queries not captured by the index. `rg` is fast enough for tens of MB of session data.
- If performance becomes an issue, the index can be split into per-month shards or a SQLite database can be introduced (but don't over-engineer this — file-based search works well for the expected scale).

### Step 8: Update documentation

**New file:** `.GITCLAW/docs/GITCLAW-Cross-References.md`
- Explain the session index and how it's built
- Document how the agent uses cross-issue context
- Show examples of cross-reference queries
- Document the `#N` auto-detection behavior

**File:** `.GITCLAW/README.md`
- Add "Cross-Issue Memory" to the capabilities table
- Note that the agent can reference prior conversations across issues

### Step 9: Test

- Create issue #A, have a conversation about a design decision (e.g., "We should use PostgreSQL for the session store").
- Create issue #B, ask "What database did we choose in #A?"
  1. Verify the agent detects the `#A` reference.
  2. Verify it injects context from issue A's session.
  3. Verify the agent's response references the PostgreSQL decision.
- Create issue #C, ask "Search all past conversations for mentions of authentication."
  1. Verify the agent uses the cross-reference skill to search sessions.
  2. Verify it finds and cites relevant discussions.
- Verify the session index is updated after each run:
  1. Check `state/session-index.json` exists and contains entries.
  2. Verify new issues appear in the index after their first interaction.
- Test with a large number of sessions (create 20+ test issues):
  1. Verify index building completes in under 5 seconds.
  2. Verify search returns relevant results.

## Design Decisions

**Why a JSON index instead of a database?** Git-native. The index is a file that gets committed, diffed, and audited like everything else. No SQLite binaries, no database setup, no migration scripts. When someone forks the repo, they get the index too.

**Why grep + jq instead of embeddings/vector search?** Embeddings require either a local model (heavy, slow on Actions runners) or an API call (adds cost and latency to every search). Keyword-based search over structured index entries works well for the expected scale (hundreds to low thousands of issues). It's fast, free, deterministic, and debuggable. If a repo grows to 10K+ issues, vector search can be layered on top of this foundation.

**Why auto-detect `#N` references?** It's the most natural way users reference other issues — they already do it in regular GitHub conversations. Detecting and injecting context automatically means the user doesn't need to learn a special command. It "just works."

**Why limit to 3 cross-references?** Each cross-reference adds up to 5000 characters of context to the prompt. Three references = 15K extra characters = ~4K tokens. Beyond that, the added context starts to dilute the agent's attention on the current task. Users who need more can ask the agent to search explicitly.

**Why is the index non-fatal?** The index is a performance optimization, not a correctness requirement. The agent can always fall back to `rg` across session files if the index is missing or corrupted. Making it non-fatal means index bugs never break the core agent pipeline.
