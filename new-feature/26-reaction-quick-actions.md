# Feature: Reaction-Based Quick Actions

## Summary

Users trigger agent actions by adding emoji reactions to comments — no typing required. React with 🔄 to retry a failed response, ✏️ to ask the agent to refine its answer, 📋 to get a summary of the conversation so far, 🔍 to search for related context, and 📌 to bookmark a response as permanently important (never trimmed from context). The workflow listens for `issue_comment` reactions, maps each emoji to an action, and executes it. This creates a zero-friction interaction layer where a single click triggers complex agent behavior.

## Why This Feature — The Deep Reasoning

### 1. Typing Is Friction; Reactions Are Instant

Every interaction with the agent today requires typing: a full natural language request, a `/command`, or at minimum a few words. But many common actions don't need words:
- "That response was wrong, try again" → 🔄
- "Make that shorter/clearer" → ✏️
- "Remind me what we've discussed" → 📋
- "This response is important, don't forget it" → 📌
- "I approve" → 👍

These are *gestures*, not sentences. Reactions are the gestural interface of GitHub — one click, zero typing, instant feedback. On mobile (where many developers triage issues), reactions are dramatically easier than typing a comment.

### 2. GitHub Already Sends Reaction Events to Webhooks

The workflow can listen for reaction events. When a user reacts to any comment on an issue, GitHub fires an event with the reaction content, the comment body, and the user info. The agent can detect which comment was reacted to and what the reaction means, then execute the corresponding action.

However, there's a subtlety: GitHub Actions doesn't have a native `issue_comment_reaction` trigger. The approach uses the `issues` event with `labeled` type as a workaround, or polls reactions on the triggering comment. The cleanest implementation: the agent checks for reactions on its *own* previous response at the start of each run, enabling reaction-driven follow-ups.

### 3. It Creates a Two-Layer Interaction Model

```
Layer 1 (current): Natural language → agent understands intent → executes
Layer 2 (this feature): Emoji reaction → agent maps to action → executes
```

Layer 1 is powerful but slow. Layer 2 is limited but instant. Together, they cover the full spectrum of interaction needs: reactions for common/quick actions, comments for complex/nuanced requests. This is the same pattern as keyboard shortcuts + menu bars in desktop apps.

### 4. Bookmarking Solves the Context Loss Problem

Feature 22 (Context Window Intelligence) trims old conversation turns to fit the context budget. But sometimes a specific response contains critical information that must never be trimmed — a decision, a key finding, a configuration detail. Today, there's no way for the user to signal "this is important."

The 📌 bookmark reaction solves this: any response the user pins is permanently preserved in context, immune to trimming. The user curates the conversation's permanent memory through reactions.

### 5. It's the Most Accessible Interaction Pattern

Reactions work for:
- **Mobile users**: One tap, no keyboard
- **Email users**: Can't react from email, but can see which reactions were added
- **Accessibility**: Screen readers can navigate reaction buttons
- **Non-English speakers**: Emoji are universal
- **Quick triage**: Skim 10 issues, react to 3, move on

## Scope

### In Scope
- **Reaction-to-action mapping**: 🔄 retry, ✏️ refine, 📋 summarize, 🔍 search, 📌 bookmark, 👍 approve, 👎 reject
- **Reaction detection**: Check for new reactions on agent comments at the start of each run
- **Action execution**: Map detected reactions to agent prompts or internal actions
- **Bookmark persistence**: Track pinned comments in `state/bookmarks.json`
- **Bookmark-aware trimming**: Integration with feature 22 to protect bookmarked content
- **Reaction legend**: The agent includes a small reaction guide in its first response on each issue
- **Configurable mappings**: Customizable reaction-action pairs

### Out of Scope
- Real-time reaction webhooks (GitHub Actions doesn't support this natively)
- Reaction-based voting (multiple users reacting to influence agent behavior)
- Custom emoji reactions (GitHub only supports 8 standard reactions)

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Reaction detector** | Check reactions on agent's previous comments | ~2 hours |
| **Action mapper** | Map reactions to agent prompts or internal actions | ~1 hour |
| **Retry action** | Re-run with same prompt, fresh attempt | ~30 min |
| **Refine action** | Re-run with "make this clearer/shorter" prompt | ~30 min |
| **Summarize action** | Generate conversation summary | ~1 hour |
| **Bookmark system** | Persist bookmarks, integrate with context trimming | ~1.5 hours |
| **Reaction legend** | Generate and include legend in first response | ~30 min |
| **Configuration** | Customizable mappings | ~30 min |
| **Agent orchestrator integration** | Insert detection before prompt construction | ~1 hour |
| **Docs** | Document reaction system | ~30 min |
| **Testing** | Test each reaction action, test bookmark persistence | ~1.5 hours |

**Total: ~11 hours.**

---

## AI Implementation Instructions

### Step 1: Reaction detector

**New file:** `.GITCLAW/lifecycle/GITCLAW-REACTIONS.ts`

```typescript
export interface DetectedReaction {
  emoji: string;
  user: string;
  commentId: number;
  commentBody: string;
  createdAt: string;
}

export async function detectReactions(
  issueNumber: number,
  repo: string,
  sinceTimestamp: string
): Promise<DetectedReaction[]> {
  const reactions: DetectedReaction[] = [];
  
  // Get all comments on the issue by the bot
  const { stdout: commentsJson } = await run([
    "gh", "api", `repos/${repo}/issues/${issueNumber}/comments`,
    "--paginate",
    "--jq", `.[] | select(.user.login == "github-actions[bot]") | {id: .id, body: .body, created_at: .created_at}`,
  ]);
  
  for (const line of commentsJson.trim().split("\n").filter(Boolean)) {
    try {
      const comment = JSON.parse(line);
      
      // Get reactions on this comment
      const { stdout: reactionsJson } = await run([
        "gh", "api", `repos/${repo}/issues/comments/${comment.id}/reactions`,
        "--jq", `.[] | select(.user.login != "github-actions[bot]") | select(.created_at > "${sinceTimestamp}") | {content: .content, user: .user.login, created_at: .created_at}`,
      ]);
      
      for (const rLine of reactionsJson.trim().split("\n").filter(Boolean)) {
        try {
          const reaction = JSON.parse(rLine);
          // Map GitHub reaction content to emoji
          const emojiMap: Record<string, string> = {
            "+1": "👍", "-1": "👎", "laugh": "😄", "confused": "😕",
            "heart": "❤️", "hooray": "🎉", "rocket": "🚀", "eyes": "👀",
          };
          
          reactions.push({
            emoji: emojiMap[reaction.content] || reaction.content,
            user: reaction.user,
            commentId: comment.id,
            commentBody: comment.body,
            createdAt: reaction.created_at,
          });
        } catch (e) { /* skip */ }
      }
    } catch (e) { /* skip */ }
  }
  
  return reactions;
}
```

### Step 2: Action mapper

```typescript
export interface ReactionAction {
  emoji: string;
  action: string;           // "retry" | "refine" | "summarize" | "search" | "bookmark" | "approve" | "reject"
  prompt?: string;          // if the action requires running the agent with a specific prompt
  internal?: boolean;       // if true, handled without running the agent
}

const DEFAULT_MAPPINGS: Record<string, ReactionAction> = {
  "🔄": {
    emoji: "🔄",
    action: "retry",
    prompt: "Your previous response was not satisfactory. Please try again with a fresh approach to the original request. Focus on accuracy and completeness.",
  },
  "✏️": {
    emoji: "✏️",
    action: "refine",
    prompt: "Please refine your previous response. Make it clearer, more concise, and better structured. Keep the same information but improve the presentation.",
  },
  "📋": {
    emoji: "📋",
    action: "summarize",
    prompt: "Please provide a concise summary of our entire conversation so far: what was asked, what was decided, what actions were taken, and what's still pending.",
  },
  "🔍": {
    emoji: "🔍",
    action: "search",
    prompt: "Search for related context across other issues and the knowledge base that might be relevant to our current discussion. Report what you find.",
  },
  "📌": {
    emoji: "📌",
    action: "bookmark",
    internal: true,
  },
  "👍": {
    emoji: "👍",
    action: "approve",
    internal: true,
  },
  "👎": {
    emoji: "👎",
    action: "reject",
    internal: true,
  },
};

export function mapReactionToAction(
  emoji: string,
  config?: Record<string, ReactionAction>
): ReactionAction | null {
  const mappings = { ...DEFAULT_MAPPINGS, ...config };
  return mappings[emoji] || null;
}
```

### Step 3: Bookmark system

```typescript
export interface Bookmark {
  commentId: number;
  issueNumber: number;
  content: string;           // the bookmarked comment's text
  bookmarkedBy: string;
  bookmarkedAt: string;
  tokens: number;            // estimated token count
}

export function loadBookmarks(stateDir: string, issueNumber: number): Bookmark[] {
  const bookmarkFile = resolve(stateDir, "bookmarks.json");
  if (!existsSync(bookmarkFile)) return [];
  
  const all: Bookmark[] = JSON.parse(readFileSync(bookmarkFile, "utf-8"));
  return all.filter(b => b.issueNumber === issueNumber);
}

export function addBookmark(stateDir: string, bookmark: Bookmark): void {
  const bookmarkFile = resolve(stateDir, "bookmarks.json");
  let all: Bookmark[] = [];
  if (existsSync(bookmarkFile)) {
    all = JSON.parse(readFileSync(bookmarkFile, "utf-8"));
  }
  
  // Don't duplicate
  if (all.some(b => b.commentId === bookmark.commentId)) return;
  
  all.push(bookmark);
  writeFileSync(bookmarkFile, JSON.stringify(all, null, 2) + "\n");
}

// Integration with context trimming (feature 22):
export function getBookmarkedContent(stateDir: string, issueNumber: number): string {
  const bookmarks = loadBookmarks(stateDir, issueNumber);
  if (bookmarks.length === 0) return "";
  
  return [
    "[📌 Bookmarked responses — preserved in context by user request:]",
    "",
    ...bookmarks.map(b => `---\n📌 (bookmarked by @${b.bookmarkedBy}):\n${b.content.slice(0, 2000)}`),
  ].join("\n");
}
```

### Step 4: Integrate into agent orchestrator

In `GITCLAW-AGENT.ts`, at the start of the try block:

```typescript
import { detectReactions, mapReactionToAction, addBookmark, getBookmarkedContent } from "./GITCLAW-REACTIONS";

// Check for reactions on the agent's previous comments
const lastRunTimestamp = existsSync(mappingFile)
  ? JSON.parse(readFileSync(mappingFile, "utf-8")).updatedAt
  : new Date(0).toISOString();

const newReactions = await detectReactions(issueNumber, repo, lastRunTimestamp);

// Process reactions
for (const reaction of newReactions) {
  const action = mapReactionToAction(reaction.emoji);
  if (!action) continue;
  
  if (action.action === "bookmark") {
    addBookmark(stateDir, {
      commentId: reaction.commentId,
      issueNumber,
      content: reaction.commentBody,
      bookmarkedBy: reaction.user,
      bookmarkedAt: reaction.createdAt,
      tokens: estimateTokens(reaction.commentBody),
    });
    
    // React with 📌 back to confirm
    try {
      await gh("api", `repos/${repo}/issues/comments/${reaction.commentId}/reactions`,
        "-f", "content=rocket");
    } catch (e) { /* ignore */ }
    
    console.log(`Bookmarked comment ${reaction.commentId} by @${reaction.user}`);
    continue;
  }
  
  if (action.action === "approve" || action.action === "reject") {
    // Handled by approval gates (feature 21)
    continue;
  }
  
  if (action.prompt) {
    // Override the prompt with the reaction-triggered action
    console.log(`Reaction ${reaction.emoji} from @${reaction.user} → ${action.action}`);
    prompt = action.prompt;
    // Don't break — process all reactions, but last one wins for prompt
  }
}

// Inject bookmarked content into context
const bookmarkedContent = getBookmarkedContent(stateDir, issueNumber);
if (bookmarkedContent) {
  // Prepend to prompt so bookmarks are always in context
  prompt = bookmarkedContent + "\n\n---\n\n" + prompt;
}
```

### Step 5: Reaction legend in first response

When the agent posts its first response on a new issue, append a reaction guide:

```typescript
function getReactionLegend(): string {
  return [
    "",
    "<sub>",
    "**Quick actions:** React to any of my responses:",
    "🔄 retry · ✏️ refine · 📋 summarize · 📌 bookmark · 👍 approve",
    "</sub>",
  ].join(" ");
}

// In the comment posting section:
if (mode === "new") {
  commentBody += getReactionLegend();
}
```

### Step 6: Configuration

Add to `.GITCLAW/.pi/settings.json` or a new `reactions.json`:

```json
{
  "reactions": {
    "enabled": true,
    "showLegend": true,
    "mappings": {
      "🔄": { "action": "retry" },
      "✏️": { "action": "refine" },
      "📋": { "action": "summarize" },
      "📌": { "action": "bookmark" },
      "👍": { "action": "approve" },
      "👎": { "action": "reject" }
    }
  }
}
```

### Step 7: Test

- Post a response, react with 🔄 → verify agent retries with fresh approach
- React with ✏️ → verify agent refines the response (shorter/clearer)
- React with 📋 → verify agent posts a conversation summary
- React with 📌 → verify the comment is bookmarked in `state/bookmarks.json`
- Start a new conversation → verify the reaction legend appears in the first response
- In a long conversation with feature 22, verify bookmarked responses survive context trimming

## Design Decisions

**Why check reactions at the start of each run instead of real-time webhooks?** GitHub Actions doesn't have a native trigger for reactions on issue comments. The agent runs on `issue_comment.created` events. By checking for new reactions on its previous comments at the start of each run, the agent catches reactions that happened between runs. The latency is acceptable — reactions are checked whenever the user posts a new comment (which triggers a run).

**Why only 7 mappings?** GitHub supports exactly 8 reaction types: +1, -1, laugh, confused, heart, hooray, rocket, eyes. Of these, 👀 (eyes) is already used as the working indicator. That leaves 7. Each mapping should be intuitive — 🔄 (cycle) for retry, ✏️ (pencil) for edit/refine, 📋 (clipboard) for summary. If a mapping isn't immediately obvious, it shouldn't exist.

**Why bookmarks as a separate system instead of just flagging turns in the session?** Bookmarks need to survive across sessions and integrate with multiple features: context trimming (feature 22), knowledge base curation (feature 17), and session summarization (feature 06). A standalone `bookmarks.json` file makes this cross-cutting concern manageable. It's also user-facing — the user can inspect their bookmarks by reading the file.
