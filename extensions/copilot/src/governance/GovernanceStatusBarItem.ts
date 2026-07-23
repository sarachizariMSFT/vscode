/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { IConfigurationService, ConfigKey } from '../platform/configuration/common/configurationService';
import { ILogService } from '../platform/log/common/logService';
import { Disposable } from '../util/vs/base/common/lifecycle';
import { IExtensionContribution } from '../extension/common/contributions';
import { PolicyStore } from './policyStore';
import { OPEN_PANEL_COMMAND_ID } from './GovernanceSidePanel';

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

		this._statusBarItem.command = OPEN_PANEL_COMMAND_ID;

		// Initial render
		this._update();

		// React to store changes
		this._register(this._policyStore.onDidChange(() => this._update()));
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
			this._statusBarItem.tooltip = `${policies.length} polic${policies.length === 1 ? 'y' : 'ies'}, ${standards.length} standard${standards.length === 1 ? '' : 's'} active — click to manage`;
			this._statusBarItem.show();
			this._logService.trace(`[Governance] status bar updated: ${policies.length} policies, ${standards.length} standards`);
		} else {
			this._statusBarItem.hide();
		}
	}
}
