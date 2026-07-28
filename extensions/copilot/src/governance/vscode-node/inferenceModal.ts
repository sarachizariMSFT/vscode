/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ILogService } from '../../platform/log/common/logService';
import { Disposable } from '../../util/vs/base/common/lifecycle';
import { IExtensionContribution } from '../../extension/common/contributions';

/** VS Code command ID for the "How Copilot infers governance" modal. */
export const INFERENCE_MODAL_COMMAND_ID = 'github.copilot.governance.showInferenceModal';

/**
 * Inference signals used by the workspace scan (Phase 3).
 * Matches spec §5 exactly — shown to the user when they ask "how does Copilot know this?"
 */
const INFERENCE_SIGNALS = [
	{
		signal: 'Test framework present',
		files: '`jest.config.*`, `vitest.config.*`, `__tests__/`',
		standard: 'Tests for every new function',
	},
	{
		signal: '`.env.example` or `.env.template` exists',
		files: '`.env.example`, `.env.template`',
		standard: 'No secrets in source files',
	},
	{
		signal: '`package.json` with pinned versions',
		files: '`package.json`',
		standard: 'Prefer packages already in package.json',
	},
	{
		signal: 'TypeScript project detected',
		files: '`tsconfig.json`',
		standard: 'Async/await over raw promises',
	},
	{
		signal: 'Layered directory structure',
		files: '`controllers/`, `services/`, `repositories/`',
		standard: 'Services stay in their layer',
	},
];

function buildModalContent(): vscode.MarkdownString {
	const lines: string[] = [
		'## How Copilot infers governance for this workspace',
		'',
		'Copilot scans your workspace using five lightweight signals — **no file contents leave your machine**. Only file names and directory structure are read.',
		'',
		'| Signal detected | Files checked | Inferred standard |',
		'|---|---|---|',
		...INFERENCE_SIGNALS.map(s => `| ${s.signal} | ${s.files} | *${s.standard}* |`),
		'',
		'### Privacy guarantee',
		'',
		'The inference engine reads:',
		'- File names and directory structure',
		'- Whether specific config files exist',
		'',
		'It does **not** read file contents, send data to any external endpoint, or store anything outside your workspace state.',
		'',
		'### Changing your governance',
		'',
		'Open the governance panel (`$(law) Guardrails` in the status bar) to toggle any inferred standard on or off. Changes take effect on the next agent request.',
	];

	const md = new vscode.MarkdownString(lines.join('\n'));
	md.isTrusted = true;
	md.supportThemeIcons = true;
	md.supportHtml = false;
	return md;
}

/**
 * "How Copilot infers governance" modal (Phase 8 / Phase 7 detail).
 *
 * Registered as a command — invoked from the GovernanceSidePanel's "Learn more" item.
 * Opens an information message with the full inference signal table from spec §5.
 */
export class InferenceModal extends Disposable implements IExtensionContribution {

	constructor(
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._register(
			vscode.commands.registerCommand(INFERENCE_MODAL_COMMAND_ID, () => this._show())
		);
	}

	private async _show(): Promise<void> {
		this._logService.trace('[Governance] showing inference modal');

		const content = buildModalContent();

		// VS Code information messages don't support full markdown tables.
		// Open a virtual read-only document in the editor instead so the
		// table renders with the editor's built-in markdown preview.
		const doc = await vscode.workspace.openTextDocument({
			language: 'markdown',
			content: content.value,
		});
		await vscode.window.showTextDocument(doc, {
			preview: true,
			viewColumn: vscode.ViewColumn.Beside,
		});
	}
}
