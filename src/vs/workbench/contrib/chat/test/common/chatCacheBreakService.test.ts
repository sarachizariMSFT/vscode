/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { ChatCacheBreakDimension, ChatCacheBreakService, IChatCacheBreakConfig, toCacheBreakToolsKey } from '../../common/chatCacheBreakService.js';

suite('ChatCacheBreakService', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const session = URI.parse('vscode-chat://session/1');
	const baseline: IChatCacheBreakConfig = {
		model: 'claude-sonnet-4',
		reasoningEffort: 'high',
		contextSize: 200_000,
		mode: 'agent',
		tools: 'editFile,runInTerminal',
	};

	test('no warning before the session has recorded a request', () => {
		const service = new ChatCacheBreakService();
		assert.strictEqual(service.wouldBreakCache(session, baseline, ChatCacheBreakDimension.Model), false);
		assert.strictEqual(service.wouldBreakCache(session, baseline, ChatCacheBreakDimension.Any), false);
	});

	test('detects a cache break per dimension once a request is recorded', () => {
		const service = new ChatCacheBreakService();
		service.recordRequest(session, baseline);

		const result = {
			unchanged: service.wouldBreakCache(session, baseline, ChatCacheBreakDimension.Any),
			modelChanged: service.wouldBreakCache(session, { ...baseline, model: 'gpt-5' }, ChatCacheBreakDimension.Model),
			modelChangeIgnoredForOptions: service.wouldBreakCache(session, { ...baseline, model: 'gpt-5' }, ChatCacheBreakDimension.Options),
			effortChanged: service.wouldBreakCache(session, { ...baseline, reasoningEffort: 'low' }, ChatCacheBreakDimension.Options),
			contextChanged: service.wouldBreakCache(session, { ...baseline, contextSize: 1_000_000 }, ChatCacheBreakDimension.Options),
			modeChanged: service.wouldBreakCache(session, { ...baseline, mode: 'plan' }, ChatCacheBreakDimension.Mode),
			toolsChanged: service.wouldBreakCache(session, { ...baseline, tools: 'editFile' }, ChatCacheBreakDimension.Tools),
			anyChange: service.wouldBreakCache(session, { ...baseline, contextSize: 1_000_000 }, ChatCacheBreakDimension.Any),
		};

		assert.deepStrictEqual(result, {
			unchanged: false,
			modelChanged: true,
			modelChangeIgnoredForOptions: false,
			effortChanged: true,
			contextChanged: true,
			modeChanged: true,
			toolsChanged: true,
			anyChange: true,
		});
	});

	test('a later request updates the baseline, and clearSession forgets it', () => {
		const service = new ChatCacheBreakService();
		service.recordRequest(session, baseline);
		service.recordRequest(session, { ...baseline, model: 'gpt-5' });

		assert.strictEqual(service.wouldBreakCache(session, { ...baseline, model: 'gpt-5' }, ChatCacheBreakDimension.Model), false);
		assert.strictEqual(service.wouldBreakCache(session, baseline, ChatCacheBreakDimension.Model), true);

		service.clearSession(session);
		assert.strictEqual(service.wouldBreakCache(session, baseline, ChatCacheBreakDimension.Any), false);
	});

	test('toCacheBreakToolsKey is order-independent and ignores disabled tools', () => {
		assert.strictEqual(toCacheBreakToolsKey(undefined), undefined);
		assert.strictEqual(
			toCacheBreakToolsKey({ runInTerminal: true, editFile: true, search: false }),
			toCacheBreakToolsKey({ editFile: true, runInTerminal: true }),
		);
	});
});
