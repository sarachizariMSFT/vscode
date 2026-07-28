/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivePolicy, GovernanceDecision, GuardrailMode, PolicyRule, RuleAction, RuleCondition } from './types';

export interface EvaluationContext {
	readonly kind: 'terminal' | 'tool' | 'file';
	readonly value: string;           // command string, tool name, or file path
	readonly content?: string;        // file content (only for kind='file')
}

export interface EvaluationResult {
	readonly action: RuleAction | 'allow';
	readonly matchedPolicyId: string | undefined;
	readonly matchedRule: PolicyRule | undefined;
	readonly decision: GovernanceDecision | undefined;
	/** Session flags raised by every matching rule, to be applied by the caller. */
	readonly flagsToSet: readonly string[];
}

const _NO_FLAGS: ReadonlySet<string> = new Set<string>();

/**
 * Evaluates a single context (terminal command, tool call, or file write) against all
 * active policies. Returns the strictest matching action or 'allow' when no rule matches.
 *
 * Rules can be *contextual*: a rule with a `when` clause only applies when the run session
 * already carries the required flags, and a matching rule's `sets` flags are collected in
 * `flagsToSet` so the caller can update the session for subsequent evaluations.
 *
 * Enforcement semantics:
 *   - policy.enforcement === 'enforce' + rule.action === 'deny'  → hard block
 *   - policy.enforcement === 'enforce' + rule.action === 'warn'  → confirmation required
 *   - rule.action === 'observe'                                  → allow, only raises flags
 *   - policy.enforcement === 'warn'    (deny/warn rule)          → log and allow
 *   - no matching rule                                           → allow
 *
 * The global `globalMode` acts as an org-wide kill-switch: when it is `'warn'`, every policy
 * is treated as warn-only regardless of its own `enforcement`, so nothing is hard-blocked.
 */
export function evaluateContext(ctx: EvaluationContext, policies: readonly ActivePolicy[], sessionFlags: ReadonlySet<string> = _NO_FLAGS, globalMode: GuardrailMode = 'enforce'): EvaluationResult {
	const flagsToSet: string[] = [];
	let actionable: Omit<EvaluationResult, 'flagsToSet'> | undefined;

	for (const policy of policies) {
		if (!policy.rules || policy.rules.length === 0) { continue; }
		for (const rule of policy.rules) {
			if (rule.target !== ctx.kind) { continue; }
			if (!_conditionMet(rule.when, sessionFlags)) { continue; }
			if (!_matchesRule(rule, ctx)) { continue; }

			if (rule.sets) {
				for (const flag of rule.sets) { flagsToSet.push(flag); }
			}

			// `observe` rules never block or warn — they only raise flags.
			if (rule.action === 'observe') { continue; }

			if (!actionable) {
				// In 'warn' mode — either globally or per policy — never hard-block, only report.
				const effectiveAction: RuleAction = (globalMode === 'warn' || policy.enforcement === 'warn') ? 'warn' : rule.action;
				actionable = {
					action: effectiveAction,
					matchedPolicyId: policy.id,
					matchedRule: rule,
					decision: {
						policyId: policy.id,
						ruleTarget: ctx.kind,
						context: ctx.value,
						outcome: effectiveAction === 'deny' ? 'blocked' : 'confirmed',
					},
				};
			}
		}
	}

	if (actionable) {
		return { ...actionable, flagsToSet };
	}
	return { action: 'allow', matchedPolicyId: undefined, matchedRule: undefined, decision: undefined, flagsToSet };
}

/** Returns true when the session state satisfies the rule's `when` condition (or there is none). */
function _conditionMet(when: RuleCondition | undefined, sessionFlags: ReadonlySet<string>): boolean {
	if (!when || !when.flags || when.flags.length === 0) { return true; }
	for (const flag of when.flags) {
		if (!sessionFlags.has(flag)) { return false; }
	}
	return true;
}

function _matchesRule(rule: PolicyRule, ctx: EvaluationContext): boolean {
	const match = rule.match as Record<string, unknown>;
	switch (rule.target) {
		case 'terminal': {
			const pattern = match['commandPattern'];
			if (typeof pattern !== 'string') { return false; }
			try {
				return new RegExp(pattern).test(ctx.value);
			} catch {
				return false;   // invalid regex — never enforce
			}
		}
		case 'tool': {
			const name = match['toolName'];
			if (typeof name !== 'string') { return false; }
			return ctx.value === name;
		}
		case 'file': {
			const pathPat = match['pathPattern'];
			const contentPat = match['contentPattern'];
			let pathMatch = true;
			let contentMatch = true;
			try {
				if (typeof pathPat === 'string') { pathMatch = new RegExp(pathPat).test(ctx.value); }
				if (typeof contentPat === 'string' && ctx.content !== undefined) {
					contentMatch = new RegExp(contentPat).test(ctx.content);
				}
			} catch {
				return false;
			}
			return pathMatch && contentMatch;
		}
	}
}
