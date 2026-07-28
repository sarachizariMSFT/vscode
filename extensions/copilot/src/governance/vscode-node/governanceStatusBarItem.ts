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

/** Command that opens the inline Guardrails picker in the chat input — the single control surface. */
const OPEN_INLINE_PICKER_COMMAND_ID = 'github.copilot.governance.openInlinePicker';

/**
 * Governance status bar item (Phase 7).
 *
 * Status-only indicator that matches the inline Guardrails chip: `$(law) Guardrails N`
 * (balance icon in Enforce, warning icon in Warn) where N includes active platform
 * policies and enabled inferred/recommended standards.
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

		// The badge is a status indicator and discoverable entry point — not a
		// second management panel. Clicking it opens Copilot Chat and its inline
		// Guardrails picker, which is the single place to switch mode, toggle
		// policies, and accept recommendations. The hover tooltip (below) is a
		// read-only glance at current state.
		this._register(vscode.commands.registerCommand(OPEN_INLINE_PICKER_COMMAND_ID, async () => {
			await vscode.commands.executeCommand('workbench.action.chat.open');
			await vscode.commands.executeCommand('workbench.action.chat.openGuardrailsPicker');
		}));
		this._statusBarItem.command = OPEN_INLINE_PICKER_COMMAND_ID;

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
			// Match the inline Guardrails chip: the balance ("law") icon in Enforce
			// mode, the warning icon in Warn mode. In Warn mode also tint the badge
			// so the mode is readable at a glance.
			const isWarn = (this._configurationService.getConfig(ConfigKey.Governance.Mode) as string) === 'warn';
			const icon = isWarn ? '$(warning)' : '$(law)';
			this._statusBarItem.text = `${icon} Guardrails ${total}`;
			this._statusBarItem.backgroundColor = isWarn ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
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
		md.appendMarkdown(`$(law) Mode: **${modeLabel}**\n\n`);

		const policies = this._policyStore.allPolicies;
		if (policies.length > 0) {
			md.appendMarkdown(`Policies\n\n`);
			for (const policy of policies) {
				const enabled = this._policyStore.isPolicyEnabled(policy.id);
				const icon = enabled ? '$(check)' : '$(circle-slash)';
				md.appendMarkdown(`${icon} ${policy.label}${enabled ? '' : ' _(disabled)_'}\n\n`);
			}
		}

		md.appendMarkdown(`---\n\n_Click to open Guardrails in Copilot Chat_`);
		return md;
	}
}
