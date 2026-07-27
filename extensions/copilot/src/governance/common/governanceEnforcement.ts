/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EvaluationContext, evaluateContext } from './policyEvaluator';
import { GovernanceRunSession } from './governanceRunSession';
import { ActivePolicy, GovernanceConfig } from './types';

/**
 * The concrete facts about a single tool call that governance rules can match against.
 */
export interface ToolCallContext {
	/** The tool being invoked (matched against `tool` rules). */
	readonly toolName: string;
	/** The shell command, when the tool runs a terminal command (matched against `terminal` rules). */
	readonly terminalCommand?: string;
	/** The target path, when the tool writes a file (matched against `file` rules). */
	readonly filePath?: string;
	/** The file content being written, when available (matched against `file` content rules). */
	readonly fileContent?: string;
}

export type EnforcementBlockReason = 'policy' | 'rate-limit-tools' | 'rate-limit-files';

export interface EnforcementResult {
	readonly blocked: boolean;
	readonly reason?: EnforcementBlockReason;
	/** The policy that caused a `policy` block, when applicable. */
	readonly policyId?: string;
}

/**
 * Per-run session registry. Sessions are keyed by a stable per-request object (the
 * `ChatRequest`) so a whole agent run shares one session and is garbage-collected with it.
 */
const _runSessions = new WeakMap<object, GovernanceRunSession>();

/** Returns the run session for the given key, creating it on first access. */
export function getRunSession(key: object): GovernanceRunSession {
	let session = _runSessions.get(key);
	if (!session) {
		session = new GovernanceRunSession();
		_runSessions.set(key, session);
	}
	return session;
}

/** Returns the run session for the given key without creating one. */
export function peekRunSession(key: object): GovernanceRunSession | undefined {
	return _runSessions.get(key);
}

/**
 * Deterministically evaluates a single tool call against active governance policies and
 * per-run rate limits, recording the outcome on the run session. Never throws.
 *
 * Enforcement order:
 *   1. Rate limits (tool-call and file budgets) — stop an over-budget run early.
 *   2. Policy rules — evaluate the tool, then any terminal command, then any file write.
 *
 * Rules can be contextual: a rule's `sets` flags are raised on the session and later rules
 * (in this call and subsequent calls) can gate on them via `when`. A `deny` action blocks the
 * call; a `warn` action is recorded and allowed; an `observe` action only raises flags.
 */
export function enforceToolCall(
	ctx: ToolCallContext,
	policies: readonly ActivePolicy[],
	config: GovernanceConfig,
	session: GovernanceRunSession,
): EnforcementResult {
	if (config.rateLimits.enabled) {
		if (session.toolCallCount >= config.rateLimits.maxToolCallsPerRun) {
			return { blocked: true, reason: 'rate-limit-tools' };
		}
		if (ctx.filePath !== undefined && session.editedFileCount >= config.rateLimits.maxFilesPerTask) {
			return { blocked: true, reason: 'rate-limit-files' };
		}
	}

	const evaluations: EvaluationContext[] = [{ kind: 'tool', value: ctx.toolName }];
	if (ctx.terminalCommand !== undefined) {
		evaluations.push({ kind: 'terminal', value: ctx.terminalCommand });
	}
	if (ctx.filePath !== undefined) {
		evaluations.push({ kind: 'file', value: ctx.filePath, content: ctx.fileContent });
	}

	for (const evaluation of evaluations) {
		const result = evaluateContext(evaluation, policies, session.flags);
		// Raise any contextual flags first so later evaluations in this call — and
		// subsequent tool calls in the run — can condition on them.
		for (const flag of result.flagsToSet) {
			session.setFlag(flag);
		}
		if (result.decision) {
			session.recordDecision(result.decision);
			if (result.action === 'deny') {
				return { blocked: true, reason: 'policy', policyId: result.matchedPolicyId };
			}
		}
	}

	// Allowed — record activity for rate-limit accounting and the per-run summary.
	session.recordToolCall();
	if (ctx.filePath !== undefined) {
		session.recordFileEdit(ctx.filePath);
	}
	return { blocked: false };
}
