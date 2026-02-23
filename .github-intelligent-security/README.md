# GitHub Intelligent Security

<p align="center">
  <picture>
    <img src="https://raw.githubusercontent.com/japer-technology/github-intelligence/main/.github-intelligence/logo.png" alt="Security Intelligence">
  </picture>
</p>

### Intelligence for security — code scanning, dependency audits, secret detection, and CODEOWNERS management.

---

## What It Acts On

| Trigger / Data | Description |
|---|---|
| **Code Scanning (CodeQL) alerts** | Reads static analysis alerts with severity, location, and remediation guidance |
| **Dependabot alerts** | Reads known vulnerabilities in dependencies with compatibility scores |
| **Dependabot PRs** | Monitors automated version update PRs for review and approval |
| **Secret Scanning alerts** | Detects exposed credentials — API keys, tokens, passwords — on push |
| **CODEOWNERS file** | Reads file path → owner mappings for reviewer routing and coverage analysis |
| **`security_advisory` events** | Triggers on new security advisory publications for real-time response |
| **SARIF reports** | Reads third-party security tool results in SARIF format |

## What It Acts In

| Surface | How the Agent Participates |
|---|---|
| **CodeQL triage** | Triages alerts by severity — auto-closes informational alerts, escalates critical ones to dedicated issues with fix proposals |
| **Fix PR generation** | Opens fix PRs for auto-remediable vulnerability patterns (SQL injection, XSS, path traversal) |
| **Alert trend tracking** | Detects regressions where new alerts appear after a merge and surfaces them in periodic reports |
| **Dependabot coordination** | Auto-approves low-risk updates (patch bumps, no breaking changes) and summarizes high-risk alerts with impact analysis |
| **Secret response** | Immediately opens a high-priority issue on secret detection with provider-specific containment and rotation instructions |
| **CODEOWNERS generation** | Analyzes `git blame` to generate a CODEOWNERS file reflecting actual ownership patterns |
| **Stale owner detection** | Flags CODEOWNERS entries that reference users who have left or haven't contributed recently |
| **Coverage gap analysis** | Identifies directories or file types not covered by any CODEOWNERS entry |
| **Weekly security digest** | Generates consolidated reports of all open alerts across categories with trend analysis |
