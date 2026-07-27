/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { enforceToolCall, getRunSession, peekRunSession } from '../../src/governance/common/governanceEnforcement';
import { GovernanceRunSession } from '../../src/governance/common/governanceRunSession';
import { ActivePolicy, GovernanceConfig } from '../../src/governance/common/types';

// ---- Helpers ----

function makeConfig(overrides?: Partial<GovernanceConfig['rateLimits']>): GovernanceConfig {
	return {
		enabled: true,
		mode: 'enforce',
		policyUrl: '',
		autoFixSafeIssues: false,
		showDiffSummaryAfterEdits: false,
		includeRationaleInResponses: false,
		rateLimits: {
			enabled: false,
			maxFilesPerTask: 100,
			maxToolCallsPerRun: 100,
			...overrides,
		},
	};
}

function terminalPolicy(id: string, pattern: string, action: 'deny' | 'warn', enforcement: 'enforce' | 'warn' = 'enforce'): ActivePolicy {
	return {
		id, label: id, category: 'test', scope: 'org', enforcement, description: '', autoFix: false, status: 'applied',
		rules: [{ target: 'terminal', match: { commandPattern: pattern }, action }],
	};
}

function toolPolicy(id: string, toolName: string, action: 'deny' | 'warn' = 'deny'): ActivePolicy {
	return {
		id, label: id, category: 'test', scope: 'org', enforcement: 'enforce', description: '', autoFix: false, status: 'applied',
		rules: [{ target: 'tool', match: { toolName }, action }],
	};
}

function filePolicy(id: string, pathPattern: string, contentPattern: string, action: 'deny' | 'warn' = 'deny'): ActivePolicy {
	return {
		id, label: id, category: 'test', scope: 'org', enforcement: 'enforce', description: '', autoFix: false, status: 'applied',
		rules: [{ target: 'file', match: { pathPattern, contentPattern }, action }],
	};
}

// ---- Tests ----

describe('enforceToolCall', () => {
	it('allows a tool call that matches no rule and records activity', () => {
		const session = new GovernanceRunSession();
		const result = enforceToolCall({ toolName: 'read_file' }, [], makeConfig(), session);
		expect(result.blocked).toBe(false);
		expect(session.toolCallCount).toBe(1);
	});

	it('blocks a denied tool by name', () => {
		const session = new GovernanceRunSession();
		const result = enforceToolCall({ toolName: 'run_terminal_command' }, [toolPolicy('no-banned', 'run_terminal_command')], makeConfig(), session);
		expect(result).toMatchObject({ blocked: true, reason: 'policy', policyId: 'no-banned' });
		expect(session.decisions).toHaveLength(1);
		expect(session.decisions[0].outcome).toBe('blocked');
		expect(session.toolCallCount).toBe(0);
	});

	it('blocks a denied terminal command', () => {
		const session = new GovernanceRunSession();
		const result = enforceToolCall(
			{ toolName: 'run_in_terminal', terminalCommand: 'git push --force origin main' },
			[terminalPolicy('no-force-push', '(^|\\s)git\\s+push.*(--force|-f)', 'deny')],
			makeConfig(),
			session,
		);
		expect(result).toMatchObject({ blocked: true, reason: 'policy', policyId: 'no-force-push' });
	});

	it('allows and records a warn decision without blocking', () => {
		const session = new GovernanceRunSession();
		const result = enforceToolCall(
			{ toolName: 'run_in_terminal', terminalCommand: 'rm -rf build' },
			[terminalPolicy('no-rm-rf', 'rm\\s+-[rf]', 'deny', 'warn')],
			makeConfig(),
			session,
		);
		expect(result.blocked).toBe(false);
		expect(session.decisions).toHaveLength(1);
		expect(session.decisions[0].outcome).toBe('confirmed');
		expect(session.toolCallCount).toBe(1);
	});

	it('blocks a file write matching path and content patterns', () => {
		const session = new GovernanceRunSession();
		const result = enforceToolCall(
			{ toolName: 'create_file', filePath: 'app/.env', fileContent: 'api_key = "abc123"' },
			[filePolicy('no-secrets', '.*\\.(env|config|json)$', '(api_key|password|secret)\\s*=')],
			makeConfig(),
			session,
		);
		expect(result).toMatchObject({ blocked: true, reason: 'policy', policyId: 'no-secrets' });
	});

	it('blocks when the per-run tool-call budget is exceeded', () => {
		const session = new GovernanceRunSession();
		const config = makeConfig({ enabled: true, maxToolCallsPerRun: 2 });
		expect(enforceToolCall({ toolName: 'read_file' }, [], config, session).blocked).toBe(false);
		expect(enforceToolCall({ toolName: 'read_file' }, [], config, session).blocked).toBe(false);
		const third = enforceToolCall({ toolName: 'read_file' }, [], config, session);
		expect(third).toMatchObject({ blocked: true, reason: 'rate-limit-tools' });
	});

	it('blocks when the per-run file budget is exceeded', () => {
		const session = new GovernanceRunSession();
		const config = makeConfig({ enabled: true, maxFilesPerTask: 1 });
		expect(enforceToolCall({ toolName: 'create_file', filePath: 'a.ts' }, [], config, session).blocked).toBe(false);
		const second = enforceToolCall({ toolName: 'create_file', filePath: 'b.ts' }, [], config, session);
		expect(second).toMatchObject({ blocked: true, reason: 'rate-limit-files' });
	});

	it('contextual — a later call is blocked because of state raised by an earlier call', () => {
		const session = new GovernanceRunSession();
		const contextualPolicy: ActivePolicy = {
			id: 'no-exfil', label: 'no-exfil', category: 'security', scope: 'org', enforcement: 'enforce', description: '', autoFix: false, status: 'applied',
			rules: [
				{ target: 'file', match: { pathPattern: '\\.env$' }, action: 'observe', sets: ['readSecrets'] },
				{ target: 'tool', match: { toolName: 'fetch_webpage' }, action: 'deny', when: { flags: ['readSecrets'] } },
			],
		};

		// Before reading secrets, the outbound tool is allowed.
		expect(enforceToolCall({ toolName: 'fetch_webpage' }, [contextualPolicy], makeConfig(), session).blocked).toBe(false);

		// Reading a secret file is allowed (observe) but raises the session flag.
		const read = enforceToolCall({ toolName: 'create_file', filePath: 'app/.env', fileContent: 'x' }, [contextualPolicy], makeConfig(), session);
		expect(read.blocked).toBe(false);
		expect(session.hasFlag('readSecrets')).toBe(true);

		// The same outbound tool is now blocked because of accumulated state.
		const after = enforceToolCall({ toolName: 'fetch_webpage' }, [contextualPolicy], makeConfig(), session);
		expect(after).toMatchObject({ blocked: true, reason: 'policy', policyId: 'no-exfil' });
	});
});

describe('run session registry', () => {
	it('returns the same session for the same key and a fresh one for a new key', () => {
		const keyA = {};
		const keyB = {};
		const first = getRunSession(keyA);
		expect(getRunSession(keyA)).toBe(first);
		expect(getRunSession(keyB)).not.toBe(first);
	});

	it('peek returns undefined before creation and the session afterwards', () => {
		const key = {};
		expect(peekRunSession(key)).toBeUndefined();
		const session = getRunSession(key);
		expect(peekRunSession(key)).toBe(session);
	});
});
