import { homedir } from "node:os";
import {
	negotiateProviderCapabilities,
	type ProviderCatalog,
	type ProviderConnectRequest,
	type ProviderConnection,
	type ProviderEvent,
	type ProviderInput,
} from "@getpaseo/plugin/server/provider";
import { resolveSessionDir, listPiSessions, parsePersistence } from "../sessions";
import { defaultThinkingLevels, publicModelId, toProviderModel, type PiWireModel } from "./models";
import { resolveLaunch, type PiProviderOptions, PiProviderOptionsSchema, buildSessionArgs } from "./options";
import { PiRpc } from "./rpc";
import { PI_CAPABILITIES, PiSession } from "./session";

export interface PiConnectionDeps {
	launch?: ProviderConnectRequest["launch"];
	settings: {
		command: string;
		args: string[];
		inheritEnv: string[];
		sessionDir: string;
		noExtensions: boolean;
		noSkills: boolean;
		noContextFiles: boolean;
		noMcp: boolean;
		reloadCommand?: boolean;
	};
	processEnv?: NodeJS.ProcessEnv;
	spawn?: (options: ConstructorParameters<typeof PiRpc>[0], diagnostic?: (text: string) => void) => PiRpc;
	diagnostic?: (message: string) => void;
}

interface SessionSlot {
	session: PiSession;
}

const CATALOG_TTL_MS = 60_000;
const MAX_SESSIONS = 32;

export function createPiConnection(
	deps: PiConnectionDeps,
	request: ProviderConnectRequest,
): ProviderConnection {
	const listeners = new Set<(event: ProviderEvent) => void>();
	const sessions = new Map<string, SessionSlot>();
	const opening = new Map<string, AbortController>();
	const processEnv = deps.processEnv ?? process.env;
	const Spawn: NonNullable<PiConnectionDeps["spawn"]> =
		deps.spawn ?? ((options, diagnostic) => new PiRpc(options, diagnostic));
	let closed = false;
	let catalogCache: { key: string; expiresAt: number; catalog: ProviderCatalog } | undefined;

	const emit = (event: ProviderEvent): void => {
		if (closed) return;
		if (event.type === "session.closed") sessions.delete(event.sessionId);
		for (const listener of listeners) listener(event);
	};

	const optionsFor = (input: { providerOptions?: unknown } | undefined): PiProviderOptions => {
		const parsed = PiProviderOptionsSchema.safeParse(input?.providerOptions ?? {});
		return parsed.success ? parsed.data : {};
	};

	const launchFor = (options: PiProviderOptions) =>
		resolveLaunch({
			...(deps.launch ? { launch: deps.launch } : {}),
			options,
			settings: deps.settings,
			processEnv,
		});

	const discoverCatalog = async (input: {
		cwd?: string;
		providerOptions?: unknown;
	}): Promise<ProviderCatalog> => {
		const options = optionsFor(input);
		const cwd = input.cwd ?? homedir();
		const launch = launchFor(options);
		const args = buildSessionArgs({
			persist: false,
			...(cwd ? { sessionDir: resolveSessionDir({ option: options.sessionDir ?? deps.settings.sessionDir, processEnv }) } : {}),
			...(deps.settings.noExtensions || options.noExtensions ? { noExtensions: true } : {}),
			...(deps.settings.noSkills || options.noSkills ? { noSkills: true } : {}),
			...(deps.settings.noContextFiles || options.noContextFiles ? { noContextFiles: true } : {}),
			...(deps.settings.noMcp || options.noMcp ? { noMcp: true } : {}),
			...(options.extraArgs ? { extraArgs: options.extraArgs } : {}),
		});
		const key = JSON.stringify({
			command: launch.command,
			args: [...launch.args, ...args],
			env: launch.env,
			cwd,
		});
		if (catalogCache && catalogCache.key === key && catalogCache.expiresAt > Date.now()) {
			return catalogCache.catalog;
		}
		const rpc = Spawn(
			{ command: launch.command, args: [...launch.args, ...args], cwd, env: launch.env },
			deps.diagnostic,
		);
		try {
			const state = (await rpc.request("get_state")) as { model?: PiWireModel };
			const data = (await rpc.request("get_available_models")) as { models?: unknown[] };
			const wireModels = (data?.models ?? []).filter(
				(model): model is PiWireModel =>
					!!model &&
					typeof model === "object" &&
					typeof (model as PiWireModel).id === "string" &&
					typeof (model as PiWireModel).provider === "string",
			);
			if (wireModels.length === 0) throw new Error("pi reported no models");
			let levels = defaultThinkingLevels(state.model);
			try {
				const levelData = (await rpc.request("get_available_thinking_levels")) as {
					levels?: string[];
				};
				if (Array.isArray(levelData?.levels) && levelData.levels.length > 0) {
					levels = levelData.levels;
				}
			} catch {
				// The default ladder is a fair description when the probe cannot answer.
			}
			const defaultId = state.model ? publicModelId(state.model) : undefined;
			const catalog: ProviderCatalog = {
				models: wireModels.map((model) =>
					toProviderModel(
						model,
						defaultId && publicModelId(model) === defaultId ? levels : defaultThinkingLevels(model),
					),
				),
				modes: [],
				thinkingOptions: toThinkingOptions(levels),
				...(defaultId ? { defaultModel: defaultId } : {}),
			};
			catalogCache = { key, expiresAt: Date.now() + CATALOG_TTL_MS, catalog };
			return catalog;
		} finally {
			await rpc.close().catch(() => undefined);
		}
	};

	const dispatch = async (input: ProviderInput): Promise<void> => {
		switch (input.type) {
			case "catalog": {
				try {
					const catalog = await discoverCatalog(
						input as typeof input & { providerOptions?: unknown },
					);
					emit({ type: "catalog", requestId: input.requestId, catalog });
				} catch (error) {
					emit({
						type: "request.failed",
						requestId: input.requestId,
						error: { message: messageOf(error) },
					});
				}
				return;
			}
			case "sessions": {
				try {
					const options = optionsFor(input as typeof input & { providerOptions?: unknown });
					const sessionDir = resolveSessionDir({
						option: options.sessionDir ?? deps.settings.sessionDir,
						processEnv,
					});
					const sessions = await listPiSessions({
						sessionDir,
						...(input.cwd ? { cwd: input.cwd } : {}),
						...(input.query ? { query: input.query } : {}),
						...(input.limit ? { limit: input.limit } : {}),
					});
					emit({ type: "sessions", requestId: input.requestId, sessions });
				} catch (error) {
					emit({
						type: "request.failed",
						requestId: input.requestId,
						error: { message: messageOf(error) },
					});
				}
				return;
			}
			case "session.open": {
				if (sessions.has(input.sessionId) || opening.has(input.sessionId)) {
					emit({
						type: "request.failed",
						requestId: input.requestId,
						error: { message: "Pi session already exists" },
					});
					return;
				}
				if (sessions.size + opening.size >= MAX_SESSIONS) {
					emit({
						type: "request.failed",
						requestId: input.requestId,
						error: { message: "Pi session limit reached" },
					});
					return;
				}
				const controller = new AbortController();
				opening.set(input.sessionId, controller);
				try {
					const options = optionsFor({ providerOptions: input.config.providerOptions });
					const session = await PiSession.open(input, {
						emit,
						spawn: (args) => {
							const launch = launchFor(options);
							return Spawn(
								{
									command: launch.command,
									args: [...launch.args, ...args],
									cwd: input.config.cwd,
									env: { ...launch.env, ...(input.config.env ?? {}) },
								},
								deps.diagnostic,
							);
						},
						...(deps.settings.sessionDir || options.sessionDir
							? {
									sessionDir: resolveSessionDir({
										option: options.sessionDir ?? deps.settings.sessionDir,
										processEnv,
									}),
								}
							: {}),
						settings: {
							noExtensions: deps.settings.noExtensions || options.noExtensions,
							noSkills: deps.settings.noSkills || options.noSkills,
							noContextFiles: deps.settings.noContextFiles || options.noContextFiles,
							noMcp: deps.settings.noMcp || options.noMcp,
							reloadCommand: deps.settings.reloadCommand !== false,
							...(options.extraArgs ? { extraArgs: options.extraArgs } : {}),
						},
						diagnostic: deps.diagnostic,
					});
					if (closed || controller.signal.aborted) {
						await session.close();
						return;
					}
					sessions.set(input.sessionId, { session });
				} catch (error) {
					if (!closed && !controller.signal.aborted) {
						emit({
							type: "request.failed",
							requestId: input.requestId,
							error: { message: messageOf(error) },
						});
						emit({
							type: "session.closed",
							sessionId: input.sessionId,
							error: { message: messageOf(error) },
						});
					}
				} finally {
					if (opening.get(input.sessionId) === controller) opening.delete(input.sessionId);
				}
				return;
			}
			case "session.prompt": {
				const slot = sessions.get(input.sessionId);
				if (!slot) {
					emit({
						type: "session.prompt_result",
						sessionId: input.sessionId,
						clientMessageId: input.prompt.clientMessageId,
						result: { type: "failed", error: { message: "Unknown Pi session" } },
					});
					return;
				}
				await slot.session.prompt(input);
				return;
			}
			case "session.configure": {
				const slot = sessions.get(input.sessionId);
				if (!slot) {
					emit({
						type: "request.failed",
						requestId: input.requestId,
						error: { message: "Unknown Pi session" },
					});
					return;
				}
				await slot.session.configure(input);
				return;
			}
			case "session.interrupt": {
				const slot = sessions.get(input.sessionId);
				if (!slot) {
					emit({
						type: "request.failed",
						requestId: input.requestId,
						error: { message: "Unknown Pi session" },
					});
					return;
				}
				await slot.session.interrupt(input);
				return;
			}
			case "session.close": {
				const slot = sessions.get(input.sessionId);
				if (!slot) {
					const pending = opening.get(input.sessionId);
					if (pending) pending.abort();
					// Closing an already closed session is a no-op, not an error.
					emit({ type: "request.completed", requestId: input.requestId });
					return;
				}
				sessions.delete(input.sessionId);
				await slot.session.close();
				emit({ type: "request.completed", requestId: input.requestId });
				return;
			}
			default: {
				if ("requestId" in input && typeof input.requestId === "string") {
					emit({
						type: "request.failed",
						requestId: input.requestId,
						error: { message: `Pi does not support ${input.type}` },
					});
				}
			}
		}
	};

	return {
		version: 1,
		capabilities: negotiateProviderCapabilities(request.capabilities, [...PI_CAPABILITIES]),
		send: async (input) => {
			await dispatch(input);
		},
		onEvent: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		close: async () => {
			closed = true;
			for (const controller of opening.values()) controller.abort();
			opening.clear();
			const all = [...sessions.values()];
			sessions.clear();
			await Promise.allSettled(all.map((slot) => slot.session.close()));
		},
	};
}

function toThinkingOptions(levels: readonly string[]) {
	return levels.map((id) => ({
		id,
		label: id.charAt(0).toUpperCase() + id.slice(1),
	}));
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// Keep the parser exported for tests that pin persistence acceptance.
export { parsePersistence };
