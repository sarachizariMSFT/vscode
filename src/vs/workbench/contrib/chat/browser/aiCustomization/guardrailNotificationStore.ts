/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../../base/common/event.js';
import { localize } from '../../../../../nls.js';

/**
 * A single guardrail finding surfaced by the embedded enforcement layer when an
 * agent action is blocked (either the LLM self-refused at the policy layer, or
 * the structural tool gate intercepted a jailbroken attempt).
 */
export interface IGuardrailIssue {
	readonly id: string;
	/** Short headline, e.g. "Write file blocked". */
	readonly title: string;
	/** One-line explanation of which layer caught it and why. */
	readonly detail: string;
	/** Which scenario produced the block. */
	readonly scenario: 'policy' | 'jailbroken';
	readonly timestamp: number;
}

/**
 * Process-wide store of guardrail issues for the current agent session.
 *
 * This is intentionally a lightweight module singleton (prototype scope): it
 * lets the chat surface advertise a "N guardrails blocked" notification bar
 * that deep-links into the Agents customization view, while the Agents view's
 * action simulator can push live issues into the same store. Both sides stay in
 * sync without threading a full workbench service through unrelated layers.
 */
class GuardrailNotificationStore {
	private readonly _issues: IGuardrailIssue[] = [];

	private readonly _onDidChange = new Emitter<void>();
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _onDidChangeDemo = new Emitter<void>();
	readonly onDidChangeDemo: Event<void> = this._onDidChangeDemo.event;

	private _demoActive = false;
	/** Monotonic counter; bumped on every startDemo() so an already-open demo re-runs its script. */
	private _demoNonce = 0;

	constructor() {
		this._seedDemoIssues();
	}

	get issues(): readonly IGuardrailIssue[] {
		return this._issues;
	}

	get count(): number {
		return this._issues.length;
	}

	/** Whether the scripted "agent working → guardrail blocks" demo session is showing. */
	get demoActive(): boolean {
		return this._demoActive;
	}

	get demoNonce(): number {
		return this._demoNonce;
	}

	/**
	 * Enter (or restart) the scripted demo session. Clears any prior findings so
	 * the blocked-action popup reads as something that just happened in this turn.
	 */
	startDemo(): void {
		this._issues.length = 0;
		this._onDidChange.fire();
		this._demoActive = true;
		this._demoNonce++;
		this._onDidChangeDemo.fire();
	}

	/** Leave the demo session and return to the new-chat surface. */
	stopDemo(): void {
		if (!this._demoActive) {
			return;
		}
		this._demoActive = false;
		this._onDidChangeDemo.fire();
	}

	add(issue: IGuardrailIssue): void {
		this._issues.unshift(issue);
		this._onDidChange.fire();
	}

	reset(): void {
		if (this._issues.length === 0) {
			return;
		}
		this._issues.length = 0;
		this._onDidChange.fire();
	}

	/**
	 * Seed a few representative findings so the notification bar is meaningful
	 * the moment the session opens (prototype/demo affordance).
	 */
	private _seedDemoIssues(): void {
		const now = Date.now();
		this._issues.push(
			{
				id: 'seed-net',
				title: localize('guardrailIssueNetTitle', "Network call blocked"),
				detail: localize('guardrailIssueNetDetail', "Tool gate: network = disallowed — POST to api.io was intercepted before it ran."),
				scenario: 'jailbroken',
				timestamp: now - 4000,
			},
			{
				id: 'seed-write',
				title: localize('guardrailIssueWriteTitle', "Write file blocked"),
				detail: localize('guardrailIssueWriteDetail', "Tool gate: file_system = read-only forbids modifying src/auth.ts."),
				scenario: 'jailbroken',
				timestamp: now - 9000,
			},
			{
				id: 'seed-policy',
				title: localize('guardrailIssuePolicyTitle', "Write file refused at policy layer"),
				detail: localize('guardrailIssuePolicyDetail', "Model read the injected policy, refused, and suggested an alternative."),
				scenario: 'policy',
				timestamp: now - 15000,
			},
		);
	}
}

export const guardrailNotificationStore = new GuardrailNotificationStore();
