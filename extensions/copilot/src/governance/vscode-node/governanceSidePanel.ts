/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { ConfigKey, IConfigurationService } from '../../platform/configuration/common/configurationService';
import { ILogService } from '../../platform/log/common/logService';
import { Disposable } from '../../util/vs/base/common/lifecycle';
import { IExtensionContribution } from '../../extension/common/contributions';
import { PolicyStore } from '../common/policyStore';
import { ActivePolicy, GuardrailMode, Standard } from '../common/types';
import { INFERENCE_MODAL_COMMAND_ID } from './inferenceModal';
/** Command registered by this contribution — also used by GovernanceStatusBarItem. */
export const OPEN_PANEL_COMMAND_ID = 'github.copilot.governance.openPanel';

/** Sets the global enforcement mode. Invoked from the status bar tooltip menu. */
export const SET_MODE_COMMAND_ID = 'github.copilot.governance.setMode';

/** Toggles a single policy on/off. Invoked from the status bar tooltip menu. */
export const TOGGLE_POLICY_COMMAND_ID = 'github.copilot.governance.togglePolicy';

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
	readonly action: 'setMode' | 'rescan' | 'learnMore';
	readonly mode?: GuardrailMode;
}

type PanelItem = PolicyItem | StandardItem | ActionItem;

function isSeparator(item: vscode.QuickPickItem): boolean {
	return item.kind === vscode.QuickPickItemKind.Separator;
}

function asPanelItem(item: vscode.QuickPickItem): PanelItem | undefined {
	const p = item as Partial<PanelItem>;
	return p.itemType ? p as PanelItem : undefined;
}

/**
 * Stable identity for a panel item, used to restore the highlighted (active)
 * item after the Quick Pick's `items` array is rebuilt. Separators and other
 * non-panel items return `undefined`.
 */
function itemKey(item: vscode.QuickPickItem): string | undefined {
	const p = asPanelItem(item);
	if (!p) { return undefined; }
	switch (p.itemType) {
		case 'policy': return `policy:${p.policy.id}`;
		case 'standard': return `standard:${p.standard.id}`;
		case 'action': return `action:${p.action}:${p.mode ?? ''}`;
	}
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
		this._register(
			vscode.commands.registerCommand(SET_MODE_COMMAND_ID, (mode: GuardrailMode) => this._setMode(mode))
		);
		this._register(
			vscode.commands.registerCommand(TOGGLE_POLICY_COMMAND_ID, (id: string) => {
				this._policyStore.togglePolicy(id);
				this._logService.trace(`[Governance] toggled policy ${id}`);
			})
		);
	}

	private _setMode(mode: GuardrailMode): void {
		void vscode.workspace.getConfiguration('github.copilot').update(
			'governance.mode',
			mode,
			vscode.ConfigurationTarget.Workspace,
		);
		this._logService.trace(`[Governance] mode switched to ${mode}`);
	}

	private async _open(): Promise<void> {
		const qp = vscode.window.createQuickPick<vscode.QuickPickItem>();
		qp.title = 'GitHub Copilot Governance';
		qp.placeholder = 'Toggle policies / standards — press Enter to apply';
		qp.canSelectMany = false;
		qp.keepScrollPosition = true;

		// Rebuilds the item list while preserving the highlighted (active) item, so
		// toggling a policy or switching mode doesn't make the selection jump to the
		// top. Assigning `qp.items` resets the active item, so we restore it by key.
		const refresh = () => {
			const activeKey = qp.activeItems[0] ? itemKey(qp.activeItems[0]) : undefined;
			const items = this._buildItems();
			qp.items = items;
			if (activeKey) {
				const match = items.find(i => itemKey(i) === activeKey);
				if (match) { qp.activeItems = [match]; }
			}
		};
		refresh();

		const disposables: vscode.Disposable[] = [];

		disposables.push(
			this._policyStore.onDidChange(() => refresh()),
			vscode.workspace.onDidChangeConfiguration(e => {
				if (e.affectsConfiguration('github.copilot.governance.mode')) { refresh(); }
			}),
			qp.onDidChangeSelection(([item]) => {
				if (!item || isSeparator(item)) { return; }
				const panelItem = asPanelItem(item);
				if (panelItem) {
					// Toggling policies/standards and switching mode fire change events
					// that drive a single refresh, so we don't refresh again here (a
					// second synchronous rebuild is what caused the menu to blink).
					this._handleSelection(panelItem);
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
		const policies = this._policyStore.allPolicies;
		const standards = this._policyStore.activeStandards;

		// ── Mode ──────────────────────────────────────────────────────────────
		items.push(separator('Mode'));
		const modeOptions: readonly { readonly mode: GuardrailMode; readonly label: string; readonly detail: string }[] = [
			{ mode: 'enforce', label: 'Enforce', detail: 'Block or redirect actions that violate a policy' },
			{ mode: 'warn', label: 'Warn only', detail: 'Flag violations but let the action proceed' },
		];
		for (const option of modeOptions) {
			const active = mode === option.mode;
			const modeItem: ActionItem = {
				itemType: 'action',
				action: 'setMode',
				mode: option.mode,
				label: `${active ? '$(pass-filled)' : '$(circle-large-outline)'} ${option.label}`,
				description: active ? 'Active' : undefined,
				detail: option.detail,
			};
			items.push(modeItem);
		}

		// ── Enterprise policies ───────────────────────────────────────────────
		if (policies.length > 0) {
			items.push(separator('Policies'));
			for (const policy of policies) {
				const enabled = this._policyStore.isPolicyEnabled(policy.id);
				const icon = enabled ? '$(check)' : '$(circle-large-outline)';
				const policyItem: PolicyItem = {
					itemType: 'policy',
					policy,
					label: `${icon} ${policy.label}`,
					description: enabled ? undefined : 'Disabled',
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
			if (item.action === 'setMode' && item.mode) {
				this._setMode(item.mode);
			} else if (item.action === 'rescan') {
				void vscode.commands.executeCommand('github.copilot.governance.setupStandards');
			} else if (item.action === 'learnMore') {
				void vscode.commands.executeCommand(INFERENCE_MODAL_COMMAND_ID);
			}
		}
	}
}
