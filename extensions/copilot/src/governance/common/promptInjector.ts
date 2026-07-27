/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivePolicy, GovernanceConfig, Standard } from './types';
import { PolicyStore } from './policyStore';

/**
 * Builds the enterprise governance block (XML-wrapped) injected into the agent system prompt.
 * Lists all active policies with their id, scope, enforcement level, and label.
 * Returns an empty string when there are no active policies.
 */
export function buildEnterpriseBlock(policies: readonly ActivePolicy[], config: GovernanceConfig): string {
	if (policies.length === 0) {
		return '';
	}

	const policyList = policies
		.map(p => `- ${p.id} (${p.scope}, ${p.enforcement}): ${p.label}${p.fix ? `. ${p.fix}` : ''}`)
		.join('\n');

	const lines = [
		'<governance>',
		'The following org and project policies are active for this workspace. Apply them silently during implementation. Do not ask the developer for permission to apply these — just apply them. If a policy requires redirecting the developer\'s requested approach (e.g., replacing a prohibited library), implement the compliant alternative, then explain the change in your response after presenting the code.',
		'',
		'ACTIVE POLICIES:',
		policyList,
	];

	// Explain contextual enforcement so the model adapts rather than blindly retrying a blocked call.
	const hasContextualRules = policies.some(p => p.rules?.some(r => r.when !== undefined || r.sets !== undefined));
	if (hasContextualRules) {
		lines.push('', 'Some policies are contextual: they activate based on earlier actions in this session (for example, after a sensitive file has been read). If a tool call is blocked partway through a task, it may be a consequence of an earlier action rather than the call itself — adapt your approach instead of retrying the same call.');
	}

	if (config.includeRationaleInResponses) {
		lines.push('', 'After completing the task, include a "Guardrails applied" section listing which policies were applied and any redirections made. Keep explanations concise (one sentence per policy).');
	}

	lines.push('</governance>');
	return lines.join('\n');
}

/**
 * Builds the individual-developer standards block injected into the agent system prompt.
 * Lists only the standards the developer has enabled.
 * Returns an empty string when there are no enabled standards.
 */
export function buildIndividualBlock(standards: readonly Standard[], config: GovernanceConfig): string {
	const enabled = standards.filter(s => s.enabled);
	if (enabled.length === 0) {
		return '';
	}

	const list = enabled
		.map(s => `- ${s.label} (evidence: ${s.evidence})`)
		.join('\n');

	const lines = [
		'<standards>',
		'The developer has accepted the following coding standards for this workspace. Apply them silently during implementation without asking for permission.',
		'',
		'ACTIVE STANDARDS:',
		list,
	];

	if (config.includeRationaleInResponses) {
		lines.push('', 'After completing the task, include a brief "Standards kept" summary noting which standards were honored and how.');
	}

	lines.push('</standards>');
	return lines.join('\n');
}

/**
 * Returns the governance context block to prepend to the agent system prompt, or an empty
 * string when governance is disabled or neither policies nor standards are active.
 *
 * Priority order: enterprise policies → individual standards → empty.
 */
export function buildGovernanceBlock(store: PolicyStore, config: GovernanceConfig): string {
	if (!config.enabled) {
		return '';
	}
	const enterprise = buildEnterpriseBlock(store.activePolicies, config);
	const individual = buildIndividualBlock(store.activeStandards, config);
	if (!enterprise && !individual) {
		return '';
	}

	return [enterprise, individual]
		.filter(Boolean)
		.join('\n\n');
}
