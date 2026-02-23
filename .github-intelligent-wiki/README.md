# GitHub Intelligent Wiki

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/japer-technology/github-intelligence/main/.github-intelligence/github-intelligence-LOGO.png" alt="Wiki Intelligence">
  </picture>
</p>

### Intelligence for GitHub Wikis — auto-generated documentation, knowledge bases, and decision logs.

---

## What It Acts On

| Trigger / Data | Description |
|---|---|
| **Wiki pages** | Reads existing wiki pages and their content for updates and synchronization |
| **Wiki page history** | Tracks wiki page revisions and diffs via the wiki's underlying git repository |
| **Repository source code** | Analyzes code to generate architecture overviews, API references, and configuration guides |
| **Agent conversations** | Reads past issue and discussion sessions to compile knowledge into wiki pages |
| **`gollum` events** | Triggers when wiki pages are created or updated |

## What It Acts In

| Surface | How the Agent Participates |
|---|---|
| **Auto-generated wiki** | Generates wiki pages from code analysis — architecture overviews, API references, configuration guides |
| **Wiki-as-knowledge-base** | Maintains a structured knowledge base in the wiki, updated as the agent learns from conversations |
| **Decision log** | Each significant decision discussed in issues is summarized and added to a wiki decision log |
| **Documentation sync** | Keeps wiki content synchronized with in-repo documentation — changes in one propagate to the other |
| **Sidebar navigation** | Maintains wiki sidebar navigation structure as pages are added and updated |
