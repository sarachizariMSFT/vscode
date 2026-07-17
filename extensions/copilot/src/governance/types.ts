/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type PolicySource = 'org' | 'project' | 'inferred';
export type PolicyStatus = 'redirected' | 'applied' | 'warn';
export type GuardrailMode = 'enforce' | 'warn';

export interface Policy {
	readonly id: string;
	readonly category: string;
	readonly scope: PolicySource;
	readonly enforcement: GuardrailMode;
	readonly label: string;
	readonly description: string;
	readonly autoFix: boolean;
	readonly fix?: string;
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
