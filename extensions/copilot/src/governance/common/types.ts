/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type PolicySource = 'org' | 'project' | 'inferred';
export type PolicyStatus = 'redirected' | 'applied' | 'warn';
export type GuardrailMode = 'enforce' | 'warn';

// ---- Structured rule types (new) ----

export type RuleTarget = 'terminal' | 'tool' | 'file';

/**
 * What a matching rule does:
 *   - `deny`    — block the action.
 *   - `warn`    — record a confirmation and allow.
 *   - `observe` — allow silently; used only to raise session flags via {@link PolicyRule.sets}.
 */
export type RuleAction = 'deny' | 'warn' | 'observe';

export interface TerminalRuleMatch {
	readonly commandPattern: string;          // regex string
}

export interface ToolRuleMatch {
	readonly toolName: string;                // exact tool name
}

export interface FileRuleMatch {
	readonly pathPattern?: string;            // regex string against file path
	readonly contentPattern?: string;         // regex string against file content
}

export type RuleMatch = TerminalRuleMatch | ToolRuleMatch | FileRuleMatch;

/**
 * Gates a rule on accumulated per-run session state so policies can be *contextual* —
 * i.e. condition on what has already happened in the session rather than on the
 * current action alone.
 */
export interface RuleCondition {
	/** Every listed session flag must be set for the rule to apply. */
	readonly flags?: readonly string[];
}

export interface PolicyRule {
	readonly target: RuleTarget;
	readonly match: RuleMatch;
	readonly action: RuleAction;
	/** When present, the rule only applies if the run session satisfies this condition. */
	readonly when?: RuleCondition;
	/** Session flags raised when this rule matches, making later rules contextual. */
	readonly sets?: readonly string[];
}

export interface Policy {
	readonly id: string;
	readonly category: string;
	readonly scope: PolicySource;
	readonly enforcement: GuardrailMode;
	readonly label: string;
	readonly description: string;
	readonly autoFix: boolean;
	readonly fix?: string;
	readonly rules?: readonly PolicyRule[];    // optional structured rules
}

// Per-run enforcement decision (new)
export type DecisionOutcome = 'allowed' | 'blocked' | 'confirmed';

export interface GovernanceDecision {
	readonly policyId: string;
	readonly ruleTarget: RuleTarget;
	readonly context: string;           // what was blocked (command, tool name, file path)
	readonly outcome: DecisionOutcome;
}

export interface Standard {
	readonly id: string;
	readonly label: string;
	readonly evidence: string;
	enabled: boolean;
	readonly category: string;
}

export type ActivePolicy = Policy & { status: PolicyStatus };

export interface GovernanceConfig {
	readonly enabled: boolean;
	readonly mode: GuardrailMode;
	readonly policyUrl: string;
	readonly autoFixSafeIssues: boolean;
	readonly showDiffSummaryAfterEdits: boolean;
	readonly includeRationaleInResponses: boolean;
	readonly rateLimits: {
		readonly enabled: boolean;
		readonly maxFilesPerTask: number;
		readonly maxToolCallsPerRun: number;
	};
}
