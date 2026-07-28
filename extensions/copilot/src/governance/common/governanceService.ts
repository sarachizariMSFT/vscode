/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConfigKey, IConfigurationService } from '../../platform/configuration/common/configurationService';
import { IVSCodeExtensionContext } from '../../platform/extContext/common/extensionContext';
import { IFileSystemService } from '../../platform/filesystem/common/fileSystemService';
import { IFetcherService } from '../../platform/networking/common/fetcherService';
import { ILogService } from '../../platform/log/common/logService';
import { IWorkspaceService } from '../../platform/workspace/common/workspaceService';
import { Disposable } from '../../util/vs/base/common/lifecycle';
import { IExtensionContribution } from '../../extension/common/contributions';
import { InferenceEngine } from './inferenceEngine';
import { PolicyLoader } from './policyLoader';
import { PolicyStore } from './policyStore';
import { Standard } from './types';

/** Glob watched by the file system watcher — matches .github/copilot-policies.json in any workspace folder. */
const POLICY_FILE_GLOB = '**/.github/copilot-policies.json';

/** workspaceState key for persisted inferred standards (set after user accepts in Phase 5). */
const STANDARDS_STATE_KEY = 'copilot.governance.inferredStandards';

/**
 * Entry point for the governance module. Activated as a VS Code extension contribution.
 * When `github.copilot.governance.enabled` is false this class is a no-op; all downstream
 * phases (policy loading, inference, prompt injection, UI) guard against an empty store.
 */
export class GovernanceService extends Disposable implements IExtensionContribution {

	private readonly _policyStore = PolicyStore.getInstance();

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IVSCodeExtensionContext private readonly _extensionContext: IVSCodeExtensionContext,
		@IFileSystemService private readonly _fileSystemService: IFileSystemService,
		@IWorkspaceService private readonly _workspaceService: IWorkspaceService,
		@IFetcherService private readonly _fetcherService: IFetcherService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
		void this._activate().catch(err => {
			this._logService.error('[Governance] activation error — governance is disabled for this session', err);
		});
	}

	private async _activate(): Promise<void> {
		const enabled = this._configurationService.getConfig(ConfigKey.Governance.Enabled);
		if (!enabled) {
			this._logService.trace('[Governance] disabled — skipping activation');
			return;
		}

		this._logService.trace('[Governance] activating');

		const loader = new PolicyLoader(
			this._fileSystemService,
			this._workspaceService,
			this._fetcherService,
			this._logService,
		);

		await this._refreshGovernanceState(loader);

		// Watch .github/copilot-policies.json for changes and reload
		const watcher = this._fileSystemService.createFileSystemWatcher(POLICY_FILE_GLOB);
		this._register(watcher);
		this._register(watcher.onDidCreate(() => void this._refreshGovernanceState(loader)));
		this._register(watcher.onDidChange(() => void this._refreshGovernanceState(loader)));
		this._register(watcher.onDidDelete(() => void this._refreshGovernanceState(loader)));

		// Bridge the inline Guardrails picker's per-policy toggles (stored in the
		// `github.copilot.governance.disabledPolicies` setting) into the policy store.
		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('github.copilot.governance.disabledPolicies')) {
				this._applyDisabledPoliciesFromConfig();
			}
		}));
	}

	private async _refreshGovernanceState(loader: PolicyLoader): Promise<void> {
		const hasEnterprisePolicies = await this._loadPolicies(loader);
		this._applyDisabledPoliciesFromConfig();
		await this._loadOrQueueInference(hasEnterprisePolicies);
	}

	/** Re-applies the disabled-policy set from configuration onto the (freshly loaded) policy store. */
	private _applyDisabledPoliciesFromConfig(): void {
		const disabled = this._configurationService.getConfig(ConfigKey.Governance.DisabledPolicies);
		this._policyStore.setDisabledPolicyIds(Array.isArray(disabled) ? disabled : []);
	}

	/**
	 * Attempts to load enterprise policies (workspace file first, then remote URL).
	 * Returns true if policies were loaded, false to indicate fallthrough to inference.
	 */
	private async _loadPolicies(loader: PolicyLoader): Promise<boolean> {
		const workspaceResult = await loader.loadFromWorkspace();
		if (workspaceResult) {
			this._policyStore.setPolicies(workspaceResult.policies);
			this._logService.trace(`[Governance] loaded ${workspaceResult.policies.length} policies from .github/copilot-policies.json`);
			return true;
		}

		const policyUrl = this._configurationService.getConfig(ConfigKey.Governance.PolicyUrl);
		if (policyUrl) {
			const urlResult = await loader.loadFromUrl(policyUrl);
			if (urlResult) {
				this._policyStore.setPolicies(urlResult.policies);
				this._logService.trace(`[Governance] loaded ${urlResult.policies.length} policies from ${policyUrl}`);
				return true;
			}
		}

		this._policyStore.setPolicies([]);

		return false;
	}

	/**
	 * Checks for previously accepted inferred standards in workspaceState.
	 * If found, loads them into the store.  If not, signals that onboarding is needed
	 * (Phase 5 UI will trigger the workspace scan and acceptance flow).
	 */
	private async _loadOrQueueInference(hasEnterprisePolicies: boolean): Promise<void> {
		const cached = this._extensionContext.workspaceState.get<Standard[]>(STANDARDS_STATE_KEY);
		if (cached && cached.length > 0) {
			this._policyStore.setStandards(cached);
			this._policyStore.setNeedsOnboarding(false);
			this._logService.trace(`[Governance] loaded ${cached.length} previously accepted inferred standards from workspaceState`);
			return;
		}

		const engine = new InferenceEngine(this._fileSystemService, this._workspaceService, this._logService);
		const scanResult = await engine.scan();
		const inferred = scanResult.inferredStandards;
		if (inferred.length > 0) {
			this._policyStore.setStandards(inferred);
			this._policyStore.setNeedsOnboarding(false);
			this._logService.trace(`[Governance] inferred ${inferred.length} standards from codebase and activated unified governance`);
			return;
		}

		// No cached or inferred standards. When no enterprise policies exist, defer standard
		// selection to the developer's first chat prompt rather than popping a notification now.
		this._policyStore.setStandards([]);
		if (hasEnterprisePolicies) {
			this._logService.trace('[Governance] platform policies active; no standards inferred, onboarding not required');
		} else {
			this._policyStore.setNeedsPromptInference(true);
			this._logService.trace('[Governance] no platform policy and no codebase standards inferred — waiting for first prompt to suggest standards');
		}
	}
}
