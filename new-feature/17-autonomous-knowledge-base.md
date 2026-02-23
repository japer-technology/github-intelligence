# Feature: The Autonomous Knowledge Base

## Summary

The agent curates a living, hierarchical knowledge base from its own conversation history — not a raw log or a mechanical index, but an actively maintained collection of Markdown articles organized by topic, cross-referenced, de-duplicated, and kept current as new conversations add or contradict previous knowledge. After every N sessions (or on schedule), the agent reviews recent conversations, extracts decisions, facts, patterns, preferences, and architectural knowledge, then writes or updates articles in a `knowledge/` directory. The knowledge base becomes a first-class artifact of the repository: a searchable, browsable, git-tracked institutional memory that the agent reads at the start of every session to be maximally informed, and that humans can read as living documentation.

## Why This Feature — The Deepest Reasoning

### The Problem Is Not Missing Memory — It's Missing *Curation*

GitClaw already has three memory mechanisms:

1. **Sessions** (`state/sessions/*.jsonl`) — Complete conversation transcripts. Every word the user said, every tool call the agent made, every response. 1.8MB in 3 days.
2. **Memory log** (`state/memory.log`) — An append-only text file where the agent is told to write `[timestamp] One-line fact.` Defined in APPEND_SYSTEM.md and the memory skill. Currently *empty* — the agent has never written to it.
3. **Session index** (proposed in feature 08) — Mechanical metadata: issue numbers, keywords, file paths, timestamps.

All three share the same fundamental flaw: they are **accumulation without synthesis**. Sessions grow indefinitely. Memory logs become grep targets. Indexes are metadata, not knowledge. None of them perform the intellectual act that makes knowledge useful: *organizing it, connecting it, resolving contradictions, pruning what's obsolete, and presenting what matters*.

Consider what's buried in this repo's 21 sessions right now:
- The agent's identity was decided: Spock 🖖, rational, analytical, dry wit. (session from 2026-02-20)
- The user's identity was established: "The Admiral," values precision. (same session)
- A fork comparison was performed: 285 commits ahead, 85 files changed, +8,372 lines. (issue #82)
- Cron functionality was explored and deemed viable via GitHub Actions schedule triggers. (issue #85)
- Website generation via GitHub Pages was analyzed and found feasible. (issue #89)
- The repo was renamed from "addon" to "drop-in" after discussion about GitHub terminology. (issue #96)
- Copyright implications for the MIT-licensed fork were analyzed. (issue #100)
- `.gitattributes` export-ignore for state files was investigated and confirmed working. (issue #103)

This is *institutional knowledge*. It's the kind of context that makes the difference between a useful agent and a confused one. But today, none of it is accessible unless:
- The user manually tells the agent to check a specific past issue
- The agent happens to resume the exact session where the fact was discussed
- Someone reads raw JSONL files

**A knowledge base transforms raw conversation history into organized, accessible, living knowledge.**

### Why Curation Matters More Than Recall

Feature 08 (Cross-Issue Context) gives the agent the ability to *search* past conversations. But search requires knowing what to search for. If the user asks "what database did we pick?" the agent can grep for "database." But what about:
- "How do we handle X?" — requires knowing which past conversation discussed X
- "What are the project's conventions?" — requires synthesizing across many conversations
- "What have we decided so far?" — requires curating decisions vs. speculations vs. rejected ideas

These questions require a *librarian*, not a search engine. The knowledge base is that librarian.

### The Three Levels of Memory

Think of human organizational memory:

| Level | Analogy | GitClaw Equivalent | Status |
|---|---|---|---|
| **Raw recall** | "I remember we talked about databases" | Session files | ✅ Exists |
| **Indexed recall** | "It was in the meeting on Tuesday" | Session index (feature 08) | Proposed |
| **Curated knowledge** | "We chose PostgreSQL because of X, Y, Z" | **Knowledge Base** | **This feature** |

Raw recall is cheap — just save everything. Indexed recall is useful — you can find things. Curated knowledge is *powerful* — it shapes every future decision. Without curation, the agent has raw memory. With curation, the agent has *wisdom*.

### Why This Is Different From Documentation

The agent can already generate documentation when asked ("write a README," "document this module"). But that's responsive — it happens when a human asks. The knowledge base is *proactive*:

- Nobody asks the agent to organize its own knowledge. It does it because it's valuable.
- Nobody asks the agent to resolve contradictions between what was said in issue #42 vs #85. It notices and resolves them.
- Nobody asks the agent to prune stale knowledge (the cron decision was made before scheduled tasks were implemented — is it still relevant?). It does it because curated knowledge must be current.

The knowledge base is also *different in kind* from documentation:
- Documentation describes the codebase. The knowledge base describes *decisions about* the codebase.
- Documentation is written for humans who will read it. The knowledge base is written for the agent to read at session start *and* for humans to browse.
- Documentation is static until someone updates it. The knowledge base updates itself.

### Why It Compounds With Every Other Feature

| Feature | How Knowledge Base Helps |
|---|---|
| **Cross-Issue Context (08)** | Search finds raw sessions; KB provides curated summaries |
| **Multi-Agent Personas (10)** | Each persona can read domain-specific KB articles |
| **Guided Workflows (12)** | KB articles provide context for workflow steps |
| **Skill Auto-Generation (15)** | KB tracks which skills have been effective |
| **Guardrails (16)** | KB records why guardrails were configured a certain way |
| **Scheduled Runs (04)** | KB is updated on a schedule, independent of user interaction |
| **Dashboard (14)** | KB articles are a natural dashboard data source |
| **Session Summarization (06)** | Summaries feed into KB; KB reduces need for full sessions |

### Why It Embodies GitClaw's Philosophy

The Idea doc says: *"When you fork the repo, you fork the agent's mind."* But right now, the agent's "mind" is 1.8MB of raw JSONL. Forking it gives you a pile of transcripts, not organized knowledge. With a knowledge base, forking the repo gives you a curated, browsable understanding of every decision the project has made — *that's* forking a mind.

The Idea doc says: *"Conversations are data — and they deserve the same versioning, auditability, and collaboration workflows that code gets."* The knowledge base takes this further: conversations are data, *and data can be refined into knowledge*. Each KB article is a git-tracked Markdown file. Changes to knowledge are commits. Knowledge evolution is `git log`.

## Scope

### In Scope
- Knowledge extraction: analyze sessions and extract decisions, facts, preferences, architectural choices
- Knowledge organization: hierarchical topic structure in `.GITCLAW/knowledge/`
- Knowledge articles: Markdown files with frontmatter, cross-references, and source citations
- Curation lifecycle: create, update, merge, deprecate, and delete articles
- Scheduled curation: run knowledge extraction on a schedule (weekly or per-N-sessions)
- Session startup: agent reads relevant KB articles at the start of each session
- Contradiction detection: flag when new information contradicts existing KB articles
- Human-browsable: the knowledge directory is readable as-is (no special tooling needed)

### Out of Scope
- Semantic search over KB (use grep and topic structure)
- KB articles as source for GitHub Wiki or Pages (future follow-up)
- Multi-repo knowledge federation
- User-editable KB with merge conflict resolution (users can edit; the agent respects changes)

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Knowledge extractor** (new `GITCLAW-KNOWLEDGE.ts`) | Parse sessions, identify extractable knowledge | ~3 hours |
| **Article generator** | Create/update Markdown articles from extracted knowledge | ~2.5 hours |
| **Topic taxonomy** | Define and maintain a hierarchical topic structure | ~1 hour |
| **Contradiction detector** | Compare new knowledge against existing articles | ~1.5 hours |
| **Session startup loader** | Select and inject relevant KB articles into agent context | ~1.5 hours |
| **Curation scheduler** | Trigger extraction on schedule or threshold | ~30 min |
| **Knowledge skill** | Teach the agent how to query and cite the KB | ~1 hour |
| **Docs** | Document KB system, article format, curation process | ~30 min |
| **Testing** | Verify extraction quality, article generation, startup loading | ~2 hours |

**Total: ~14 hours.** This is the most intellectually complex feature because it requires the agent to make *editorial judgments* about what constitutes knowledge vs. noise.

---

## AI Implementation Instructions

### Step 1: Define the knowledge article format

**Directory structure:**

```
.GITCLAW/knowledge/
  _index.md                    # auto-generated table of contents
  architecture/
    session-model.md           # how sessions work and why
    commit-push-model.md       # the retry-rebase pattern and its tradeoffs
  decisions/
    identity-spock.md          # why the agent is Spock, who decided, when
    naming-drop-in.md          # why "drop-in" not "addon", the discussion
    database-choice.md         # (example) why PostgreSQL was chosen
  project/
    fork-status.md             # relationship to upstream, divergence metrics
    capabilities.md            # what the agent can currently do
    known-limitations.md       # documented limitations and workarounds
  preferences/
    user-the-admiral.md        # user preferences, communication style
    code-style.md              # coding conventions observed in the repo
  history/
    timeline.md                # key events in chronological order
```

**Article format:**

```markdown
---
topic: decisions
title: Agent Identity — Spock
created: 2026-02-20
updated: 2026-02-20
sources:
  - issue: 63
    session: 2026-02-20T12-32-37-832Z_fd67ceb3.jsonl
  - issue: 71
    session: 2026-02-20T12-55-28-934Z_31b7bf2a.jsonl
confidence: high
status: current
---

# Agent Identity — Spock 🖖

## Decision

The agent's identity is **Spock** — a rational digital entity with disciplined,
analytical precision and dry, minimalist wit.

## Context

During the hatching process (issue #63), The Admiral and the agent collaboratively
defined the identity through a guided conversation following BOOTSTRAP.md.

## Key Facts

- **Name**: Spock
- **Emoji**: 🖖
- **Vibe**: Disciplined, analytical, precise. Dry wit when it improves clarity.
- **Hatched by**: The Admiral
- **Hatch date**: 2026-02-20
- **Purpose**: To serve with logic, precision, and the occasional raised eyebrow.

## Rationale

The Admiral values precision and expressed preferences consistent with Vulcan
analytical philosophy. The name emerged naturally from the collaborative process.

## Related

- [User Preferences — The Admiral](../preferences/user-the-admiral.md)
- [Agent Configuration](../project/capabilities.md)
```

### Step 2: Build the knowledge extractor

**New file:** `.GITCLAW/lifecycle/GITCLAW-KNOWLEDGE.ts`

The extractor reads sessions and identifies "knowledge-worthy" content using heuristic signals.

```typescript
export interface ExtractedKnowledge {
  type: "decision" | "fact" | "preference" | "architecture" | "limitation" | "event";
  title: string;
  content: string;
  confidence: "high" | "medium" | "low";
  sourceIssue: number;
  sourceSession: string;
  sourceTimestamp: string;
  keywords: string[];
  relatedTopics: string[];
}

export async function extractKnowledge(
  sessionPath: string,
  issueNumber: number
): Promise<ExtractedKnowledge[]>
```

**Extraction uses two approaches:**

**Approach A: Heuristic signal detection**

Scan assistant text for knowledge indicators:

```typescript
const DECISION_SIGNALS = [
  /(?:we |you |the team )(?:decided|chose|agreed|selected|picked|went with)/i,
  /(?:the decision|the conclusion|the recommendation) (?:is|was)/i,
  /(?:going with|settling on|opting for)/i,
];

const FACT_SIGNALS = [
  /(?:the .+ is|there are \d+|currently|as of)/i,
  /(?:this means|this implies|the result is)/i,
  /(?:the total|the count|the size|the number)/i,
];

const PREFERENCE_SIGNALS = [
  /(?:prefer|always|never|convention|standard|our style)/i,
  /(?:the admiral|the user) (?:wants|likes|prefers|values)/i,
];

const ARCHITECTURE_SIGNALS = [
  /(?:the architecture|the design|the pattern|the model|how .+ works)/i,
  /(?:the pipeline|the flow|the lifecycle|the sequence)/i,
];

const LIMITATION_SIGNALS = [
  /(?:limitation|constraint|tradeoff|caveat|known issue|doesn't support)/i,
  /(?:can't|cannot|won't work|not possible|not supported)/i,
];
```

For each assistant message that matches one or more signals, extract the surrounding paragraph as a knowledge candidate.

**Approach B: LLM-powered extraction (more expensive, higher quality)**

After collecting heuristic candidates, use a single LLM call to refine them:

```typescript
const extractionPrompt = `You are a knowledge curator. Below are excerpts from a conversation
between a user and an AI agent. Extract the key knowledge items — decisions made,
facts established, preferences expressed, architectural patterns described, and
limitations discovered.

For each item, provide:
- type: decision | fact | preference | architecture | limitation | event
- title: a concise title (under 10 words)
- content: a 2-3 sentence summary
- confidence: high (explicitly stated) | medium (implied) | low (speculative)
- keywords: 3-5 relevant keywords

Conversation excerpts:
${candidates.map(c => c.text.slice(0, 500)).join("\n\n---\n\n")}

Return as JSON array.`;
```

Use the cheaper summary model (same as feature 06's session summarization) to keep costs low.

**Combine both approaches:** Heuristics identify candidates cheaply. The LLM refines and structures them. If the LLM is unavailable or too expensive, fall back to heuristics-only.

### Step 3: Build the article generator

```typescript
export interface KnowledgeArticle {
  path: string;           // relative to knowledge/
  frontmatter: {
    topic: string;
    title: string;
    created: string;
    updated: string;
    sources: { issue: number; session: string }[];
    confidence: string;
    status: "current" | "outdated" | "superseded" | "disputed";
  };
  body: string;
}

export function generateArticle(knowledge: ExtractedKnowledge): KnowledgeArticle
export function updateArticle(existing: KnowledgeArticle, newKnowledge: ExtractedKnowledge): KnowledgeArticle
export function generateIndex(articles: KnowledgeArticle[]): string
```

**`generateArticle`:**
- Map the knowledge type to a topic directory (decision → `decisions/`, fact → `project/`, etc.)
- Generate a slug from the title for the filename.
- Write the frontmatter with sources, confidence, and status.
- Write the body with the knowledge content, a "Context" section citing the source issue, and a "Related" section linking to articles with overlapping keywords.

**`updateArticle`:**
- If an existing article covers the same topic (matching title or >60% keyword overlap):
  - Append the new source to the sources list.
  - Update the `updated` date.
  - If the new knowledge contradicts the existing content, set `status: "disputed"` and add a "⚠️ Conflict" section describing the contradiction.
  - If the new knowledge supplements the existing content, merge it into the body.

**`generateIndex`:**
- Build `_index.md` as a table of contents:
  ```markdown
  # Knowledge Base

  _Auto-curated from 21 conversations. Last updated: 2026-02-22._

  ## Decisions (4 articles)
  - [Agent Identity — Spock](decisions/identity-spock.md) — high confidence
  - [Naming — "Drop-In" not "Addon"](decisions/naming-drop-in.md) — high confidence
  ...

  ## Architecture (2 articles)
  - [Session Model](architecture/session-model.md) — high confidence
  ...

  ## Preferences (2 articles)
  ...
  ```

### Step 4: Detect contradictions

```typescript
export function detectContradictions(
  newKnowledge: ExtractedKnowledge,
  existingArticles: KnowledgeArticle[]
): { article: KnowledgeArticle; conflict: string }[]
```

**Contradiction detection heuristics:**

1. **Direct negation:** New knowledge says "we chose X" but existing article says "we chose Y" for the same topic.
2. **Temporal supersession:** New knowledge is about the same topic but from a later date — the old article may be outdated.
3. **Confidence downgrade:** New knowledge has lower confidence about something the existing article stated as high-confidence.

Implementation:
- For each new knowledge item, find existing articles with >40% keyword overlap.
- For each matching article, compare:
  - If both are "decision" type with the same keywords but different content → potential contradiction.
  - If the new item's timestamp is significantly later → potential supersession.
- Return conflicts for the article generator to handle (add dispute markers or supersede).

### Step 5: Session startup — inject relevant KB context

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts`

At the start of each session (after prompt construction, before running `pi`), load relevant KB articles:

```typescript
import { findRelevantArticles } from "./GITCLAW-KNOWLEDGE";

const knowledgeDir = resolve(gitclawDir, "knowledge");
if (existsSync(knowledgeDir)) {
  // Find articles relevant to the current prompt
  const relevantArticles = findRelevantArticles(prompt, knowledgeDir, 5); // max 5 articles
  
  if (relevantArticles.length > 0) {
    const kbContext = relevantArticles.map(a => {
      return `### ${a.frontmatter.title} (${a.frontmatter.confidence} confidence, ${a.frontmatter.status})\n${a.body.slice(0, 500)}`;
    }).join("\n\n");
    
    prompt = `[Relevant knowledge from past conversations:]\n\n${kbContext}\n\n---\n\n${prompt}`;
  }
  
  // Always load "preferences" articles — they inform every interaction
  const preferences = loadArticlesByTopic("preferences", knowledgeDir);
  if (preferences.length > 0) {
    const prefContext = preferences.map(a => a.body.slice(0, 300)).join("\n");
    // This goes into the system context, not the user prompt
    // Append to the session's initial context
  }
}
```

**`findRelevantArticles`:**
- Tokenize the prompt into keywords.
- For each article, read the frontmatter keywords.
- Score by keyword overlap (same as feature 08's search).
- Return the top N.
- Always include any article with `status: "disputed"` that matches — the agent needs to know about contradictions.

### Step 6: Implement the curation scheduler

**Two triggers:**

**A. Session-count threshold:**

After the agent finishes a run, check how many sessions have occurred since the last KB update:

```typescript
// In GITCLAW-AGENT.ts, after committing session state:
const KB_UPDATE_THRESHOLD = 5; // curate every 5 sessions

const lastCurationFile = resolve(stateDir, "kb-last-curated.json");
let sessionsSinceLastCuration = 0;

if (existsSync(lastCurationFile)) {
  const last = JSON.parse(readFileSync(lastCurationFile, "utf-8"));
  sessionsSinceLastCuration = totalSessionCount - last.sessionCount;
} else {
  sessionsSinceLastCuration = totalSessionCount;
}

if (sessionsSinceLastCuration >= KB_UPDATE_THRESHOLD) {
  console.log(`${sessionsSinceLastCuration} sessions since last KB curation. Running curation...`);
  await curateKnowledgeBase(stateDir, gitclawDir);
  writeFileSync(lastCurationFile, JSON.stringify({
    sessionCount: totalSessionCount,
    curatedAt: new Date().toISOString(),
  }, null, 2) + "\n");
}
```

**B. Scheduled (weekly) — via feature 04:**

Add a `knowledge-curation` task to `scheduled-tasks.json`:
```json
{
  "id": "knowledge-curation",
  "title": "Knowledge Base Curation",
  "enabled": true,
  "prompt": "INTERNAL:curate-knowledge"
}
```

### Step 7: The curation function

```typescript
export async function curateKnowledgeBase(
  stateDir: string,
  gitclawDir: string
): Promise<{ articlesCreated: number; articlesUpdated: number; contradictions: number }> {
  const knowledgeDir = resolve(gitclawDir, "knowledge");
  mkdirSync(knowledgeDir, { recursive: true });
  
  // Load existing articles
  const existingArticles = loadAllArticles(knowledgeDir);
  
  // Find sessions that haven't been curated yet
  const lastCuration = loadLastCurationTimestamp(stateDir);
  const newSessions = findSessionsSince(stateDir, lastCuration);
  
  let articlesCreated = 0;
  let articlesUpdated = 0;
  let contradictions = 0;
  
  for (const session of newSessions) {
    // Extract knowledge from this session
    const knowledge = await extractKnowledge(session.path, session.issueNumber);
    
    for (const item of knowledge) {
      // Check for contradictions
      const conflicts = detectContradictions(item, existingArticles);
      contradictions += conflicts.length;
      
      // Find existing article to update, or create new
      const existingMatch = findMatchingArticle(item, existingArticles);
      
      if (existingMatch) {
        const updated = updateArticle(existingMatch, item);
        writeArticle(knowledgeDir, updated);
        articlesUpdated++;
      } else {
        const newArticle = generateArticle(item);
        writeArticle(knowledgeDir, newArticle);
        existingArticles.push(newArticle); // add to working set
        articlesCreated++;
      }
    }
  }
  
  // Regenerate the index
  const index = generateIndex(existingArticles);
  writeFileSync(resolve(knowledgeDir, "_index.md"), index);
  
  // Create topic subdirectories as needed
  for (const topic of ["decisions", "architecture", "project", "preferences", "history"]) {
    mkdirSync(resolve(knowledgeDir, topic), { recursive: true });
  }
  
  console.log(`KB curation: ${articlesCreated} created, ${articlesUpdated} updated, ${contradictions} contradictions detected`);
  
  return { articlesCreated, articlesUpdated, contradictions };
}
```

### Step 8: Create the knowledge skill

**New file:** `.GITCLAW/.pi/skills/knowledge-base/SKILL.md`

```markdown
---
name: knowledge-base
description: Query, cite, and maintain the project's knowledge base. Use when the user asks about past decisions, project conventions, architectural choices, team preferences, or "what do we know about X." Also use proactively when your current task relates to a topic in the knowledge base.
---

# Knowledge Base

The project maintains a curated knowledge base in `.GITCLAW/knowledge/`.

## Structure

```
knowledge/
  _index.md          # Table of contents
  decisions/         # Decisions made and their rationale
  architecture/      # How things work and why
  project/           # Project facts, status, capabilities
  preferences/       # User and team preferences
  history/           # Timeline of key events
```

## When to Read

- Before answering questions about "why" something is the way it is
- Before making recommendations that might contradict past decisions
- When the user references a past discussion or decision
- At the start of complex tasks to gather context

## How to Query

```bash
# Browse the index
cat .GITCLAW/knowledge/_index.md

# Search for a topic
rg -i "topic keyword" .GITCLAW/knowledge/

# Read a specific article
cat .GITCLAW/knowledge/decisions/article-name.md

# Find disputed knowledge
rg "status: disputed" .GITCLAW/knowledge/
```

## When You Find Relevant Knowledge

- Cite it: "According to our knowledge base (decisions/naming-drop-in.md)..."
- Flag if outdated: "The KB article on X was written before we implemented Y — it may need updating"
- Note contradictions: "The KB shows a dispute on this topic — the decision in #42 conflicts with the analysis in #85"

## When to Write

After making a significant decision or discovering an important fact:

```bash
# The curation system handles this automatically, but you can also write directly:
echo "New article content" > .GITCLAW/knowledge/decisions/new-decision.md
```

Include frontmatter with topic, title, created date, sources, and confidence level.
```

### Step 9: Handle human edits to KB articles

The knowledge base is git-tracked Markdown. Humans can and should edit it directly. The curation system must respect human edits:

- **Never overwrite human-authored content.** If an article has been modified since the last curation (check git blame or a `last_auto_curated` field in frontmatter), skip automatic updates to that article.
- **Add a `curated_by: auto | human | mixed` field** to frontmatter. If `human` or `mixed`, only append new sources — don't rewrite the body.
- **If a human deletes an article,** don't recreate it. Track deleted article paths in `state/kb-deleted.json` and skip them in future curation runs.

### Step 10: Bootstrap from existing sessions

For repos with existing sessions (like this one), run a one-time full curation:

```bash
bun .GITCLAW/lifecycle/GITCLAW-KNOWLEDGE.ts --bootstrap
```

This scans ALL sessions, not just new ones, and generates the initial knowledge base. For this repo, it would produce articles about:
- The Spock identity decision
- The Admiral's preferences
- Fork status and divergence from upstream
- The "drop-in" naming decision
- Cron/scheduling feasibility analysis
- GitHub Pages website feasibility
- Copyright/licensing analysis
- `.gitattributes` export-ignore for state files
- Skills system architecture

### Step 11: Update documentation

**New file:** `.GITCLAW/docs/GITCLAW-Knowledge-Base.md`
- Philosophy: why curated knowledge is different from memory
- Article format reference
- Topic taxonomy
- How curation works (extraction → generation → contradiction detection)
- How to read, search, and edit the KB
- How the agent uses KB at session startup
- How to bootstrap from existing sessions
- Privacy: KB articles are committed to git (public repos = public KB)

**File:** `.GITCLAW/README.md`
- Add "Knowledge Base" to capabilities: "The agent maintains a curated knowledge base from past conversations — decisions, architecture, preferences, and project facts — all as browsable Markdown files in git."

**File:** `.GITCLAW/.pi/APPEND_SYSTEM.md`
- Add: "At the start of each session, check `.GITCLAW/knowledge/_index.md` for relevant context. Cite KB articles when they inform your response."

### Step 12: Test

- Bootstrap the KB from existing sessions:
  1. Run `--bootstrap` mode.
  2. Verify articles are created for key decisions (identity, naming, fork status).
  3. Verify `_index.md` is generated and browsable.
  4. Verify articles cite their source issues.
- Have a new conversation that establishes a decision:
  1. Discuss and decide something (e.g., "Let's use TypeScript for all new code").
  2. Wait for the next curation cycle (or trigger manually).
  3. Verify a new article appears in `knowledge/decisions/`.
- Have a conversation that contradicts an existing KB article:
  1. Say something that reverses a previous decision.
  2. Verify the article is marked `status: disputed` with a conflict section.
- Start a new session on a topic covered by the KB:
  1. Verify the agent references KB articles in its response.
  2. Verify the response is informed by past decisions without the user needing to provide context.
- Edit a KB article manually:
  1. Change the content of an article.
  2. Run curation again.
  3. Verify the human edit is preserved (not overwritten).
- Delete a KB article manually:
  1. Remove an article.
  2. Run curation again.
  3. Verify the article is NOT recreated.

## Design Decisions

**Why Markdown files in a directory, not a database?**
GitClaw's philosophy is that everything is a file in git. The knowledge base follows this: each article is a diffable, auditable Markdown file. `git log knowledge/decisions/naming-drop-in.md` shows how a piece of knowledge evolved. `git blame` shows which curation run added each line. When you fork the repo, you fork the knowledge. When you branch, you branch the knowledge. The metaphors are structural, not forced.

**Why a topic taxonomy instead of flat files or tags?**
Directories create a navigable hierarchy that works in any file browser — GitHub's web UI, VS Code's sidebar, `ls` in the terminal. Tags require tooling to navigate. Directories are zero-infrastructure browsability. The taxonomy is shallow (one level) to avoid over-engineering: `decisions/`, `architecture/`, `project/`, `preferences/`, `history/`.

**Why heuristic extraction backed by optional LLM refinement?**
Pure heuristics are fast, free, and deterministic — they run on every session without API cost. But they produce rough candidates. The LLM refinement step structures and cleans them. Making the LLM step optional means the KB works even if the LLM budget is exhausted or the model is unavailable. Degraded quality is better than no knowledge.

**Why contradiction detection instead of silent overwrites?**
Knowledge evolves. A decision made in week 1 may be reversed in week 3. Silently overwriting the old article erases the history of the decision change. Marking articles as "disputed" preserves both versions and signals to the agent (and humans) that this is an area of ambiguity. The agent can then ask the user to resolve the dispute, or the human can edit the article to reflect the final decision.

**Why inject KB context at session startup instead of on-demand?**
On-demand search (feature 08) requires the agent to decide to search. At session startup, the agent receives relevant knowledge automatically — it doesn't need to know to look. For preferences and conventions, this is critical: the agent should always know how the user likes to be addressed and what coding conventions to follow, without needing to search for it.

**Why every 5 sessions instead of after every run?**
Curation involves reading sessions, possibly calling the LLM, and writing files. Doing this on every run adds latency (and cost if LLM extraction is used). Every 5 sessions balances freshness with efficiency. Critical knowledge (user identity, major decisions) is captured within a day of normal usage. For repos with lower activity, the weekly schedule serves as a fallback.

**Why is this the deepest feature?**
Because it's the only feature that makes the agent *genuinely wiser over time*. Every other feature makes the agent more capable (more triggers, more surfaces, more safety). The knowledge base makes the agent more *knowledgeable* — not in the sense of having access to more data, but in the sense of having organized, curated, contradiction-aware understanding of its project's history, decisions, and conventions. That's the difference between a tool and a colleague.
