# GitHub Intelligent Reaction

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/japer-technology/github-intelligence/main/.github-intelligence/logo.png" alt="Reaction Intelligence">
  </picture>
</p>

### Intelligence for reactions — feedback signals, quick actions, and status indicators.

---

## What It Acts On

| Trigger / Data | Description |
|---|---|
| **Issue reactions** | Reads reactions (👍, 👎, 😄, 🎉, 😕, ❤️, 🚀, 👀) on issues and comments |
| **PR reactions** | Reads reactions on pull request comments and review threads |
| **Discussion reactions** | Reads upvotes and reactions on discussion replies |
| **Reaction patterns** | Detects trends in reactions across issues — popular requests, controversial topics |
| **Agent comment reactions** | Monitors 👍/👎 reactions on the agent's own comments as quality feedback |

## What It Acts In

| Surface | How the Agent Participates |
|---|---|
| **Working indicator** | Adds a 👀 reaction to signal the agent is processing, removed when done |
| **Feedback-based calibration** | Users react to agent comments (👍 for good, 👎 for bad) and the agent uses this signal to calibrate future responses |
| **Reaction-based quick actions** | Specific reactions trigger agent actions — e.g., 🚀 on a comment to approve, 👀 to request review |
| **Sentiment analysis** | Analyzes reaction patterns to gauge community sentiment on proposals and decisions |
| **Priority signals** | Issues with many 👍 reactions are surfaced as high-demand items in triage reports |
