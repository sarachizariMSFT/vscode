/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFileSystemService } from '../../platform/filesystem/common/fileSystemService';
import { IFetcherService } from '../../platform/networking/common/fetcherService';
import { ILogService } from '../../platform/log/common/logService';
import { IWorkspaceService } from '../../platform/workspace/common/workspaceService';
import { URI } from '../../util/vs/base/common/uri';
import { Policy, PolicyRule, PolicySource } from './types';

/** Relative path inside any workspace folder where the enterprise policy file lives. */
const POLICY_FILE_SEGMENTS = ['.github', 'copilot-policies.json'];

export interface ParsedPolicyFile {
	readonly source: PolicySource;
	readonly policies: readonly Policy[];
}

/**
 * Loads and validates `copilot-policies.json` from two sources:
 *  1. The workspace — `.github/copilot-policies.json`
 *  2. A remote URL configured via `github.copilot.governance.policyUrl`
 *
 * Validation is intentionally lenient: only the `id`, `label`, and `enforcement`
 * fields are required.  Unknown/extra fields are silently retained so that
 * future policy schema additions don't break older clients.
 */
export class PolicyLoader {
	constructor(
		private readonly _fileSystemService: IFileSystemService,
		private readonly _workspaceService: IWorkspaceService,
		private readonly _fetcherService: IFetcherService,
		private readonly _logService: ILogService,
	) { }

	/**
	 * Reads `.github/copilot-policies.json` from the first workspace folder.
	 * Returns `null` when the file does not exist or is malformed.
	 */
	async loadFromWorkspace(): Promise<ParsedPolicyFile | null> {
		const workspaceFolders = this._workspaceService.getWorkspaceFolders();
		if (workspaceFolders.length === 0) {
			return null;
		}
		const uri = URI.joinPath(workspaceFolders[0], ...POLICY_FILE_SEGMENTS);
		let raw: Uint8Array;
		try {
			raw = await this._fileSystemService.readFile(uri);
		} catch {
			// File absent — not an error
			return null;
		}
		return this._parse(new TextDecoder().decode(raw), 'project');
	}

	/**
	 * Fetches and parses a policy file from `url`.
	 * Returns `null` on network failure or a malformed response.
	 */
	async loadFromUrl(url: string): Promise<ParsedPolicyFile | null> {
		if (!url) {
			return null;
		}
		let text: string;
		try {
			const response = await this._fetcherService.fetch(url, {
				callSite: 'governance.policyLoader',
				method: 'GET',
			});
			if (!response.ok) {
				this._logService.warn(`[Governance] Policy URL returned HTTP ${response.status}: ${url}`);
				return null;
			}
			text = await response.text();
		} catch (err) {
			this._logService.warn(`[Governance] Failed to fetch policy from ${url}: ${err}`);
			return null;
		}
		return this._parse(text, 'org');
	}

	// ----- private -----

	private _parse(text: string, fallbackSource: PolicySource): ParsedPolicyFile | null {
		let data: unknown;
		try {
			data = JSON.parse(text);
		} catch {
			this._logService.warn('[Governance] copilot-policies.json contains invalid JSON');
			return null;
		}

		if (typeof data !== 'object' || data === null) {
			this._logService.warn('[Governance] copilot-policies.json root must be an object');
			return null;
		}

		const raw = data as Record<string, unknown>;
		if (!Array.isArray(raw['policies'])) {
			this._logService.warn('[Governance] copilot-policies.json missing required "policies" array');
			return null;
		}

		const sourceField = raw['source'];
		const source: PolicySource =
			sourceField === 'org' || sourceField === 'project' || sourceField === 'inferred'
				? sourceField
				: fallbackSource;

		const policies: Policy[] = (raw['policies'] as unknown[])
			.filter(_isValidPolicy)
			.map(p => _normalizeRules(p as Policy, this._logService));

		if (policies.length === 0 && (raw['policies'] as unknown[]).length > 0) {
			this._logService.warn('[Governance] copilot-policies.json: all entries were invalid and were skipped');
		}

		return { source, policies };
	}
}

function _normalizeRules(policy: Policy, log: ILogService): Policy {
	const rules = policy.rules;
	if (!Array.isArray(rules)) {
		return policy;
	}
	const validRules: PolicyRule[] = [];
	for (const rule of rules) {
		if (_isValidRule(rule)) {
			validRules.push(rule);
		} else {
			log.warn(`[Governance] Policy "${policy.id}" has an invalid rule (skipped): ${JSON.stringify(rule)}`);
		}
	}
	return { ...policy, rules: validRules };
}

function _isValidRule(rule: unknown): boolean {
	if (typeof rule !== 'object' || rule === null) { return false; }
	const r = rule as Record<string, unknown>;
	if (r['target'] !== 'terminal' && r['target'] !== 'tool' && r['target'] !== 'file') { return false; }
	if (r['action'] !== 'deny' && r['action'] !== 'warn' && r['action'] !== 'observe') { return false; }
	if (typeof r['match'] !== 'object' || r['match'] === null) { return false; }
	if (r['when'] !== undefined && !_isValidCondition(r['when'])) { return false; }
	if (r['sets'] !== undefined && !_isStringArray(r['sets'])) { return false; }
	return true;
}

function _isValidCondition(when: unknown): boolean {
	if (typeof when !== 'object' || when === null) { return false; }
	const flags = (when as Record<string, unknown>)['flags'];
	return flags === undefined || _isStringArray(flags);
}

function _isStringArray(value: unknown): boolean {
	return Array.isArray(value) && value.every(item => typeof item === 'string');
}

/** Minimum required fields for a policy entry. */
function _isValidPolicy(p: unknown): boolean {
	return (
		typeof p === 'object' &&
		p !== null &&
		typeof (p as Record<string, unknown>)['id'] === 'string' &&
		typeof (p as Record<string, unknown>)['label'] === 'string' &&
		typeof (p as Record<string, unknown>)['enforcement'] === 'string'
	);
}
