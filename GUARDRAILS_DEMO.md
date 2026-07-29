# GitHub Copilot Guardrails — Demo Guide

> **Branch:** `sara/copilot-guardrails-inline` on [sarachizariMSFT/vscode](https://github.com/sarachizariMSFT/vscode/tree/sara/copilot-guardrails-inline)
> **Feature:** Shift-left standards enforcement built into Copilot Chat

Copilot Governance applies your org or personal coding standards during every agent run. In **Warn** mode it shapes the output silently and explains what it did afterward; in **Enforce** mode it blocks any restricted step and offers a compliant alternative for you to approve before proceeding.

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
git checkout sara/copilot-guardrails-inline
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

### Fastest path — one command

A ready-to-paste sample policy set ships at [`.github/copilot-policies-sample.json`](.github/copilot-policies-sample.json). To activate it and launch the dev build in one step:

**Windows**
```powershell
scripts\try-governance.ps1
```

This backs up any existing `.github/copilot-policies.json`, copies the sample into place, prints the active policies, and runs `scripts\code.bat`. Use `-NoLaunch` to only activate the policies, or `-Restore` to put your previous policy file back.

### Manual path

Drop a `.github/copilot-policies.json` file into the root of any workspace you open (copy from the sample above, or use this minimal set):

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
1. Status bar shows `⚖ Guardrails 3` (balance icon) within ~2 seconds of opening the workspace
2. Send any agent request (e.g. "add a login function that stores the password")
3. In **Enforce** mode Copilot blocks the restricted step and offers a compliant alternative for you to approve before proceeding; in **Warn** mode it silently redirects to a compliant implementation
4. A Guardrails summary is appended to the response — `🛡 Guardrails applied — N redirected, N enforced` for prompt-shaped policies, or `⚖ Guardrails — Enforce mode · N blocked, N flagged` when a structured rule fires
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

With no `.github/copilot-policies.json` present, Copilot infers coding standards from a workspace
scan and surfaces them **inline** in the Guardrails picker — there is no pop-up notification.

Open Copilot Chat, click the **Guardrails** chip, and add recommendations as described in
[The Guardrails control surface](#the-guardrails-control-surface). Once you've added at least one
standard and send an agent request, a `◉ Kept your N coding standards` summary appears at the
bottom of the response.

Prefer a guided multi-select instead of the inline picker? Run **Runtime Governance: Setup
Governance Standards** from the Command Palette (`Ctrl+Shift+P`). It lets you pick project type
(existing / greenfield) and approve or trim the inferred standards in one pass.

---

## Settings

All settings live under `github.copilot.governance.*` in VS Code settings:

| Setting | Default | Description |
|---|---|---|
| `enabled` | `true` | Master switch; when off the module is a no-op |
| `mode` | `enforce` | `enforce` = block the restricted step and offer a compliant alternative to approve; `warn` = flag the violation but let the action proceed |
| `policyUrl` | `""` | Remote URL for policy JSON, fetched in addition to the workspace file (enterprise) |
| `autoFixSafeIssues` | `true` | Auto-apply fixes that don't change intent |
| `showDiffSummaryAfterEdits` | `true` | Append the Guardrails summary after each agent edit session |
| `includeRationaleInResponses` | `true` | Include a one-sentence rationale per governance decision |
| `rateLimits.enabled` | `false` | Enable per-run rate limits |
| `rateLimits.maxFilesPerTask` | `10` | Max files editable per agent run |
| `rateLimits.maxToolCallsPerRun` | `20` | Max tool calls per agent run |
| `disabledPolicies` | `[]` | Policy ids toggled off from the inline picker; managed by the UI, not edited by hand |

---

## The Guardrails control surface

Governance has one control surface — the **Guardrails picker** in Copilot Chat — with two entry points that share the same balance icon:

- **Status bar badge** — `⚖ Guardrails N` in Enforce mode, `⚠ Guardrails N` in Warn mode, where *N* is the total active items (policies + standards). Hidden when governance is disabled, the store is empty, or no workspace is open. The badge is a status indicator; clicking it opens the picker.
- **Chat input chip** — a **Guardrails** chip in the composer toolbar so you never leave the prompt to adjust standards.

Either one opens a dropdown with three groups:

- **Mode** — switch between **Enforce** (block violations, then offer a compliant alternative to approve) and **Warn only** (flag the violation, let it proceed). Writes `github.copilot.governance.mode`.
- **Policies** — every active policy from `.github/copilot-policies.json` with an inline on/off switch. Turning one off adds its id to `github.copilot.governance.disabledPolicies` so the engine stops enforcing it; the manifest file is left untouched.
- **Recommended** — guardrails that aren't active yet, split into **From this workspace** (inferred from a file/folder scan) and **From your prompt** (learned live from what you type). Each row has a **＋**, plus an **Add all N recommended** shortcut.

**Live learning.** As you type and submit prompts, matching guardrails surface under *From your prompt*. When a new one arrives, the chip shows an **unread dot**. Opening the picker clears the chip dot, but each newly recommended item keeps **its own dot in the menu** until you add it — so you can always tell which entries are new.

**Accepting a recommendation** writes the policy into `.github/copilot-policies.json` (creating the file if needed) and moves it into the **Policies** group. The picker stays open after toggles and adds so you can make several changes in one pass.

**What to look for:**
1. Open Copilot Chat — the **Guardrails** chip appears in the input toolbar
2. In an empty/greenfield workspace, open the picker before typing — baseline safety guardrails are listed under *Recommended*
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
- `warn` rules record and allow — there is no interactive mid-run approval prompt yet (only `deny` hard-blocks)
- File-content rules match only on write tools that expose their content; reads taint by path only
