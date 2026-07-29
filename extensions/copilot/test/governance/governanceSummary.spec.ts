/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { buildRunSummary } from '../../src/governance/common/governanceSummary';
import { GovernanceDecision } from '../../src/governance/common/types';

describe('buildRunSummary', () => {
	it('returns undefined when there are no decisions', () => {
		expect(buildRunSummary([])).toBeUndefined();
	});

	it('renders a blocked decision with the blocked icon and a blocked count', () => {
		const decisions: GovernanceDecision[] = [
			{ policyId: 'p1', ruleTarget: 'terminal', context: 'git push --force', outcome: 'blocked' },
		];
		const summary = buildRunSummary(decisions)!;
		expect(summary).toContain('1 blocked');
		expect(summary).toContain('✗');
		expect(summary).toContain('git push --force');
		expect(summary).toContain('| | Policy | Target | Context |');
	});

	it('renders a confirmed decision with the warn icon and a flagged count', () => {
		const decisions: GovernanceDecision[] = [
			{ policyId: 'p2', ruleTarget: 'tool', context: 'deleteFile', outcome: 'confirmed' },
		];
		const summary = buildRunSummary(decisions)!;
		expect(summary).toContain('1 flagged');
		expect(summary).toContain('⚠');
		expect(summary).not.toContain('blocked');
	});

	it('combines blocked and flagged counts in the header', () => {
		const decisions: GovernanceDecision[] = [
			{ policyId: 'p1', ruleTarget: 'terminal', context: 'rm -rf /', outcome: 'blocked' },
			{ policyId: 'p2', ruleTarget: 'file', context: 'secrets.env', outcome: 'confirmed' },
		];
		const summary = buildRunSummary(decisions)!;
		expect(summary).toContain('1 blocked, 1 flagged');
	});

	it('labels the header with the active governance mode', () => {
		const decisions: GovernanceDecision[] = [
			{ policyId: 'p1', ruleTarget: 'tool', context: 'deleteFile', outcome: 'confirmed' },
		];
		expect(buildRunSummary(decisions)).toContain('Guardrails — Enforce mode');
		expect(buildRunSummary(decisions, [], 'warn')).toContain('Guardrails — Warn mode');
	});

	it('escapes pipe characters in the context cell', () => {
		const decisions: GovernanceDecision[] = [
			{ policyId: 'p1', ruleTarget: 'terminal', context: 'cat a | grep b', outcome: 'blocked' },
		];
		const summary = buildRunSummary(decisions)!;
		expect(summary).toContain('cat a \\| grep b');
	});

	it('lists tracked context flags after the decisions table', () => {
		const decisions: GovernanceDecision[] = [
			{ policyId: 'p1', ruleTarget: 'tool', context: 'fetch_webpage', outcome: 'blocked' },
		];
		const summary = buildRunSummary(decisions, ['readSecrets'])!;
		expect(summary).toContain('Context tracked: `readSecrets`');
	});

	it('renders a flag-only summary when context was tracked but nothing was blocked', () => {
		const summary = buildRunSummary([], ['readSecrets'])!;
		expect(summary).toContain('Context tracked: `readSecrets`');
		expect(summary).not.toContain('| | Policy | Target | Context |');
	});

	it('returns undefined when there are no decisions and no flags', () => {
		expect(buildRunSummary([], [])).toBeUndefined();
	});
});
