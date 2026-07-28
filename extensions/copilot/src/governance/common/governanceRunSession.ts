/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GovernanceDecision } from './types';

/**
 * Accumulates per-run governance state: tool call count, unique edited files,
 * and enforcement decisions. Created fresh for each agent request.
 */
export class GovernanceRunSession {
	private _toolCallCount = 0;
	private _editedFiles = new Set<string>();
	private _decisions: GovernanceDecision[] = [];
	private _flags = new Set<string>();

	recordToolCall(): void {
		this._toolCallCount++;
	}

	recordFileEdit(path: string): void {
		this._editedFiles.add(path);
	}

	recordDecision(decision: GovernanceDecision): void {
		this._decisions.push(decision);
	}

	/** Raises a contextual flag that later rules can condition on via `when`. */
	setFlag(flag: string): void {
		this._flags.add(flag);
	}

	hasFlag(flag: string): boolean {
		return this._flags.has(flag);
	}

	get toolCallCount(): number { return this._toolCallCount; }
	get editedFileCount(): number { return this._editedFiles.size; }
	get decisions(): readonly GovernanceDecision[] { return this._decisions; }
	get flags(): ReadonlySet<string> { return this._flags; }

	hasActivity(): boolean {
		return this._decisions.length > 0 || this._flags.size > 0;
	}
}
