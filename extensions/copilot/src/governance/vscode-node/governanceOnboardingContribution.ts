/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IVSCodeExtensionContext } from '../../platform/extContext/common/extensionContext';
import { IFileSystemService } from '../../platform/filesystem/common/fileSystemService';
import { ILogService } from '../../platform/log/common/logService';
import { IWorkspaceService } from '../../platform/workspace/common/workspaceService';
import { Disposable } from '../../util/vs/base/common/lifecycle';
import { IExtensionContribution } from '../../extension/common/contributions';
import { InferenceEngine } from '../common/inferenceEngine';
import { PolicyStore } from '../common/policyStore';
import { Standard } from '../common/types';
/** workspaceState key — must match the key in GovernanceService. */
const STANDARDS_STATE_KEY = 'copilot.governance.inferredStandards';

/** VS Code command ID to manually re-trigger the onboarding flow. */
const SETUP_COMMAND_ID = 'github.copilot.governance.setupStandards';

/**
 * Registers the manual individual-mode setup command.
 *
 * Recommendations now surface inline through the Guardrails chip in the chat
 * input (its "From this workspace" and "From your prompt" groups), so there is
 * no auto-notification and no prompt-driven auto-accept. Developers who want the
 * guided multi-select can still run `github.copilot.governance.setupStandards`
 * from the Command Palette, which:
 *   1. Picks project type (existing / greenfield)
 *   2. Lets them approve or trim the inferred standards in a multi-select Quick Pick
 *   3. Saves the accepted standards to workspaceState and loads them into the store
 */
export class GovernanceOnboardingContribution extends Disposable implements IExtensionContribution {
	private readonly _policyStore = PolicyStore.getInstance();

	constructor(
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
		@IFileSystemService private readonly _fileSystemService: IFileSystemService,
		@IWorkspaceService private readonly _workspaceService: IWorkspaceService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._register(vscode.commands.registerCommand(SETUP_COMMAND_ID, () => {
			void this._runFlow();
		}));
	}

	// -----------------------------------------------------------------------
	// Onboarding flow
	// -----------------------------------------------------------------------

	private async _runFlow(): Promise<void> {
		let type = await this._pickProjectType();
		if (!type) {
			type = await this._detectProjectType();
		}

		const standards = type === 'existing'
			? await this._scanWorkspace()
			: this._greenfieldStandards();

		if (standards === null) {
			return; // scan failed or was cancelled
		}

		await this._acceptFlow(standards);
	}

	private async _pickProjectType(): Promise<'existing' | 'greenfield' | undefined> {
		const items: (vscode.QuickPickItem & { value: 'existing' | 'greenfield' })[] = [
			{
				label: vscode.l10n.t('$(folder) Existing project'),
				description: vscode.l10n.t('Scan workspace and infer standards from your codebase'),
				value: 'existing',
			},
			{
				label: vscode.l10n.t('$(new-folder) New / greenfield project'),
				description: vscode.l10n.t('Start with a recommended best-practice starter set'),
				value: 'greenfield',
			},
		];

		const picked = await vscode.window.showQuickPick(items, {
			placeHolder: vscode.l10n.t('What kind of project is this?'),
			title: vscode.l10n.t('Copilot Governance: Project Type'),
		});

		return picked?.value;
	}

	private async _detectProjectType(): Promise<'existing' | 'greenfield'> {
		const folders = this._workspaceService.getWorkspaceFolders();
		if (folders.length === 0) {
			return 'greenfield';
		}

		try {
			const rootEntries = await this._fileSystemService.readDirectory(folders[0]);
			const hasProjectSignals = rootEntries.length > 0;
			return hasProjectSignals ? 'existing' : 'greenfield';
		} catch {
			return 'greenfield';
		}
	}

	// -----------------------------------------------------------------------
	// Workspace scan (existing project path)
	// -----------------------------------------------------------------------

	private async _scanWorkspace(): Promise<Standard[] | null> {
		const engine = new InferenceEngine(this._fileSystemService, this._workspaceService, this._logService);
		let result: Awaited<ReturnType<InferenceEngine['scan']>> | null = null;

		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: vscode.l10n.t('Copilot Governance: Scanning workspace...'),
				cancellable: false,
			},
			async progress => {
				result = await engine.scan();
				progress.report({
					message: vscode.l10n.t('{0} files · {1} signals detected', result.filesScanned.length, result.signals.filter(s => s.detected).length),
				});
			},
		);

		if (!result) {
			return null;
		}

		const { inferredStandards } = result as Awaited<ReturnType<InferenceEngine['scan']>>;
		this._logService.trace(`[Governance] Scan complete: ${inferredStandards.length} standards inferred`);
		return inferredStandards;
	}

	// -----------------------------------------------------------------------
	// Greenfield defaults
	// -----------------------------------------------------------------------

	private _greenfieldStandards(): Standard[] {
		return [
			{ id: 'infer-tests', label: vscode.l10n.t('Tests for every new function'), evidence: vscode.l10n.t('Recommended best practice'), enabled: true, category: 'quality' },
			{ id: 'infer-no-secrets', label: vscode.l10n.t('No secrets in source files'), evidence: vscode.l10n.t('Recommended best practice'), enabled: true, category: 'security' },
			{ id: 'infer-async-await', label: vscode.l10n.t('Async/await over raw promises'), evidence: vscode.l10n.t('Recommended best practice'), enabled: true, category: 'style' },
			{ id: 'infer-package-pinning', label: vscode.l10n.t('Pin all new dependencies explicitly'), evidence: vscode.l10n.t('Recommended best practice'), enabled: true, category: 'dependencies' },
			{ id: 'infer-module-boundaries', label: vscode.l10n.t('Separate concerns into layers'), evidence: vscode.l10n.t('Recommended best practice'), enabled: false, category: 'architecture' },
		];
	}

	// -----------------------------------------------------------------------
	// Standards checklist + acceptance
	// -----------------------------------------------------------------------

	private async _acceptFlow(standards: Standard[]): Promise<void> {
		const items: (vscode.QuickPickItem & { standard: Standard })[] = standards.map(s => ({
			label: s.label,
			description: s.evidence,
			picked: s.enabled,
			standard: s,
		}));

		const selected = await vscode.window.showQuickPick(items, {
			canPickMany: true,
			placeHolder: vscode.l10n.t('Select the standards Copilot should quietly maintain — uncheck any you want to skip'),
			title: vscode.l10n.t('Copilot Governance: Confirm Your Standards'),
		});

		if (selected === undefined) {
			return; // user dismissed without confirming
		}

		const selectedIds = new Set(selected.map(s => s.standard.id));
		const accepted: Standard[] = standards.map(s => ({ ...s, enabled: selectedIds.has(s.id) }));

		await this._extensionContext.workspaceState.update(STANDARDS_STATE_KEY, accepted);
		this._policyStore.setStandards(accepted);

		const activeCount = accepted.filter(s => s.enabled).length;
		this._logService.trace(`[Governance] Onboarding complete: ${activeCount}/${accepted.length} standards accepted`);

		vscode.window.showInformationMessage(
			vscode.l10n.t('Copilot Governance: {0} standard{1} active. Copilot will maintain them quietly while you work.', activeCount, activeCount === 1 ? '' : 's')
		);
	}
}
