/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IVSCodeExtensionContext } from '../platform/extContext/common/extensionContext';
import { IFileSystemService } from '../platform/filesystem/common/fileSystemService';
import { ILogService } from '../platform/log/common/logService';
import { IWorkspaceService } from '../platform/workspace/common/workspaceService';
import { Disposable } from '../util/vs/base/common/lifecycle';
import { IExtensionContribution } from '../extension/common/contributions';
import { InferenceEngine } from './inferenceEngine';
import { PolicyStore } from './policyStore';
import { Standard } from './types';

/** workspaceState key — must match the key in GovernanceService. */
const STANDARDS_STATE_KEY = 'copilot.governance.inferredStandards';

/** VS Code command ID to manually re-trigger the onboarding flow. */
const SETUP_COMMAND_ID = 'github.copilot.governance.setupStandards';

/**
 * Drives the individual-mode onboarding flow (Phase 5).
 *
 * Reacts to `PolicyStore.onNeedsOnboardingChanged`: when the flag is raised,
 * shows an information-message notification. The user can then:
 *   1. Pick project type (existing / greenfield)
 *   2. Approve or trim the inferred/suggested standards in a multi-select Quick Pick
 *   3. Click "Accept" — standards are saved to workspaceState and loaded into the store
 *
 * Also registers `github.copilot.governance.setupStandards` for manual re-trigger.
 */
export class GovernanceOnboardingContribution extends Disposable implements IExtensionContribution {
	private readonly _policyStore = PolicyStore.getInstance();
	/** Guard so we only prompt once per session even if the event fires multiple times. */
	private _prompted = false;

	constructor(
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
		@IFileSystemService private readonly _fileSystemService: IFileSystemService,
		@IWorkspaceService private readonly _workspaceService: IWorkspaceService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._register(this._policyStore.onNeedsOnboardingChanged(needs => {
			if (needs && !this._prompted) {
				this._prompted = true;
				void this._notifyUser();
			}
		}));

		this._register(vscode.commands.registerCommand(SETUP_COMMAND_ID, () => {
			void this._runFlow();
		}));
	}

	// -----------------------------------------------------------------------
	// Notification entry point
	// -----------------------------------------------------------------------

	private async _notifyUser(): Promise<void> {
		const choice = await vscode.window.showInformationMessage(
			vscode.l10n.t('Copilot Governance: Set up coding standards Copilot will quietly maintain while you work.'),
			vscode.l10n.t('Get Started'),
			vscode.l10n.t('Not Now'),
		);
		if (choice === vscode.l10n.t('Get Started')) {
			await this._runFlow();
		}
	}

	// -----------------------------------------------------------------------
	// Onboarding flow
	// -----------------------------------------------------------------------

	private async _runFlow(): Promise<void> {
		const type = await this._pickProjectType();
		if (!type) {
			return; // dismissed
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
		this._policyStore.setNeedsOnboarding(false);

		const activeCount = accepted.filter(s => s.enabled).length;
		this._logService.trace(`[Governance] Onboarding complete: ${activeCount}/${accepted.length} standards accepted`);

		vscode.window.showInformationMessage(
			vscode.l10n.t('Copilot Governance: {0} standard{1} active. Copilot will maintain them quietly while you work.', activeCount, activeCount === 1 ? '' : 's')
		);
	}
}
