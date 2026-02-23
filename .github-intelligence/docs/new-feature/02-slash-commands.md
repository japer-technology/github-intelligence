# Feature: Slash Commands with Skill Routing

## Summary

Add a slash command system that parses `/command` patterns from issue and PR comments, enabling users to explicitly invoke skills, control agent behavior, and trigger specific actions. Commands like `/review`, `/explain`, `/test`, `/remember`, and `/help` give users predictable, composable control over the agent.

## Why This Feature

1. **The skill system exists but has no explicit invocation mechanism.** Skills are currently triggered by the agent's own judgment based on description matching. Users have no way to say "use this specific skill" — they can only hope the agent figures it out. Slash commands close this gap.

2. **Predictability is a UX superpower.** Right now, every interaction is "type something and see what the agent does." Slash commands create a contract: `/review` always reviews, `/explain` always explains. This makes the agent trustworthy for team workflows where consistency matters.

3. **It's the foundation for Phase 2 dispatch.** The roadmap calls for label-driven dispatch (`agent:review`, `agent:docs`, `agent:triage`). Slash commands are the user-facing side of the same routing layer. Build commands first, then labels become syntactic sugar on top.

4. **It composes with every other feature.** PR review gets `/review --focus security`. Scheduled runs get `/triage --unlabeled`. Memory gets `/remember <fact>`. Every future capability benefits from explicit invocation.

5. **It's trivially low-risk.** If a comment doesn't start with `/`, behavior is unchanged. The command parser is a pure addition — no existing code paths are modified, only a new branch is added before prompt construction.

## Scope

### In Scope
- Parse `/command [args]` from the first line of issue/PR comments
- Built-in commands: `/help`, `/review`, `/explain`, `/test`, `/remember`, `/forget`, `/status`
- Skill routing: `/skill <skill-name> [args]` invokes a specific skill by name
- Command arguments passed as context to the agent prompt
- `/help` lists available commands and installed skills
- Graceful fallback: unrecognized commands treated as regular prompts with a note

### Out of Scope
- Multi-command comments (only first line is parsed)
- Command aliases or custom command registration
- Label-driven dispatch (Phase 2 follow-up built on top of this)
- Permission scoping per command (all commands use existing auth gating)

## Effort Estimation

| Component | Changes | Effort |
|---|---|---|
| **Command parser** (new file `GITCLAW-COMMANDS.ts`) | Parse first line for `/command` pattern, extract command + args | ~1 hour |
| **Agent orchestrator** (`GITCLAW-AGENT.ts`) | Import parser, route to command handler or augmented prompt | ~1.5 hours |
| **Built-in command handlers** | `/help` (list commands+skills), `/remember` (append to memory.log), `/status` (session info) | ~1.5 hours |
| **Prompt augmentation for skill routing** | Prepend skill-specific instructions when `/skill <name>` or `/review` etc. is used | ~1 hour |
| **Docs** | Update README, add slash-commands reference | ~30 min |
| **Testing** | Test each built-in command, test unknown commands, test skill routing | ~1 hour |

**Total: ~6–7 hours of focused work.**

---

## AI Implementation Instructions

### Step 1: Create the command parser

**New file:** `.GITCLAW/lifecycle/GITCLAW-COMMANDS.ts`

Create a module that exports a `parseCommand` function:

```typescript
interface ParsedCommand {
  isCommand: boolean;
  command: string;       // e.g. "review", "help", "skill"
  args: string;          // everything after the command on the first line
  body: string;          // rest of the comment after the first line
  raw: string;           // original full comment text
}

function parseCommand(text: string): ParsedCommand
```

**Parsing rules:**
- Trim the input text.
- Check if the first line starts with `/` followed by a word character.
- If yes: extract the command name (first word after `/`) and the args (rest of the first line). The body is everything after the first line.
- If no: return `{ isCommand: false, command: "", args: "", body: text, raw: text }`.
- Command names are case-insensitive, normalized to lowercase.
- Examples:
  - `/review focus on error handling` → `{ isCommand: true, command: "review", args: "focus on error handling", body: "", raw: "..." }`
  - `/skill code-review\n\nPlease check the auth module` → `{ isCommand: true, command: "skill", args: "code-review", body: "Please check the auth module", raw: "..." }`
  - `Hey can you help me with this?` → `{ isCommand: false, ... }`

Also export a `BUILT_IN_COMMANDS` map:

```typescript
const BUILT_IN_COMMANDS: Record<string, { description: string; usage: string }> = {
  help:     { description: "List available commands and installed skills", usage: "/help" },
  review:   { description: "Review code in the current issue/PR context", usage: "/review [focus area]" },
  explain:  { description: "Explain code, architecture, or decisions", usage: "/explain [topic or file path]" },
  test:     { description: "Generate or analyze tests", usage: "/test [file or module]" },
  remember: { description: "Save a fact to long-term memory", usage: "/remember <fact to remember>" },
  forget:   { description: "Remove a fact from long-term memory", usage: "/forget <fact to remove>" },
  status:   { description: "Show session info and agent configuration", usage: "/status" },
  skill:    { description: "Invoke a specific skill by name", usage: "/skill <skill-name> [instructions]" },
};
```

### Step 2: Handle `/help` without invoking the agent

**File:** `.GITCLAW/lifecycle/GITCLAW-AGENT.ts`

Import `parseCommand` and `BUILT_IN_COMMANDS` from `GITCLAW-COMMANDS.ts`.

After constructing the `prompt` variable (the raw comment text), parse it:

```typescript
const parsed = parseCommand(prompt);
```

If `parsed.isCommand && parsed.command === "help"`:
- Do NOT run the `pi` agent.
- Instead, build a help response directly:
  1. List all built-in commands from `BUILT_IN_COMMANDS` in a markdown table.
  2. Scan `.GITCLAW/.pi/skills/` for installed skills. For each skill directory, read the YAML frontmatter from `SKILL.md` and extract `name` and `description`.
  3. List installed skills in a second markdown table.
  4. Post the help text as an issue/PR comment via `gh issue comment` or the appropriate API.
  5. Skip all agent invocation, session management, and commit/push steps.
- This makes `/help` instant (no LLM call, no Actions minutes burned).

If `parsed.isCommand && parsed.command === "status"`:
- Do NOT run the `pi` agent.
- Build a status response directly:
  1. Read `.GITCLAW/.pi/settings.json` and report the current provider, model, and thinking level.
  2. Check if a session mapping exists for the current issue/PR and report session age, file path, and approximate size.
  3. Count total sessions in `state/sessions/` and total issues in `state/issues/`.
  4. Report the agent identity from `AGENTS.md` (first line or name field).
  5. Post as a comment. Skip agent invocation.

### Step 3: Handle `/remember` and `/forget` with minimal agent involvement

If `parsed.isCommand && parsed.command === "remember"`:
- Do NOT run the `pi` agent.
- Append to `state/memory.log`:
  ```
  [YYYY-MM-DD HH:MM] <parsed.args + parsed.body>
  ```
- Post a confirmation comment: `🧠 Remembered: <the fact>`
- Commit and push the memory.log change (reuse the existing commit/push logic).
- Skip agent invocation.

If `parsed.isCommand && parsed.command === "forget"`:
- This one DOES invoke the agent, because finding and removing the right memory entry requires judgment.
- Augment the prompt: `"Search state/memory.log for entries related to: <parsed.args>. Show the matching entries and remove them. Confirm what was removed."`

### Step 4: Handle `/review`, `/explain`, `/test` with prompt augmentation

For these commands, the agent IS invoked, but with a structured prompt prefix that makes intent explicit.

If `parsed.isCommand && parsed.command === "review"`:
- Replace `prompt` with:
  ```
  The user has requested a code review via the /review command.

  Focus: <parsed.args || "general review">

  <parsed.body || "Review the code in the context of this issue/PR.">

  Provide a structured code review: identify bugs, security issues, performance concerns, style problems, and suggest improvements. Be specific with file names and line references.
  ```

If `parsed.isCommand && parsed.command === "explain"`:
- Replace `prompt` with:
  ```
  The user has requested an explanation via the /explain command.

  Topic: <parsed.args>

  <parsed.body>

  Provide a clear, thorough explanation. Reference specific files and code when relevant. Use examples where they aid understanding.
  ```

If `parsed.isCommand && parsed.command === "test"`:
- Replace `prompt` with:
  ```
  The user has requested test generation via the /test command.

  Target: <parsed.args>

  <parsed.body>

  Analyze the target code, then generate comprehensive tests. Follow existing test conventions in the repo if any exist. Cover happy paths, edge cases, and error conditions.
  ```

### Step 5: Handle `/skill <name>` with skill-aware routing

If `parsed.isCommand && parsed.command === "skill"`:
- Extract the skill name from `parsed.args` (first word).
- The remaining args after the skill name become instructions.
- Check if `.GITCLAW/.pi/skills/<skill-name>/SKILL.md` exists.
- If it does NOT exist, post a comment: `❌ Unknown skill: \`<skill-name>\`. Use \`/help\` to see available skills.` and skip agent invocation.
- If it DOES exist, read the skill's `SKILL.md` body content.
- Augment the prompt:
  ```
  The user has explicitly invoked the "<skill-name>" skill via /skill command.

  Instructions: <remaining args + parsed.body>

  The skill's guidance follows. Use it to inform your approach:

  ---
  <SKILL.md body content>
  ---

  Follow the skill's instructions to complete the user's request.
  ```
- This forces the skill to be loaded regardless of whether the agent would have triggered it naturally.

### Step 6: Handle unknown commands gracefully

If `parsed.isCommand` but the command is not in `BUILT_IN_COMMANDS`:
- Do NOT reject it. Instead, pass it through to the agent as a regular prompt with a hint:
  ```
  The user typed "/<parsed.command> <parsed.args>".

  This is not a recognized slash command. Interpret it as a natural language request and respond helpfully.

  <parsed.body>

  (Tip: the user may have meant one of: /help, /review, /explain, /test, /remember, /skill)
  ```
- This ensures unknown commands never silently fail.

### Step 7: Update documentation

**New file:** `.GITCLAW/docs/GITCLAW-Slash-Commands.md`
- Document every built-in command with usage examples.
- Document the `/skill` routing mechanism.
- Document how to add custom skills that become invocable via `/skill`.
- Add a "Commands vs. Natural Language" section explaining when to use each.

**File:** `.GITCLAW/README.md`
- Add a "Slash Commands" section after "How It Works" with a quick reference table.
- Link to the full slash commands doc.

**File:** `.GITCLAW/AGENTS.md`
- Add a note in the agent identity that the agent understands slash commands, so it can reference `/help` when users seem confused.

### Step 8: Test

- Post `/help` on an issue → verify instant response listing all commands and skills, no agent invocation.
- Post `/status` on an issue → verify instant response with config and session info.
- Post `/remember The Admiral prefers Vulcan precision` → verify memory.log is updated and committed.
- Post `/review error handling in lifecycle/GITCLAW-AGENT.ts` → verify agent runs with review-focused prompt.
- Post `/explain how session resumption works` → verify agent runs with explanation-focused prompt.
- Post `/test lifecycle/GITCLAW-ENABLED.ts` → verify agent generates tests.
- Post `/skill memory search for all memories about preferences` → verify skill content is loaded into prompt.
- Post `/skill nonexistent-skill do something` → verify error message.
- Post `/yolo lets go` → verify graceful fallback with hint.
- Post a normal comment without `/` → verify behavior is completely unchanged.

## Design Decisions

**Why parse only the first line?** Simplicity and predictability. Users can write `/review focus on auth` on line 1 and then provide detailed context on subsequent lines. No ambiguity about which part is the command.

**Why handle `/help` and `/status` without the agent?** Speed and cost. These are pure metadata queries that don't need an LLM. Responding in <5 seconds (just API calls) vs 30-120 seconds (LLM inference) is a massive UX win. It also saves Actions minutes and API costs.

**Why augment prompts rather than using a middleware layer?** The `pi` agent is already good at following instructions. A structured prompt prefix is simpler, more debuggable, and more flexible than a routing middleware. The agent can still use judgment within the command's scope.

**Why graceful fallback for unknown commands?** Users will typo commands or invent their own. Failing silently or posting an error wastes the interaction. Passing it through with a hint means the agent can usually figure out what the user meant.
