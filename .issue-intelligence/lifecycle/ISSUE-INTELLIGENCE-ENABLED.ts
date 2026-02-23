/**
 * ISSUE-INTELLIGENCE-ENABLED.ts — Fail-closed guard for the ISSUE-INTELLIGENCE-ENABLED.md sentinel file.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PURPOSE
 * ─────────────────────────────────────────────────────────────────────────────
 * This script is the very first step executed in every ISSUE-INTELLIGENCE-* workflow.
 * Its sole job is to verify that the operator has deliberately opted-in to
 * Issue Intelligence automation by checking for the presence of the sentinel file
 * `.issue-intelligence/ISSUE-INTELLIGENCE-ENABLED.md`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SECURITY MODEL — "FAIL-CLOSED"
 * ─────────────────────────────────────────────────────────────────────────────
 * If the sentinel file is ABSENT the script:
 *   1. Prints a human-readable explanation to stderr.
 *   2. Exits with a non-zero status code (1).
 *   3. Causes GitHub Actions to mark the job as failed, which prevents every
 *      downstream step (dependency install, agent run, git push, etc.) from
 *      executing.
 *
 * This "fail-closed" design means Issue Intelligence is ALWAYS disabled by default on
 * a freshly cloned repository until the operator explicitly creates (or
 * restores) the sentinel file, preventing accidental automation.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 * The workflow invokes this file as the "Guard" step:
 *
 *   - name: Guard
 *     run: bun .issue-intelligence/lifecycle/ISSUE-INTELLIGENCE-ENABLED.ts
 *
 * To ENABLE  Issue Intelligence: ensure `.issue-intelligence/ISSUE-INTELLIGENCE-ENABLED.md` exists in the repo.
 * To DISABLE Issue Intelligence: delete `.issue-intelligence/ISSUE-INTELLIGENCE-ENABLED.md` and commit the removal.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEPENDENCIES
 * ─────────────────────────────────────────────────────────────────────────────
 * - Node.js built-in `fs` module  (existsSync)
 * - Node.js built-in `path` module (resolve)
 * - Bun runtime (for `import.meta.dir` support)
 *
 * No external packages are required; this file intentionally has zero
 * third-party dependencies so it can run before `bun install`.
 */

import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

// ─── Resolve the absolute path to the sentinel file ───────────────────────────
// `import.meta.dir` resolves to the directory containing THIS script, i.e.
// `.issue-intelligence/lifecycle/`.  We step one level up (`..`) to reach `.issue-intelligence/`,
// then join with the sentinel filename.
const enabledFile = resolve(import.meta.dir, "..", "ISSUE-INTELLIGENCE-ENABLED.md");

// ─── Guard: fail-closed if the sentinel is missing ────────────────────────────
// Print a clear, actionable error message before exiting so that operators
// immediately understand why the workflow stopped and what to do about it.
if (!existsSync(enabledFile)) {
  console.error(
    "Issue Intelligence disabled — sentinel file `.issue-intelligence/ISSUE-INTELLIGENCE-ENABLED.md` is missing.\n" +
    "To enable Issue Intelligence, restore that file and push it to the repository."
  );
  process.exit(1);
}

// ─── Sentinel found: log confirmation and continue to further checks ─────────
console.log("Issue Intelligence enabled — ISSUE-INTELLIGENCE-ENABLED.md found.");

// ─── Requires-heart gate ──────────────────────────────────────────────────────
// If the file `ISSUE-INTELLIGENCE-HEART-REQUIRED.md` exists in the
// `.issue-intelligence/` directory, newly opened issues must have a ❤️ (heart)
// reaction to be processed.  This allows repository owners to opt-in to a gating
// mechanism that requires explicit approval (via heart reaction) before the agent
// processes an issue.
//
// The check only applies to `issues` events (newly opened issues); follow-up
// comments (`issue_comment`) are always processed so that approved conversations
// can continue uninterrupted.
const heartRequiredFile = resolve(import.meta.dir, "..", "ISSUE-INTELLIGENCE-HEART-REQUIRED.md");

if (existsSync(heartRequiredFile) && process.env.GITHUB_EVENT_NAME === "issues") {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath) {
    const event = JSON.parse(readFileSync(eventPath, "utf-8"));
    const repo = process.env.GITHUB_REPOSITORY!;
    const issueNumber: number = event.issue.number;

    // Use the `gh` CLI to query the issue's reactions for a heart emoji.
    const proc = Bun.spawn(
      [
        "gh", "api",
        `repos/${repo}/issues/${issueNumber}/reactions`,
        "--jq", '[.[] | select(.content == "heart")] | length',
      ],
      { stdout: "pipe", stderr: "inherit" }
    );
    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      console.error(
        "Requires-heart gate — failed to query reactions via gh API (exit code " +
        `${exitCode}). Failing closed to prevent unreviewed issue processing.`
      );
      process.exit(1);
    }

    if (parseInt(output.trim(), 10) === 0) {
      console.error(
        `Issue #${issueNumber} skipped — requires-heart gate is active ` +
        `(ISSUE-INTELLIGENCE-HEART-REQUIRED.md present) but no ❤️ reaction on the issue.\n` +
        "Add a heart reaction to the issue and re-open or re-trigger the workflow."
      );
      process.exit(1);
    }
    console.log("Requires-heart gate passed — ❤️ reaction found.");
  }
}
