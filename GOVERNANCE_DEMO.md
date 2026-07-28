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
1. Status bar shows `⚖️ Guardrails 3` within ~2 seconds of opening the workspace
2. Send any agent request (e.g. "add a login function that stores the password")
3. Copilot silently redirects to a compliant implementation
4. A `🛡 Guardrails applied` summary appears at the bottom of the response
5. Click the status bar badge to open Copilot Chat's inline Guardrails picker — switch mode and toggle policies

---

## Structured rules (deterministic enforcement)

Beyond prompt-shaping, a policy can carry **structured rules** that are enforced deterministically at the tool-call level — before the action runs. Each rule targets a `terminal` command, a `tool`, or a `file` write, and takes an `action`:

- `deny` — block the action (surfaced to the model as a tool failure)
- `warn` — allow but record a flagged decision
- `observe` — allow silently; used only to raise contextual flags (see below)

```json
{
  "policies": [
    {
      "id": "OPS-1",
      "label": "No force-push",
      "scope": "org",
      "enforcement": "enforce",
      "category": "safety",
      "rules": [
        { "target": "terminal", "match": { "commandPattern": "git\\s+push.*(--force|-f)" }, "action": "deny" },
        { "target": "file", "match": { "pathPattern": "\\.env$", "contentPattern": "(api_key|secret)\\s*=" }, "action": "deny" }
      ]
    }
  ]
}
```

Rule match fields by target:

| Target | Match fields | Notes |
|---|---|---|
| `terminal` | `commandPattern` (regex) | Matched against the shell command |
| `tool` | `toolName` (exact) | Matched against the invoked tool name |
| `file` | `pathPattern`, `contentPattern` (both regex, both optional) | Path and content must each match when present |

Invalid regex never enforces — it is treated as no match, so a malformed rule can't block everything.

---

## Contextual rules (stateful enforcement)

Contextual rules make enforcement depend on **what already happened in the run**, not just the current action. Two fields turn a stateless rule into a contextual one:

- `sets` — the session flags this rule raises when it matches
- `when.flags` — the rule only applies when **all** listed flags are already set on the session

The run session persists across every tool call in a single agent request, so a flag raised early gates actions later. Example — once a secret-bearing file has been read, block outbound web requests for the rest of the run:

```json
{
  "policies": [
    {
      "id": "SEC-CTX-1",
      "label": "No outbound network after reading secrets",
      "scope": "org",
      "enforcement": "enforce",
      "category": "security",
      "rules": [
        { "target": "file", "match": { "pathPattern": "(^|/)\\.env$|secrets|credentials" }, "action": "observe", "sets": ["readSecrets"] },
        { "target": "tool", "match": { "toolName": "fetch_webpage" }, "action": "deny", "when": { "flags": ["readSecrets"] } }
      ]
    }
  ]
}
```

**What to look for:** ask the agent to read a `.env` file and then fetch a URL. The read is allowed (and silently taints the session); the later fetch is blocked. The post-response summary shows the block **and** a `Context tracked: ` `readSecrets` line so the reason is explainable.

**Authoring guidelines:**
- Use `observe` for pure taint markers — they never block, they only raise flags.
- Keep flag names stable and descriptive (`readSecrets`, `readUntrustedContent`); they are the contract between rules.
- A `when` rule with a flag that is never `sets` will never fire — double-check flag spelling across rules.
- Contextual behavior is deterministic and per-run; flags reset when the agent request ends.

---

## Trying Individual Mode (inferred standards)

With no `.github/copilot-policies.json` present, recommendations surface **inline** in the
Guardrails chip — there is no pop-up notification. To try it:

1. Make sure there is **no** `.github/copilot-policies.json` in your workspace
2. Open the workspace, then open Copilot Chat and click the **Guardrails** chip
3. Recommended standards appear under **From this workspace** (inferred from a scan) and, as you
   type, under **From your prompt**
4. Click **＋** on a recommendation (or **Add all**) to activate it
5. Send any agent request
6. A `◉ Kept your N coding standards` summary appears at the bottom of the response

Prefer the guided multi-select instead? Run it from the Command Palette:
```
Ctrl+Shift+P → Runtime Governance: Setup Governance Standards
```
This lets you pick project type (existing / greenfield) and approve or trim the inferred standards
in one pass.

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

The badge matches the inline Guardrails chip's icon so the two read as one feature.

| Badge | Meaning |
|---|---|
| `⚖️ Guardrails N` | Enforce mode — N total active items (policies + standards combined) |
| `⚠️ Guardrails N` | Warn mode — same count, badge tinted so the mode is visible at a glance |
| *(hidden)* | Governance disabled, store empty, or no workspace open |

The badge is a status indicator, not a second control panel. Click it to open Copilot Chat and its inline Guardrails picker — the single place to switch mode, toggle policies, and accept recommendations.

---

## Inline Guardrails picker (chat input)

Beyond the status bar badge, governance is controllable directly from the chat composer. A **Guardrails** chip sits in the chat input toolbar so you never have to leave the prompt to adjust standards.

Click the chip to open a dropdown with three groups:

- **Mode** — switch between **Enforce** (block violations) and **Warn only** (allow but flag). Writes `github.copilot.governance.mode`.
- **Policies** — every active policy from `.github/copilot-policies.json` with an inline on/off switch. Turning one off adds its id to `github.copilot.governance.disabledPolicies` so the engine stops enforcing it; the manifest file is left untouched.
- **Recommended** — guardrails that aren't active yet, split into **From this workspace** (inferred from a file/folder scan) and **From your prompt** (learned live from what you type in the composer). Each row has a **＋**, plus an **Add all N recommended** shortcut.

**Live learning.** As you type and submit prompts, matching guardrails are surfaced under *From your prompt*. When a new one arrives, the chip shows an **unread dot**. Opening the picker clears the chip dot, but each newly recommended item keeps **its own dot in the menu** until you add it — so you can always tell which entries are new.

**Accepting a recommendation** writes the policy into `.github/copilot-policies.json` (creating the file if needed) and moves it up into the **Policies** group. The picker stays open after toggles and adds so you can make several changes in one pass.

**What to look for:**
1. Open Copilot Chat — the **Guardrails** chip appears in the input toolbar
2. In an empty/greenfield workspace, open it before typing — baseline safety guardrails are listed under *Recommended*
3. Type `deploy infrastructure with Terraform to the cloud` → the chip shows an unread dot
4. Reopen the picker → *Tag cloud resources* appears under **From your prompt** with a per-item dot
5. Click **＋** → it moves into **Policies** as an active, enforced guardrail

---

## File structure

All governance code lives under `extensions/copilot/src/governance/`, split by layer:
```
extensions/copilot/src/governance/
  common/                              # Pure logic — no vscode API
    types.ts                           # Core domain types (Policy, PolicyRule, RuleCondition…)
    policyStore.ts                     # Observable singleton store
    policyLoader.ts                    # Loads .github/copilot-policies.json or remote URL
    policyEvaluator.ts                 # Matches a context against rules (incl. when/sets/observe)
    governanceRunSession.ts            # Per-run state: counts, edited files, decisions, flags
    governanceEnforcement.ts           # Deterministic per-tool-call enforcement gate
    governanceConfig.ts                # Reads github.copilot.governance.* settings
    inferenceEngine.ts                 # Scans workspace → infers coding standards
    promptInjector.ts                  # Builds system prompt governance block
    governanceSummary.ts               # Post-response markdown summary
    governanceService.ts               # Main activation entry point (contribution)
    governancePrompt.tsx               # PromptElement — injects into agent system prompt
  vscode-node/                         # Imports the vscode API
    governanceOnboardingContribution.ts  # Individual mode onboarding flow
    governanceStatusBarItem.ts         # Reactive status bar badge
    governanceSidePanel.ts             # Settings panel (Quick Pick)
    inferenceModal.ts                  # "How Copilot infers governance" modal
  sample-copilot-policies.json         # Example policy file (incl. a contextual rule)
```

Enforcement is wired into the agent tool-call path in
`extensions/copilot/src/extension/prompts/node/panel/toolCalling.tsx`, and the per-run summary is
appended in `extensions/copilot/src/extension/prompt/node/defaultIntentRequestHandler.ts`.

The inline Guardrails picker lives in the core workbench (it reads the manifest and writes the
bridge settings directly):
```
src/vs/workbench/contrib/chat/browser/widget/input/
  guardrailsPickerActionItem.ts        # Chip + dropdown (mode, policies, recommendations, learn-from-prompt)
  guardrailsPickerActionItem.css       # Chip + per-item unread dot styling
```
It is registered as a chat-input action in
`src/vs/workbench/contrib/chat/browser/actions/chatExecuteActions.ts` and hosted by
`src/vs/workbench/contrib/chat/browser/widget/input/chatInputPart.ts`.

---

## Known limitations

- Governance applies to agent (chat) requests only — not inline completions
- Full policy authoring (rules, conditions) is not in the UI; the inline picker adds recommended policies and toggles them, but complex rules are edited in `.github/copilot-policies.json` directly
- The `<details>` collapsible summary is not supported in all VS Code chat versions; falls back to a flat markdown table
- `warn` rules record and allow — there is no interactive mid-run approval prompt yet (only `deny` hard-blocks)
- File-content rules match only on write tools that expose their content; reads taint by path only
