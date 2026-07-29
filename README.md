# Visual Studio Code - Open Source ("Code - OSS")
[![Feature Requests](https://img.shields.io/github/issues/microsoft/vscode/feature-request.svg)](https://github.com/microsoft/vscode/issues?q=is%3Aopen+is%3Aissue+label%3Afeature-request+sort%3Areactions-%2B1-desc)
[![Bugs](https://img.shields.io/github/issues/microsoft/vscode/bug.svg)](https://github.com/microsoft/vscode/issues?utf8=✓&q=is%3Aissue+is%3Aopen+label%3Abug)
[![Gitter](https://img.shields.io/badge/chat-on%20gitter-yellow.svg)](https://gitter.im/Microsoft/vscode)

## The Repository

This repository ("`Code - OSS`") is where we (Microsoft) develop the [Visual Studio Code](https://code.visualstudio.com) product together with the community. Not only do we work on code and issues here, but we also publish our [roadmap](https://github.com/microsoft/vscode/wiki/Roadmap), [monthly iteration plans](https://github.com/microsoft/vscode/wiki/Iteration-Plans), and our [endgame plans](https://github.com/microsoft/vscode/wiki/Running-the-Endgame). This source code is available to everyone under the standard [MIT license](https://github.com/microsoft/vscode/blob/main/LICENSE.txt).

## Visual Studio Code

<p align="center">
  <img alt="VS Code in action" src="https://github.com/user-attachments/assets/56af271c-949d-454c-a3ea-16188c063414">
</p>

[Visual Studio Code](https://code.visualstudio.com) is a distribution of the `Code - OSS` repository with Microsoft-specific customizations released under a traditional [Microsoft product license](https://code.visualstudio.com/License/).

[Visual Studio Code](https://code.visualstudio.com) combines the simplicity of a code editor with what developers need for their core edit-build-debug cycle. It provides comprehensive code editing, navigation, and understanding support along with lightweight debugging, a rich extensibility model, and lightweight integration with existing tools.

Visual Studio Code is updated monthly with new features and bug fixes. You can download it for Windows, macOS, and Linux on [Visual Studio Code's website](https://code.visualstudio.com/Download). To get the latest releases every day, install the [Insiders build](https://code.visualstudio.com/insiders).

## Contributing

There are many ways in which you can participate in this project, for example:

* [Submit bugs and feature requests](https://github.com/microsoft/vscode/issues), and help us verify as they are checked in
* Review [source code changes](https://github.com/microsoft/vscode/pulls)
* Review the [documentation](https://github.com/microsoft/vscode-docs) and make pull requests for anything from typos to new content.

If you are interested in fixing issues and contributing directly to the code base,
please see the document [How to Contribute](https://github.com/microsoft/vscode/wiki/How-to-Contribute), which covers the following:

* [How to build and run from source](https://github.com/microsoft/vscode/wiki/How-to-Contribute)
* [The development workflow, including debugging and running tests](https://github.com/microsoft/vscode/wiki/How-to-Contribute#debugging)
* [Coding guidelines](https://github.com/microsoft/vscode/wiki/Coding-Guidelines)
* [Submitting pull requests](https://github.com/microsoft/vscode/wiki/How-to-Contribute#pull-requests)
* [Finding an issue to work on](https://github.com/microsoft/vscode/wiki/How-to-Contribute#where-to-contribute)
* [Contributing to translations](https://aka.ms/vscodeloc)

## Feedback

* Ask a question on [Stack Overflow](https://stackoverflow.com/questions/tagged/vscode)
* [Request a new feature](CONTRIBUTING.md)
* Upvote [popular feature requests](https://github.com/microsoft/vscode/issues?q=is%3Aopen+is%3Aissue+label%3Afeature-request+sort%3Areactions-%2B1-desc)
* [File an issue](https://github.com/microsoft/vscode/issues)
* Connect with the extension author community on [GitHub Discussions](https://github.com/microsoft/vscode-discussions/discussions) or [Slack](https://aka.ms/vscode-dev-community)
* Follow [@code](https://x.com/code) and let us know what you think!

See our [wiki](https://github.com/microsoft/vscode/wiki/Feedback-Channels) for a description of each of these channels and information on some other available community-driven channels.

---

## GitHub Copilot Governance — Shift-Left Standards Enforcement

> **Branch:** `sara/copilot-governance-inline` · **Fork:** [sarachizariMSFT/vscode](https://github.com/sarachizariMSFT/vscode/tree/sara/copilot-governance-inline)

Enforces your org/team coding standards during every Copilot Chat agent run. Before Copilot generates code, governance rules are injected into the system prompt. Structured rules are also enforced **deterministically** at the tool-call level — a denied command, tool, or file write is blocked before it runs. After each response, a compact summary table shows which guardrails were applied and which context was tracked. In **Enforce** mode a restricted step is blocked and Copilot offers a compliant alternative for you to approve before proceeding; in **Warn** mode Copilot applies a compliant fix silently and flags it in the summary.

### Two Modes

| Mode | How it activates | Source of rules |
|---|---|---|
| **Enterprise** | Drop `.github/copilot-policies.json` in your workspace | Your org's central policy file (local or remote URL) |
| **Individual** | No policy file present → recommendations surface inline in the Guardrails chip | 5-signal workspace scan (test framework, `.env.example`, `tsconfig.json`, folder structure) |

### What's Included

- **Policy loader** — reads `.github/copilot-policies.json` or a remote URL
- **Inference engine** — scans workspace to infer 5 coding standards (no file contents sent externally)
- **Prompt injector** — prepends guardrails as a system message to every agent run
- **Deterministic enforcement** — evaluates every tool call, terminal command, and file write against structured rules before it runs; `deny` blocks, `warn` flags
- **Contextual (stateful) rules** — rules can raise session flags (`sets`) and gate later actions on accumulated state (`when`), e.g. block outbound requests once a secret file has been read in the run
- **Per-run rate limits** — cap tool calls and edited files per agent run
- **Post-response summary** — plain markdown table after each agent response, including any tracked context flags
- **Status bar badge** — `⚖️ Guardrails N` (total active policies + standards; matches the inline chip's icon, tints in Warn mode, and opens the inline picker on click)
- **Inline Guardrails picker** — a Guardrails chip in the chat input toolbar to switch mode (Enforce/Warn), toggle individual policies on/off, and accept recommendations without leaving the composer
- **Live recommendations** — guardrails inferred from a workspace scan and learned from your prompts as you type; new ones are flagged with an unread dot on the chip and a per-item dot in the menu, and accepting one writes it to `.github/copilot-policies.json`
- **Settings panel** — click the badge to toggle policies on/off or rescan
- **Settings** — `github.copilot.governance.*` config keys in VS Code settings

### Install & Run

Requires building VS Code from source. **Prerequisites:** Node.js 20+, Git, active GitHub Copilot subscription.

```bash
# Clone this fork and check out the self-contained demo branch
git clone https://github.com/sarachizariMSFT/vscode.git
cd vscode
git checkout sara/copilot-governance-inline

# Install dependencies (~5 min)
npm install

# Launch pointed at the bundled demo workspace (Windows)
scripts\code.bat .\governance-demo

# Launch (macOS/Linux)
scripts/code.sh ./governance-demo
```

Sign in to GitHub Copilot when prompted, then open the Chat view to try it. See [`governance-demo/README.md`](governance-demo/README.md) for the full step-by-step walkthrough.

### Quick Test — Enterprise Mode

1. Copy `extensions/copilot/src/governance/sample-copilot-policies.json` to `.github/copilot-policies.json` in any open workspace
2. Open Copilot Chat in agent mode and ask it to write code
3. The response ends with a guardrails summary table

### Quick Test — Individual Mode

1. Open a workspace with no `.github/copilot-policies.json`
2. Open Copilot Chat and click the **Guardrails** chip — recommended standards appear under **From this workspace** (no pop-up)
3. Click **＋** on a recommendation (or **Add all**) to activate it; they persist to workspace state
4. Prefer a guided multi-select? Run **Runtime Governance: Setup Governance Standards** from the Command Palette

### Quick Test — Inline Guardrails Picker

1. Open the Copilot Chat input and click the **Guardrails** chip in the toolbar
2. Switch between **Enforce** and **Warn**, and toggle policies on/off inline
3. Type a prompt (e.g. "deploy infrastructure with Terraform") — matching guardrails surface under **From your prompt** with an unread dot
4. Click **＋** on a recommendation (or **Add all**) to write it to `.github/copilot-policies.json`

See [GUARDRAILS_DEMO.md](GUARDRAILS_DEMO.md) for the full walkthrough.

## Related Projects

Many of the core components and extensions to VS Code live in their own repositories on GitHub. For example, the [node debug adapter](https://github.com/microsoft/vscode-node-debug) and the [mono debug adapter](https://github.com/microsoft/vscode-mono-debug) repositories are separate from each other. For a complete list, please visit the [Related Projects](https://github.com/microsoft/vscode/wiki/Related-Projects) page on our [wiki](https://github.com/microsoft/vscode/wiki).

## Bundled Extensions

VS Code includes a set of built-in extensions located in the [extensions](extensions) folder, including grammars and snippets for many languages. Extensions that provide rich language support (inline suggestions, Go to Definition) for a language have the suffix `language-features`. For example, the `json` extension provides coloring for `JSON` and the `json-language-features` extension provides rich language support for `JSON`.

## Development Container

This repository includes a Visual Studio Code Dev Containers / GitHub Codespaces development container.

* For [Dev Containers](https://aka.ms/vscode-remote/download/containers), use the **Dev Containers: Clone Repository in Container Volume...** command which creates a Docker volume for better disk I/O on macOS and Windows.
  * If you already have VS Code and Docker installed, you can also click [here](https://vscode.dev/redirect?url=vscode://ms-vscode-remote.remote-containers/cloneInVolume?url=https://github.com/microsoft/vscode) to get started. This will cause VS Code to automatically install the Dev Containers extension if needed, clone the source code into a container volume, and spin up a dev container for use.

* For Codespaces, install the [GitHub Codespaces](https://marketplace.visualstudio.com/items?itemName=GitHub.codespaces) extension in VS Code, and use the **Codespaces: Create New Codespace** command.

Docker / the Codespace should have at least **4 cores and 6 GB of RAM (8 GB recommended)** to run a full build. See the [development container README](.devcontainer/README.md) for more information.

## Code of Conduct

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

## License

Copyright (c) Microsoft Corporation. All rights reserved.

Licensed under the [MIT](LICENSE.txt) license.
