/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { enforceToolCall } from './governanceEnforcement';
import { GovernanceRunSession } from './governanceRunSession';
import { evaluateContext } from './policyEvaluator';
import { ActivePolicy, GovernanceConfig, GuardrailMode } from './types';

function config(overrides: Partial<GovernanceConfig> = {}): GovernanceConfig {
	return {
		enabled: true,
		mode: 'enforce',
		policyUrl: '',
		autoFixSafeIssues: true,
		showDiffSummaryAfterEdits: true,
		includeRationaleInResponses: true,
		rateLimits: { enabled: false, maxFilesPerTask: 10, maxToolCallsPerRun: 20 },
		...overrides,
	};
}

/**
 * The "no outbound network after reading secrets" contextual policy from the demo: reading a
 * secret-bearing file silently raises the `readSecrets` flag (observe), and once set it denies
 * `fetch_webpage` for the rest of the run.
 */
function secretsThenNoNetworkPolicy(enforcement: GuardrailMode = 'enforce'): ActivePolicy {
	return {
		id: 'SEC-CTX-1',
		category: 'security',
		scope: 'org',
		enforcement,
		label: 'No outbound network after reading secrets',
		description: '',
		autoFix: false,
		status: 'applied',
		rules: [
			{ target: 'file', match: { pathPattern: '(^|/)\\.env$|secrets|credentials' }, action: 'observe', sets: ['readSecrets'] },
			{ target: 'tool', match: { toolName: 'fetch_webpage' }, action: 'deny', when: { flags: ['readSecrets'] } },
		],
	};
}

describe('governance contextual enforcement', () => {
	it('blocks a fetch only after a secret file has been read in the same run', () => {
		const policies = [secretsThenNoNetworkPolicy()];
		const cfg = config();
		const session = new GovernanceRunSession();

		const readResult = enforceToolCall({ toolName: 'read_file', filePath: '/proj/.env' }, policies, cfg, session);
		const flagRaised = session.hasFlag('readSecrets');
		const fetchResult = enforceToolCall({ toolName: 'fetch_webpage' }, policies, cfg, session);

		expect({
			readBlocked: readResult.blocked,
			flagRaised,
			fetchBlocked: fetchResult.blocked,
			fetchReason: fetchResult.reason,
			fetchPolicyId: fetchResult.policyId,
			trackedContext: [...session.flags],
		}).toEqual({
			readBlocked: false,
			flagRaised: true,
			fetchBlocked: true,
			fetchReason: 'policy',
			fetchPolicyId: 'SEC-CTX-1',
			trackedContext: ['readSecrets'],
		});
	});

	it('allows a fetch when no secret file was read first (the rule is contextual)', () => {
		const policies = [secretsThenNoNetworkPolicy()];
		const session = new GovernanceRunSession();

		const fetchResult = enforceToolCall({ toolName: 'fetch_webpage' }, policies, config(), session);

		expect({ blocked: fetchResult.blocked, flags: [...session.flags] }).toEqual({ blocked: false, flags: [] });
	});

	it('in warn mode records the contextual match as confirmed instead of blocking', () => {
		const policies = [secretsThenNoNetworkPolicy('warn')];
		const cfg = config({ mode: 'warn' });
		const session = new GovernanceRunSession();

		enforceToolCall({ toolName: 'read_file', filePath: '/proj/.env' }, policies, cfg, session);
		const fetchResult = enforceToolCall({ toolName: 'fetch_webpage' }, policies, cfg, session);

		expect({
			blocked: fetchResult.blocked,
			decisions: session.decisions.map(d => ({ policyId: d.policyId, outcome: d.outcome })),
		}).toEqual({
			blocked: false,
			decisions: [{ policyId: 'SEC-CTX-1', outcome: 'confirmed' }],
		});
	});

	it('global warn mode downgrades an enforce policy to warn instead of blocking', () => {
		// The policy itself is 'enforce', but the org-wide kill-switch (config.mode = 'warn')
		// turns every hard block into a flag-and-allow.
		const policies = [secretsThenNoNetworkPolicy('enforce')];
		const cfg = config({ mode: 'warn' });
		const session = new GovernanceRunSession();

		enforceToolCall({ toolName: 'read_file', filePath: '/proj/.env' }, policies, cfg, session);
		const fetchResult = enforceToolCall({ toolName: 'fetch_webpage' }, policies, cfg, session);

		expect({
			blocked: fetchResult.blocked,
			decisions: session.decisions.map(d => ({ policyId: d.policyId, outcome: d.outcome })),
		}).toEqual({
			blocked: false,
			decisions: [{ policyId: 'SEC-CTX-1', outcome: 'confirmed' }],
		});
	});

	it('applies flags raised earlier in the same tool call to later evaluations', () => {
		// A single tool call is evaluated in the order tool -> terminal -> file, and a flag raised by
		// an earlier evaluation gates the later ones. Here the tool match taints the run and the file
		// write in the same call is denied as a result.
		const policy: ActivePolicy = {
			id: 'SELF-CTX', category: 'security', scope: 'org', enforcement: 'enforce',
			label: 'self', description: '', autoFix: false, status: 'applied',
			rules: [
				{ target: 'tool', match: { toolName: 'run_untrusted' }, action: 'observe', sets: ['tainted'] },
				{ target: 'file', match: { pathPattern: '.*' }, action: 'deny', when: { flags: ['tainted'] } },
			],
		};
		const session = new GovernanceRunSession();

		const result = enforceToolCall({ toolName: 'run_untrusted', filePath: '/proj/out.txt' }, [policy], config(), session);

		expect({ blocked: result.blocked, policyId: result.policyId }).toEqual({ blocked: true, policyId: 'SELF-CTX' });
	});
});

describe('evaluateContext contextual gating', () => {
	const policy = secretsThenNoNetworkPolicy();

	it('does not match a when-gated rule until its flags are present', () => {
		const withoutFlags = evaluateContext({ kind: 'tool', value: 'fetch_webpage' }, [policy]);
		const withFlags = evaluateContext({ kind: 'tool', value: 'fetch_webpage' }, [policy], new Set(['readSecrets']));

		expect({
			withoutFlags: withoutFlags.action,
			withFlags: withFlags.action,
			withFlagsPolicy: withFlags.matchedPolicyId,
		}).toEqual({ withoutFlags: 'allow', withFlags: 'deny', withFlagsPolicy: 'SEC-CTX-1' });
	});

	it('treats observe rules as allow while still reporting the flags they raise', () => {
		const result = evaluateContext({ kind: 'file', value: '/proj/.env' }, [policy]);

		expect({ action: result.action, decision: result.decision, flagsToSet: result.flagsToSet }).toEqual({
			action: 'allow',
			decision: undefined,
			flagsToSet: ['readSecrets'],
		});
	});

	it('never enforces a rule whose regex is invalid', () => {
		const badPolicy: ActivePolicy = {
			id: 'BAD-RE', category: 'security', scope: 'org', enforcement: 'enforce',
			label: 'bad', description: '', autoFix: false, status: 'applied',
			rules: [{ target: 'terminal', match: { commandPattern: '(' }, action: 'deny' }],
		};

		const result = evaluateContext({ kind: 'terminal', value: 'git push --force' }, [badPolicy]);

		expect(result.action).toBe('allow');
	});
});
