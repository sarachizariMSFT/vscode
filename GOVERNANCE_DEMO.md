# GitHub Copilot Governance — Demo Guide

> **Branch:** `sara/copilot-governance-clean` on [sarachizariMSFT/vscode](https://github.com/sarachizariMSFT/vscode/tree/sara/copilot-governance-clean)
> **Feature:** Shift-left standards enforcement built into Copilot Chat

Copilot Governance silently applies your org or personal coding standards during every agent run — no gates, no interruptions. It shapes the output, then explains what it did.

---

## Quick Setup (5 minutes)

### Prerequisites

- Node.js ≥ 22.14 and npm ≥ 9
- Git
- A GitHub account with Copilot access

### 1 — Clone and install

```bash
git clone https://github.com/sarachizariMSFT/vscode.git
cd vscode
git checkout sara/copilot-governance-clean
npm install
```

### 2 — Launch the dev build

**Windows**
```bat
scripts\code.bat
```

**macOS / Linux**
```bash
scripts/code.sh
```

A VS Code window opens. Sign in to GitHub Copilot when prompted.

---

## Trying Enterprise Mode (org policies)

Drop a `.github/copilot-policies.json` file into the root of any workspace you open:

```json
{
  "policies": [
    {
      "id": "SEC-1",
      "label": "No hardcoded credentials",
      "scope": "org",
      "enforcement": "enforce",
      "category": "security"
    },
    {
      "id": "SEC-4",
      "label": "No custom cryptographic implementations — use jose@5 RS256",
      "scope": "org",
      "enforcement": "enforce",
      "category": "security"
    },
    {
      "id": "DEP-1",
      "label": "Only packages already in package.json may be introduced",
      "scope": "project",
      "enforcement": "warn",
      "category": "dependencies"
    }
  ]
}
```

**What to look for:**
1. Status bar shows `🛡 Guardrails 3` within ~2 seconds of opening the workspace
2. Send any agent request (e.g. "add a login function that stores the password")
3. Copilot silently redirects to a compliant implementation
4. A `🛡 Guardrails applied` summary appears at the bottom of the response
5. Click the status bar badge to open the settings panel — toggle policies on/off

---

## Trying Individual Mode (inferred standards)

1. Make sure there is **no** `.github/copilot-policies.json` in your workspace
2. Open the workspace — a notification appears: *"Copilot Governance: Set up coding standards…"*
3. Click **Get Started**
4. Choose **Existing project** (scans your code) or **New / greenfield** (best-practice defaults)
5. Approve or adjust the checklist — click a standard to toggle it off
6. Send any agent request
7. A `◉ Kept your N coding standards` summary appears at the bottom of the response

To re-trigger the flow manually at any time:
```
Ctrl+Shift+P → Runtime Governance: Setup Governance Standards
```

---

## Settings

All settings live under `github.copilot.governance.*` in VS Code settings:

| Setting | Default | Description |
|---|---|---|
| `enabled` | `true` | Master switch |
| `mode` | `enforce` | `enforce` = silent fix; `warn` = advisory comment |
| `policyUrl` | `""` | Remote URL for policy JSON (enterprise) |
| `autoFixSafeIssues` | `true` | Auto-apply fixes that don't change intent |
| `includeRationaleInResponses` | `true` | Copilot explains governance decisions |
| `rateLimits.enabled` | `false` | Enable per-task rate limits |
| `rateLimits.maxFilesPerTask` | `10` | Max files editable per agent run |
| `rateLimits.maxToolCallsPerRun` | `20` | Max tool calls per agent run |

---

## What the status bar shows

| Badge | Meaning |
|---|---|
| `🛡 Guardrails N` | N total active items (policies + standards combined) |
| *(hidden)* | Governance disabled, store empty, or no workspace open |

Click the badge to open the governance panel where you can toggle individual policies/standards and switch between Enforce and Warn mode.

---

## File structure

All governance code lives in:
```
extensions/copilot/src/governance/
  types.ts                      # Core domain types
  policyStore.ts                # Observable singleton store
  policyLoader.ts               # Loads .github/copilot-policies.json or remote URL
  inferenceEngine.ts            # Scans workspace → infers 5 coding standards
  promptInjector.ts             # Builds system prompt governance block
  governanceSummary.ts          # Post-response markdown summary
  GovernanceService.ts          # Main activation entry point
  GovernancePrompt.tsx          # PromptElement — injects into agent system prompt
  GovernanceOnboardingContribution.ts  # Individual mode onboarding flow
  GovernanceStatusBarItem.ts    # Reactive status bar badge
  GovernanceSidePanel.ts        # Settings panel (Quick Pick)
  InferenceModal.ts             # "How Copilot infers governance" modal
```

---

## Known limitations (v1)

- Governance applies to agent (chat) requests only — not inline completions
- Policy authoring UI is not included; edit `.github/copilot-policies.json` directly
- The `<details>` collapsible summary is not supported in all VS Code chat versions; falls back to a flat markdown table
- Rate limit enforcement is settings-only in v1 (not enforced at the tool-call level)
