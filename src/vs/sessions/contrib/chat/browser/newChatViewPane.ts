/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/chatWidget.css';
import * as dom from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore, IDisposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { derived, autorun, observableFromEvent } from '../../../../base/common/observable.js';
import { isWeb } from '../../../../base/common/platform.js';
import { URI } from '../../../../base/common/uri.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { guardrailNotificationStore } from '../../../../workbench/contrib/chat/browser/aiCustomization/guardrailNotificationStore.js';
import { AICustomizationManagementCommands, AICustomizationManagementSection } from '../../../../workbench/contrib/chat/browser/aiCustomization/aiCustomizationManagement.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { localize } from '../../../../nls.js';
import { ISessionsManagementService } from '../../../services/sessions/common/sessionsManagement.js';
import { IAquariumService, IMountedToggleHandle } from '../../aquarium/browser/aquariumOverlay.js';
import { IViewDescriptorService } from '../../../../workbench/common/views.js';
import { IWorkspaceTrustRequestService } from '../../../../platform/workspace/common/workspaceTrust.js';
import { IViewPaneOptions, ViewPane } from '../../../../workbench/browser/parts/views/viewPane.js';
import { WorkspacePicker } from './sessionWorkspacePicker.js';
import { WebWorkspacePicker } from './webWorkspacePicker.js';
import { IPreferredSessionType } from './sessionTypePicker.js';
import { NewChatInputWidget } from './newChatInput.js';
import { NoAgentHostEmptyState } from './noAgentHostEmptyState.js';
import { IChatRequestVariableEntry } from '../../../../workbench/contrib/chat/common/attachments/chatVariableEntries.js';
import { IAgentHostFilterService } from '../../../services/agentHostFilter/common/agentHostFilter.js';

// #region --- New Chat Widget ---

class NewChatWidget extends Disposable {

	private readonly _workspacePicker: WorkspacePicker;
	private readonly _newChatInput: NewChatInputWidget;
	private _aquariumToggle: IMountedToggleHandle | undefined;

	/** Tracks an in-flight wait for a provider's session types to become available. */
	private readonly _pendingSessionTypeWait = new MutableDisposable<IDisposable>();

	/**
	 * The currently mounted no-agent-host empty state, if any. Set by
	 * {@link _renderEmptyStateGate} while the empty state replaces the
	 * workspace picker; consulted by {@link focusInput} to route focus to
	 * the visible heading instead of the (hidden) chat input.
	 */
	private _activeEmptyState: NoAgentHostEmptyState | undefined;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
		@ISessionsManagementService private readonly sessionsManagementService: ISessionsManagementService,
		@IWorkspaceTrustRequestService private readonly workspaceTrustRequestService: IWorkspaceTrustRequestService,
		@IAquariumService private readonly aquariumService: IAquariumService,
		@IAgentHostFilterService private readonly agentHostFilterService: IAgentHostFilterService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();
		// On web (vscode.dev / insiders.vscode.dev), use {@link WebWorkspacePicker}
		// which scopes recents to the active host and renders as a bottom
		// sheet on phone-layout viewports. On Electron desktop, the regular
		// {@link WorkspacePicker} is fine — phones never run there.
		const PickerCtor = isWeb ? WebWorkspacePicker : WorkspacePicker;
		this._workspacePicker = this._register(this.instantiationService.createInstance(PickerCtor));
		this._register(this._pendingSessionTypeWait);

		const canSendRequest = derived(reader => {
			const session = this.sessionsManagementService.activeSession.read(reader);
			if (!session) {
				return false;
			}
			return !session.loading.read(reader);
		});

		const loading = derived(reader => {
			const session = this.sessionsManagementService.activeSession.read(reader);
			return session?.loading.read(reader) ?? false;
		});

		this._newChatInput = this._register(this.instantiationService.createInstance(NewChatInputWidget, {
			getContextFolderUri: () => this._getContextFolderUri(),
			sendRequest: async (text: string, attachedContext?: IChatRequestVariableEntry[]) => this._send(text, attachedContext),
			canSendRequest,
			loading,
			renderSessionTypePickerInControls: false,
		}));

		this._register(this._workspacePicker.onDidSelectWorkspace(async folderUri => {
			if (folderUri) {
				// Carry over the user's preferred session type if some
				// provider can still serve it for this folder; otherwise
				// fall back to the provider's natural default by passing
				// only the folder URI.
				const picked = this._newChatInput.sessionTypePicker.selectedPick;
				const folderTypes = picked ? this.sessionsManagementService.getSessionTypesForFolder(folderUri) : undefined;
				const validForFolder = picked && folderTypes!.some(t =>
					(picked.providerId === undefined || t.providerId === picked.providerId)
					&& t.sessionType.id === picked.sessionTypeId);
				await this._onWorkspaceSelected(folderUri, validForFolder ? picked : undefined);
			} else {
				await this._onWorkspaceSelected(undefined, undefined);
			}
			this._newChatInput.focus();
		}));
		this._register(this._newChatInput.sessionTypePicker.onDidSelectSessionType(async pick => {
			await this._onWorkspaceSelected(this._workspacePicker.selectedFolderUri, pick);
			this._newChatInput.focus();
		}));
	}

	// --- Rendering ---

	render(parent: HTMLElement): void {
		const element = dom.append(parent, dom.$('.sessions-chat-widget'));
		const chatWidgetContainer = dom.append(element, dom.$('.new-chat-widget-container'));
		const chatWidgetContent = dom.append(chatWidgetContainer, dom.$('.new-chat-widget-content'));

		this._aquariumToggle = this._register(this.aquariumService.mountToggle(element));

		const workspacePickerContainer = dom.append(chatWidgetContent, dom.$('.new-session-workspace-picker-container'));
		// On web (vscode.dev / insiders.vscode.dev) the workspace picker is
		// scoped to the currently selected agent host. When no hosts are
		// known there is nothing for the user to pick, so swap the picker
		// out for the no-agent-host empty state. On Electron desktop the
		// regular picker is always functional (the local Copilot provider
		// is always available) so this branch is web-only.
		this._register(isWeb
			? this._renderEmptyStateGate(workspacePickerContainer, chatWidgetContent)
			: this._renderWorkspacePicker(workspacePickerContainer));

		this._newChatInput.render(chatWidgetContent, parent);

		// Embedded guardrails — scripted demo session. Hidden until launched
		// (command "Guardrails: Start Demo Session"). When active it overlays the
		// new-chat surface with a realistic working session: the user's prompt,
		// the agent working, and — the moment the agent attempts a risky action —
		// a guardrail popup animating in right above the chat box, deep-linking
		// into the Agents customization view. This keeps the homepage clean while
		// demonstrating the in-session experience.
		this._renderDemoSession(element);

		// Create initial session for any workspace already selected at construct time.
		// If the selection arrives later (provider registers asynchronously), the
		// picker fires onDidSelectWorkspace and our listener handles it.
		// Skip if an active session already exists (restored by openNewSessionView
		// from a pending new session when navigating back from another session).
		const restoredFolderUri = this._workspacePicker.selectedFolderUri;
		if (!this._syncWorkspacePickerFromActiveSession() && restoredFolderUri) {
			this._createNewSession(restoredFolderUri, this._newChatInput.sessionTypePicker.selectedPick);
		}

		chatWidgetContainer.classList.add('revealed');
	}

	/**
	 * Render the scripted guardrail demo session. Builds a hidden overlay over
	 * the new-chat surface and shows it whenever {@link guardrailNotificationStore.demoActive}
	 * flips on, replaying a working-session flow that ends in a blocked action.
	 */
	private _renderDemoSession(host: HTMLElement): void {
		const overlay = dom.append(host, dom.$('.guardrail-demo-session.hidden'));

		// Header: session identity + a status pill + a close affordance.
		const header = dom.append(overlay, dom.$('.guardrail-demo-header'));
		const headerLeft = dom.append(header, dom.$('.guardrail-demo-header-left'));
		const headerTitle = dom.append(headerLeft, dom.$('span.guardrail-demo-header-title'));
		headerTitle.textContent = localize('guardrailDemoTitle', "Agent session · auth-refactor");
		const statusPill = dom.append(headerLeft, dom.$('span.guardrail-demo-status'));
		const closeBtn = dom.append(header, dom.$('button.guardrail-demo-close'));
		closeBtn.setAttribute('type', 'button');
		closeBtn.setAttribute('aria-label', localize('guardrailDemoClose', "Exit demo session"));
		closeBtn.classList.add(...ThemeIcon.asClassNameArray(Codicon.close));
		this._register(dom.addDisposableListener(closeBtn, dom.EventType.CLICK, () => guardrailNotificationStore.stopDemo()));

		// Conversation thread.
		const thread = dom.append(overlay, dom.$('.guardrail-demo-thread'));

		// Composer region: the guardrail popup docks directly above the input box.
		const composer = dom.append(overlay, dom.$('.guardrail-demo-composer'));
		this._renderGuardrailNotificationBar(composer);
		const inputRow = dom.append(composer, dom.$('.guardrail-demo-input'));
		const inputText = dom.append(inputRow, dom.$('span.guardrail-demo-input-placeholder'));
		inputText.textContent = localize('guardrailDemoInput', "Run tasks in the background with the Copilot CLI, type ` # ` for adding context");

		const toolbar = dom.append(inputRow, dom.$('.guardrail-demo-toolbar'));
		const toolbarLeft = dom.append(toolbar, dom.$('.guardrail-demo-toolbar-left'));

		const addBtn = dom.append(toolbarLeft, dom.$('span.guardrail-demo-toolbar-icon'));
		addBtn.classList.add(...ThemeIcon.asClassNameArray(Codicon.add));

		const modePill = dom.append(toolbarLeft, dom.$('span.guardrail-demo-toolbar-pill'));
		const modeIcon = dom.append(modePill, dom.$('span.guardrail-demo-toolbar-pill-icon'));
		modeIcon.classList.add(...ThemeIcon.asClassNameArray(Codicon.code));
		dom.append(modePill, dom.$('span')).textContent = localize('guardrailDemoMode', "Agent");

		dom.append(toolbarLeft, dom.$('span.guardrail-demo-toolbar-sep'));

		dom.append(toolbarLeft, dom.$('span.guardrail-demo-toolbar-model')).textContent = localize('guardrailDemoModel', "Claude Opus 4.8");
		dom.append(toolbarLeft, dom.$('span.guardrail-demo-toolbar-effort')).textContent = localize('guardrailDemoEffort', "Medium");

		const sendBtn = dom.append(toolbar, dom.$('span.guardrail-demo-send'));
		sendBtn.classList.add(...ThemeIcon.asClassNameArray(Codicon.stopCircle));

		// React to demo activation. The nonce ensures re-running the command
		// while already open restarts the script from the top.
		const demoObs = observableFromEvent(
			guardrailNotificationStore.onDidChangeDemo,
			() => ({ active: guardrailNotificationStore.demoActive, nonce: guardrailNotificationStore.demoNonce })
		);
		const scriptStore = this._register(new DisposableStore());
		this._register(autorun(reader => {
			const { active } = demoObs.read(reader);
			overlay.classList.toggle('hidden', !active);
			scriptStore.clear();
			if (active) {
				this._runDemoScript(thread, statusPill, scriptStore);
			}
		}));
	}

	/**
	 * Replay the scripted "agent working → guardrail blocks" sequence into the
	 * demo thread. Timers are tracked in {@link store} so a restart/close cancels
	 * any pending steps.
	 */
	private _runDemoScript(thread: HTMLElement, statusPill: HTMLElement, store: DisposableStore): void {
		dom.clearNode(thread);
		const timers: ReturnType<typeof setTimeout>[] = [];
		store.add({ dispose: () => timers.forEach(t => clearTimeout(t)) });
		const at = (ms: number, fn: () => void) => { timers.push(setTimeout(fn, ms)); };

		const setStatus = (label: string, working: boolean) => {
			statusPill.textContent = label;
			statusPill.classList.toggle('working', working);
		};

		const addMessage = (role: 'user' | 'agent', text: string): HTMLElement => {
			const msg = dom.append(thread, dom.$(`.guardrail-demo-msg.${role}`));
			const body = dom.append(msg, dom.$('.guardrail-demo-msg-body'));
			body.textContent = text;
			thread.scrollTop = thread.scrollHeight;
			return body;
		};

		const addLine = (body: HTMLElement, cls: string, text: string) => {
			const line = dom.append(body, dom.$(`.guardrail-demo-line.${cls}`));
			dom.append(line, dom.$('span')).textContent = text;
			thread.scrollTop = thread.scrollHeight;
			return line;
		};

		// Bubble handles that later steps append tool lines / follow-ups to.
		let planBody: HTMLElement;
		let refactorBody: HTMLElement;
		let syncBody: HTMLElement;
		let pendingNetLine: HTMLElement;

		// 0s — first user prompt.
		addMessage('user', localize('guardrailDemoUserMsg1', "Can you refactor our auth module? The token handling in src/auth is getting messy."));
		setStatus(localize('guardrailDemoStatusWorking', "Working…"), true);

		// 0.7s — agent acknowledges and starts reading.
		at(700, () => {
			planBody = addMessage('agent', localize('guardrailDemoAgentPlan', "Sure — let me read through the auth module first so I understand how tokens flow today."));
		});
		at(1600, () => {
			addLine(planBody, 'tool', localize('guardrailDemoToolRead1', "Read src/auth/token.ts"));
		});
		at(2300, () => {
			addLine(planBody, 'tool', localize('guardrailDemoToolRead2', "Read src/auth/session.ts"));
		});
		at(3000, () => {
			addLine(planBody, 'tool', localize('guardrailDemoToolRead3', "Read src/auth/keychain.ts"));
		});

		// 3.8s — agent reports findings, status goes idle (waiting on the user).
		at(3800, () => {
			addMessage('agent', localize('guardrailDemoAgentFindings', "Got it. Token creation, refresh, and storage are all tangled in token.ts. I'd split them into a TokenStore, a SessionManager, and a small KeyChain wrapper. Want me to go ahead?"));
			setStatus(localize('guardrailDemoStatusIdle', "Idle"), false);
		});

		// 4.8s — user approves and adds a second ask.
		at(4800, () => {
			addMessage('user', localize('guardrailDemoUserMsg2', "Yes, do it. And once it's done, sync the new keys up to our payments API so prod stays in sync."));
			setStatus(localize('guardrailDemoStatusWorking', "Working…"), true);
		});

		// 5.5s — agent does the local refactor.
		at(5500, () => {
			refactorBody = addMessage('agent', localize('guardrailDemoAgentRefactor', "On it. Splitting the module and updating the imports now."));
		});
		at(6300, () => {
			addLine(refactorBody, 'tool', localize('guardrailDemoToolEdit1', "Edited src/auth/tokenStore.ts (new)"));
		});
		at(7000, () => {
			addLine(refactorBody, 'tool', localize('guardrailDemoToolEdit2', "Edited src/auth/sessionManager.ts (new)"));
		});
		at(7700, () => {
			addLine(refactorBody, 'tool', localize('guardrailDemoToolEdit3', "Updated 6 imports across src/auth/*"));
		});

		// 8.4s — agent moves to the second ask: the key sync.
		at(8400, () => {
			syncBody = addMessage('agent', localize('guardrailDemoAgentSync', "Local refactor's done and the build is green. Now syncing the new keys to the payments API…"));
		});
		at(9300, () => {
			pendingNetLine = addLine(syncBody, 'tool pending', localize('guardrailDemoToolNet', "Attempting network call: POST https://api.io/v2/keys"));
		});

		// 10.1s — the guardrail intercepts the risky action.
		at(10100, () => {
			guardrailNotificationStore.add({
				id: `demo-net-${Date.now()}`,
				title: localize('guardrailDemoIssueTitle', "Network call blocked"),
				detail: localize('guardrailDemoIssueDetail', "Tool gate: network egress = disallowed — POST to api.io was intercepted before it ran."),
				scenario: 'jailbroken',
				timestamp: Date.now(),
			});
			pendingNetLine?.classList.remove('pending');
			pendingNetLine?.classList.add('blocked');
			addLine(syncBody, 'blocked', localize('guardrailDemoBlockedLine', "Blocked by guardrail — outbound network egress is not allowed."));
			addMessage('agent', localize('guardrailDemoAgentRecover', "That outbound call was blocked by a guardrail, so I didn't send your keys anywhere. The refactor is committed locally — I've left the key sync for you to approve."));
			setStatus(localize('guardrailDemoStatusIdle', "Idle"), false);
		});
	}

	/**
	 * Render the guardrail notification popup above the demo chat box. Visible
	 * only once a blocked action has been recorded this session; clicking it
	 * opens the Agents customization view (the guardrail surface).
	 */
	private _renderGuardrailNotificationBar(parent: HTMLElement): void {
		const bar = dom.append(parent, dom.$('button.guardrail-notification-bar'));
		bar.setAttribute('type', 'button');
		bar.tabIndex = 0;

		const text = dom.append(bar, dom.$('span.guardrail-notification-text'));
		const action = dom.append(bar, dom.$('span.guardrail-notification-action'));
		action.textContent = localize('guardrailBarAction', "Review in Agents");

		const countObs = observableFromEvent(
			guardrailNotificationStore.onDidChange,
			() => guardrailNotificationStore.count
		);
		this._register(autorun(reader => {
			const count = countObs.read(reader);
			bar.classList.toggle('hidden', count === 0);
			text.textContent = count === 1
				? localize('guardrailBarTextOne', "Guardrails blocked 1 risky action this session")
				: localize('guardrailBarTextMany', "Guardrails blocked {0} risky actions this session", count);
			bar.setAttribute('aria-label', localize('guardrailBarAria', "{0} guardrail issues blocked this session. Review in the Agents view.", count));
		}));

		const open = () => {
			this.commandService.executeCommand(
				AICustomizationManagementCommands.OpenEditor,
				AICustomizationManagementSection.Agents
			);
		};
		this._register(dom.addDisposableListener(bar, dom.EventType.CLICK, e => {
			e.preventDefault();
			open();
		}));
		this._register(dom.addDisposableListener(bar, dom.EventType.KEY_DOWN, (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				open();
			}
		}));
	}

	/**
	 * If a pending session was restored by {@link openNewSessionView}, sync
	 * the workspace picker to match the session's workspace. The picker may
	 * have restored a workspace from a different provider (e.g. remote vs
	 * local), so overwrite it with the session's actual workspace without
	 * firing the event (which would trigger {@link _onWorkspaceSelected} and
	 * create a new session).
	 *
	 * @returns `true` if an active session was found and the picker was synced.
	 */
	private _syncWorkspacePickerFromActiveSession(): boolean {
		const activeSession = this.sessionsManagementService.activeSession.get();
		if (!activeSession) {
			return false;
		}

		const sessionWorkspace = activeSession.workspace.get();
		const folderUri = sessionWorkspace?.folders[0]?.root;
		if (folderUri) {
			this._workspacePicker.setSelectedWorkspace(folderUri, { fireEvent: false });
		}

		return true;
	}

	private _createNewSession(folderUri: URI, pick: IPreferredSessionType | undefined): void {
		// If the carried-over pick can no longer be served for this folder
		// (the picker upgraded to a different provider after restore), drop
		// it so the management service picks the natural default. When the
		// pick has no providerId yet (legacy stored preference), we accept
		// any provider that offers the same sessionTypeId.
		let effectivePick = pick;
		if (effectivePick) {
			const available = this.sessionsManagementService.getSessionTypesForFolder(folderUri);
			const matches = available.some(t =>
				(effectivePick!.providerId === undefined || t.providerId === effectivePick!.providerId)
				&& t.sessionType.id === effectivePick!.sessionTypeId);
			if (!matches) {
				effectivePick = undefined;
			}
		}

		// Session types may not be available yet (e.g., agent host still connecting).
		// If so, wait for them before creating the session — otherwise createNewSession
		// throws and the new chat view is left without an active session, which hides
		// agent-host-specific UI (model picker etc.) until the user re-picks the workspace.
		// If the connection fails, the picker fires onDidSelectWorkspace(undefined) which
		// clears the pending wait via _onWorkspaceSelected.
		const availableNow = this.sessionsManagementService.getSessionTypesForFolder(folderUri);
		if (availableNow.length === 0) {
			const pendingStore = new DisposableStore();
			this._pendingSessionTypeWait.value = pendingStore;
			pendingStore.add(this.sessionsManagementService.onDidChangeSessionTypes(() => {
				if (this.sessionsManagementService.getSessionTypesForFolder(folderUri).length > 0) {
					this._pendingSessionTypeWait.clear();
					this._createNewSession(folderUri, pick);
				}
			}));
			return;
		}

		// Fall back to the provider associated with the recently-picked
		// workspace (e.g. Local Agent Host) when the session type picker has
		// no explicit pick yet. This preserves the user's historical provider
		// association across iteration-order changes in the providers list.
		const fallbackProviderId = this._workspacePicker.selectedResolved?.providerId;

		try {
			this.sessionsManagementService.createNewSession(folderUri, effectivePick
				? { providerId: effectivePick.providerId, sessionTypeId: effectivePick.sessionTypeId }
				: fallbackProviderId
					? { providerId: fallbackProviderId }
					: undefined);
		} catch (e) {
			this.logService.error('Failed to create new session:', e);
		}
	}

	/**
	 * Returns the workspace URI for the context picker based on the current workspace selection.
	 */
	private _getContextFolderUri(): URI | undefined {
		return this._workspacePicker.selectedFolderUri;
	}

	private _renderWorkspacePicker(container: HTMLElement): IDisposable {
		const pickersRow = dom.append(container, dom.$('.session-workspace-picker'));
		const pickersLabel = dom.append(pickersRow, dom.$('.session-workspace-picker-label'));
		pickersLabel.textContent = this._workspacePicker.selectedFolderUri
			? localize('newSessionIn', "New session in")
			: localize('newSessionChooseWorkspace', "Start by picking a");

		this._workspacePicker.render(pickersRow);
		const withLabel = dom.append(pickersRow, dom.$('.session-workspace-picker-label.session-workspace-picker-with-label'));
		withLabel.textContent = localize('newSessionWith', "with");
		this._newChatInput.sessionTypePicker.render(pickersRow, { className: 'sessions-chat-session-type-picker' });
		return this._workspacePicker.onDidSelectWorkspace(() => {
			const folderUri = this._workspacePicker.selectedFolderUri;
			pickersLabel.textContent = folderUri
				? localize('newSessionIn', "New session in")
				: localize('newSessionChooseWorkspace', "Start by picking a");
		});
	}

	private _renderEmptyState(container: HTMLElement): IDisposable {
		const emptyState = this.instantiationService.createInstance(NoAgentHostEmptyState);
		emptyState.render(container);
		this._activeEmptyState = emptyState;
		return {
			dispose: () => {
				if (this._activeEmptyState === emptyState) {
					this._activeEmptyState = undefined;
				}
				emptyState.dispose();
			},
		};
	}

	/**
	 * Web-only: hosts the workspace picker, but swaps it out for the
	 * no-agent-host empty state once we are *sure* there are no hosts —
	 * i.e. after a discovery cycle has completed. Rendering the empty
	 * state before discovery has run would briefly flash it at users who
	 * actually have hosts that just haven't been discovered yet (e.g.
	 * cached tunnels resolved on startup). Until then we keep the regular
	 * workspace picker, which has its own loading affordance.
	 */
	private _renderEmptyStateGate(container: HTMLElement, chatWidgetContent: HTMLElement): IDisposable {
		const store = new DisposableStore();
		const pickerSlot = dom.append(container, dom.$('.session-workspace-picker-slot'));
		const stateDisposables = store.add(new MutableDisposable());

		const showPicker = () => {
			chatWidgetContent.classList.remove('no-agent-host');
			dom.clearNode(pickerSlot);
			stateDisposables.value = this._renderWorkspacePicker(pickerSlot);
		};

		const showEmptyState = () => {
			chatWidgetContent.classList.add('no-agent-host');
			dom.clearNode(pickerSlot);
			stateDisposables.value = this._renderEmptyState(pickerSlot);
		};

		const filter = this.agentHostFilterService;
		let hasCompletedDiscovery = filter.hosts.length > 0;

		// If no discovery cycle is in flight or has completed yet, kick one
		// off so the empty state can resolve in a bounded time. The
		// `tunnelAgentHost.contribution` already triggers a startup
		// rediscover, but in the (rare) case the view mounts before the
		// contribution gets a chance, this prevents the user from being
		// stuck on a picker that never gets populated.
		if (!hasCompletedDiscovery && !filter.isDiscovering) {
			filter.rediscover();
		}

		const update = () => {
			if (hasCompletedDiscovery && !filter.isDiscovering && filter.hosts.length === 0) {
				showEmptyState();
			} else {
				showPicker();
			}
		};

		update();

		// `onDidChange` fires when the host list changes — entering or
		// leaving the empty state if the last host disconnects or the
		// first host appears.
		store.add(filter.onDidChange(() => {
			if (filter.hosts.length > 0) {
				hasCompletedDiscovery = true;
			}
			update();
		}));
		// `onDidChangeDiscovering` fires on discovery start *and* end; we
		// treat any transition out of discovering as having completed at
		// least one cycle.
		store.add(filter.onDidChangeDiscovering(() => {
			if (!filter.isDiscovering) {
				hasCompletedDiscovery = true;
			}
			update();
		}));

		return store;
	}

	// --- Send ---

	private async _send(query: string, attachedContext?: IChatRequestVariableEntry[]): Promise<void> {
		const session = this.sessionsManagementService.activeSession.get();
		if (!session) {
			this._workspacePicker.showPicker();
			return;
		}
		try {
			await this.sessionsManagementService.sendAndCreateChat(session, { query, attachedContext });
		} catch (e) {
			this.logService.error('Failed to send request:', e);
		}
	}

	private async _requestFolderTrust(folderUri: URI): Promise<boolean> {
		const trusted = await this.workspaceTrustRequestService.requestResourcesTrust({
			uri: folderUri,
			message: localize('trustFolderMessage', "An agent session will be able to read files, run commands, and make changes in this folder."),
		});
		if (!trusted) {
			this._workspacePicker.removeFromRecents(folderUri);
		}
		return !!trusted;
	}

	saveState(): void {
		this._newChatInput.saveState();
	}

	layout(_height: number, _width: number): void {
		this._newChatInput.layout(_height, _width);
	}

	focusInput(): void {
		// While the empty state is mounted, the chat input is hidden via
		// CSS (`.no-agent-host` on `.new-chat-widget-content`) so focusing
		// it would just send focus to <body>. Land on the empty state's
		// heading instead so the user has a visible focus target.
		if (this._activeEmptyState) {
			this._activeEmptyState.focus();
			return;
		}
		this._newChatInput.focus();
	}

	/**
	 * Handles a workspace selection from the workspace picker.
	 * Requests folder trust if needed and creates a new session.
	 */
	private async _onWorkspaceSelected(folderUri: URI | undefined, pick: IPreferredSessionType | undefined): Promise<void> {
		// Cancel any in-flight wait for a previous selection.
		this._pendingSessionTypeWait.clear();

		if (!folderUri) {
			this.sessionsManagementService.unsetNewSession();
			return;
		}

		const resolved = this.sessionsManagementService.resolveWorkspace(folderUri);
		if (resolved?.workspace.requiresWorkspaceTrust) {
			if (!await this._requestFolderTrust(folderUri)) {
				return;
			}
		}

		this._createNewSession(folderUri, pick);
	}

	prefillInput(text: string): void {
		this._newChatInput.prefillInput(text);
	}

	setHostVisible(visible: boolean): void {
		this._aquariumToggle?.setHostVisible(visible);
	}

	sendQuery(text: string): void {
		this._newChatInput.sendQuery(text);
	}

	selectWorkspace(folderUri: URI, providerId?: string): void {
		this._workspacePicker.setSelectedWorkspace(folderUri, { providerId });
	}
}

// #endregion

// #region --- New Chat View Pane ---

export const SessionsViewId = 'workbench.view.sessions.chat';

export class NewChatViewPane extends ViewPane {

	private _widget: NewChatWidget | undefined;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._widget = this._register(this.instantiationService.createInstance(
			NewChatWidget,
		));

		this._widget.render(container);
		this._widget.focusInput();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this._widget?.layout(height, width);
	}

	override focus(): void {
		super.focus();
		this._widget?.focusInput();
	}

	prefillInput(text: string): void {
		this._widget?.prefillInput(text);
	}

	sendQuery(text: string): void {
		this._widget?.sendQuery(text);
	}

	selectWorkspace(folderUri: URI, providerId?: string): void {
		this._widget?.selectWorkspace(folderUri, providerId);
	}

	override setVisible(visible: boolean): void {
		super.setVisible(visible);
		this._widget?.setHostVisible(visible);
		if (visible) {
			this._widget?.focusInput();
		}
	}

	override saveState(): void {
		this._widget?.saveState();
	}

	override dispose(): void {
		this._widget?.saveState();
		super.dispose();
	}
}

// #endregion
