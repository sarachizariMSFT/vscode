/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { IFileSystemService } from '../../src/platform/filesystem/common/fileSystemService';
import { IFetcherService } from '../../src/platform/networking/common/fetcherService';
import { ILogService } from '../../src/platform/log/common/logService';
import { IWorkspaceService } from '../../src/platform/workspace/common/workspaceService';
import { mock } from '../../src/util/common/test/simpleMock';
import { URI } from '../../src/util/vs/base/common/uri';
import { PolicyLoader } from '../../src/governance/common/policyLoader';

// ---- Minimal stubs ----

class StubWorkspaceService extends mock<IWorkspaceService>() {
	private _folders: URI[];
	constructor(folders: URI[]) { super(); this._folders = folders; }
	override getWorkspaceFolders(): URI[] { return this._folders; }
}

class StubFileSystemService extends mock<IFileSystemService>() {
	private _content: Uint8Array | 'throw';
	constructor(content: Uint8Array | 'throw') { super(); this._content = content; }
	override async readFile(_uri: URI): Promise<Uint8Array> {
		if (this._content === 'throw') { throw new Error('File not found'); }
		return this._content;
	}
}

class StubFetcherService {
	private _text: string | null;
	private _status: number;
	constructor(text: string | null, status = 200) { this._text = text; this._status = status; }
	async fetch(_url: string, _opts: unknown): Promise<{ ok: boolean; status: number; text: () => Promise<string> }> {
		const t = this._text;
		const s = this._status;
		return { ok: s >= 200 && s < 300, status: s, text: async () => t ?? '' };
	}
}

class SpyLogService extends mock<ILogService>() {
	readonly warnings: string[] = [];
	override warn(msg: string): void { this.warnings.push(msg); }
	override trace(): void { }
	override debug(): void { }
	override info(): void { }
	override error(): void { }
}

// ---- Helpers ----

function makeLoader(fileContent: string | 'throw', folders: URI[] = [URI.file('/workspace')]): { loader: PolicyLoader; log: SpyLogService } {
	const log = new SpyLogService();
	const content = fileContent === 'throw' ? 'throw' : new TextEncoder().encode(fileContent);
	const loader = new PolicyLoader(
		new StubFileSystemService(content),
		new StubWorkspaceService(folders),
		new StubFetcherService(null) as unknown as IFetcherService,
		log,
	);
	return { loader, log };
}

// ---- Tests ----

describe('PolicyLoader', () => {
	describe('loadFromWorkspace', () => {
		it('returns null when no workspace folders', async () => {
			const { loader } = makeLoader('{}', []);
			const result = await loader.loadFromWorkspace();
			expect(result).toBeNull();
		});

		it('returns null on entirely malformed JSON', async () => {
			const { loader } = makeLoader('not json at all {{{');
			const result = await loader.loadFromWorkspace();
			expect(result).toBeNull();
		});

		it('returns null when policies array is missing', async () => {
			const { loader } = makeLoader(JSON.stringify({ source: 'org' }));
			const result = await loader.loadFromWorkspace();
			expect(result).toBeNull();
		});

		it('returns null when file is absent', async () => {
			const { loader } = makeLoader('throw');
			const result = await loader.loadFromWorkspace();
			expect(result).toBeNull();
		});

		it('loads legacy policy without rules — no rules field', async () => {
			const json = JSON.stringify({
				policies: [
					{ id: 'p1', label: 'No console.log', enforcement: 'enforce', category: 'code-quality', scope: 'project', description: 'Use logger', autoFix: false }
				]
			});
			const { loader } = makeLoader(json);
			const result = await loader.loadFromWorkspace();
			expect(result).not.toBeNull();
			expect(result!.policies).toHaveLength(1);
			expect(result!.policies[0].rules).toBeUndefined();
		});

		it('loads policy with valid rules — rules array preserved', async () => {
			const json = JSON.stringify({
				policies: [
					{
						id: 'no-force-push',
						label: 'No force-push',
						enforcement: 'enforce',
						category: 'source-control',
						scope: 'project',
						description: 'Protect history',
						autoFix: false,
						rules: [
							{ target: 'terminal', match: { commandPattern: 'git push.*--force' }, action: 'deny' }
						]
					}
				]
			});
			const { loader } = makeLoader(json);
			const result = await loader.loadFromWorkspace();
			expect(result).not.toBeNull();
			expect(result!.policies[0].rules).toHaveLength(1);
			expect(result!.policies[0].rules![0]).toEqual({
				target: 'terminal',
				match: { commandPattern: 'git push.*--force' },
				action: 'deny',
			});
		});

		it('retains valid rule and skips invalid rule, logs warning, policy still loaded', async () => {
			const json = JSON.stringify({
				policies: [
					{
						id: 'mixed',
						label: 'Mixed',
						enforcement: 'enforce',
						category: 'safety',
						scope: 'org',
						description: 'desc',
						autoFix: false,
						rules: [
							{ target: 'terminal', match: { commandPattern: 'rm -rf' }, action: 'deny' },   // valid
							{ target: 'unknown-target', match: {}, action: 'deny' },                       // invalid target
						]
					}
				]
			});
			const { loader, log } = makeLoader(json);
			const result = await loader.loadFromWorkspace();
			expect(result).not.toBeNull();
			expect(result!.policies).toHaveLength(1);
			expect(result!.policies[0].rules).toHaveLength(1);
			expect(result!.policies[0].rules![0].target).toBe('terminal');
			expect(log.warnings.some(w => w.includes('invalid rule'))).toBe(true);
		});

		it('policy with all invalid rules is retained as prompt-only with empty rules array', async () => {
			const json = JSON.stringify({
				policies: [
					{
						id: 'bad-rules',
						label: 'Bad',
						enforcement: 'enforce',
						category: 'safety',
						scope: 'org',
						description: 'desc',
						autoFix: false,
						rules: [
							{ target: 'invalid', match: {}, action: 'deny' },
							{ action: 'deny' },
						]
					}
				]
			});
			const { loader, log } = makeLoader(json);
			const result = await loader.loadFromWorkspace();
			expect(result).not.toBeNull();
			expect(result!.policies).toHaveLength(1);
			expect(result!.policies[0].rules).toHaveLength(0);
			expect(log.warnings.length).toBeGreaterThan(0);
		});
	});

	describe('loadFromUrl', () => {
		it('returns null when url is empty', async () => {
			const log = new SpyLogService();
			const loader = new PolicyLoader(
				new StubFileSystemService(new Uint8Array()),
				new StubWorkspaceService([]),
				new StubFetcherService(null) as unknown as IFetcherService,
				log,
			);
			const result = await loader.loadFromUrl('');
			expect(result).toBeNull();
		});

		it('returns null on HTTP error', async () => {
			const log = new SpyLogService();
			const loader = new PolicyLoader(
				new StubFileSystemService(new Uint8Array()),
				new StubWorkspaceService([]),
				new StubFetcherService(null, 403) as unknown as IFetcherService,
				log,
			);
			const result = await loader.loadFromUrl('https://example.com/policies.json');
			expect(result).toBeNull();
		});
	});
});
