/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FileType } from '../platform/filesystem/common/fileTypes';
import { IFileSystemService } from '../platform/filesystem/common/fileSystemService';
import { ILogService } from '../platform/log/common/logService';
import { IWorkspaceService } from '../platform/workspace/common/workspaceService';
import { URI } from '../util/vs/base/common/uri';
import { Standard } from './types';

export interface InferenceSignal {
	readonly id: string;
	readonly detected: boolean;
	readonly evidence: string;
}

export interface InferenceScanResult {
	readonly filesScanned: string[];
	readonly signals: readonly InferenceSignal[];
	readonly inferredStandards: Standard[];
}

/**
 * Scans workspace structure to infer coding standards without sending any file
 * contents to external services.  All analysis is purely local.
 *
 * Produces up to 5 signals, each mapping to one `Standard`.  Called by
 * Phase 5 (in-thread onboarding UI) when no enterprise policy file exists.
 */
export class InferenceEngine {
	constructor(
		private readonly _fileSystemService: IFileSystemService,
		private readonly _workspaceService: IWorkspaceService,
		private readonly _logService: ILogService,
	) { }

	async scan(): Promise<InferenceScanResult> {
		const folders = this._workspaceService.getWorkspaceFolders();
		if (folders.length === 0) {
			return { filesScanned: [], signals: [], inferredStandards: [] };
		}
		const root = folders[0];

		let rootEntries: [string, FileType][] = [];
		try {
			rootEntries = await this._fileSystemService.readDirectory(root);
		} catch (err) {
			this._logService.warn(`[Governance] Inference scan failed to read workspace root: ${err}`);
			return { filesScanned: [], signals: [], inferredStandards: [] };
		}

		const filesScanned = rootEntries.map(([name]) => name);
		const signals: InferenceSignal[] = [];
		const inferredStandards: Standard[] = [];

		// Signal 1 — Test framework
		const testSignal = await this._detectTestFramework(root, rootEntries);
		signals.push(testSignal);
		if (testSignal.detected) {
			inferredStandards.push({
				id: 'infer-tests',
				label: 'Tests for every new function',
				evidence: testSignal.evidence,
				enabled: true,
				category: 'quality',
			});
		}

		// Signal 2 — Secrets hygiene (.env.example pattern)
		const secretsSignal = this._detectSecretsHygiene(rootEntries);
		signals.push(secretsSignal);
		if (secretsSignal.detected) {
			inferredStandards.push({
				id: 'infer-no-secrets',
				label: 'No secrets in source files',
				evidence: secretsSignal.evidence,
				enabled: true,
				category: 'security',
			});
		}

		// Signal 3 — Package management (pinned deps in package.json)
		const pkgSignal = this._detectPackageManagement(rootEntries);
		signals.push(pkgSignal);
		if (pkgSignal.detected) {
			inferredStandards.push({
				id: 'infer-package-pinning',
				label: 'Prefer packages already in package.json',
				evidence: pkgSignal.evidence,
				enabled: true,
				category: 'dependencies',
			});
		}

		// Signal 4 — Async style (TypeScript project → modern async/await convention)
		const asyncSignal = this._detectAsyncStyle(rootEntries);
		signals.push(asyncSignal);
		if (asyncSignal.detected) {
			inferredStandards.push({
				id: 'infer-async-await',
				label: 'Async/await over raw promises',
				evidence: asyncSignal.evidence,
				enabled: true,
				category: 'style',
			});
		}

		// Signal 5 — Architecture layers (controllers/, services/, repositories/)
		const archSignal = await this._detectArchitectureLayers(root, rootEntries);
		signals.push(archSignal);
		if (archSignal.detected) {
			inferredStandards.push({
				id: 'infer-module-boundaries',
				label: 'Services stay in their layer',
				evidence: archSignal.evidence,
				enabled: false,  // off by default — architecture constraints require explicit opt-in
				category: 'architecture',
			});
		}

		const detected = signals.filter(s => s.detected).length;
		this._logService.trace(`[Governance] Inference scan: ${detected}/${signals.length} signals detected, ${inferredStandards.length} standards inferred`);

		return { filesScanned, signals, inferredStandards };
	}

	// ----- private helpers -----

	private async _detectTestFramework(root: URI, entries: [string, FileType][]): Promise<InferenceSignal> {
		const testConfigPatterns = /^(jest|vitest|karma|mocha|jasmine)\.config\.(t|j|m)s$/i;
		const testDirNames = new Set(['__tests__', 'test', 'tests', 'spec', 'e2e']);

		// Check root for test config files and test directories
		for (const [name, type] of entries) {
			if (type === FileType.File && testConfigPatterns.test(name)) {
				return { id: 'test-framework', detected: true, evidence: `${name} found at workspace root` };
			}
			if (type === FileType.Directory && testDirNames.has(name.toLowerCase())) {
				return { id: 'test-framework', detected: true, evidence: `${name}/ directory found` };
			}
		}

		// Check inside src/ for .test.* or .spec.* files
		const hasSrc = entries.some(([name, type]) => name === 'src' && type === FileType.Directory);
		if (hasSrc) {
			try {
				const srcEntries = await this._fileSystemService.readDirectory(URI.joinPath(root, 'src'));
				const testFileCount = srcEntries.filter(([name]) => /\.(test|spec)\.(ts|js|tsx|jsx)$/.test(name)).length;
				if (testFileCount > 0) {
					return { id: 'test-framework', detected: true, evidence: `${testFileCount} test file${testFileCount > 1 ? 's' : ''} detected in src/` };
				}
			} catch { /* src/ not readable */ }
		}

		return { id: 'test-framework', detected: false, evidence: 'No test framework detected' };
	}

	private _detectSecretsHygiene(entries: [string, FileType][]): InferenceSignal {
		const hasEnvExample = entries.some(([name, type]) =>
			type === FileType.File && name.toLowerCase() === '.env.example'
		);
		if (hasEnvExample) {
			return { id: 'secrets-hygiene', detected: true, evidence: '.env.example found — env-based secrets pattern' };
		}
		const hasEnvTemplate = entries.some(([name, type]) =>
			type === FileType.File && /^\.env\.(template|sample|example)$/i.test(name)
		);
		return {
			id: 'secrets-hygiene',
			detected: hasEnvTemplate,
			evidence: hasEnvTemplate ? '.env template file found' : 'No secrets hygiene pattern detected',
		};
	}

	private _detectPackageManagement(entries: [string, FileType][]): InferenceSignal {
		const hasPackageJson = entries.some(([name, type]) =>
			type === FileType.File && name === 'package.json'
		);
		return {
			id: 'package-management',
			detected: hasPackageJson,
			evidence: hasPackageJson ? 'package.json found' : 'No package.json detected',
		};
	}

	private _detectAsyncStyle(entries: [string, FileType][]): InferenceSignal {
		// Presence of tsconfig.json indicates a TypeScript project which conventionally uses async/await
		const hasTsConfig = entries.some(([name, type]) =>
			type === FileType.File && /^tsconfig(\..*)?\.json$/.test(name)
		);
		return {
			id: 'async-style',
			detected: hasTsConfig,
			evidence: hasTsConfig ? 'TypeScript project detected (tsconfig.json)' : 'No TypeScript configuration detected',
		};
	}

	private async _detectArchitectureLayers(root: URI, entries: [string, FileType][]): Promise<InferenceSignal> {
		const layerDirs = new Set(['controllers', 'services', 'repositories', 'handlers', 'adapters']);
		const foundLayers: string[] = [];

		// Check root-level dirs
		for (const [name, type] of entries) {
			if (type === FileType.Directory && layerDirs.has(name.toLowerCase())) {
				foundLayers.push(name + '/');
			}
		}

		// Check inside src/
		const hasSrc = entries.some(([name, type]) => name === 'src' && type === FileType.Directory);
		if (hasSrc && foundLayers.length === 0) {
			try {
				const srcEntries = await this._fileSystemService.readDirectory(URI.joinPath(root, 'src'));
				for (const [name, type] of srcEntries) {
					if (type === FileType.Directory && layerDirs.has(name.toLowerCase())) {
						foundLayers.push('src/' + name + '/');
					}
				}
			} catch { /* src/ not readable */ }
		}

		if (foundLayers.length >= 2) {
			return {
				id: 'arch-layers',
				detected: true,
				evidence: `Layered architecture detected (${foundLayers.slice(0, 3).join(', ')})`,
			};
		}
		return { id: 'arch-layers', detected: false, evidence: 'No layered architecture detected' };
	}
}
