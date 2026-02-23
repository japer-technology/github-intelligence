# GitHub Intelligent Release

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/japer-technology/github-intelligence/main/.github-intelligence/github-intelligence-LOGO.png" alt="Release Intelligence">
  </picture>
</p>

### Intelligence for releases and tags — automated changelogs, versioning, and release management.

---

## What It Acts On

| Trigger / Data | Description |
|---|---|
| **Merged PRs** | Reads merged pull requests since the last tag to generate release content |
| **Closed issues** | Reads resolved issues to include in changelog entries |
| **Git tags** | Reads existing tags to determine the current version and version history |
| **Release notes** | Reads existing release notes and changelog format conventions |
| **Label categories** | Uses PR and issue labels to categorize changes — features, fixes, breaking, internal |
| **`release` events** | Triggers on release creation, publication, and editing |

## What It Acts In

| Surface | How the Agent Participates |
|---|---|
| **Changelog generation** | Reads merged PRs and closed issues since the last tag and generates a structured changelog categorized by labels |
| **Release note drafting** | Creates a draft GitHub Release with generated notes, letting humans review before publishing |
| **Semantic version detection** | Analyzes the nature of changes (breaking, feature, fix) and recommends the next version number |
| **Tag creation** | After human approval, creates an annotated tag and publishes the release |
| **Asset coordination** | Triggers build workflows and attaches binary artifacts to the release |
| **Release announcements** | Posts release summaries to a pinned discussion or a dedicated issue |
| **Upgrade guides** | For breaking changes, generates migration instructions based on the diff between tagged versions |
| **Format support** | Supports both Keep-a-Changelog and Conventional Commits formats |
