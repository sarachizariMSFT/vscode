/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ActivePolicy, Standard } from './types';
import { PolicyStore } from './policyStore';

const ICON_ENFORCED = '✓';
const ICON_REDIRECTED = '→';
const ICON_WARN = '⚠';
const ICON_ENTERPRISE = '🛡';
const ICON_INDIVIDUAL = '◉';

function policyIcon(status: ActivePolicy['status']): string {
	switch (status) {
		case 'redirected': return ICON_REDIRECTED;
		case 'warn': return ICON_WARN;
		default: return ICON_ENFORCED;
	}
}

/**
 * Builds a markdown summary block for governance state to append after an agent response.
 * Format (plain markdown — isTrusted boolean is not supported in chat participants):
 *   ---
 *   🛡 **Guardrails applied** — N redirected, N enforced
 *   | | Policy | Scope |
 *   ...
 *   ◉ **Kept your N coding standards**
 *   | | Standard |
 *   ...
 */
function buildEnterpriseSummary(policies: readonly ActivePolicy[]): string {
	if (policies.length === 0) {
		return '';
	}

	const redirected = policies.filter(p => p.status === 'redirected').length;
	const enforced = policies.filter(p => p.status !== 'redirected' && p.status !== 'warn').length;

	const tagParts: string[] = [];
	if (redirected > 0) {
		tagParts.push(`${redirected} redirected`);
	}
	if (enforced > 0) {
		tagParts.push(`${enforced} enforced`);
	}

	const rows = policies.map(p => {
		const icon = policyIcon(p.status);
		const scope = p.scope === 'org' ? `org · ${p.id}` : p.scope;
		return `| ${icon} | ${p.label} | ${scope} |`;
	}).join('\n');

	const header = `${ICON_ENTERPRISE} **Guardrails applied**${tagParts.length ? ' — ' + tagParts.join(', ') : ''}`;

	return [
		'\n---',
		header,
		'',
		'| | Policy | Scope |',
		'|---|---|---|',
		rows,
	].join('\n');
}

/**
 * Builds a markdown summary block for individual coding standards to append after an agent response.
 * Format (plain markdown):
 *   ---
 *   ◉ **Kept your N coding standards**
 *   | | Standard |
 *   ...
 */
function buildIndividualSummary(standards: readonly Standard[]): string {
	const enabled = standards.filter(s => s.enabled);
	if (enabled.length === 0) {
		return '';
	}

	const rows = enabled.map(s => `| ${ICON_ENFORCED} | ${s.label} |`).join('\n');

	const header = `${ICON_INDIVIDUAL} **Kept your ${enabled.length} coding standard${enabled.length !== 1 ? 's' : ''}**`;

	return [
		'\n---',
		header,
		'',
		'| | Standard |',
		'|---|---|',
		rows,
	].join('\n');
}

/**
 * Returns the post-response governance summary as a plain markdown string, or undefined
 * when governance is inactive or has nothing to report.
 */
export function buildGovernanceSummaryMarkdown(store: PolicyStore): string | undefined {
	const blocks: string[] = [];

	const enterprise = buildEnterpriseSummary(store.activePolicies);
	if (enterprise) {
		blocks.push(enterprise);
	}

	const individual = buildIndividualSummary(store.activeStandards);
	if (individual) {
		blocks.push(individual);
	}

	return blocks.length > 0 ? blocks.join('\n') : undefined;
}
