# .issue-intelligence 🦞 Enabled

### Delete or rename this file to disable .issue-intelligence

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/japer-technology/blank-with-issue-intelligence/main/.issue-intelligence/ISSUE-INTELLIGENCE-LOGO.png" alt="Issue Intelligence" width="500">
  </picture>
</p>

## File existence behavior

All `ISSUE-INTELLIGENCE-*` workflows run `.issue-intelligence/lifecycle/ISSUE-INTELLIGENCE-ENABLED.ts` as the first blocking guard step. If this file is missing, the guard exits non-zero and prints:

> Issue Intelligence disabled by missing ISSUE-INTELLIGENCE-ENABLED.md

That fail-closed guard blocks all subsequent ISSUE-INTELLIGENCE workflow logic.
