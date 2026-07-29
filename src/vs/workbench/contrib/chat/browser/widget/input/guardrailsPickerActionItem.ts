/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from '../../../../../../base/browser/dom.js';
import { CONTEXT_VIEW_MENU_MOTION_CLOSE_ANIMATION_DURATION } from '../../../../../../base/browser/ui/contextview/contextview.js';
import { renderLabelWithIcons } from '../../../../../../base/browser/ui/iconLabel/iconLabels.js';
import { VSBuffer } from '../../../../../../base/common/buffer.js';
import { Codicon } from '../../../../../../base/common/codicons.js';
import { Emitter, Event } from '../../../../../../base/common/event.js';
import { IDisposable, MutableDisposable, toDisposable } from '../../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../../base/common/themables.js';
import { URI } from '../../../../../../base/common/uri.js';
import { localize } from '../../../../../../nls.js';
import { MenuItemAction } from '../../../../../../platform/actions/common/actions.js';
import { IActionWidgetService } from '../../../../../../platform/actionWidget/browser/actionWidget.js';
import { IActionWidgetDropdownAction, IActionWidgetDropdownActionProvider } from '../../../../../../platform/actionWidget/browser/actionWidgetDropdown.js';
import { ConfigurationTarget, IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../../platform/contextkey/common/contextkey.js';
import { FileChangesEvent, IFileService } from '../../../../../../platform/files/common/files.js';
import { IHoverService } from '../../../../../../platform/hover/browser/hover.js';
import { IKeybindingService } from '../../../../../../platform/keybinding/common/keybinding.js';
import { ITelemetryService } from '../../../../../../platform/telemetry/common/telemetry.js';
import { IWorkspaceContextService, WorkbenchState } from '../../../../../../platform/workspace/common/workspace.js';
import { ChatInputPickerActionViewItem, IChatInputPickerOptions } from './chatInputPickerActionItem.js';
import './guardrailsPickerActionItem.css';

/** Governance mode setting: whether policy violations are blocked (enforce) or only warned (warn). */
const GOVERNANCE_MODE_KEY = 'github.copilot.governance.mode';
/** Setting holding the ids of policies the developer has turned off from the inline picker. */
const GOVERNANCE_DISABLED_POLICIES_KEY = 'github.copilot.governance.disabledPolicies';
/** Workspace-relative path to the policy manifest read by the governance engine. */
const POLICY_FILE_RELATIVE_PATH = ['.github', 'copilot-policies.json'];

type GovernanceMode = 'enforce' | 'warn';

interface IGuardrailPolicy {
	readonly id: string;
	readonly label: string;
	readonly enforcement?: string;
}

interface IGovernanceModeMeta {
	readonly id: GovernanceMode;
	readonly label: string;
	readonly detail: string;
	readonly icon: ThemeIcon;
}

const MODE_META: readonly IGovernanceModeMeta[] = [
	{
		id: 'enforce',
		label: localize('guardrails.mode.enforce', "Enforce"),
		detail: localize('guardrails.mode.enforce.detail', "Block actions that violate a policy"),
		icon: ThemeIcon.fromId(Codicon.law.id),
	},
	{
		id: 'warn',
		label: localize('guardrails.mode.warn', "Warn only"),
		detail: localize('guardrails.mode.warn.detail', "Allow actions but surface a warning"),
		icon: ThemeIcon.fromId(Codicon.warning.id),
	},
];

/** A policy definition the chip can write into a fresh manifest when recommended. */
interface IManifestPolicy {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly enforcement?: string;
	readonly category?: string;
	readonly rules?: readonly unknown[];
}

/** A recommended policy paired with the human-readable reason it surfaced. */
interface IRecommendedPolicy {
	readonly policy: IManifestPolicy;
	/** Short, human-readable reason this policy was recommended (shown as the row detail). */
	readonly evidence: string;
}

/**
 * The catalog of best-practice policies the chip can recommend. Keyed by id so both
 * the workspace scan and the prompt-learning path reference the same definitions.
 * Nothing here is applied automatically — a policy only takes effect once the
 * developer accepts it (which writes it into `.github/copilot-policies.json`).
 */
const POLICY_LIBRARY: Readonly<Record<string, IManifestPolicy>> = {
	'SEC-TERM-1': {
		id: 'SEC-TERM-1',
		label: localize('guardrails.rec.term.label', "No destructive Git or shell commands"),
		description: localize('guardrails.rec.term.desc', "Blocks force pushes, hard resets, and recursive deletes."),
		enforcement: 'enforce',
		category: 'security',
		rules: [{ target: 'terminal', match: { commandPattern: 'git\\s+push\\b.*(--force\\b|-f\\b)|git\\s+reset\\s+--hard|\\brm\\s+-rf\\b|git\\s+clean\\s+-[a-z]*f' }, action: 'deny' }],
	},
	'EXT-1': {
		id: 'EXT-1',
		label: localize('guardrails.rec.ext.label', "No installing VS Code extensions"),
		description: localize('guardrails.rec.ext.desc', "Prevents the agent from installing extensions without review."),
		enforcement: 'enforce',
		category: 'supply-chain',
		rules: [{ target: 'tool', match: { toolName: 'install_extension' }, action: 'deny' }],
	},
	'SEC-SECRET-WRITE-1': {
		id: 'SEC-SECRET-WRITE-1',
		label: localize('guardrails.rec.secret.label', "No hardcoded secrets in code"),
		description: localize('guardrails.rec.secret.desc', "Blocks writing API keys, tokens, or private keys into source files."),
		enforcement: 'enforce',
		category: 'security',
		rules: [{ target: 'file', match: { contentPattern: 'AKIA[0-9A-Z]{16}|-----BEGIN\\s+(RSA|OPENSSH|EC|PGP)?\\s*PRIVATE KEY-----|(password|passwd|secret|api[_-]?key|token)\\s*[:=]\\s*[\'\"][^\'\"]{6,}[\'\"]' }, action: 'deny' }],
	},
	'SEC-INPUT-1': {
		id: 'SEC-INPUT-1',
		label: localize('guardrails.rec.input.label', "Validate all external inputs"),
		description: localize('guardrails.rec.input.desc', "Advisory guidance to validate request, form, and API inputs."),
		enforcement: 'warn',
		category: 'security',
	},
	'DEP-1': {
		id: 'DEP-1',
		label: localize('guardrails.rec.dep.label', "Approval required for new dependencies"),
		description: localize('guardrails.rec.dep.desc', "Warns before installing new npm, pnpm, or yarn packages."),
		enforcement: 'warn',
		category: 'dependencies',
		rules: [{ target: 'terminal', match: { commandPattern: '\\b(npm|pnpm|yarn)\\s+(install|i|add)\\s+\\S' }, action: 'warn' }],
	},
	'STYLE-1': {
		id: 'STYLE-1',
		label: localize('guardrails.rec.style.label', "Prefer async/await over raw promises"),
		description: localize('guardrails.rec.style.desc', "Advisory guidance surfaced to Copilot while editing TypeScript."),
		enforcement: 'warn',
		category: 'style',
	},
	'STYLE-PY-1': {
		id: 'STYLE-PY-1',
		label: localize('guardrails.rec.pytype.label', "Add type hints to all functions"),
		description: localize('guardrails.rec.pytype.desc', "Advisory guidance to annotate Python functions with type hints."),
		enforcement: 'warn',
		category: 'style',
	},
	'QA-1': {
		id: 'QA-1',
		label: localize('guardrails.rec.qa.label', "Tests required for auth or payment changes"),
		description: localize('guardrails.rec.qa.desc', "Advisory guidance to add tests when touching auth or payment code."),
		enforcement: 'enforce',
		category: 'quality',
	},
	'OPS-TAG-1': {
		id: 'OPS-TAG-1',
		label: localize('guardrails.rec.tag.label', "Tag all cloud resources"),
		description: localize('guardrails.rec.tag.desc', "Advisory guidance to tag provisioned cloud infrastructure."),
		enforcement: 'warn',
		category: 'operations',
	},
	'ARCH-1': {
		id: 'ARCH-1',
		label: localize('guardrails.rec.arch.label', "Separate concerns into layers"),
		description: localize('guardrails.rec.arch.desc', "Advisory guidance to keep services within their architectural layer."),
		enforcement: 'warn',
		category: 'architecture',
	},
};

/** A signal derived from the names of the workspace-root entries (never file contents). */
interface IFileSignal {
	readonly policyId: string;
	readonly evidence: string;
	readonly detect: (names: ReadonlySet<string>) => boolean;
}

/** Workspace-root entry names that indicate an existing test setup. */
const TEST_SIGNAL_NAMES = ['test', 'tests', '__tests__', 'spec', 'e2e', 'jest.config.js', 'jest.config.ts', 'vitest.config.ts', 'vitest.config.js'];

/**
 * File-based signals. The scan reads only the names of the workspace-root entries
 * — never any file contents — so nothing about the codebase leaves the machine.
 */
const FILE_SIGNALS: readonly IFileSignal[] = [
	{ policyId: 'SEC-TERM-1', evidence: localize('guardrails.rec.evidence.baseline', "Baseline safety — recommended for every repo"), detect: () => true },
	{ policyId: 'EXT-1', evidence: localize('guardrails.rec.evidence.baseline', "Baseline safety — recommended for every repo"), detect: () => true },
	{ policyId: 'SEC-SECRET-WRITE-1', evidence: localize('guardrails.rec.evidence.env', "Detected .env — guard against leaked secrets"), detect: names => names.has('.env') || names.has('.env.example') || names.has('.env.local') },
	{ policyId: 'DEP-1', evidence: localize('guardrails.rec.evidence.pkg', "Detected package.json — guard dependency changes"), detect: names => names.has('package.json') },
	{ policyId: 'STYLE-1', evidence: localize('guardrails.rec.evidence.ts', "Detected TypeScript — keep async style consistent"), detect: names => names.has('tsconfig.json') },
	{ policyId: 'QA-1', evidence: localize('guardrails.rec.evidence.tests', "Detected test setup — require tests for sensitive changes"), detect: names => TEST_SIGNAL_NAMES.some(name => names.has(name)) },
];

/** Policies always recommended for a fresh/greenfield project with no signals to scan. */
const GREENFIELD_POLICY_IDS = ['SEC-TERM-1', 'EXT-1', 'SEC-SECRET-WRITE-1', 'QA-1'];

/** A signal derived from the developer's chat prompt (keyword matching, purely local). */
interface IPromptSignal {
	readonly pattern: RegExp;
	readonly policyId: string;
	readonly evidence: string;
}

/**
 * Prompt-based signals. As the developer describes what they are building, matching
 * guardrails are surfaced in the Recommended section. Mirrors the keyword mapping the
 * Copilot extension's InferenceEngine uses, kept here because core cannot import it.
 */
const PROMPT_SIGNALS: readonly IPromptSignal[] = [
	{ pattern: /rest|api|graphql|endpoint|auth|oauth|jwt|login|sign[\s-]?up|register/, policyId: 'SEC-SECRET-WRITE-1', evidence: localize('guardrails.rec.evidence.prompt.api', "You described API or auth work") },
	{ pattern: /rest|api|graphql|endpoint|auth|oauth|jwt|login|sign[\s-]?up|register/, policyId: 'SEC-INPUT-1', evidence: localize('guardrails.rec.evidence.prompt.api', "You described API or auth work") },
	{ pattern: /\btest(s|ing)?\b|spec|tdd|bdd|coverage/, policyId: 'QA-1', evidence: localize('guardrails.rec.evidence.prompt.test', "You mentioned testing") },
	{ pattern: /typescript|\bts\b|react|next\.?js|vue|angular|\bnode(\.js)?\b|express/, policyId: 'STYLE-1', evidence: localize('guardrails.rec.evidence.prompt.ts', "You described a TypeScript or Node project") },
	{ pattern: /typescript|\bts\b|react|next\.?js|vue|angular|\bnode(\.js)?\b|express/, policyId: 'DEP-1', evidence: localize('guardrails.rec.evidence.prompt.js', "You described a JavaScript or TypeScript project") },
	{ pattern: /python|django|fastapi|flask|pytest/, policyId: 'STYLE-PY-1', evidence: localize('guardrails.rec.evidence.prompt.py', "You described a Python project") },
	{ pattern: /python|django|fastapi|flask|pytest/, policyId: 'QA-1', evidence: localize('guardrails.rec.evidence.prompt.py', "You described a Python project") },
	{ pattern: /terraform|aws|azure|\bgcp\b|infra|cloud|\bk8s\b|kubernetes/, policyId: 'SEC-SECRET-WRITE-1', evidence: localize('guardrails.rec.evidence.prompt.infra', "You described infrastructure or cloud work") },
	{ pattern: /terraform|aws|azure|\bgcp\b|infra|cloud|\bk8s\b|kubernetes/, policyId: 'OPS-TAG-1', evidence: localize('guardrails.rec.evidence.prompt.cloud', "You described cloud work") },
	{ pattern: /microservice|domain.driven|\bddd\b|clean arch|layer/, policyId: 'ARCH-1', evidence: localize('guardrails.rec.evidence.prompt.arch', "You described a layered architecture") },
];

/**
 * A chat-input chip that surfaces Copilot governance ("Guardrails") controls
 * inline, next to the permission picker. It lets a developer switch the
 * governance mode and enable/disable individual policies right where they work
 * instead of hunting through the command palette. State is bridged to the
 * Copilot extension purely through configuration:
 * `github.copilot.governance.mode` and `github.copilot.governance.disabledPolicies`.
 */
export class GuardrailsPickerActionItem extends ChatInputPickerActionViewItem {

	private readonly _onDidDispose = this._register(new Emitter<void>());
	readonly onDidDispose: Event<void> = this._onDidDispose.event;

	private _policies: IGuardrailPolicy[] = [];
	/** Recommendations derived from the workspace scan (file/dir names only). */
	private _fileRecommendations: IRecommendedPolicy[] = [];
	/** Recommendations accumulated from the developer's chat prompts, deduped by policy id. */
	private _promptRecommendations: IRecommendedPolicy[] = [];
	/** Whether new recommendations have arrived that the developer has not yet seen. */
	private _hasUnseenRecommendations = false;
	/**
	 * Ids of prompt-inferred recommendations that arrived recently and have not yet been added
	 * to the manifest. These stay marked with a dot inside the menu (even after the chip's dot
	 * clears on open) so the developer can tell which items are the newly recommended ones.
	 */
	private readonly _newRecommendationIds = new Set<string>();
	private readonly _fileWatcher = this._register(new MutableDisposable<IDisposable>());
	private readonly _reopenHandle = this._register(new MutableDisposable<IDisposable>());
	private _currentTooltip: string = '';
	private _hoverElement: HTMLElement | undefined;
	private readonly _hover = this._register(new MutableDisposable<IDisposable>());

	constructor(
		action: MenuItemAction,
		pickerOptions: IChatInputPickerOptions,
		@IActionWidgetService actionWidgetService: IActionWidgetService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@IHoverService private readonly hoverService: IHoverService,
	) {
		const actionProvider: IActionWidgetDropdownActionProvider = {
			getActions: () => this._buildActions(),
		};

		super(action, {
			actionProvider,
			reporter: { id: 'ChatGuardrailsPicker', name: 'ChatGuardrailsPicker', includeOptions: true },
			listOptions: { minWidth: 300, detailItemHeight: 44, inlineToggleItemHeight: 30, ...pickerOptions.listOptions },
		}, pickerOptions, actionWidgetService, keybindingService, contextKeyService, telemetryService);

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if ((e.affectsConfiguration(GOVERNANCE_MODE_KEY) || e.affectsConfiguration(GOVERNANCE_DISABLED_POLICIES_KEY)) && this.element) {
				this.renderLabel(this.element);
			}
		}));

		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this._reloadPolicies()));
		this._register(this.fileService.onDidFilesChange((e: FileChangesEvent) => {
			const uri = this._getPolicyFileUri();
			if (uri && e.contains(uri)) {
				this._reloadPolicies();
			}
		}));

		this._reloadPolicies();
	}

	private _getPolicyFileUri(): URI | undefined {
		const folder = this.workspaceContextService.getWorkspace().folders.at(0);
		return folder ? URI.joinPath(folder.uri, ...POLICY_FILE_RELATIVE_PATH) : undefined;
	}

	private async _reloadPolicies(): Promise<void> {
		const uri = this._getPolicyFileUri();
		this._fileWatcher.value = uri ? this.fileService.watch(uri) : undefined;
		this._policies = uri ? await this._readPolicies(uri) : [];
		await this._scanRecommendations();
		if (this.element) {
			this.renderLabel(this.element);
		}
	}

	private async _readPolicies(uri: URI): Promise<IGuardrailPolicy[]> {
		try {
			const content = await this.fileService.readFile(uri);
			const parsed = JSON.parse(content.value.toString()) as { policies?: unknown };
			if (!Array.isArray(parsed.policies)) {
				return [];
			}
			return parsed.policies
				.filter((p): p is { id: string; label?: string; enforcement?: string } => !!p && typeof (p as { id?: unknown }).id === 'string')
				.map(p => ({ id: p.id, label: p.label ?? p.id, enforcement: p.enforcement }));
		} catch {
			// Missing or malformed manifest simply means no policies to surface.
			return [];
		}
	}

	private _getMode(): GovernanceMode {
		return this.configurationService.getValue<string>(GOVERNANCE_MODE_KEY) === 'warn' ? 'warn' : 'enforce';
	}

	private _getDisabledPolicies(): string[] {
		const value = this.configurationService.getValue<string[]>(GOVERNANCE_DISABLED_POLICIES_KEY);
		return Array.isArray(value) ? value : [];
	}

	/**
	 * Chooses the configuration target for governance writes. Prefers workspace scope so the
	 * selection travels with the project, but falls back to user scope in an empty workbench
	 * (e.g. the agents window with no folder open) where a workspace write would be silently
	 * dropped — which previously made a mode switch appear to do nothing.
	 */
	private _writeTarget(): ConfigurationTarget {
		return this.workspaceContextService.getWorkbenchState() === WorkbenchState.EMPTY
			? ConfigurationTarget.USER
			: ConfigurationTarget.WORKSPACE;
	}

	private async _setMode(mode: GovernanceMode): Promise<void> {
		if (this._getMode() !== mode) {
			await this.configurationService.updateValue(GOVERNANCE_MODE_KEY, mode, this._writeTarget());
		}
	}

	private async _setPolicyEnabled(id: string, enabled: boolean): Promise<void> {
		const disabled = new Set(this._getDisabledPolicies());
		if (enabled) {
			disabled.delete(id);
		} else {
			disabled.add(id);
		}
		await this.configurationService.updateValue(GOVERNANCE_DISABLED_POLICIES_KEY, [...disabled], this._writeTarget());
	}

	/**
	 * Reads only the names of the workspace-root entries (never file contents) and derives
	 * a set of recommended policies from {@link FILE_SIGNALS}. When the workspace is empty or
	 * has no folder (a greenfield project), it seeds the {@link GREENFIELD_POLICY_IDS} baseline
	 * so there is always something to accept.
	 */
	private async _scanRecommendations(): Promise<void> {
		const folder = this.workspaceContextService.getWorkspace().folders.at(0);
		const names = new Set<string>();
		let hasFolder = false;
		if (folder) {
			try {
				const stat = await this.fileService.resolve(folder.uri);
				for (const child of stat.children ?? []) {
					names.add(child.name.toLowerCase());
				}
				hasFolder = true;
			} catch {
				hasFolder = false;
			}
		}

		const recommendations: IRecommendedPolicy[] = [];
		const seen = new Set<string>();
		for (const signal of FILE_SIGNALS) {
			if (signal.detect(names) && !seen.has(signal.policyId)) {
				const policy = POLICY_LIBRARY[signal.policyId];
				if (policy) {
					seen.add(signal.policyId);
					recommendations.push({ policy, evidence: signal.evidence });
				}
			}
		}

		// Greenfield: with no folder or an empty root there is nothing to scan, so seed the
		// baseline best-practice set instead of leaving the developer with no guardrails.
		if (!hasFolder || names.size === 0) {
			for (const id of GREENFIELD_POLICY_IDS) {
				if (!seen.has(id) && POLICY_LIBRARY[id]) {
					seen.add(id);
					recommendations.push({ policy: POLICY_LIBRARY[id], evidence: localize('guardrails.rec.evidence.greenfield', "Recommended best practice for a new project") });
				}
			}
		}

		this._fileRecommendations = recommendations;
	}

	/**
	 * Feeds a submitted chat prompt into the recommendation engine. Matching guardrails are
	 * added to the Recommended section and, when genuinely new, the chip shows an unread dot.
	 * Called by the chat input part whenever the developer submits a message.
	 */
	public learnFromPrompt(prompt: string): void {
		const text = prompt.toLowerCase();
		const known = new Set(this._promptRecommendations.map(rec => rec.policy.id));
		let added = false;
		for (const signal of PROMPT_SIGNALS) {
			if (signal.pattern.test(text) && !known.has(signal.policyId)) {
				const policy = POLICY_LIBRARY[signal.policyId];
				if (policy) {
					known.add(signal.policyId);
					this._promptRecommendations.push({ policy, evidence: signal.evidence });
					this._newRecommendationIds.add(signal.policyId);
					added = true;
				}
			}
		}

		if (!added) {
			return;
		}

		// Only flag as unseen if at least one recommendation is not already in the manifest.
		const manifestIds = new Set(this._policies.map(p => p.id));
		if (this._promptRecommendations.some(rec => !manifestIds.has(rec.policy.id))) {
			this._hasUnseenRecommendations = true;
			if (this.element) {
				this.renderLabel(this.element);
			}
		}
	}

	/** Merges the given recommended policies into the workspace manifest, creating it if needed. */
	private async _addRecommendations(recs: readonly IRecommendedPolicy[]): Promise<void> {
		const uri = this._getPolicyFileUri();
		if (!uri || recs.length === 0) {
			return;
		}
		let manifest: { source?: string; policies: IManifestPolicy[] } = { source: 'inferred', policies: [] };
		try {
			const content = await this.fileService.readFile(uri);
			const parsed = JSON.parse(content.value.toString()) as { source?: string; policies?: unknown };
			if (parsed && Array.isArray(parsed.policies)) {
				manifest = { source: parsed.source, policies: parsed.policies as IManifestPolicy[] };
			}
		} catch {
			// No existing manifest — start a fresh one.
		}
		const existingIds = new Set(manifest.policies.map(p => p.id));
		let changed = false;
		for (const rec of recs) {
			if (!existingIds.has(rec.policy.id)) {
				manifest.policies.push(rec.policy);
				existingIds.add(rec.policy.id);
				changed = true;
			}
		}
		if (changed) {
			await this.fileService.writeFile(uri, VSBuffer.fromString(JSON.stringify(manifest, null, '\t')));
		}
	}

	private _buildActions(): IActionWidgetDropdownAction[] {
		const currentMode = this._getMode();
		const modeCategory = { label: localize('guardrails.category.mode', "Mode"), order: 0, showHeader: true };
		const actions: IActionWidgetDropdownAction[] = MODE_META.map(meta => ({
			id: `chat.guardrails.mode.${meta.id}`,
			label: meta.label,
			detail: meta.detail,
			checked: currentMode === meta.id,
			enabled: true,
			category: modeCategory,
			class: undefined,
			tooltip: '',
			run: async () => {
				await this._setMode(meta.id);
				if (this.element) {
					this.renderLabel(this.element);
				}
				this._reopen();
			},
		}));

		const disabled = new Set(this._getDisabledPolicies());
		const policyCategory = { label: localize('guardrails.category.policies', "Policies"), order: 1, showHeader: true };
		for (const policy of this._policies) {
			const isEnabled = !disabled.has(policy.id);
			actions.push({
				id: `chat.guardrails.policy.${policy.id}`,
				label: policy.label,
				className: 'guardrail-policy-row',
				category: policyCategory,
				enabled: true,
				class: undefined,
				tooltip: policy.enforcement
					? localize('guardrails.policy.enforcement', "Enforcement: {0}", policy.enforcement)
					: '',
				inlineToggle: {
					label: localize('guardrails.policy.toggle', "Enabled"),
					checked: isEnabled,
					onChange: (checked: boolean) => {
						void this._setPolicyEnabled(policy.id, checked);
					},
				},
				run: async () => {
					await this._setPolicyEnabled(policy.id, !isEnabled);
					this._reopen();
				},
			});
		}

		// Split pending recommendations by source so they can be grouped in the UI, deduped
		// against the manifest and against each other (a workspace rec wins over a prompt rec).
		const existingIds = new Set(this._policies.map(p => p.id));
		const seenRecs = new Set<string>();
		const pendingFileRecs: IRecommendedPolicy[] = [];
		for (const rec of this._fileRecommendations) {
			if (!existingIds.has(rec.policy.id) && !seenRecs.has(rec.policy.id)) {
				seenRecs.add(rec.policy.id);
				pendingFileRecs.push(rec);
			}
		}
		const pendingPromptRecs: IRecommendedPolicy[] = [];
		for (const rec of this._promptRecommendations) {
			if (!existingIds.has(rec.policy.id) && !seenRecs.has(rec.policy.id)) {
				seenRecs.add(rec.policy.id);
				pendingPromptRecs.push(rec);
			}
		}
		const allPending = [...pendingFileRecs, ...pendingPromptRecs];

		// Opening the dropdown counts as seeing the recommendations — clear the unread dot.
		if (this._hasUnseenRecommendations) {
			this._hasUnseenRecommendations = false;
			queueMicrotask(() => this.refresh());
		}

		const recommendedCategory = { label: localize('guardrails.category.recommended', "Recommended"), order: 2, showHeader: true };

		if (allPending.length > 0) {
			// Bulk action, kept in its own category so a divider separates it from the items
			// it summarizes, with a count and a distinct icon so it doesn't read as one more policy.
			actions.push({
				id: 'chat.guardrails.recommend.all',
				label: localize('guardrails.recommend.all', "Add all {0} recommended", allPending.length),
				detail: localize('guardrails.recommend.all.detail', "Add {0} guardrail(s) to .github/copilot-policies.json", allPending.length),
				icon: ThemeIcon.fromId(Codicon.checkAll.id),
				category: recommendedCategory,
				enabled: true,
				class: undefined,
				tooltip: '',
				run: async () => {
					for (const rec of allPending) {
						this._newRecommendationIds.delete(rec.policy.id);
					}
					await this._addRecommendations(allPending);
					await this._reloadPolicies();
					this._reopen();
				},
			});

			const enforcementLabel = (policy: IManifestPolicy): string => policy.enforcement === 'enforce'
				? localize('guardrails.enforce', "Enforce")
				: localize('guardrails.warn', "Warn");
			const pushRec = (rec: IRecommendedPolicy, category: { label: string; order: number; showHeader?: boolean }): void => {
				const isNew = this._newRecommendationIds.has(rec.policy.id);
				actions.push({
					id: `chat.guardrails.recommend.${rec.policy.id}`,
					label: rec.policy.label,
					detail: localize('guardrails.recommend.detail', "{0} — {1}", enforcementLabel(rec.policy), rec.evidence),
					icon: ThemeIcon.fromId(Codicon.add.id),
					className: isNew ? 'guardrail-rec-new' : undefined,
					category,
					enabled: true,
					class: undefined,
					tooltip: isNew
						? localize('guardrails.recommend.new.tooltip', "Newly recommended from your prompt")
						: (rec.policy.description ?? ''),
					run: async () => {
						this._newRecommendationIds.delete(rec.policy.id);
						await this._addRecommendations([rec]);
						await this._reloadPolicies();
						this._reopen();
					},
				});
			};

			if (pendingFileRecs.length > 0) {
				const workspaceCategory = { label: localize('guardrails.category.fromWorkspace', "From this workspace"), order: 3, showHeader: true };
				for (const rec of pendingFileRecs) {
					pushRec(rec, workspaceCategory);
				}
			}

			if (pendingPromptRecs.length > 0) {
				const promptCategory = { label: localize('guardrails.category.fromPrompt', "From your prompt"), order: 4, showHeader: true };
				for (const rec of pendingPromptRecs) {
					pushRec(rec, promptCategory);
				}
			}
		} else if (this._policies.length > 0) {
			// Everything recommended is already in the manifest. Distinguish "present" from
			// "enabled": a policy can be added but toggled off, so only claim "active" when none
			// are disabled — otherwise the reassurance would contradict the toggles above.
			const disabledCount = this._getDisabledPolicies().filter(id => this._policies.some(p => p.id === id)).length;
			const allActive = disabledCount === 0;
			actions.push({
				id: 'chat.guardrails.allSet',
				label: allActive
					? localize('guardrails.allSet', "All recommended guardrails are active")
					: localize('guardrails.allSetSomeOff', "All recommended guardrails added — {0} turned off", disabledCount),
				icon: ThemeIcon.fromId(allActive ? Codicon.check.id : Codicon.info.id),
				category: recommendedCategory,
				enabled: false,
				class: undefined,
				tooltip: '',
				run: async () => { },
			});
		}

		if (this._policies.length === 0 && allPending.length === 0) {
			actions.push({
				id: 'chat.guardrails.noPolicies',
				label: localize('guardrails.noPolicies', "No policies found"),
				detail: localize('guardrails.noPolicies.detail', "Add .github/copilot-policies.json to this workspace"),
				category: policyCategory,
				enabled: false,
				class: undefined,
				tooltip: '',
				run: async () => { },
			});
		}

		return actions;
	}

	protected override renderLabel(element: HTMLElement): IDisposable | null {
		this.setAriaLabelAttributes(element);

		const mode = this._getMode();
		const meta = MODE_META.find(m => m.id === mode) ?? MODE_META[0];
		const disabledCount = this._getDisabledPolicies().length;

		const labelElements = [];
		labelElements.push(...renderLabelWithIcons(`$(${meta.icon.id})`));
		labelElements.push(dom.$('span.chat-input-picker-label', undefined, localize('guardrails.label', "Guardrails")));
		if (this._hasUnseenRecommendations) {
			labelElements.push(dom.$('span.guardrails-unread-dot'));
		}

		dom.reset(element, ...labelElements);
		element.classList.toggle('warning', mode === 'warn');
		element.classList.toggle('has-recommendations', this._hasUnseenRecommendations);

		const base = disabledCount > 0
			? localize('guardrails.tooltip.disabled', "Guardrails: {0} — {1} policy(ies) off", meta.label, disabledCount)
			: localize('guardrails.tooltip', "Guardrails: {0}", meta.label);
		const tooltip = this._hasUnseenRecommendations
			? localize('guardrails.tooltip.recommendations', "{0} — new guardrail recommendations available", base)
			: base;
		this._currentTooltip = tooltip;
		const ariaLabel = this._hasUnseenRecommendations
			? localize('guardrails.ariaLabel.recommendations', "Guardrails picker, {0}, new recommendations available", meta.label)
			: localize('guardrails.ariaLabel', "Guardrails picker, {0}", meta.label);
		element.setAttribute('aria-label', ariaLabel);

		if (this._hoverElement !== element) {
			this._hoverElement = element;
			this._hover.value = this.hoverService.setupDelayedHover(element, () => ({ content: this._currentTooltip }));
		}
		return null;
	}

	public refresh(): void {
		if (this.element) {
			this.renderLabel(this.element);
		}
	}

	/**
	 * Reopens the picker once the action widget's close animation has finished. The action widget
	 * always dismisses when a row is selected, so toggling a policy or adding a recommendation would
	 * otherwise close the picker. Reopening on the next tick races with the in-flight close animation
	 * and can immediately re-dismiss the reopened widget; waiting for the animation to complete keeps
	 * the picker reliably in view so several changes can be made in one pass.
	 */
	private _reopen(): void {
		if (!this.element) {
			return;
		}
		const targetWindow = dom.getWindow(this.element);
		const handle = targetWindow.setTimeout(() => this.show(), CONTEXT_VIEW_MENU_MOTION_CLOSE_ANIMATION_DURATION + 16);
		this._reopenHandle.value = toDisposable(() => targetWindow.clearTimeout(handle));
	}

	override dispose(): void {
		if (this._store.isDisposed) {
			return;
		}
		this._onDidDispose.fire();
		super.dispose();
	}
}
