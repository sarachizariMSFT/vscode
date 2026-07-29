# Copilot Guardrails — Greenfield / Onboarding Demo

This workspace has **no `.github/copilot-policies.json`** — it's the "starting fresh" story.
Use it to show how Guardrails **infers project standards** and onboards a repo that has no org policy file yet.

It ships with realistic signals so the inference scan lights up:

| Signal in this repo | Standard it infers |
|---|---|
| `jest.config.js` + `__tests__/…test.ts` | *Tests for every new function* |
| `.env.example` | *No secrets in source files* |
| `package.json` | *Prefer packages already in `package.json`* |
| `tsconfig.json` | *Async/await over raw promises* |
| `src/controllers`, `src/services`, `src/repositories` | *Services stay in their layer* |

---

## Setup

1. Open **this folder** (`greenfield-demo`) as your workspace in the governance build.
2. Make sure `github.copilot.governance.enabled` is `true` (it's on by default).
3. Because there's no policy file, the status bar shows Guardrails running on **inferred standards**, not org policies.

---

## Scenario A — Onboard an existing project (inference scan)

1. **Command Palette** → run **`Copilot Governance: Set Up Standards`**
   (command id `github.copilot.governance.setupStandards`).
2. In the picker choose **📁 Existing project**.
3. A progress notification "**Scanning workspace…**" runs the inference engine
   (it reads file **names/structure only** — never file contents).
4. A multi-select appears: **"Select the standards Copilot should quietly maintain."**
   All five signals above are pre-detected. Accept them.
5. You'll get **"5 standard(s) active"** and Guardrails now quietly steers Copilot with them.

> These are saved to workspace state, so re-opening the folder keeps them without re-scanning.

## Scenario B — Start truly greenfield (no signals)

1. Create/open an **empty** folder (e.g. `mkdir C:\Users\%USERNAME%\blank-demo`) as the workspace.
2. Run **`Copilot Governance: Set Up Standards`** → choose **🆕 New / greenfield project**.
3. Instead of scanning, it offers a **starter best-practice set** (tests, no hardcoded secrets,
   dependency hygiene, async/await, layering). Multi-select the ones you want → they go active.

> This is the "I have nothing yet, give me sensible defaults" path. It ignores folder contents.

## Scenario C — See *why* each standard was inferred

From the Guardrails picker (click the status-bar badge) choose **Learn more**, or run the command
`github.copilot.governance.showInferenceModal`. It opens a markdown doc listing every inference
**signal → standard** mapping, so a viewer understands the reasoning, not just the result.

## Scenario D — Standards actually steer Copilot

With standards active, ask the Agent:
> **Prompt:** "Add a `deleteUser(id)` function to `src/services/userService.ts`."

Copilot follows the inferred *Tests for every new function* standard and adds/updates a test in
`__tests__/`, and keeps the service/repository layering — without you asking.

---

## Where things live

| What | Where |
|---|---|
| Inferred standards (after accept) | workspace state key `copilot.governance.inferredStandards` |
| Enable/disable | `github.copilot.governance.enabled` |
| Onboarding command | `github.copilot.governance.setupStandards` (Command Palette) |
| Inference reasoning modal | `github.copilot.governance.showInferenceModal` (picker → Learn more) |

No secrets in this repo are real — everything is demo scaffolding.
