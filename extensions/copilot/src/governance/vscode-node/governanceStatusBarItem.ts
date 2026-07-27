/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IConfigurationService, ConfigKey } from '../../platform/configuration/common/configurationService';
import { ILogService } from '../../platform/log/common/logService';
import { Disposable } from '../../util/vs/base/common/lifecycle';
import { IExtensionContribution } from '../../extension/common/contributions';
import { PolicyStore } from '../common/policyStore';
import { OPEN_PANEL_COMMAND_ID } from './governanceSidePanel';
/**
 * Governance status bar item (Phase 7).
 *
 * Unified mode: `🛡 Guardrails N` where N includes active platform policies
 * and enabled inferred/recommended standards.
 *
 * Reacts reactively to `PolicyStore.onDidChange` so the badge stays current
 * without polling.  Hidden when governance is disabled or the store is empty.
 */
export class GovernanceStatusBarItem extends Disposable implements IExtensionContribution {

	private readonly _policyStore = PolicyStore.getInstance();
	private readonly _statusBarItem: vscode.StatusBarItem;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._statusBarItem = this._register(
			vscode.window.createStatusBarItem(
				'github.copilot.governance',
				vscode.StatusBarAlignment.Right,
				// Priority just below VS Code's own language indicator (100)
				99,
			)
		);

		// Click opens the full Quick Pick panel — the only surface that stays open
		// so the user can switch mode and toggle policies in place. The hover tooltip
		// (below) is a read-only glance at current state.
		this._statusBarItem.command = OPEN_PANEL_COMMAND_ID;

		// Initial render
		this._update();

		// React to store changes
		this._register(this._policyStore.onDidChange(() => this._update()));

		// React to mode changes so the tooltip glance stays current
		this._register(vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('github.copilot.governance.mode')) { this._update(); }
		}));
	}

	private _update(): void {
		const enabled = this._configurationService.getConfig(ConfigKey.Governance.Enabled);
		if (!enabled) {
			this._statusBarItem.hide();
			return;
		}

		const policies = this._policyStore.activePolicies;
		const standards = this._policyStore.activeStandards.filter(s => s.enabled);
		const total = policies.length + standards.length;

		if (total > 0) {
			this._statusBarItem.text = `🛡 Guardrails ${total}`;
			this._statusBarItem.tooltip = this._buildTooltip();
			this._statusBarItem.show();
			this._logService.trace(`[Governance] status bar updated: ${policies.length} policies, ${standards.length} standards`);
		} else {
			this._statusBarItem.hide();
		}
	}

	/**
	 * Builds the read-only glance shown when hovering the status bar item.
	 * Summarises the current mode and each policy's on/off state. Interaction
	 * (switching mode, toggling policies) happens in the click-opened Quick Pick,
	 * because a hover tooltip is dismissed on click and cannot stay open.
	 */
	private _buildTooltip(): vscode.MarkdownString {
		const md = new vscode.MarkdownString(undefined, true /* supportThemeIcons */);

		const mode = this._configurationService.getConfig(ConfigKey.Governance.Mode) as string;
		const modeLabel = mode === 'enforce' ? 'Enforce' : 'Warn only';

		md.appendMarkdown(`**GitHub Copilot Governance**\n\n`);
		md.appendMarkdown(`$(shield) Mode: **${modeLabel}**\n\n`);

		const policies = this._policyStore.allPolicies;
		if (policies.length > 0) {
			md.appendMarkdown(`Policies\n\n`);
			for (const policy of policies) {
				const enabled = this._policyStore.isPolicyEnabled(policy.id);
				const icon = enabled ? '$(check)' : '$(circle-slash)';
				md.appendMarkdown(`${icon} ${policy.label}${enabled ? '' : ' _(disabled)_'}\n\n`);
			}
		}

		md.appendMarkdown(`---\n\n_Click to manage_`);
		return md;
	}
}
