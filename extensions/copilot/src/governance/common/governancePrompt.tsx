/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BasePromptElementProps, PromptElement, PromptElementProps, PromptSizing, SystemMessage } from '@vscode/prompt-tsx';
import { IConfigurationService } from '../../platform/configuration/common/configurationService';
import { readGovernanceConfig } from './governanceConfig';
import { PolicyStore } from './policyStore';
import { buildGovernanceBlock } from './promptInjector';

/**
 * A prompt element that injects the governance context block into the agent system prompt.
 *
 * - Enterprise mode: emits a `<governance>` XML block listing all active org/project policies.
 * - Individual mode: emits a `<standards>` XML block listing accepted inferred standards.
 * - Returns null (no-op) when governance is disabled or the store is empty.
 *
 * Rendered at priority 700 — on par with conversation history — so governance instructions
 * are always present in the context window unless the session is extremely long.
 */
export class GovernanceSystemPrompt extends PromptElement<BasePromptElementProps> {
	constructor(
		props: PromptElementProps<BasePromptElementProps>,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
	) {
		super(props);
	}

	render(_state: void, _sizing: PromptSizing) {
		const config = readGovernanceConfig(this._configurationService);
		if (!config.enabled) {
			return null;
		}

		const block = buildGovernanceBlock(PolicyStore.getInstance(), config);
		if (!block) {
			return null;
		}

		return <SystemMessage priority={700}>{block}</SystemMessage>;
	}
}
