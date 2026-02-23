# Feature: Session Content Compression

## Summary

Compress individual session JSONL files by surgically removing the content that consumes space without contributing to conversation quality: tool call argument bodies (the full text of `write` calls that wrote 30KB files), tool result bodies (the full output of `read` commands that returned 50KB of source code), redundant thinking blocks, and duplicate content that appears in both tool calls and the subsequent text response. The compressed session preserves the full conversational structure — every turn, every decision, every instruction — while replacing bulk data with compact references. A 1.27MB session becomes ~150KB without losing any information the model actually needs for continuity.

## Why This Feature — The Deep Reasoning

### 1. The Actual Data Tells a Devastating Story

This repository's largest session (the one generating these specs) is **1,274KB**. Here's what's inside:

| Content Type | Blocks | Size | % of Total |
|---|---|---|---|
| Tool calls (write, bash, read arguments) | 101 | 618 KB | 48.5% |
| Tool results (command outputs, file contents) | 100 | 372 KB | 29.2% |
| Text (agent responses + user messages) | 138 | 405 KB | 17.6% |
| Thinking blocks | 17 | ~1 KB | 0.1% |

**77.7% of the session is tool I/O** — the arguments passed to `write` (the full text of feature specs being written to files) and the outputs of `read` and `bash` commands. This content served its purpose in the turn it was used, but it's deadweight for future turns. The model doesn't need the full text of `new-feature/15-skill-auto-generation.md` in its context to answer the user's next question — it needs to know that it *wrote* that file and roughly what it contains.

### 2. Tool Calls Are Redundant With Their Effects

When the agent calls `write(path="new-feature/15.md", content="<19KB of markdown>")`, that 19KB is stored in the session. But the file *also* exists in the repo at that path. The session stores a copy of something that's already on disk. This is pure redundancy — the session should record *what happened* (wrote 19KB to that path) not *what was written* (the full 19KB).

Similarly, when the agent calls `read(path="GITCLAW-AGENT.ts")` and gets back 15KB of TypeScript, that content is the file itself. The session stores a snapshot of something that's in git. The session should record "read GITCLAW-AGENT.ts (369 lines, 15KB)" not the entire file contents.

### 3. The Model Doesn't Read Its Own History Like Humans Do

When the model receives a resumed session, it processes every token. But it doesn't *need* every token. For tool calls, it needs:
- **What tool was called and why** (the intent) — ~50 tokens
- **Whether it succeeded or failed** — ~5 tokens
- **A brief summary of the result** — ~50 tokens

It does NOT need:
- The full file contents that were written (~5,000 tokens)
- The full command output of a `bash` call (~2,000 tokens)
- The full file contents returned by `read` (~3,000 tokens)

The current session gives the model 10,000 tokens of raw data when 100 tokens of summary would serve the same purpose for conversation continuity.

### 4. Compression Ratio Projections

Based on this repo's actual sessions:

| Session | Original | Projected Compressed | Ratio |
|---|---|---|---|
| 1,274 KB (186 lines, current) | 1,274 KB | ~160 KB | 87% reduction |
| 399 KB (86 lines) | 399 KB | ~60 KB | 85% reduction |
| 209 KB (62 lines) | 209 KB | ~35 KB | 83% reduction |

Average reduction: **~85%**. The 2.9MB state directory drops to ~450KB. The context window gets 85% more room for actual conversation.

### 5. It's the Foundation for Every Other Memory Feature

Feature 22 (Context Window Intelligence) manages the token budget. Feature 06 (Session Summarization) compresses at the turn level. Feature 17 (Knowledge Base) extracts knowledge from sessions. All of these work better when the input data is already lean. Compressing tool I/O is the lowest-hanging fruit — it removes the most bytes with the least information loss.

## Scope

### In Scope
- **Tool call compression**: Replace `write` content with a summary + hash reference
- **Tool result compression**: Replace large `read`/`bash` output with summaries
- **Thinking block stripping**: Remove `thinking` blocks (internal reasoning, not replayable)
- **Redundancy elimination**: When a tool result repeats content from the subsequent text response, keep only the text
- **Compression triggers**: Compress after every N turns, or when session exceeds a size threshold
- **In-place compression**: Modify the session file directly (keeping a backup)
- **Lossless metadata preservation**: All timestamps, turn IDs, roles, and tool names are kept
- **Decompression reference**: Store enough info to reconstruct full content if needed (file paths, git commits)

### Out of Scope
- General-purpose compression (gzip/zstd) — the session must remain valid JSONL for `pi` to read
- Compression of sessions from other tools (only `pi` session format)
- Real-time streaming compression (compression happens between runs, not during)

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Tool call compressor** | Replace write/bash/read arguments with summaries | ~2.5 hours |
| **Tool result compressor** | Replace large outputs with summaries | ~2 hours |
| **Thinking block stripper** | Remove thinking content, keep markers | ~30 min |
| **Redundancy detector** | Find content duplicated between tool calls and text | ~1.5 hours |
| **Compression orchestrator** | Decide when and what to compress | ~1 hour |
| **Reference index** | Map compressed blocks to original content locations | ~1 hour |
| **Agent orchestrator integration** | Run compression between agent finish and commit | ~1 hour |
| **Configuration** | Thresholds, what to compress, retention | ~30 min |
| **Testing** | Verify compressed sessions resume correctly with pi | ~2 hours |

**Total: ~12 hours.**

---

## AI Implementation Instructions

### Step 1: Analyze session content types

**New file:** `.GITCLAW/lifecycle/GITCLAW-COMPRESS.ts`

```typescript
import { existsSync, readFileSync, writeFileSync, copyFileSync } from "fs";
import { resolve, basename } from "path";

export interface CompressionStats {
  originalSize: number;
  compressedSize: number;
  ratio: number;
  toolCallsCompressed: number;
  toolResultsCompressed: number;
  thinkingBlocksRemoved: number;
  redundanciesEliminated: number;
}

export interface CompressionConfig {
  enabled: boolean;
  sizeThresholdKB: number;          // only compress sessions larger than this
  turnThresholdBeforeCompress: number; // don't compress the last N turns (keep recent full)
  toolCallMaxBytes: number;          // compress tool call arguments above this size
  toolResultMaxBytes: number;        // compress tool results above this size
  stripThinking: boolean;
  eliminateRedundancy: boolean;
  keepBackup: boolean;
}

const DEFAULT_CONFIG: CompressionConfig = {
  enabled: true,
  sizeThresholdKB: 100,             // compress sessions over 100KB
  turnThresholdBeforeCompress: 4,    // keep last 4 turns fully intact
  toolCallMaxBytes: 500,             // compress tool args over 500 bytes
  toolResultMaxBytes: 1000,          // compress tool results over 1KB
  stripThinking: true,
  eliminateRedundancy: true,
  keepBackup: true,
};
```

### Step 2: Tool call compressor

The core compression logic. For each tool call, replace the full argument content with a compact summary:

```typescript
function compressToolCall(block: any): { compressed: any; bytesSaved: number } {
  if (block.type !== "toolCall") return { compressed: block, bytesSaved: 0 };
  
  const argsStr = JSON.stringify(block.arguments || {});
  const originalSize = argsStr.length;
  
  if (originalSize <= DEFAULT_CONFIG.toolCallMaxBytes) {
    return { compressed: block, bytesSaved: 0 };
  }
  
  const toolName = block.name;
  let summary: any;
  
  switch (toolName) {
    case "write": {
      const path = block.arguments?.path || "unknown";
      const content = block.arguments?.content || "";
      const lineCount = content.split("\n").length;
      const sizeKB = Math.round(content.length / 1024);
      // Keep the first and last 3 lines as preview
      const lines = content.split("\n");
      const preview = lines.length > 6
        ? [...lines.slice(0, 3), `... (${lineCount - 6} lines omitted, ${sizeKB}KB) ...`, ...lines.slice(-3)].join("\n")
        : content;
      
      summary = {
        path,
        content: `[COMPRESSED: wrote ${lineCount} lines (${sizeKB}KB) to ${path}]\n${preview}`,
        _compressed: true,
        _originalSize: content.length,
        _lineCount: lineCount,
      };
      break;
    }
    
    case "read": {
      const path = block.arguments?.path || "unknown";
      summary = {
        path,
        _compressed: true,
        _note: `Read file: ${path}`,
      };
      break;
    }
    
    case "bash": {
      const command = block.arguments?.command || "";
      // Keep the command itself but truncate if very long
      summary = {
        command: command.length > 200 ? command.slice(0, 200) + "..." : command,
        _compressed: command.length > 200,
        _originalCommandLength: command.length,
      };
      break;
    }
    
    case "edit": {
      const path = block.arguments?.path || "unknown";
      const oldText = block.arguments?.oldText || "";
      const newText = block.arguments?.newText || "";
      summary = {
        path,
        oldText: oldText.length > 100 ? oldText.slice(0, 100) + `... (${oldText.length} chars)` : oldText,
        newText: newText.length > 100 ? newText.slice(0, 100) + `... (${newText.length} chars)` : newText,
        _compressed: true,
      };
      break;
    }
    
    default:
      // Unknown tool — keep full if small, truncate if large
      summary = block.arguments;
      if (originalSize > 2000) {
        summary = { _compressed: true, _note: `${toolName} call (${originalSize} bytes)`, _preview: argsStr.slice(0, 200) };
      }
  }
  
  const compressed = { ...block, arguments: summary };
  const compressedSize = JSON.stringify(summary).length;
  
  return { compressed, bytesSaved: originalSize - compressedSize };
}
```

### Step 3: Tool result compressor

```typescript
function compressToolResult(block: any): { compressed: any; bytesSaved: number } {
  if (block.type !== "toolResult") return { compressed: block, bytesSaved: 0 };
  
  const content = typeof block.content === "string" ? block.content : JSON.stringify(block.content || "");
  const originalSize = content.length;
  
  if (originalSize <= DEFAULT_CONFIG.toolResultMaxBytes) {
    return { compressed: block, bytesSaved: 0 };
  }
  
  // Keep head and tail of the result
  const lines = content.split("\n");
  const headLines = 5;
  const tailLines = 5;
  
  let summary: string;
  if (lines.length > headLines + tailLines + 2) {
    const head = lines.slice(0, headLines).join("\n");
    const tail = lines.slice(-tailLines).join("\n");
    const omitted = lines.length - headLines - tailLines;
    summary = `${head}\n\n[... ${omitted} lines omitted (${Math.round(originalSize / 1024)}KB total) ...]\n\n${tail}`;
  } else {
    // Short enough by line count but large by bytes (long lines)
    summary = content.slice(0, 500) + `\n\n[... truncated (${Math.round(originalSize / 1024)}KB total) ...]`;
  }
  
  const compressed = { ...block, content: summary, _compressed: true, _originalSize: originalSize };
  
  return { compressed, bytesSaved: originalSize - summary.length };
}
```

### Step 4: Thinking block stripper

```typescript
function stripThinking(block: any): { compressed: any | null; bytesSaved: number } {
  if (block.type !== "thinking") return { compressed: block, bytesSaved: 0 };
  
  const originalSize = (block.text || "").length;
  
  // Replace with a marker that preserves structure but removes content
  const compressed = {
    type: "thinking",
    text: `[thinking block removed during compression — ${originalSize} chars]`,
    _compressed: true,
  };
  
  return { compressed, bytesSaved: originalSize - compressed.text.length };
}
```

### Step 5: The main compression function

```typescript
export function compressSession(
  sessionPath: string,
  config: CompressionConfig = DEFAULT_CONFIG
): CompressionStats {
  const originalContent = readFileSync(sessionPath, "utf-8");
  const originalSize = originalContent.length;
  
  // Check size threshold
  if (originalSize < config.sizeThresholdKB * 1024) {
    return {
      originalSize, compressedSize: originalSize, ratio: 0,
      toolCallsCompressed: 0, toolResultsCompressed: 0,
      thinkingBlocksRemoved: 0, redundanciesEliminated: 0,
    };
  }
  
  // Backup
  if (config.keepBackup) {
    const backupPath = sessionPath.replace(".jsonl", ".uncompressed.jsonl");
    if (!existsSync(backupPath)) {
      copyFileSync(sessionPath, backupPath);
    }
  }
  
  const lines = originalContent.split("\n").filter(Boolean);
  const totalLines = lines.length;
  
  // Determine which lines are "recent" (don't compress)
  // Count user messages to determine turns
  let turnCount = 0;
  const turnBoundaries: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    try {
      const event = JSON.parse(lines[i]);
      if (event.message?.role === "user") {
        turnCount++;
        turnBoundaries.push(i);
      }
    } catch (e) { /* skip */ }
  }
  
  // Don't compress the last N turns
  const compressBefore = turnBoundaries.length > config.turnThresholdBeforeCompress
    ? turnBoundaries[turnBoundaries.length - config.turnThresholdBeforeCompress]
    : 0;
  
  let stats: CompressionStats = {
    originalSize,
    compressedSize: 0,
    ratio: 0,
    toolCallsCompressed: 0,
    toolResultsCompressed: 0,
    thinkingBlocksRemoved: 0,
    redundanciesEliminated: 0,
  };
  
  const compressedLines: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    try {
      const event = JSON.parse(lines[i]);
      
      // Don't compress recent turns or non-message events
      if (i >= compressBefore || !event.message?.content) {
        compressedLines.push(lines[i]);
        continue;
      }
      
      // Compress each content block
      const compressedContent = event.message.content.map((block: any) => {
        // Tool calls
        if (block.type === "toolCall") {
          const { compressed, bytesSaved } = compressToolCall(block);
          if (bytesSaved > 0) stats.toolCallsCompressed++;
          return compressed;
        }
        
        // Tool results
        if (block.type === "toolResult") {
          const { compressed, bytesSaved } = compressToolResult(block);
          if (bytesSaved > 0) stats.toolResultsCompressed++;
          return compressed;
        }
        
        // Thinking blocks
        if (block.type === "thinking" && config.stripThinking) {
          const { compressed, bytesSaved } = stripThinking(block);
          if (bytesSaved > 0) stats.thinkingBlocksRemoved++;
          return compressed;
        }
        
        return block;
      });
      
      const compressedEvent = {
        ...event,
        message: { ...event.message, content: compressedContent },
      };
      
      compressedLines.push(JSON.stringify(compressedEvent));
    } catch (e) {
      // Keep non-JSON lines as-is
      compressedLines.push(lines[i]);
    }
  }
  
  const compressedContent = compressedLines.join("\n") + "\n";
  stats.compressedSize = compressedContent.length;
  stats.ratio = 1 - (stats.compressedSize / stats.originalSize);
  
  // Write compressed session
  writeFileSync(sessionPath, compressedContent);
  
  return stats;
}
```

### Step 6: Integrate into agent orchestrator

In `GITCLAW-AGENT.ts`, after the agent finishes but before committing:

```typescript
import { compressSession, loadCompressionConfig } from "./GITCLAW-COMPRESS";

// After agent run, before git add:
const compressionConfig = loadCompressionConfig(gitclawDir);
if (compressionConfig.enabled && latestSession) {
  const stats = compressSession(latestSession, compressionConfig);
  if (stats.ratio > 0) {
    console.log(
      `Session compressed: ${Math.round(stats.originalSize / 1024)}KB → ${Math.round(stats.compressedSize / 1024)}KB ` +
      `(${Math.round(stats.ratio * 100)}% reduction, ` +
      `${stats.toolCallsCompressed} tool calls, ${stats.toolResultsCompressed} results, ${stats.thinkingBlocksRemoved} thinking blocks)`
    );
  }
}
```

### Step 7: Configuration

Add to `.GITCLAW/compression.json`:

```json
{
  "session": {
    "enabled": true,
    "sizeThresholdKB": 100,
    "turnThresholdBeforeCompress": 4,
    "toolCallMaxBytes": 500,
    "toolResultMaxBytes": 1000,
    "stripThinking": true,
    "keepBackup": true
  }
}
```

### Step 8: Test

- Take the 1.27MB session and compress it → verify ~85% reduction
- Resume the compressed session with `pi --session` → verify conversation continuity works
- Verify the last 4 turns are fully intact (no compression of recent context)
- Verify `write` tool calls show file path and size but not full content
- Verify `read` tool results show head/tail preview but not full file content
- Verify thinking blocks are replaced with markers
- Verify backup file is created
- Verify sessions under 100KB are not compressed (threshold)

## Design Decisions

**Why compress tool I/O instead of whole turns?** Because tool I/O is 77.7% of session size but carries the least information density for conversation continuity. A `write` call that wrote a 30KB file to disk: the model needs to know the file was written, not re-read the entire file. The text content of turns (the agent's analysis, the user's requests) is high-density and should be preserved verbatim.

**Why keep the last 4 turns uncompressed?** Recent context is critical for conversation coherence. If the user just asked "modify that function" and the agent just read the file, the model needs the full file content from the `read` to make the modification. After 4+ turns, that specific file content is stale — the agent can re-read if needed.

**Why keep backups?** Compression is lossy. If a compressed session causes conversation quality issues, the backup enables recovery. Over time, once confidence in the compression quality is established, backups can be disabled to save space.

**Why not use gzip/zstd?** The session file must be valid JSONL that `pi` can parse with `--session`. Binary compression would require a decompression step before every run. Content-level compression (replacing large strings with summaries) keeps the file format compatible while achieving similar or better compression ratios for this specific data pattern.

**Why compress in the orchestrator instead of in `pi` itself?** `pi` is an external tool — we can't modify it. The orchestrator controls the session file between runs, making it the natural place for compression. Compression happens after the agent finishes (so the current run has full context) and before commit (so the compressed version is what's stored in git).
