import { isAbsolute } from "node:path";
import type {
	ProviderCommand,
	ProviderConfigState,
	ProviderEvent,
	ProviderInput,
	ProviderModel,
	ProviderPersistence,
	ProviderSessionConfig,
	ProviderThinkingOption,
	ProviderTimelineItem,
} from "@getpaseo/plugin/server/provider";
import { randomUUID } from "node:crypto";
import { PI_PERSISTENCE_VERSION } from "../../shared/constants";
import {
	defaultThinkingLevels,
	publicModelId,
	splitModelId,
	thinkingOptionsFor,
	toProviderModel,
	toProviderUsage,
	type PiWireModel,
} from "./models";
import { buildSessionArgs } from "./options";
import { isReloadCommand, reloadCommandExtensionPath } from "./reload-extension";
import { PiRpc, PiRpcError } from "./rpc";
import { parsePersistence } from "../sessions";
import {
	blocksOf,
	messageText,
	reasoningText,
	resultText,
	toolCallsOf,
	toolDetail,
	type WireMessage,
} from "./timeline";

type SessionOpenInput = Extract<ProviderInput, { type: "session.open" }>;
type SessionPromptInput = Extract<ProviderInput, { type: "session.prompt" }>;
type SessionConfigureInput = Extract<ProviderInput, { type: "session.configure" }>;
type SessionInterruptInput = Extract<ProviderInput, { type: "session.interrupt" }>;
type SessionCloseInput = Extract<ProviderInput, { type: "session.close" }>;

export const PI_CAPABILITIES = [
	"prompt.message",
	"prompt.command",
	"prompt.image",
	"prompt.steer",
	"session.configure",
	"session.list",
	"session.persistence",
] as const;

const ABORT_TIMEOUT_MS = 60_000;
const MAX_REPLAY_ITEMS = 5_000;

export interface PiSessionDeps {
	emit(event: ProviderEvent): void;
	spawn(input: ReturnType<typeof buildSessionArgs>, config: ProviderSessionConfig): PiRpc;
	sessionDir?: string;
	settings?: {
		noExtensions?: boolean;
		noSkills?: boolean;
		noContextFiles?: boolean;
		noMcp?: boolean;
		reloadCommand?: boolean;
		extraArgs?: string[];
	};
	diagnostic?: (message: string) => void;
}

/** The config state pi's state and model list describe, including per-model thinking levels. */
function configStateFor(
	state: { model?: PiWireModel; thinkingLevel?: string },
	wireModels: readonly PiWireModel[],
	levels: readonly string[],
): ProviderConfigState {
	const current = state.model ? publicModelId(state.model) : "";
	return {
		...(state.model ? { model: current } : {}),
		...(state.thinkingLevel ? { thinkingOption: state.thinkingLevel } : {}),
		models: wireModels.map((model) =>
			toProviderModel(
				model,
				publicModelId(model) === current ? levels : defaultThinkingLevels(model),
			),
		),
		modes: [],
		thinkingOptions: thinkingOptionsFor(levels),
		settings: [],
	};
}

interface ActiveTurn {
	id: string;
	started: boolean;
}

interface PendingUser {
	clientMessageId: string;
	text: string;
	delivery: "auto" | "steer";
}

function isWireMessage(value: unknown): value is WireMessage {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * `--extension` for the generated `/reload` command. An explicit path loads even with
 * `--no-extensions`, so the host setting is the only off switch.
 */
async function reloadExtensionArgs(deps: PiSessionDeps): Promise<string[]> {
	if (deps.settings?.reloadCommand === false) return [];
	try {
		return [await reloadCommandExtensionPath()];
	} catch (error) {
		deps.diagnostic?.(`reload command extension unavailable: ${errorMessage(error)}`);
		return [];
	}
}

export class PiSession {
	private readonly listeners: Array<() => void> = [];
	private activeTurn: ActiveTurn | null = null;
	private pendingTurnId: string | undefined;
	private turnCounter = 0;
	private itemCounter = 0;
	private compactionCounter = 0;
	private pendingUsers: PendingUser[] = [];
	private closed = false;
	private config: ProviderConfigState;
	private persistence: ProviderPersistence | undefined;
	private replaying = false;
	private reloadExtensionPath: string | undefined;
	private commands: ProviderCommand[] = [];

	private constructor(
		readonly id: string,
		readonly cwd: string,
		readonly persist: boolean,
		private readonly rpc: PiRpc,
		private readonly deps: PiSessionDeps,
		private models: ProviderModel[],
		config: ProviderConfigState,
		persistence: ProviderPersistence | undefined,
		private sessionFile: string | undefined,
		private sessionId: string | undefined,
	) {
		this.config = config;
		this.persistence = persistence;
		this.removeEventListener = rpc.onEvent((record) => this.handleEvent(record));
		this.removeExitListener = rpc.onExit(({ code }) => {
			if (this.closed) return;
			this.closed = true;
			this.deps.emit({
				type: "session.closed",
				sessionId: this.id,
				...(code !== null && code !== 0
					? { error: { message: `pi exited with code ${code}` } }
					: {}),
			});
		});
	}

	private removeEventListener: () => void;
	private removeExitListener: () => void;

	static async open(input: SessionOpenInput, deps: PiSessionDeps): Promise<PiSession> {
		const config = input.config;
		if (!config || typeof config.cwd !== "string" || !isAbsolute(config.cwd)) {
			throw new Error("Pi session needs an absolute working directory");
		}
		if (Object.keys(config.mcpServers ?? {}).length > 0) {
			throw new Error(
				"MCP servers are configured in pi itself (~/.pi/agent/mcp.json), not per Paseo session",
			);
		}
		if (config.toolPolicy?.preapproved?.length) {
			throw new Error("per-session tool preapproval is not supported by the Pi provider");
		}
		const persisted = input.persistence ? parsePersistence(input.persistence) : undefined;
		if (input.persistence && !persisted) throw new Error("Invalid Pi session persistence");
		if (persisted && !config.persist) {
			throw new Error("A persisted Pi session requires persist: true");
		}
		const persist = config.persist === true;
		const extensionPaths = await reloadExtensionArgs(deps);
		const args = buildSessionArgs({
			persist,
			...(persisted?.sessionFile ? { sessionFile: persisted.sessionFile } : {}),
			...(deps.sessionDir ? { sessionDir: deps.sessionDir } : {}),
			...(config.systemPrompt ? { systemPrompt: config.systemPrompt } : {}),
			...(config.title ? { title: config.title } : {}),
			...(extensionPaths.length ? { extensionPaths } : {}),
			...(deps.settings?.noExtensions ? { noExtensions: true } : {}),
			...(deps.settings?.noSkills ? { noSkills: true } : {}),
			...(deps.settings?.noContextFiles ? { noContextFiles: true } : {}),
			...(deps.settings?.noMcp ? { noMcp: true } : {}),
			...(deps.settings?.extraArgs ? { extraArgs: deps.settings.extraArgs } : {}),
		});
		const rpc = deps.spawn(args, config);

		try {
			const state = (await rpc.request("get_state")) as {
				model?: PiWireModel;
				thinkingLevel?: string;
				sessionFile?: string;
				sessionId?: string;
				sessionName?: string;
				isStreaming?: boolean;
			};
			if (persisted?.sessionId && state.sessionId && state.sessionId !== persisted.sessionId) {
				throw new Error("pi resumed a different session");
			}
			const wireModels = await fetchModels(rpc);
			if (config.model) {
				const target = splitModelId(config.model);
				if (state.model?.provider !== target.provider || state.model.id !== target.modelId) {
					await rpc.request("set_model", target);
				}
			}
			if (config.thinkingOption) {
				const levels = await fetchLevels(rpc);
				if (levels.includes(config.thinkingOption)) {
					await rpc.request("set_thinking_level", { level: config.thinkingOption });
				}
			}
			const finalState = (await rpc.request("get_state")) as {
				model?: PiWireModel;
				thinkingLevel?: string;
				sessionFile?: string;
				sessionId?: string;
				sessionName?: string;
			};
			const levels = await fetchLevels(rpc).catch(() =>
				defaultThinkingLevels(finalState.model),
			);
			const configState = configStateFor(finalState, wireModels, levels);
			const models = [...configState.models];
			const persistence: ProviderPersistence | undefined =
				persist && finalState.sessionFile
					? {
							version: PI_PERSISTENCE_VERSION,
							data: {
								sessionFile: finalState.sessionFile,
								...(finalState.sessionId ? { sessionId: finalState.sessionId } : {}),
							},
						}
					: undefined;
			const session = new PiSession(
				input.sessionId,
				config.cwd,
				persist,
				rpc,
				deps,
				models,
				configState,
				persistence,
				finalState.sessionFile,
				finalState.sessionId,
			);
			session.reloadExtensionPath = extensionPaths[0];
			deps.emit({
				type: "session.opened",
				requestId: input.requestId,
				sessionId: input.sessionId,
				capabilities: [...PI_CAPABILITIES],
				restoration: "core",
				cwd: config.cwd,
				...(persistence ? { persistence } : {}),
				...(config.title ? { title: config.title } : {}),
			});
			deps.emit({ type: "session.config", sessionId: input.sessionId, config: configState });
			if (input.history === "replay" && persistence) {
				await session.replayHistory();
			}
			const commands = await session.fetchCommands();
			session.commands = commands;
			deps.emit({ type: "session.commands", sessionId: input.sessionId, commands });
			deps.emit({ type: "session.ready", requestId: input.requestId, sessionId: input.sessionId });
			return session;
		} catch (error) {
			await rpc.close().catch(() => undefined);
			throw error;
		}
	}

	async prompt(input: SessionPromptInput): Promise<void> {
		const prompt = input.prompt;
		if (prompt.outputSchema !== undefined) {
			this.emitPromptResult(input, {
				type: "failed",
				error: { message: "Pi does not support structured output schemas" },
			});
			return;
		}
		const { text, images } = promptContent(prompt);
		const command =
			prompt.input.type === "command"
				? `/${prompt.input.name}${prompt.input.arguments ? ` ${prompt.input.arguments}` : ""}`
				: undefined;
		const message = command ?? text;
		if (!message.trim() && images.length === 0) {
			this.emitPromptResult(input, {
				type: "failed",
				error: { message: "The prompt is empty" },
			});
			return;
		}
		const commandName = "prompt";
		if (prompt.delivery !== "steer" && isReloadCommand(message)) {
			await this.reload(input);
			return;
		}
		if (prompt.delivery === "steer") {
			try {
				await this.rpc.request("steer", { message, ...(images.length ? { images } : {}) });
				this.activeTurn ??= { id: this.nextTurnId(), started: false };
				this.emitPromptResult(input, { type: "steer", turnId: this.activeTurn.id });
			} catch (error) {
				this.emitPromptResult(input, {
					type: "failed",
					error: { message: errorMessage(error) },
				});
			}
			return;
		}
		this.pendingUsers.push({
			clientMessageId: prompt.clientMessageId,
			text: message,
			delivery: prompt.delivery,
		});
		if (this.pendingUsers.length > 64) this.pendingUsers.shift();
		try {
			const data = (await this.rpc.request(
				commandName,
				{
					message,
					...(images.length ? { images } : {}),
					...(this.isStreaming() ? { streamingBehavior: "steer" } : {}),
				},
				60_000,
			)) as { disposition?: string } | undefined;
			const disposition = data?.disposition ?? "started";
			if (disposition === "handled") {
				// A command (not a message) produced no user turn: drop the pending entry so a
				// later message cannot pair with this clientMessageId.
				this.pendingUsers = this.pendingUsers.filter(
					(pending) => pending.clientMessageId !== prompt.clientMessageId,
				);
				this.emitPromptResult(input, { type: "completed" });
				return;
			}
			const turnId = this.activeTurn?.id ?? this.nextTurnId();
			this.pendingTurnId = turnId;
			this.emitPromptResult(
				input,
				disposition === "queued"
					? { type: "steer", turnId }
					: { type: "turn", turnId },
			);
		} catch (error) {
			this.pendingUsers = this.pendingUsers.filter(
				(pending) => pending.clientMessageId !== prompt.clientMessageId,
			);
			this.emitPromptResult(input, {
				type: "failed",
				error: { message: errorMessage(error) },
			});
		}
	}

	/**
	 * Runs pi's own `/reload` through the generated extension command. pi's reload refuses to run
	 * mid-turn, so a busy session answers with a failed prompt instead of touching the runtime.
	 */
	private async reload(input: SessionPromptInput): Promise<void> {
		const unavailable = !this.reloadExtensionPath || !this.commands.some((c) => c.name === "reload");
		const message = unavailable
			? "The pi reload command is not available for this session"
			: this.isStreaming()
				? "Wait for the current turn to finish before reloading"
				: undefined;
		if (message) {
			this.notice("warning", "Reload", message);
			this.emitPromptResult(input, { type: "failed", error: { message } });
			return;
		}
		try {
			const data = (await this.rpc.request("prompt", { message: "/reload" }, 60_000)) as
				| { disposition?: string }
				| undefined;
			if ((data?.disposition ?? "started") !== "handled") {
				throw new Error("pi did not run the reload command");
			}
			this.emitPromptResult(input, { type: "completed" });
			await this.refreshAfterReload();
		} catch (error) {
			const detail = errorMessage(error);
			this.notice("error", "Reload failed", detail);
			this.emitPromptResult(input, { type: "failed", error: { message: detail } });
		}
	}

	/** Reload can change models, thinking levels, extensions and skills; tell the host about it. */
	private async refreshAfterReload(): Promise<void> {
		const state = (await this.rpc.request("get_state")) as {
			model?: PiWireModel;
			thinkingLevel?: string;
		};
		const levels = await fetchLevels(this.rpc).catch(() => defaultThinkingLevels(state.model));
		const wireModels = await fetchModels(this.rpc).catch(() => undefined);
		this.config = wireModels
			? configStateFor(state, wireModels, levels)
			: {
					...this.config,
					...(state.model ? { model: publicModelId(state.model) } : {}),
					...(state.thinkingLevel ? { thinkingOption: state.thinkingLevel } : {}),
					thinkingOptions: thinkingOptionsFor(levels),
				};
		this.deps.emit({ type: "session.config", sessionId: this.id, config: this.config });
		this.commands = await this.fetchCommands();
		this.deps.emit({ type: "session.commands", sessionId: this.id, commands: this.commands });
		this.notice(
			"info",
			"Reloaded pi resources",
			"Settings, models, extensions, skills, prompts, themes and context files were reloaded.",
		);
	}

	async configure(input: SessionConfigureInput): Promise<void> {
		try {
			const changes = input.changes;
			if (changes.settings && Object.keys(changes.settings).length > 0) {
				throw new Error("Pi provider settings are managed on the host, not per session");
			}
			if (changes.mode !== undefined && changes.mode !== null) {
				throw new Error("Pi has no approval modes to switch");
			}
			if (changes.model !== undefined) {
				if (changes.model === null) throw new Error("Pi needs a model");
				await this.rpc.request("set_model", splitModelId(changes.model));
			}
			if (changes.thinkingOption !== undefined && changes.thinkingOption !== null) {
				const levels = await fetchLevels(this.rpc);
				if (!levels.includes(changes.thinkingOption)) {
					throw new Error(`Pi does not support thinking level ${changes.thinkingOption}`);
				}
				await this.rpc.request("set_thinking_level", { level: changes.thinkingOption });
			}
			await this.refreshConfig();
			this.deps.emit({ type: "request.completed", requestId: input.requestId });
		} catch (error) {
			this.deps.emit({
				type: "request.failed",
				requestId: input.requestId,
				error: { message: errorMessage(error) },
			});
		}
	}

	async interrupt(input: SessionInterruptInput): Promise<void> {
		try {
			await this.rpc.request("abort", {}, ABORT_TIMEOUT_MS);
			this.deps.emit({ type: "request.completed", requestId: input.requestId });
		} catch (error) {
			this.deps.emit({
				type: "request.failed",
				requestId: input.requestId,
				error: { message: errorMessage(error) },
			});
		}
	}

	async close(_input?: SessionCloseInput): Promise<void> {
		const alreadyClosed = this.closed;
		this.closed = true;
		this.removeEventListener();
		this.removeExitListener();
		await this.rpc.close();
		if (!alreadyClosed) this.deps.emit({ type: "session.closed", sessionId: this.id });
	}

	async abortOpen(): Promise<void> {
		this.closed = true;
		this.removeEventListener();
		this.removeExitListener();
		await this.rpc.close().catch(() => undefined);
	}

	async replayHistory(): Promise<void> {
		this.replaying = true;
		try {
			const data = (await this.rpc.request("get_messages")) as { messages?: unknown[] };
			const messages = (data?.messages ?? []).filter(isWireMessage);
			const results = new Map<string, WireMessage>();
			for (const message of messages) {
				if (message.role === "toolResult" && message.toolCallId) {
					results.set(message.toolCallId, message);
				}
			}
			const items: ProviderTimelineItem[] = [];
			for (let index = 0; index < messages.length; index += 1) {
				const message = messages[index];
				if (!message || items.length >= MAX_REPLAY_ITEMS) break;
				if (message.role === "user") {
					const text = messageText(message);
					if (!text.trim()) continue;
					items.push({
						id: `replay-${index}`,
						type: "user_message",
						text,
					});
					continue;
				}
				if (message.role === "assistant") {
					const text = messageText(message);
					if (text.trim()) {
						items.push({ id: `replay-${index}`, type: "assistant_message", text });
					}
					for (const [reasonIndex, reasoning] of reasoningText(message).entries()) {
						items.push({
							id: `replay-${index}-r${reasonIndex}`,
							type: "reasoning",
							text: reasoning,
						});
					}
					for (const call of toolCallsOf(message)) {
						const result = results.get(call.id);
						const failed = result?.isError === true;
						items.push(
							failed
								? {
										id: `tool-${call.id}`,
										type: "tool_call",
										callId: call.id,
										name: call.name,
										detail: toolDetail(call.name, call.arguments, result, true),
										status: "failed",
										error: { message: resultText(result) || "Tool failed" },
									}
								: {
										id: `tool-${call.id}`,
										type: "tool_call",
										callId: call.id,
										name: call.name,
										detail: toolDetail(call.name, call.arguments, result, false),
										status: "completed",
										error: null,
									},
						);
					}

				}
			}
			for (const item of items) {
				this.deps.emit({
					type: "timeline.item",
					sessionId: this.id,
					item,
				});
			}
		} finally {
			this.replaying = false;
		}
	}

	private async fetchCommands(): Promise<ProviderCommand[]> {
		try {
			const data = (await this.rpc.request("get_commands")) as {
				commands?: Array<{ name?: string; description?: string; argumentHint?: string }>;
			};
			return (data?.commands ?? [])
				.filter(
					(command): command is { name: string; description?: string; argumentHint?: string } =>
						typeof command?.name === "string" && command.name.length > 0,
				)
				.map((command) => ({
					name: command.name,
					description: command.description ?? "",
					...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
				}));
		} catch {
			return [];
		}
	}

	private async refreshConfig(): Promise<void> {
		const state = (await this.rpc.request("get_state")) as {
			model?: PiWireModel;
			thinkingLevel?: string;
		};
		const levels = await fetchLevels(this.rpc).catch((error) => {
			this.notice("warning", "Thinking levels", errorMessage(error));
			return defaultThinkingLevels(state.model);
		});
		this.config = {
			...(state.model ? { model: publicModelId(state.model) } : {}),
			...(state.thinkingLevel ? { thinkingOption: state.thinkingLevel } : {}),
			models: this.config.models,
			modes: [],
			thinkingOptions: thinkingOptionsFor(levels),
			settings: [],
		};
		const modelIndex = this.config.models.findIndex(
			(model) => model.id === this.config.model,
		);
		if (modelIndex >= 0) {
			const model = this.config.models[modelIndex];
			if (model) {
				this.config.models = this.config.models.map((candidate, index) =>
					index === modelIndex
						? { ...candidate, thinkingOptions: thinkingOptionsFor(levels) }
						: candidate,
				);
			}
		}
		this.deps.emit({ type: "session.config", sessionId: this.id, config: this.config });
	}

	private isStreaming(): boolean {
		// pendingTurnId covers the gap between an accepted prompt and agent_start.
		return this.activeTurn !== null || this.pendingTurnId !== undefined;
	}

	private nextTurnId(): string {
		this.turnCounter += 1;
		return `turn-${this.turnCounter}`;
	}

	private nextItemId(prefix: string): string {
		this.itemCounter += 1;
		return `${prefix}-${this.itemCounter}`;
	}

	private emitPromptResult(
		input: SessionPromptInput,
		result: Extract<ProviderEvent, { type: "session.prompt_result" }>["result"],
	): void {
		this.deps.emit({
			type: "session.prompt_result",
			sessionId: this.id,
			clientMessageId: input.prompt.clientMessageId,
			result,
		});
	}

	private notice(level: "info" | "warning" | "error", title: string, description?: string): void {
		this.deps.emit({
			type: "session.notice",
			sessionId: this.id,
			notice: {
				id: randomUUID(),
				severity: level,
				title,
				...(description ? { description } : {}),
			},
		});
	}

	private timeline(item: ProviderTimelineItem): void {
		if (this.replaying) return;
		this.deps.emit({ type: "timeline.item", sessionId: this.id, item });
	}

	private handleEvent(record: Record<string, unknown>): void {
		if (this.closed) return;
		switch (record.type) {
			case "agent_start": {
				if (!this.activeTurn) {
					const turnId = this.pendingTurnId ?? this.nextTurnId();
					this.pendingTurnId = undefined;
					this.activeTurn = { id: turnId, started: true };
					this.deps.emit({
						type: "session.turn",
						sessionId: this.id,
						turnId,
						state: "started",
					});
				}
				return;
			}
			case "agent_settled": {
				const aborted = record.aborted === true;
				if (this.activeTurn) {
					this.deps.emit({
						type: "session.turn",
						sessionId: this.id,
						turnId: this.activeTurn.id,
						state: aborted ? "canceled" : "completed",
					});
					this.activeTurn = null;
				}
				this.pendingTurnId = undefined;
				if (aborted) this.notice("info", "Run stopped");
				void this.refreshUsage();
				return;
			}
			case "message_start": {
				const message = record.message;
				if (!isWireMessage(message) || message.role !== "user") return;
				const text = messageText(message);
				const index = this.pendingUsers.findIndex(
					(pending) => pending.text.trim() === text.trim(),
				);
				const pending = index >= 0 ? this.pendingUsers.splice(index, 1)[0] : undefined;
				this.timeline({
					id: this.nextItemId("user"),
					type: "user_message",
					text,
					...(pending ? { clientMessageId: pending.clientMessageId } : {}),
				});
				return;
			}
			case "message_end": {
				const message = record.message;
				if (!isWireMessage(message) || message.role !== "assistant") return;
				this.handleAssistantMessage(message);
				return;
			}
			case "tool_execution_start": {
				const callId = String(record.toolCallId ?? "");
				const name = String(record.toolName ?? "tool");
				if (!callId) return;
				this.timeline({
					id: `tool-${callId}`,
					type: "tool_call",
					callId,
					name,
					detail: toolDetail(name, record.args),
					status: "running",
					error: null,
				});
				return;
			}
			case "tool_execution_end": {
				const callId = String(record.toolCallId ?? "");
				const name = String(record.toolName ?? "tool");
				if (!callId) return;
				const isError = record.isError === true;
				this.timeline(
					isError
						? {
								id: `tool-${callId}`,
								type: "tool_call",
								callId,
								name,
								detail: toolDetail(name, record.args, record.result, true),
								status: "failed",
								error: { message: resultText(record.result) || "Tool failed" },
							}
						: {
								id: `tool-${callId}`,
								type: "tool_call",
								callId,
								name,
								detail: toolDetail(name, record.args, record.result, false),
								status: "completed",
								error: null,
							},
				);
				return;
			}
			case "compaction_start": {
				this.compactionCounter += 1;
				this.timeline({
					id: `compaction-${this.compactionCounter}`,
					type: "compaction",
					status: "loading",
					trigger: record.reason === "manual" ? "manual" : "auto",
				});
				return;
			}
			case "compaction_end": {
				const result = record.result as { tokensBefore?: number } | undefined;
				this.timeline({
					id: `compaction-${this.compactionCounter}`,
					type: "compaction",
					status: "completed",
					...(result?.tokensBefore ? { preTokens: result.tokensBefore } : {}),
				});
				if (record.errorMessage) {
					this.notice("error", "Compaction failed", String(record.errorMessage));
				}
				return;
			}
			case "auto_retry_start": {
				this.notice(
					"warning",
					"Retrying the model request",
					`Attempt ${record.attempt ?? "?"} of ${record.maxAttempts ?? "?"}: ${record.errorMessage ?? ""}`,
				);
				return;
			}
			case "auto_retry_end": {
				if (record.success === false) {
					this.notice(
						"error",
						"The model request failed",
						String(record.finalError ?? "pi stopped retrying"),
					);
				}
				return;
			}
			case "thinking_level_changed": {
				const level = typeof record.level === "string" ? record.level : undefined;
				if (!level) return;
				this.config = { ...this.config, thinkingOption: level };
				this.deps.emit({ type: "session.config", sessionId: this.id, config: this.config });
				return;
			}
			case "session_info_changed": {
				const name = record.name;
				if (typeof name === "string" && name.trim()) {
					this.deps.emit({
						type: "session.opened",
						sessionId: this.id,
						capabilities: [...PI_CAPABILITIES],
						restoration: "core",
						cwd: this.cwd,
						title: name,
						...(this.persistence ? { persistence: this.persistence } : {}),
					});
				}
				return;
			}
			default:
				return;
		}
	}

	private handleAssistantMessage(message: WireMessage): void {
		const text = messageText(message);
		if (text.trim()) {
			this.timeline({
				id: this.nextItemId("assistant"),
				type: "assistant_message",
				text,
			});
		}
		for (const reasoning of reasoningText(message)) {
			this.timeline({
				id: this.nextItemId("reasoning"),
				type: "reasoning",
				text: reasoning,
			});
		}
		if (message.stopReason === "error") {
			this.timeline({
				id: this.nextItemId("error"),
				type: "error",
				message: message.errorMessage ?? "The model request failed",
			});
		}
		if (message.usage) {
			void this.emitUsage(message.usage);
		}
	}

	private async emitUsage(usage: NonNullable<WireMessage["usage"]>): Promise<void> {
		const contextWindow = this.config.models.find(
			(model) => model.id === this.config.model,
		)?.contextWindowMaxTokens;
		const mapped = toProviderUsage(usage, contextWindow);
		if (!mapped) return;
		this.deps.emit({
			type: "session.usage",
			sessionId: this.id,
			...(this.activeTurn ? { turnId: this.activeTurn.id } : {}),
			usage: mapped,
		});
	}

	private async refreshUsage(): Promise<void> {
		try {
			const stats = (await this.rpc.request("get_session_stats")) as {
				tokens?: { input?: number; output?: number; cacheRead?: number };
				cost?: number;
				contextUsage?: { tokens?: number | null; contextWindow?: number };
			};
			if (!stats) return;
			this.deps.emit({
				type: "session.usage",
				sessionId: this.id,
				usage: {
					inputTokens: stats.tokens?.input ?? 0,
					cachedInputTokens: stats.tokens?.cacheRead ?? 0,
					outputTokens: stats.tokens?.output ?? 0,
					...(typeof stats.cost === "number" ? { totalCostUsd: stats.cost } : {}),
					...(stats.contextUsage?.contextWindow
						? { contextWindowMaxTokens: stats.contextUsage.contextWindow }
						: {}),
					...(typeof stats.contextUsage?.tokens === "number"
						? { contextWindowUsedTokens: stats.contextUsage.tokens }
						: {}),
				},
			});
		} catch {
			// Usage is best-effort; the next completed message reports it anyway.
		}
	}
}

async function fetchModels(rpc: PiRpc): Promise<PiWireModel[]> {
	const data = (await rpc.request("get_available_models")) as { models?: unknown[] };
	const models = (data?.models ?? []).filter(
		(model): model is PiWireModel =>
			!!model &&
			typeof model === "object" &&
			typeof (model as PiWireModel).id === "string" &&
			typeof (model as PiWireModel).provider === "string",
	);
	if (models.length === 0) throw new Error("pi reported no models");
	return models;
}

async function fetchLevels(rpc: PiRpc): Promise<string[]> {
	const data = (await rpc.request("get_available_thinking_levels")) as { levels?: string[] };
	return Array.isArray(data?.levels) ? data.levels : [];
}

function errorMessage(error: unknown): string {
	if (error instanceof PiRpcError) return error.message;
	return error instanceof Error ? error.message : String(error);
}

function promptContent(prompt: {
	input: { type: "message"; content: Array<{ type: string }> } | { type: "command" };
}): { text: string; images: Array<{ type: "image"; data: string; mimeType: string }> } {
	if (prompt.input.type === "command") return { text: "", images: [] };
	const images: Array<{ type: "image"; data: string; mimeType: string }> = [];
	const parts: string[] = [];
	for (const content of prompt.input.content as Array<Record<string, unknown>>) {
		if (content.type === "text" && typeof content.text === "string") {
			parts.push(content.text);
			continue;
		}
		if (
			content.type === "image" &&
			typeof content.data === "string" &&
			typeof content.mimeType === "string"
		) {
			images.push({ type: "image", data: content.data, mimeType: content.mimeType });
			continue;
		}
		if (content.type === "uploaded_file" && typeof content.path === "string") {
			parts.push(`[Attached file: ${content.fileName ?? content.path}] (${content.path})`);
			continue;
		}
		const title = typeof content.title === "string" ? content.title : content.type;
		const url = typeof content.url === "string" ? content.url : undefined;
		const body = typeof content.body === "string" ? content.body : undefined;
		parts.push(
			[
				`[${title}]`,
				url ? `URL: ${url}` : undefined,
				body ? `\n${body}` : undefined,
			]
				.filter(Boolean)
				.join("\n"),
		);
	}
	return { text: parts.join("\n\n"), images };
}
