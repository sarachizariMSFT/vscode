/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../util/vs/base/common/event';
import { ActivePolicy, Policy, Standard } from './types';

/**
 * Singleton observable store for active governance policies and inferred standards.
 * Phases 2–7 read and write through this store.
 */
export class PolicyStore {
	private static _instance: PolicyStore | undefined;

	private _allPolicies: ActivePolicy[] = [];
	private _disabledPolicyIds = new Set<string>();
	private _activePolicies: ActivePolicy[] = [];
	private _activeStandards: Standard[] = [];

	private readonly _onDidChange = new Emitter<void>();
	readonly onDidChange: Event<void> = this._onDidChange.event;

	static getInstance(): PolicyStore {
		if (!PolicyStore._instance) {
			PolicyStore._instance = new PolicyStore();
		}
		return PolicyStore._instance;
	}

	get activePolicies(): readonly ActivePolicy[] {
		return this._activePolicies;
	}

	/** Returns all loaded policies regardless of per-policy toggle state. */
	get allPolicies(): readonly ActivePolicy[] {
		return this._allPolicies;
	}

	get activeStandards(): readonly Standard[] {
		return this._activeStandards;
	}

	/**
	 * Load policies from the enterprise policy file or remote URL.
	 * Policies are stored as `ActivePolicy` with an initial status of `'applied'`.
	 */
	setPolicies(policies: readonly Policy[]): void {
		this._allPolicies = policies.map(p => ({ ...p, status: 'applied' as const }));
		this._disabledPolicyIds.clear();
		this._activePolicies = this._allPolicies.slice();
		this._onDidChange.fire();
	}

	setStandards(standards: readonly Standard[]): void {
		this._activeStandards = standards.slice();
		this._onDidChange.fire();
	}

	togglePolicy(id: string): void {
		if (this._disabledPolicyIds.has(id)) {
			this._disabledPolicyIds.delete(id);
		} else {
			this._disabledPolicyIds.add(id);
		}
		this._activePolicies = this._allPolicies.filter(p => !this._disabledPolicyIds.has(p.id));
		this._onDidChange.fire();
	}

	/** Whether a policy is currently enabled (i.e. not toggled off in this session). */
	isPolicyEnabled(id: string): boolean {
		return !this._disabledPolicyIds.has(id);
	}

	/**
	 * Replace the set of disabled policy ids wholesale. Used to bridge the
	 * `github.copilot.governance.disabledPolicies` setting (written by the inline
	 * Guardrails picker) into the store so enforcement honors it.
	 */
	setDisabledPolicyIds(ids: readonly string[]): void {
		const next = new Set(ids);
		const changed = next.size !== this._disabledPolicyIds.size || [...next].some(id => !this._disabledPolicyIds.has(id));
		if (!changed) {
			return;
		}
		this._disabledPolicyIds = next;
		this._activePolicies = this._allPolicies.filter(p => !this._disabledPolicyIds.has(p.id));
		this._onDidChange.fire();
	}

	toggleStandard(id: string): void {
		const standard = this._activeStandards.find(s => s.id === id);
		if (standard) {
			standard.enabled = !standard.enabled;
			this._onDidChange.fire();
		}
	}

	clear(): void {
		this._allPolicies = [];
		this._disabledPolicyIds.clear();
		this._activePolicies = [];
		this._activeStandards = [];
		this._onDidChange.fire();
	}
}
