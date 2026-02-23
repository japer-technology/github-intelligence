# .github-intelligence 🦞 Enabled

### Delete or rename this file to disable .github-intelligence

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/japer-technology/blank-with-issue-intelligence/main/.github-intelligence/github-intelligence-LOGO.png" alt="Issue Intelligence" width="500">
  </picture>
</p>

## File existence behavior

All `github-intelligence-*` workflows run `.github-intelligence/lifecycle/github-intelligence-ENABLED.ts` as the first blocking guard step. If this file is missing, the guard exits non-zero and prints:

> Issue Intelligence disabled by missing github-intelligence-ENABLED.md

That fail-closed guard blocks all subsequent ISSUE-INTELLIGENCE workflow logic.
