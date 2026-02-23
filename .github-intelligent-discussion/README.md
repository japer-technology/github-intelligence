# GitHub Intelligent Discussion

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/japer-technology/github-intelligence/main/.github-intelligence/github-intelligence-LOGO.png" alt="Discussion Intelligence">
  </picture>
</p>

### Intelligence for GitHub Discussions — long-form Q&A, RFCs, and community conversations.

---

## What It Acts On

| Trigger / Data | Description |
|---|---|
| **`discussion` events** | Triggers when new discussions are created |
| **`discussion_comment` events** | Triggers when new comments are posted in discussion threads |
| **Discussion categories** | Reads category context — General, Ideas, Q&A, Show and Tell, Polls |
| **Threaded replies** | Follows threaded conversation structure within discussions |
| **Upvotes and answers** | Monitors which replies are upvoted or marked as answers in Q&A categories |
| **Poll results** | Reads poll data for structured analysis and summarization |

## What It Acts In

| Surface | How the Agent Participates |
|---|---|
| **Q&A responder** | In Q&A categories, answers questions by searching the codebase and citing specific files and functions |
| **RFC summarizer** | For long design discussions, posts periodic summaries — key arguments, open questions, emerging consensus |
| **Discussion-to-issue converter** | When a discussion reaches a decision, creates a tracked issue with the agreed-upon requirements |
| **Knowledge base builder** | Monitors discussions and compiles recurring answers into searchable FAQ or documentation pages |
| **Poll analysis** | Analyzes poll results and posts structured summaries with insights |
| **Ideas triage** | In Ideas categories, evaluates feasibility, estimates effort, and suggests related existing issues |
| **Discussion sessions** | Maps `discussion #N → state/discussions/N.json → state/sessions/<session>.jsonl` for persistent memory |
