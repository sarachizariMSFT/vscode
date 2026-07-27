/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { evaluateContext, EvaluationContext } from '../../src/governance/common/policyEvaluator';
import { ActivePolicy } from '../../src/governance/common/types';

// ---- Helpers ----

function makeTerminalPolicy(id: string, pattern: string, action: 'deny' | 'warn', enforcement: 'enforce' | 'warn' = 'enforce'): ActivePolicy {
	return {
		id,
		label: id,
		category: 'test',
		scope: 'org',
		enforcement,
		description: '',
		autoFix: false,
		status: 'applied',
		rules: [{ target: 'terminal', match: { commandPattern: pattern }, action }],
	};
}

function makeToolPolicy(id: string, toolName: string, action: 'deny' | 'warn' = 'deny'): ActivePolicy {
	return {
		id,
		label: id,
		category: 'test',
		scope: 'org',
		enforcement: 'enforce',
		description: '',
		autoFix: false,
		status: 'applied',
		rules: [{ target: 'tool', match: { toolName }, action }],
	};
}

function makeFilePolicy(id: string, pathPattern: string | undefined, contentPattern: string | undefined, action: 'deny' | 'warn' = 'deny'): ActivePolicy {
	return {
		id,
		label: id,
		category: 'test',
		scope: 'org',
		enforcement: 'enforce',
		description: '',
		autoFix: false,
		status: 'applied',
		rules: [{ target: 'file', match: { pathPattern, contentPattern }, action }],
	};
}

// ---- Tests ----

describe('evaluateContext', () => {
	it('returns allow when no active policies', () => {
		const ctx: EvaluationContext = { kind: 'terminal', value: 'git push --force' };
		const result = evaluateContext(ctx, []);
		expect(result).toEqual({ action: 'allow', matchedPolicyId: undefined, matchedRule: undefined, decision: undefined, flagsToSet: [] });
	});

	it('returns allow when policies have no rules', () => {
		const policy: ActivePolicy = {
			id: 'prompt-only',
			label: 'Prompt Only',
			category: 'test',
			scope: 'org',
			enforcement: 'enforce',
			description: '',
			autoFix: false,
			status: 'applied',
		};
		const result = evaluateContext({ kind: 'terminal', value: 'git push --force' }, [policy]);
		expect(result.action).toBe('allow');
	});

	it('deny — terminal command matching commandPattern in enforce+deny policy', () => {
		const policy = makeTerminalPolicy('no-force-push', '(^|\\s)git\\s+push.*(--force|-f)', 'deny');
		const result = evaluateContext({ kind: 'terminal', value: 'git push --force origin main' }, [policy]);
		expect(result.action).toBe('deny');
		expect(result.matchedPolicyId).toBe('no-force-push');
		expect(result.decision?.outcome).toBe('blocked');
		expect(result.decision?.context).toBe('git push --force origin main');
	});

	it('warn — terminal command matching pattern in warn-enforcement policy → warn (not deny)', () => {
		const policy = makeTerminalPolicy('rm-rf', 'rm\\s+-[rf]', 'deny', 'warn');
		const result = evaluateContext({ kind: 'terminal', value: 'rm -rf /tmp/junk' }, [policy]);
		expect(result.action).toBe('warn');
		expect(result.decision?.outcome).toBe('confirmed');
	});

	it('allow — terminal command not matching any rule', () => {
		const policy = makeTerminalPolicy('no-force-push', 'git push.*--force', 'deny');
		const result = evaluateContext({ kind: 'terminal', value: 'git status' }, [policy]);
		expect(result.action).toBe('allow');
	});

	it('deny — tool name matching toolName', () => {
		const policy = makeToolPolicy('block-terminal', 'run_terminal_command');
		const result = evaluateContext({ kind: 'tool', value: 'run_terminal_command' }, [policy]);
		expect(result.action).toBe('deny');
		expect(result.matchedPolicyId).toBe('block-terminal');
	});

	it('allow — tool name not matching', () => {
		const policy = makeToolPolicy('block-terminal', 'run_terminal_command');
		const result = evaluateContext({ kind: 'tool', value: 'read_file' }, [policy]);
		expect(result.action).toBe('allow');
	});

	it('allow — invalid regex in commandPattern never throws, returns allow', () => {
		const policy: ActivePolicy = {
			id: 'bad-regex',
			label: 'Bad Regex',
			category: 'test',
			scope: 'org',
			enforcement: 'enforce',
			description: '',
			autoFix: false,
			status: 'applied',
			rules: [{ target: 'terminal', match: { commandPattern: '[invalid regex(' }, action: 'deny' }],
		};
		expect(() => evaluateContext({ kind: 'terminal', value: 'anything' }, [policy])).not.toThrow();
		const result = evaluateContext({ kind: 'terminal', value: 'anything' }, [policy]);
		expect(result.action).toBe('allow');
	});

	it('deny — file path and content both match', () => {
		const policy = makeFilePolicy('no-secrets', '\\.(env|json)$', '(api_key|password)\\s*=');
		const result = evaluateContext({ kind: 'file', value: 'config.json', content: 'api_key = "abc123"' }, [policy]);
		expect(result.action).toBe('deny');
		expect(result.decision?.outcome).toBe('blocked');
	});

	it('allow — file path matches but content does not match', () => {
		const policy = makeFilePolicy('no-secrets', '\\.(env|json)$', '(api_key|password)\\s*=');
		const result = evaluateContext({ kind: 'file', value: 'config.json', content: 'normal content' }, [policy]);
		expect(result.action).toBe('allow');
	});

	it('deny — file path matches, no contentPattern specified → only path matters', () => {
		const policy = makeFilePolicy('no-env-files', '\\.env$', undefined);
		const result = evaluateContext({ kind: 'file', value: 'secrets.env' }, [policy]);
		expect(result.action).toBe('deny');
	});

	it('allow — file path does not match pathPattern', () => {
		const policy = makeFilePolicy('no-env-files', '\\.env$', undefined);
		const result = evaluateContext({ kind: 'file', value: 'readme.md' }, [policy]);
		expect(result.action).toBe('allow');
	});
});

describe('evaluateContext — contextual (stateful) rules', () => {
	function contextualPolicy(): ActivePolicy {
		return {
			id: 'no-exfil',
			label: 'no-exfil',
			category: 'security',
			scope: 'org',
			enforcement: 'enforce',
			description: '',
			autoFix: false,
			status: 'applied',
			rules: [
				{ target: 'file', match: { pathPattern: '\\.env$' }, action: 'observe', sets: ['readSecrets'] },
				{ target: 'tool', match: { toolName: 'fetch_webpage' }, action: 'deny', when: { flags: ['readSecrets'] } },
			],
		};
	}

	it('observe rule raises flags without producing a decision', () => {
		const result = evaluateContext({ kind: 'file', value: 'app/.env' }, [contextualPolicy()]);
		expect(result.action).toBe('allow');
		expect(result.decision).toBeUndefined();
		expect(result.flagsToSet).toEqual(['readSecrets']);
	});

	it('when-gated rule does not apply while the required flag is absent', () => {
		const result = evaluateContext({ kind: 'tool', value: 'fetch_webpage' }, [contextualPolicy()]);
		expect(result.action).toBe('allow');
	});

	it('when-gated rule applies once the required flag is present', () => {
		const result = evaluateContext({ kind: 'tool', value: 'fetch_webpage' }, [contextualPolicy()], new Set(['readSecrets']));
		expect(result.action).toBe('deny');
		expect(result.matchedPolicyId).toBe('no-exfil');
	});
});
