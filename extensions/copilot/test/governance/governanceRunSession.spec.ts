/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it } from 'vitest';
import { GovernanceRunSession } from '../../src/governance/common/governanceRunSession';

describe('GovernanceRunSession', () => {
	it('fresh session has zero counts and no activity', () => {
		const session = new GovernanceRunSession();
		expect(session.toolCallCount).toBe(0);
		expect(session.editedFileCount).toBe(0);
		expect(session.decisions).toHaveLength(0);
		expect(session.hasActivity()).toBe(false);
	});

	it('records tool calls and count increments', () => {
		const session = new GovernanceRunSession();
		session.recordToolCall();
		session.recordToolCall();
		expect(session.toolCallCount).toBe(2);
	});

	it('records file edits and deduplicates by path', () => {
		const session = new GovernanceRunSession();
		session.recordFileEdit('a.ts');
		session.recordFileEdit('b.ts');
		session.recordFileEdit('a.ts');   // duplicate
		expect(session.editedFileCount).toBe(2);
	});

	it('hasActivity returns true after recording a decision', () => {
		const session = new GovernanceRunSession();
		session.recordDecision({ policyId: 'p1', ruleTarget: 'terminal', context: 'git push --force', outcome: 'blocked' });
		expect(session.hasActivity()).toBe(true);
	});

	it('decisions array reflects all recorded decisions in order', () => {
		const session = new GovernanceRunSession();
		session.recordDecision({ policyId: 'p1', ruleTarget: 'terminal', context: 'cmd1', outcome: 'blocked' });
		session.recordDecision({ policyId: 'p2', ruleTarget: 'tool', context: 'tool_name', outcome: 'confirmed' });
		expect(session.decisions).toHaveLength(2);
		expect(session.decisions[0].policyId).toBe('p1');
		expect(session.decisions[1].policyId).toBe('p2');
	});

	it('tracks contextual flags and deduplicates them', () => {
		const session = new GovernanceRunSession();
		expect(session.hasFlag('readSecrets')).toBe(false);
		session.setFlag('readSecrets');
		session.setFlag('readSecrets');   // duplicate
		expect(session.hasFlag('readSecrets')).toBe(true);
		expect([...session.flags]).toEqual(['readSecrets']);
	});
});
