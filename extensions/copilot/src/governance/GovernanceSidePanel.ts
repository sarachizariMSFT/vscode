/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ConfigKey, IConfigurationService } from '../platform/configuration/common/configurationService';
import { ILogService } from '../platform/log/common/logService';
import { Disposable } from '../util/vs/base/common/lifecycle';
import { IExtensionContribution } from '../extension/common/contributions';
import { PolicyStore } from './policyStore';
import { ActivePolicy, Standard } from './types';
import { INFERENCE_MODAL_COMMAND_ID } from './InferenceModal';

/** Command registered by this contribution — also used by GovernanceStatusBarItem. */
export const OPEN_PANEL_COMMAND_ID = 'github.copilot.governance.openPanel';

/** Discriminated-union items for the governance Quick Pick. */
interface PolicyItem extends vscode.QuickPickItem {
	readonly itemType: 'policy';
	readonly policy: ActivePolicy;
}

interface StandardItem extends vscode.QuickPickItem {
	readonly itemType: 'standard';
	readonly standard: Standard;
}

interface ActionItem extends vscode.QuickPickItem {
	readonly itemType: 'action';
	readonly action: 'toggleMode' | 'rescan' | 'learnMore';
}

type PanelItem = PolicyItem | StandardItem | ActionItem;

function isSeparator(item: vscode.QuickPickItem): boolean {
	return item.kind === vscode.QuickPickItemKind.Separator;
}

function asPanelItem(item: vscode.QuickPickItem): PanelItem | undefined {
	const p = item as Partial<PanelItem>;
	return p.itemType ? p as PanelItem : undefined;
}

function separator(label: string): vscode.QuickPickItem {
	return { label, kind: vscode.QuickPickItemKind.Separator };
}

/**
 * Governance side panel (Phase 7).
 *
 * Opens as a VS Code Quick Pick that allows the user to:
 * - Toggle individual policies / standards on or off
 * - Switch the global enforcement mode between "enforce" and "warn"
 * - Trigger a fresh workspace scan for repo-inferred standards
 *
 * Registered as an `IExtensionContribution` so it is activated with the extension
 * and registers the `github.copilot.governance.openPanel` command.
 */
export class GovernanceSidePanel extends Disposable implements IExtensionContribution {

	private readonly _policyStore = PolicyStore.getInstance();

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		this._register(
			vscode.commands.registerCommand(OPEN_PANEL_COMMAND_ID, () => this._open())
		);
	}

	private async _open(): Promise<void> {
		const qp = vscode.window.createQuickPick<vscode.QuickPickItem>();
		qp.title = 'GitHub Copilot Governance';
		qp.placeholder = 'Toggle policies / standards — press Enter to apply';
		qp.canSelectMany = false;
		qp.keepScrollPosition = true;

		const refresh = () => { qp.items = this._buildItems(); };
		refresh();

		const disposables: vscode.Disposable[] = [];

		disposables.push(
			this._policyStore.onDidChange(() => refresh()),
			qp.onDidChangeSelection(([item]) => {
				if (!item || isSeparator(item)) { return; }
				const panelItem = asPanelItem(item);
				if (panelItem) {
					this._handleSelection(panelItem);
					refresh();
				}
			}),
			qp.onDidHide(() => {
				disposables.forEach(d => d.dispose());
				qp.dispose();
			}),
		);

		qp.show();
	}

	private _buildItems(): vscode.QuickPickItem[] {
		const items: vscode.QuickPickItem[] = [];
		const mode = this._configurationService.getConfig(ConfigKey.Governance.Mode) as string;
		const policies = this._policyStore.activePolicies;
		const standards = this._policyStore.activeStandards;

		// ── Global settings ───────────────────────────────────────────────────
		items.push(separator('Settings'));
		const modeItem: ActionItem = {
			itemType: 'action',
			action: 'toggleMode',
			label: `$(gear) Mode: ${mode === 'enforce' ? 'Enforce (active)' : 'Warn only (active)'}`,
			detail: mode === 'enforce'
				? 'Click to switch to Warn mode — Copilot flags issues but does not redirect'
				: 'Click to switch to Enforce mode — Copilot redirects to compliant implementations',
		};
		items.push(modeItem);

		// ── Enterprise policies ───────────────────────────────────────────────
		if (policies.length > 0) {
			items.push(separator('Active Policies'));
			for (const policy of policies) {
				const icon = policy.status === 'warn' ? '$(warning)' : '$(pass)';
				const policyItem: PolicyItem = {
					itemType: 'policy',
					policy,
					label: `${icon} ${policy.label}`,
					detail: `${policy.scope === 'org' ? `Org · ${policy.id}` : policy.scope} · ${policy.enforcement}${policy.description ? ' — ' + policy.description : ''}`,
				};
				items.push(policyItem);
			}
		}

		// ── Individual standards ──────────────────────────────────────────────
		if (standards.length > 0) {
			items.push(separator('Coding Standards'));
			for (const standard of standards) {
				const icon = standard.enabled ? '$(pass-filled)' : '$(circle-large-outline)';
				const standardItem: StandardItem = {
					itemType: 'standard',
					standard,
					label: `${icon} ${standard.label}`,
					detail: standard.evidence || undefined,
				};
				items.push(standardItem);
			}

			items.push(separator(''));
			const rescanItem: ActionItem = {
				itemType: 'action',
				action: 'rescan',
				label: '$(refresh) Re-run workspace scan',
				detail: 'Re-analyse your workspace to refresh inferred governance standards',
			};
			items.push(rescanItem);

			const learnMoreItem: ActionItem = {
				itemType: 'action',
				action: 'learnMore',
				label: '$(question) How Copilot infers your standards',
				detail: 'See the 5 signals used during workspace scan',
			};
			items.push(learnMoreItem);
		}

		return items;
	}

	private _handleSelection(item: PanelItem): void {
		if (item.itemType === 'policy') {
			this._policyStore.togglePolicy(item.policy.id);
			this._logService.trace(`[Governance] toggled policy ${item.policy.id}`);
		} else if (item.itemType === 'standard') {
			this._policyStore.toggleStandard(item.standard.id);
			this._logService.trace(`[Governance] toggled standard ${item.standard.id}`);
		} else if (item.itemType === 'action') {
			if (item.action === 'toggleMode') {
				const current = this._configurationService.getConfig(ConfigKey.Governance.Mode) as string;
				const next = current === 'enforce' ? 'warn' : 'enforce';
				void vscode.workspace.getConfiguration('github.copilot').update(
					'governance.mode',
					next,
					vscode.ConfigurationTarget.Workspace,
				);
				this._logService.trace(`[Governance] mode switched to ${next}`);
			} else if (item.action === 'rescan') {
				void vscode.commands.executeCommand('github.copilot.governance.setupStandards');
			} else if (item.action === 'learnMore') {
				void vscode.commands.executeCommand(INFERENCE_MODAL_COMMAND_ID);
			}
		}
	}
}
