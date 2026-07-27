/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ConfigKey, IConfigurationService } from '../../platform/configuration/common/configurationService';
import { GovernanceConfig, GuardrailMode } from './types';

/**
 * Reads the full {@link GovernanceConfig} from settings. Shared by the prompt injector
 * and the deterministic enforcement gate so both observe the same configuration.
 */
export function readGovernanceConfig(configurationService: IConfigurationService): GovernanceConfig {
	return {
		enabled: configurationService.getConfig(ConfigKey.Governance.Enabled),
		mode: configurationService.getConfig(ConfigKey.Governance.Mode) as GuardrailMode,
		policyUrl: configurationService.getConfig(ConfigKey.Governance.PolicyUrl),
		autoFixSafeIssues: configurationService.getConfig(ConfigKey.Governance.AutoFixSafeIssues),
		showDiffSummaryAfterEdits: configurationService.getConfig(ConfigKey.Governance.ShowDiffSummaryAfterEdits),
		includeRationaleInResponses: configurationService.getConfig(ConfigKey.Governance.IncludeRationaleInResponses),
		rateLimits: {
			enabled: configurationService.getConfig(ConfigKey.Governance.RateLimitsEnabled),
			maxFilesPerTask: configurationService.getConfig(ConfigKey.Governance.RateLimitsMaxFilesPerTask),
			maxToolCallsPerRun: configurationService.getConfig(ConfigKey.Governance.RateLimitsMaxToolCallsPerRun),
		},
	};
}
