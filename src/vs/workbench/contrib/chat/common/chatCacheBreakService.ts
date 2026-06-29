/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

/**
 * Cache-relevant configuration of a chat request. The prompt cache is keyed on
 * the request prefix, so a change in any of these fields between turns of the
 * same session invalidates the cache the previous turn warmed up — costing more
 * and running slower.
 */
export interface IChatCacheBreakConfig {
	/** Selected model identifier (the user's selection, e.g. `auto`, not the resolved model). */
	readonly model?: string;
	/** Reasoning/thinking effort level, when the model exposes one. */
	readonly reasoningEffort?: string;
	/** Selected context-size tier in tokens, when the model exposes one. */
	readonly contextSize?: number;
	/** Identity of the active mode / custom agent. */
	readonly mode?: string;
	/** Stable key of the enabled tool set. */
	readonly tools?: string;
}

/**
 * The dimension(s) a {@link IChatCacheBreakService.wouldBreakCache} query
 * compares. Each maps to the picker / surface the change is made from.
 */
export const enum ChatCacheBreakDimension {
	/** The selected model. */
	Model = 'model',
	/** Reasoning effort and context size (the model-options picker). */
	Options = 'options',
	/** The active mode / custom agent. */
	Mode = 'mode',
	/** The enabled tool set. */
	Tools = 'tools',
	/** Any cache-relevant dimension. */
	Any = 'any',
}

export const IChatCacheBreakService = createDecorator<IChatCacheBreakService>('chatCacheBreakService');

/**
 * Tracks, per chat session, the cache-relevant config of the most recent
 * request, so any surface can ask whether adopting a different config would
 * break the prompt cache the session warmed up. Reusable across the model
 * picker, agent-host sessions, and other cache-break affordances; the config is
 * recorded at the shared request send path so it covers every chat session type.
 */
export interface IChatCacheBreakService {
	readonly _serviceBrand: undefined;

	/**
	 * Records the cache-relevant config a session's request used. Called from the
	 * request send path; the most recent record is what later queries compare
	 * against.
	 */
	recordRequest(sessionResource: URI, config: IChatCacheBreakConfig): void;

	/**
	 * Forgets a session's recorded config (e.g. when the session is cleared or
	 * disposed) so a later session reusing the resource cannot falsely warn.
	 */
	clearSession(sessionResource: URI): void;

	/**
	 * Whether adopting `candidate` for the session would break the prompt cache —
	 * i.e. it differs from the session's last recorded request in `dimension`.
	 * Returns `false` when the session has no recorded request yet (no warm cache
	 * to lose). Only the fields relevant to `dimension` are compared, so callers
	 * can pass a candidate scoped to that dimension.
	 */
	wouldBreakCache(sessionResource: URI, candidate: IChatCacheBreakConfig, dimension: ChatCacheBreakDimension): boolean;
}

/**
 * Builds a stable key for the enabled tool set (sorted enabled tool names) so it
 * can be compared across turns. Exported so recorders and queriers serialize
 * tools the same way.
 */
export function toCacheBreakToolsKey(tools: Readonly<Record<string, boolean>> | undefined): string | undefined {
	if (!tools) {
		return undefined;
	}
	const enabled = Object.keys(tools).filter(name => tools[name]).sort();
	return enabled.join(',');
}

export class ChatCacheBreakService implements IChatCacheBreakService {
	declare readonly _serviceBrand: undefined;

	private readonly _lastBySession = new Map<string, IChatCacheBreakConfig>();

	recordRequest(sessionResource: URI, config: IChatCacheBreakConfig): void {
		this._lastBySession.set(sessionResource.toString(), config);
	}

	clearSession(sessionResource: URI): void {
		this._lastBySession.delete(sessionResource.toString());
	}

	wouldBreakCache(sessionResource: URI, candidate: IChatCacheBreakConfig, dimension: ChatCacheBreakDimension): boolean {
		const last = this._lastBySession.get(sessionResource.toString());
		if (!last) {
			// No recorded request yet — there is no warm cache to lose.
			return false;
		}

		switch (dimension) {
			case ChatCacheBreakDimension.Model:
				return candidate.model !== last.model;
			case ChatCacheBreakDimension.Options:
				return candidate.reasoningEffort !== last.reasoningEffort || candidate.contextSize !== last.contextSize;
			case ChatCacheBreakDimension.Mode:
				return candidate.mode !== last.mode;
			case ChatCacheBreakDimension.Tools:
				return candidate.tools !== last.tools;
			case ChatCacheBreakDimension.Any:
				return candidate.model !== last.model
					|| candidate.reasoningEffort !== last.reasoningEffort
					|| candidate.contextSize !== last.contextSize
					|| candidate.mode !== last.mode
					|| candidate.tools !== last.tools;
		}
	}
}

registerSingleton(IChatCacheBreakService, ChatCacheBreakService, InstantiationType.Delayed);
