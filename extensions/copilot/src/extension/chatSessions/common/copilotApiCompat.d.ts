/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module '@vscode/copilot-api' {
	export interface AgentTaskCollaborator {
		readonly slug?: string;
	}

	export interface AgentTaskGitHubResourceData {
		readonly type: 'pull';
		readonly id: number;
		readonly global_id: string;
	}

	export interface AgentTaskBranchResourceData {
		readonly base_ref: string;
		readonly head_ref: string;
	}

	export interface AgentTaskArtifact {
		readonly provider?: string;
		readonly type?: string;
		readonly data?: AgentTaskGitHubResourceData | AgentTaskBranchResourceData | unknown;
	}

	export interface AgentTaskSession {
		readonly state: AgentTaskState;
		readonly prompt?: string;
		readonly events?: readonly AgentTaskSessionEvent[];
	}

	export type AgentTaskState = 'queued' | 'in_progress' | 'idle' | 'waiting_for_user' | 'completed' | 'failed' | 'timed_out' | 'cancelled' | (string & {});

	export interface AgentTaskSessionEvent {
		readonly type: string;
		readonly data: any;
		readonly dismissed?: boolean;
		readonly created_at?: string;
		readonly id: string;
	}

	export interface AgentTask {
		readonly id: string;
		readonly state: AgentTaskState;
		readonly created_at: string;
		readonly updated_at?: string;
		readonly html_url?: string;
		readonly name?: string;
		readonly prompt?: string;
		readonly problem_statement?: string;
		readonly creator?: { readonly id: number };
		readonly owner?: { readonly id: number };
		readonly repository?: { readonly id: number };
		readonly sessions?: readonly AgentTaskSession[];
		readonly artifacts?: readonly AgentTaskArtifact[];
		readonly archived_at?: string | null;
		readonly agent_collaborators?: readonly AgentTaskCollaborator[];
	}

	export interface AgentTaskCreateRequest {
		readonly prompt: string;
		readonly event_content: string;
		readonly problem_statement: string;
		readonly base_ref?: string;
		readonly create_pull_request?: boolean;
		readonly event_type: string;
		readonly head_ref?: string;
		readonly custom_agent?: string;
		readonly model?: string;
		readonly agent_id?: number;
	}

	export interface AgentTaskGetResponse extends AgentTask { }

	export interface AgentTaskListResponse {
		readonly tasks: readonly AgentTask[];
	}

	export interface AgentTaskListEventsResponse {
		readonly events: readonly AgentTaskSessionEvent[];
		readonly total?: number;
	}

	export interface AgentTaskSteerRequest {
		readonly content: string;
		readonly type: 'user_message' | string;
	}

	export interface AgentTaskCreatePullRequestResponse {
		readonly id: number;
		readonly number: number;
		readonly repository_id: number;
		readonly html_url?: string;
	}

	export interface FetchOptions {
		callSite?: string;
		headers?: { [name: string]: string };
		body?: BodyInit;
		timeout?: number;
		json?: any;
		method?: 'GET' | 'POST' | 'PUT';
		signal?: IAbortSignal;
		suppressIntegrationId?: boolean;
	}

	export interface MakeRequestOptions extends FetchOptions {
		callSite?: string;
	}

	export interface IAbortSignal {
		readonly aborted: boolean;
		addEventListener(type: 'abort', listener: (this: AbortSignal) => void): void;
		removeEventListener(type: 'abort', listener: (this: AbortSignal) => void): void;
	}

	export type RequestMetadata = {
		type: RequestType;
		[key: string]: unknown;
	};

	export enum RequestType {
		Telemetry = 'Telemetry',
		ChatCompletions = 'ChatCompletions',
		ChatResponses = 'ChatResponses',
		ChatMessages = 'ChatMessages',
		ProxyCompletions = 'ProxyCompletions',
		ProxyChatCompletions = 'ProxyChatCompletions',
		CopilotAgentJob = 'CopilotAgentJob',
		CopilotAgentJobEnabled = 'CopilotAgentJobEnabled',
		CopilotToken = 'CopilotToken',
		CopilotNLToken = 'CopilotNLToken',
		CopilotUserInfo = 'CopilotUserInfo',
		ListModel = 'ListModel',
		ModelPolicy = 'ModelPolicy',
		Models = 'Models',
		AutoModels = 'AutoModels',
		Chunks = 'Chunks',
		EmbeddingsModels = 'EmbeddingsModels',
		EmbeddingsCodeSearch = 'EmbeddingsCodeSearch',
		CAPIEmbeddings = 'CAPIEmbeddings',
		DotcomEmbeddings = 'DotcomEmbeddings',
		EmbeddingsIndex = 'EmbeddingsIndex',
		ContentExclusion = 'ContentExclusion',
		SearchSkill = 'SearchSkill',
		CodeReviewAgent = 'CodeReviewAgent',
		CopilotSessions = 'CopilotSessions',
		CopilotSessionLogs = 'CopilotSessionLogs',
		CopilotSessionDetails = 'CopilotSessionDetails',
		CopilotCustomAgents = 'CopilotCustomAgents',
		CopilotCustomAgentsDetail = 'CopilotCustomAgentsDetail',
		OrgCustomInstructions = 'OrgCustomInstructions',
		CopilotAgentMemory = 'CopilotAgentMemory',
		ModelRouter = 'ModelRouter',
		RemoteAgent = 'RemoteAgent',
		RemoteAgentChat = 'RemoteAgentChat',
		ListSkills = 'ListSkills',
		CCAModelsList = 'CCAModelsList',
		ChatAttachmentUpload = 'ChatAttachmentUpload',
		SnippyMatch = 'SnippyMatch',
		SnippyFilesForMatch = 'SnippyFilesForMatch',
		AgentTask = 'AgentTask',
	}

	export abstract class CAPIClient {
		readonly proxyBaseURL: string;
		readonly dotcomAPIURL: string;
		readonly capiPingURL: string;
		readonly copilotTelemetryURL: string;
		readonly originTrackerURL: string;
		readonly snippyMatchPath: string;
		readonly snippyFilesForMatchPath: string;
		protected constructor(
			information: { machineId: string; deviceId: string; sessionId: string; vscodeVersion: string; buildType: 'dev' | 'prod'; name: string; version: string },
			licenseAgreement: string,
			fetcherService: unknown,
			hmac?: string,
			integrationId?: string,
		);
		makeRequest<T>(request: MakeRequestOptions, requestMetadata: RequestMetadata): Promise<T>;
		createResponsesWebSocket(url: any, options?: any): any;
		updateDomains(domains: unknown, enterpriseValue?: string): IDomainChangeResponse;
	}

	export interface IDomainChangeResponse {
		readonly capiUrlChanged: boolean;
		readonly telemetryUrlChanged: boolean;
		readonly dotcomUrlChanged: boolean;
		readonly proxyUrlChanged: boolean;
	}

	export interface CCAModelBilling {
		readonly is_premium: boolean;
		readonly multiplier: number;
		readonly restricted_to: string[];
		readonly token_prices?: Record<string, { readonly context_max?: number; readonly [key: string]: unknown }>;
	}

	export interface CCAModelLimits {
		readonly max_context_window_tokens?: number;
		readonly max_output_tokens?: number;
		readonly max_prompt_tokens?: number;
	}

	export interface CCAModelSupports {
		readonly parallel_tool_calls?: boolean;
		readonly streaming?: boolean;
		readonly tool_calls?: boolean;
		readonly vision?: boolean;
	}

	export interface CCAModelCapabilities {
		readonly family?: string;
		readonly limits?: CCAModelLimits;
		readonly supports?: CCAModelSupports;
	}

	export interface CCAModel {
		readonly billing: CCAModelBilling;
		readonly capabilities: CCAModelCapabilities;
		readonly id: string;
		readonly is_chat_default: boolean;
		readonly is_chat_fallback: boolean;
		readonly model_picker_category: string;
		readonly model_picker_enabled: boolean;
		readonly model_picker_price_category?: string;
		readonly name: string;
		readonly object: string;
		readonly policy: unknown;
		readonly preview: boolean;
		readonly supported_endpoints: string[];
		readonly vendor: string;
		readonly version: string;
	}

	export interface CopilotToken {
		readonly endpoints: {
			readonly api?: string;
			readonly telemetry?: string;
			readonly proxy?: string;
			readonly 'origin-tracker'?: string;
		};
		readonly sku: string;
	}

	export interface RemoteAgentJobPayload {
		readonly problem_statement: string;
		readonly event_type: string;
		readonly event_content: string;
		readonly pull_request?: {
			readonly title?: string;
			readonly body_placeholder?: string;
			readonly body_suffix?: string;
			readonly base_ref?: string;
			readonly head_ref?: string;
		};
		readonly run_name?: string;
		readonly custom_agent?: string;
		readonly agent_id?: number;
		readonly model?: string;
	}
}
