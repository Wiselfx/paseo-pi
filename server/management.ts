import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import {
	PI_MODELS_SECRET_MASK,
	type PiExtensionEntry,
	type PiManagedSession,
	type PiModelEntry,
	type PiPromptKind,
	type PiProviderEntry,
	type PiSettingsRecord,
	type PiSkillEntry,
} from "../shared/management";
import type { PiSettings } from "../shared/settings";
import { PI_RELOAD_EXTENSION_FILE } from "../shared/constants";
import { listPiSessions } from "./sessions";
import { piAgentDir } from "./paths";
import { resolveLaunch } from "./provider/options";
import { looksLikePackageSource, normalizePackageInput } from "../shared/source";

const execFileAsync = promisify(execFile);
const MAX_SETTINGS_BYTES = 1_000_000;
const MAX_MODELS_BYTES = 2_000_000;
const MAX_SKILL_FILES = 400;
const BUILTIN_EXTENSIONS = ["mcp", "llama.cpp", "codemode", "tool-search"] as const;

/**
 * The small part of Paseo's client API used by the management RPCs.
 *
 * Kept structural on purpose: a type-only import from `@getpaseo/client` makes Paseo's plugin
 * installer look for that peer dependency in a fresh checkout, where it is not installed.
 */
export interface PaseoApiLike {
	agents: {
		list(input: {
			filter: { includeArchived: boolean; includeBackground: boolean };
		}): Promise<{ entries?: readonly unknown[] }>;
	};
}

export interface ManagementContext {
	agentDir: string;
	sessionDir: string;
	settings: PiSettings;
	env: NodeJS.ProcessEnv;
	/** Provided by the plugin host so deleting a session can remove its Paseo record too. */
	paseo?: PaseoApiLike;
}

export function buildManagementContext(input: {
	settings: PiSettings;
	sessionDir: string;
	env?: NodeJS.ProcessEnv;
	paseo?: PaseoApiLike;
}): ManagementContext {
	const env = input.env ?? process.env;
	return {
		agentDir: piAgentDir(env),
		sessionDir: input.sessionDir,
		settings: input.settings,
		env,
		...(input.paseo ? { paseo: input.paseo } : {}),
	};
}

function revisionOf(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

async function readText(path: string, limit: number): Promise<string | null> {
	try {
		const info = await stat(path);
		if (!info.isFile()) throw new Error(`${path} is not a file`);
		if (info.size > limit) throw new Error(`${path} is larger than ${limit} bytes`);
		return await readFile(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw error;
	}
}

async function atomicWrite(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`);
	try {
		await writeFile(temporary, content, { encoding: "utf8", mode: 0o600 });
		await rename(temporary, path);
	} catch (error) {
		await unlink(temporary).catch(() => undefined);
		throw error;
	}
}

function settingsPath(agentDir: string): string {
	return join(agentDir, "settings.json");
}

function modelsPath(agentDir: string): string {
	return join(agentDir, "models.json");
}

async function readJsonObject(
	path: string,
	limit: number,
): Promise<{ text: string; revision: string; value: Record<string, unknown> | null }> {
	const text = await readText(path, limit);
	if (text === null) return { text: "", revision: "missing", value: null };
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new Error(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`${path} must contain a JSON object`);
	}
	return { text, revision: revisionOf(text), value: parsed as Record<string, unknown> };
}

export async function readPiSettings(agentDir: string): Promise<{
	path: string;
	revision: string;
	settings: PiSettingsRecord;
}> {
	const path = settingsPath(agentDir);
	const read = await readJsonObject(path, MAX_SETTINGS_BYTES);
	return { path, revision: read.revision, settings: read.value ?? {} };
}

export async function savePiSettings(input: {
	agentDir: string;
	revision: string;
	settings: PiSettingsRecord;
}): Promise<{ revision: string }> {
	const path = settingsPath(input.agentDir);
	const current = await readJsonObject(path, MAX_SETTINGS_BYTES);
	if (current.revision !== input.revision) throw new Error("Settings changed on disk. Reload and try again.");
	const text = `${JSON.stringify(input.settings, null, 2)}\n`;
	if (Buffer.byteLength(text, "utf8") > MAX_SETTINGS_BYTES) {
		throw new Error(`settings.json would exceed ${MAX_SETTINGS_BYTES} bytes`);
	}
	await atomicWrite(path, text);
	return { revision: revisionOf(text) };
}

interface ProviderRecord {
	[key: string]: unknown;
}

function providerRecords(doc: Record<string, unknown>): Record<string, ProviderRecord> {
	const providers = doc.providers;
	if (providers === undefined) return Object.create(null) as Record<string, ProviderRecord>;
	if (!providers || typeof providers !== "object" || Array.isArray(providers)) {
		throw new Error("models.json providers must be an object");
	}
	const output = Object.create(null) as Record<string, ProviderRecord>;
	for (const [name, value] of Object.entries(providers)) {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new Error(`Model provider ${name} must be an object`);
		}
		output[name] = value as ProviderRecord;
	}
	return output;
}

function modelEntries(provider: ProviderRecord): PiModelEntry[] {
	const models = provider.models;
	if (!Array.isArray(models)) return [];
	const entries: PiModelEntry[] = [];
	for (const value of models) {
		if (!value || typeof value !== "object" || Array.isArray(value)) continue;
		const model = value as Record<string, unknown>;
		if (typeof model.id !== "string" || !model.id) continue;
		const input = Array.isArray(model.input)
			? model.input.filter((item): item is "text" | "image" => item === "text" || item === "image")
			: ["text" as const];
		entries.push({
			id: model.id,
			name: typeof model.name === "string" ? model.name : null,
			reasoning: model.reasoning === true,
			input,
			contextWindow: typeof model.contextWindow === "number" ? model.contextWindow : null,
			maxTokens: typeof model.maxTokens === "number" ? model.maxTokens : null,
		});
	}
	return entries;
}

function providersView(records: Record<string, ProviderRecord>): PiProviderEntry[] {
	return Object.entries(records)
		.map(([name, provider]) => ({
			name,
			label: typeof provider.name === "string" ? provider.name : null,
			baseUrl: typeof provider.baseUrl === "string" ? provider.baseUrl : null,
			api: typeof provider.api === "string" ? provider.api : null,
			apiKeySet: typeof provider.apiKey === "string" && provider.apiKey.length > 0,
			models: modelEntries(provider),
		}))
		.sort((left, right) => left.name.localeCompare(right.name));
}

const EMPTY_MODELS = `${JSON.stringify(
	{ $schema: "https://pi.dev/schemas/models.schema.json", providers: {} },
	null,
	2,
)}\n`;

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

const SECRET_NAME =
	/(?:^|[-_.])(?:api[-_]?key|access[-_]?token|refresh[-_]?token|token|secret|client[-_]?secret|password|passwd|authorization|cookie|credentials?)(?:$|[-_.])/i;

/** The editor is allowed to see and edit models.json without receiving credentials. */
function redactModelsSecrets(value: unknown, key?: string, parentKey?: string): unknown {
	// Provider names are keys too; do not mistake a provider called "token" for a secret field.
	if (key !== undefined && parentKey !== "providers" && SECRET_NAME.test(key)) {
		return PI_MODELS_SECRET_MASK;
	}
	if (Array.isArray(value)) return value.map((entry) => redactModelsSecrets(entry));
	if (isRecord(value)) {
		const output = Object.create(null) as Record<string, unknown>;
		for (const [name, entry] of Object.entries(value)) {
			output[name] = redactModelsSecrets(entry, name, key);
		}
		return output;
	}
	return value;
}

/** Put current secrets back wherever the raw editor still contains the mask. */
function restoreModelsSecrets(value: unknown, current: unknown): unknown {
	if (value === PI_MODELS_SECRET_MASK) return current;
	if (Array.isArray(value)) {
		const existing = Array.isArray(current) ? current : [];
		return value
			.map((entry, index) => restoreModelsSecrets(entry, existing[index]))
			.filter((entry) => entry !== undefined);
	}
	if (isRecord(value)) {
		const existing = isRecord(current) ? current : {};
		const output = Object.create(null) as Record<string, unknown>;
		for (const [name, entry] of Object.entries(value)) {
			const restored = restoreModelsSecrets(entry, existing[name]);
			if (restored !== undefined) output[name] = restored;
		}
		return output;
	}
	return value;
}

/** Raw provider record for requests that need the stored key, which is never sent to clients. */
export async function readProviderRecord(
	agentDir: string,
	name: string,
): Promise<{ baseUrl?: string; api?: string; apiKey?: string; headers?: Record<string, string> } | null> {
	const read = await readJsonObject(modelsPath(agentDir), MAX_MODELS_BYTES);
	const providers = providerRecords(read.value ?? { providers: {} });
	const provider = providers[name];
	if (!provider) return null;
	const headers: Record<string, string> = {};
	if (provider.headers && typeof provider.headers === "object" && !Array.isArray(provider.headers)) {
		for (const [key, value] of Object.entries(provider.headers)) {
			if (typeof value === "string") headers[key] = value;
		}
	}
	return {
		...(typeof provider.baseUrl === "string" ? { baseUrl: provider.baseUrl } : {}),
		...(typeof provider.api === "string" ? { api: provider.api } : {}),
		...(typeof provider.apiKey === "string" ? { apiKey: provider.apiKey } : {}),
		...(Object.keys(headers).length ? { headers } : {}),
	};
}

export async function readPiModels(agentDir: string): Promise<{
	path: string;
	revision: string;
	providers: PiProviderEntry[];
	raw: string;
}> {
	const path = modelsPath(agentDir);
	const read = await readJsonObject(path, MAX_MODELS_BYTES);
	const doc = read.value ?? { providers: {} };
	const providers = providersView(providerRecords(doc));
	return {
		path,
		revision: read.revision,
		providers,
		raw: read.value
			? `${JSON.stringify(redactModelsSecrets(read.value), null, 2)}\n`
			: EMPTY_MODELS,
	};
}

async function mutateModels(
	agentDir: string,
	revision: string,
	mutator: (doc: Record<string, unknown>, providers: Record<string, ProviderRecord>) => void,
): Promise<{ revision: string }> {
	const path = modelsPath(agentDir);
	const read = await readJsonObject(path, MAX_MODELS_BYTES);
	if (read.revision !== revision) throw new Error("models.json changed on disk. Reload and try again.");
	const doc = read.value ?? {
		$schema: "https://pi.dev/schemas/models.schema.json",
		providers: {},
	};
	const providers = providerRecords(doc);
	if (!doc.providers || typeof doc.providers !== "object" || Array.isArray(doc.providers)) {
		doc.providers = providers;
	}
	mutator(doc, providers);
	doc.providers = providers;
	const text = `${JSON.stringify(doc, null, 2)}\n`;
	if (Buffer.byteLength(text, "utf8") > MAX_MODELS_BYTES) throw new Error("models.json would become too large");
	await atomicWrite(path, text);
	return { revision: revisionOf(text) };
}

export async function saveProvider(input: {
	agentDir: string;
	revision: string;
	originalName?: string;
	provider: {
		name: string;
		label?: string;
		baseUrl?: string;
		api?: string;
		apiKey?: string;
	};
}): Promise<{ revision: string }> {
	return mutateModels(input.agentDir, input.revision, (_doc, providers) => {
		const original = input.originalName ?? input.provider.name;
		if (input.originalName) {
			if (!Object.hasOwn(providers, input.originalName)) {
				throw new Error(`Provider ${input.originalName} no longer exists`);
			}
		} else if (Object.hasOwn(providers, input.provider.name)) {
			throw new Error(`Provider ${input.provider.name} already exists`);
		}
		const existing = providers[original] ?? {};
		if (original !== input.provider.name) {
			if (providers[input.provider.name]) throw new Error(`Provider ${input.provider.name} already exists`);
			delete providers[original];
		}
		const next: ProviderRecord = { ...existing };
		const setOrDelete = (key: string, value: string | undefined) => {
			if (value === undefined) return;
			const trimmed = value.trim();
			if (trimmed === "") delete next[key];
			else next[key] = trimmed;
		};
		setOrDelete("name", input.provider.label);
		setOrDelete("baseUrl", input.provider.baseUrl);
		setOrDelete("api", input.provider.api);
		if (input.provider.apiKey !== undefined) {
			if (input.provider.apiKey === "") delete next.apiKey;
			else next.apiKey = input.provider.apiKey;
		}
		providers[input.provider.name] = next;
	});
}

export async function deleteProvider(input: {
	agentDir: string;
	revision: string;
	name: string;
}): Promise<{ revision: string }> {
	return mutateModels(input.agentDir, input.revision, (_doc, providers) => {
		if (!Object.hasOwn(providers, input.name)) throw new Error(`Provider ${input.name} is not in models.json`);
		delete providers[input.name];
	});
}

export async function addModels(input: {
	agentDir: string;
	revision: string;
	provider: string;
	models: {
		id: string;
		name?: string;
		reasoning?: boolean;
		input?: ("text" | "image")[];
		contextWindow?: number | null;
		maxTokens?: number | null;
	}[];
}): Promise<{ revision: string; added: number; skipped: number }> {
	let added = 0;
	let skipped = 0;
	const result = await mutateModels(input.agentDir, input.revision, (_doc, providers) => {
		const provider = providers[input.provider];
		if (!provider) throw new Error(`Provider ${input.provider} is not in models.json`);
		const models = Array.isArray(provider.models) ? [...provider.models] : [];
		const existing = new Set(
			models
				.filter((value): value is Record<string, unknown> => !!value && typeof value === "object")
				.map((value) => value.id)
				.filter((id): id is string => typeof id === "string"),
		);
		for (const model of input.models) {
			const id = model.id.trim();
			if (!id || existing.has(id)) {
				skipped += 1;
				continue;
			}
			existing.add(id);
			models.push({
				id,
				...(model.name ? { name: model.name } : {}),
				...(model.reasoning ? { reasoning: true } : {}),
				...(model.input?.length ? { input: model.input } : {}),
				...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
				...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
			});
			added += 1;
		}
		provider.models = models;
	});
	return { revision: result.revision, added, skipped };
}

export async function saveModel(input: {
	agentDir: string;
	revision: string;
	provider: string;
	originalId?: string;
	model: {
		id: string;
		name?: string;
		reasoning?: boolean;
		input?: Array<"text" | "image">;
		contextWindow?: number | null;
		maxTokens?: number | null;
	};
}): Promise<{ revision: string }> {
	return mutateModels(input.agentDir, input.revision, (_doc, providers) => {
		const provider = Object.hasOwn(providers, input.provider) ? providers[input.provider] : undefined;
		if (!provider) throw new Error(`Provider ${input.provider} is not in models.json`);
		const models = Array.isArray(provider.models) ? [...provider.models] : [];
		const originalId = input.originalId ?? input.model.id;
		const index = models.findIndex(
			(entry) => !!entry && typeof entry === "object" && (entry as { id?: unknown }).id === originalId,
		);
		if (index < 0 && originalId !== input.model.id) {
			throw new Error(`Model ${originalId} is not in provider ${input.provider}`);
		}
		if (
			index < 0 &&
			models.some((entry) => !!entry && typeof entry === "object" && (entry as { id?: unknown }).id === input.model.id)
		) {
			throw new Error(`Model ${input.model.id} already exists in provider ${input.provider}`);
		}
		if (
			index >= 0 &&
			input.model.id !== originalId &&
			models.some(
				(entry, position) =>
					position !== index &&
					!!entry &&
					typeof entry === "object" &&
					(entry as { id?: unknown }).id === input.model.id,
			)
		) {
			throw new Error(`Model ${input.model.id} already exists in provider ${input.provider}`);
		}
		const existing =
			index >= 0 && models[index] && typeof models[index] === "object"
				? { ...(models[index] as Record<string, unknown>) }
				: {};
		existing.id = input.model.id;
		if (input.model.name !== undefined) {
			if (input.model.name.trim()) existing.name = input.model.name.trim();
			else delete existing.name;
		}
		if (input.model.reasoning !== undefined) existing.reasoning = input.model.reasoning;
		if (input.model.input !== undefined) existing.input = input.model.input;
		if (input.model.contextWindow === null) delete existing.contextWindow;
		else if (input.model.contextWindow !== undefined) existing.contextWindow = input.model.contextWindow;
		if (input.model.maxTokens === null) delete existing.maxTokens;
		else if (input.model.maxTokens !== undefined) existing.maxTokens = input.model.maxTokens;
		if (index >= 0) models[index] = existing;
		else models.push(existing);
		provider.models = models;
	});
}

export async function deleteModel(input: {
	agentDir: string;
	revision: string;
	provider: string;
	id: string;
}): Promise<{ revision: string }> {
	return mutateModels(input.agentDir, input.revision, (_doc, providers) => {
		const provider = Object.hasOwn(providers, input.provider) ? providers[input.provider] : undefined;
		if (!provider) throw new Error(`Provider ${input.provider} is not in models.json`);
		const models = Array.isArray(provider.models) ? provider.models : [];
		const next = models.filter(
			(entry) => !(!!entry && typeof entry === "object" && (entry as { id?: unknown }).id === input.id),
		);
		if (next.length === models.length) throw new Error(`Model ${input.id} is not in provider ${input.provider}`);
		provider.models = next;
	});
}

export async function saveModelsJson(input: {
	agentDir: string;
	revision: string;
	json: string;
}): Promise<{ revision: string }> {
	const path = modelsPath(input.agentDir);
	const current = await readJsonObject(path, MAX_MODELS_BYTES);
	if (current.revision !== input.revision) throw new Error("models.json changed on disk. Reload and try again.");
	let parsed: unknown;
	try {
		parsed = JSON.parse(input.json);
	} catch (error) {
		throw new Error(`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("models.json must contain a JSON object");
	}
	providerRecords(parsed as Record<string, unknown>);
	const restored = restoreModelsSecrets(parsed, current.value ?? {});
	if (!isRecord(restored)) throw new Error("models.json must contain a JSON object");
	providerRecords(restored);
	const text = `${JSON.stringify(restored, null, 2)}\n`;
	if (Buffer.byteLength(text, "utf8") > MAX_MODELS_BYTES) throw new Error("models.json would become too large");
	await atomicWrite(path, text);
	return { revision: revisionOf(text) };
}

interface PackageEntry {
	source: string;
	filtered: boolean;
}

function packageEntries(settings: PiSettingsRecord): PackageEntry[] {
	const packages = settings.packages;
	if (!Array.isArray(packages)) return [];
	const output: PackageEntry[] = [];
	for (const entry of packages) {
		if (typeof entry === "string" && entry.trim()) {
			const source = entry.trim();
			if (source.startsWith("-") || source.startsWith("!")) continue;
			output.push({ source, filtered: false });
			continue;
		}
		if (entry && typeof entry === "object" && !Array.isArray(entry)) {
			const source = (entry as { source?: unknown }).source;
			if (typeof source !== "string" || !source.trim()) continue;
			const filters = Object.entries(entry as Record<string, unknown>).some(
				([key, value]) => key !== "source" && Array.isArray(value) && value.length > 0,
			);
			output.push({ source: source.trim(), filtered: filters });
		}
	}
	return output;
}

function npmPackageName(source: string): string | null {
	if (!source.startsWith("npm:")) return null;
	const spec = source.slice(4);
	const versionAt = spec.lastIndexOf("@");
	return versionAt > 0 ? spec.slice(0, versionAt) : spec;
}

function packageDirectory(source: string, agentDir: string): string | null {
	const npmName = npmPackageName(source);
	if (npmName) return join(agentDir, "npm", "node_modules", npmName);
	if (source.startsWith("git:") || source.startsWith("http://") || source.startsWith("https://")) return null;
	if (source.startsWith("~/")) return join(homedir(), source.slice(2));
	if (isAbsolute(source)) return source;
	if (source.startsWith(".")) return resolve(agentDir, source);
	return null;
}

async function readPackageMeta(
	directory: string | null,
): Promise<{ name?: string; version?: string; pi?: Record<string, unknown> } | null> {
	if (!directory) return null;
	const text = await readText(join(directory, "package.json"), 2_000_000);
	if (!text) return null;
	try {
		const parsed = JSON.parse(text) as Record<string, unknown>;
		return {
			...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
			...(typeof parsed.version === "string" ? { version: parsed.version } : {}),
			...(parsed.pi && typeof parsed.pi === "object" && !Array.isArray(parsed.pi)
				? { pi: parsed.pi as Record<string, unknown> }
				: {}),
		};
	} catch {
		return null;
	}
}

function extensionPath(path: string, agentDir: string): string {
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	if (isAbsolute(path)) return path;
	return resolve(agentDir, path);
}

async function discoveredExtensions(agentDir: string): Promise<PiExtensionEntry[]> {
	const root = join(agentDir, "extensions");
	let entries;
	try {
		entries = await readdir(root, { withFileTypes: true });
	} catch {
		return [];
	}
	const output: PiExtensionEntry[] = [];
	const push = (file: string, label: string) => {
		const managed = basename(file) === PI_RELOAD_EXTENSION_FILE;
		output.push({
			id: `ext-file:${file}`,
			kind: "extension",
			label: managed ? "paseo-pi reload" : label,
			source: file,
			version: null,
			path: file,
			enabled: true,
			removable: false,
			note: managed
				? "Installed by paseo-pi so /reload works in built-in pi sessions"
				: "Discovered in the agent extensions directory",
		});
	};
	for (const entry of entries) {
		if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
		if (entry.isDirectory()) {
			// Mirrors pi's discovery: pi.extensions paths first, then index.ts, then index.js.
			const directory = join(root, entry.name);
			const manifest = await readText(join(directory, "package.json"), 1_000_000);
			let declared: string[] = [];
			if (manifest) {
				try {
					const parsed = JSON.parse(manifest) as { pi?: { extensions?: unknown } };
					if (Array.isArray(parsed.pi?.extensions)) {
						declared = parsed.pi.extensions.filter(
							(value): value is string => typeof value === "string" && value.trim().length > 0,
						);
					}
				} catch {
					// A broken manifest is pi's diagnostic to report, not the list's.
				}
			}
			const files: string[] = [];
			for (const value of declared) {
				const file = resolve(directory, value);
				try {
					if ((await stat(file)).isFile()) files.push(file);
				} catch {
					// Missing declared entries are skipped, like pi.
				}
			}
			if (files.length === 0) {
				for (const name of ["index.ts", "index.js"]) {
					const file = join(directory, name);
					try {
						if ((await stat(file)).isFile()) {
							files.push(file);
							break;
						}
					} catch {
						// Try the next candidate.
					}
				}
			}
			for (const file of files) {
				push(file, files.length === 1 ? entry.name : `${entry.name}/${basename(file)}`);
			}
			continue;
		}
		if (!entry.isFile() || !/\.(?:ts|js)$/u.test(entry.name)) continue;
		push(join(root, entry.name), entry.name);
	}
	return output;
}

interface SkillRoot {
	path: string;
	source: PiSkillEntry["source"];
	removable: boolean;
}

function configuredSkillRoots(settings: PiSettingsRecord, agentDir: string): SkillRoot[] {
	const roots: SkillRoot[] = [];
	const configured = settings.skills;
	if (!Array.isArray(configured)) return roots;
	for (const value of configured) {
		if (typeof value !== "string" || !value.trim()) continue;
		const entry = value.trim();
		if (entry.startsWith("-") || entry.startsWith("!")) continue;
		const clean = entry.startsWith("+") ? entry.slice(1) : entry;
		if (clean.includes("*") || clean.includes("?")) continue;
		roots.push({ path: extensionPath(clean, agentDir), source: "config", removable: false });
	}
	return roots;
}

async function collectSkillFile(
	file: string,
	source: PiSkillEntry["source"],
	removable: boolean,
	output: PiSkillEntry[],
): Promise<void> {
	const text = await readText(file, 1_000_000).catch(() => null);
	if (text === null) return;
	const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/u)?.[1] ?? "";
	const fields = new Map<string, string>();
	const lines = frontmatter.split(/\r?\n/u);
	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index] ?? "";
		const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/u);
		if (!match?.[1]) continue;
		const key = match[1];
		const raw = match[2] ?? "";
		if (raw === "|" || raw === ">" || raw === "|-" || raw === ">-") {
			const collected: string[] = [];
			let next = index + 1;
			while (next < lines.length && (/^\s+/u.test(lines[next] ?? "") || (lines[next] ?? "").trim() === "")) {
				collected.push((lines[next] ?? "").trim());
				next += 1;
			}
			fields.set(key, collected.join(raw.startsWith(">") ? " " : "\n").trim());
			index = next - 1;
			continue;
		}
		fields.set(
			key,
			raw.replace(/^"(.*)"$/u, "$1").replace(/^'(.*)'$/u, "$1").trim(),
		);
	}
	const name = fields.get("name") || basename(dirname(file));
	const description = fields.get("description") ?? "";
	output.push({ name, description, path: file, source, enabled: true, removable });
}

async function scanSkillRoot(root: SkillRoot, output: PiSkillEntry[]): Promise<void> {
	let info;
	try {
		info = await lstat(root.path);
	} catch {
		return;
	}
	if (info.isFile()) {
		if (basename(root.path) === "SKILL.md") {
			await collectSkillFile(root.path, root.source, root.removable, output);
		}
		return;
	}
	if (!info.isDirectory()) return;
	const visit = async (directory: string, depth: number): Promise<void> => {
		if (output.length >= MAX_SKILL_FILES || depth > 6) return;
		let entries;
		try {
			entries = await readdir(directory, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (output.length >= MAX_SKILL_FILES) return;
			if (entry.name === "node_modules" || entry.name === ".git") continue;
			const path = join(directory, entry.name);
			if (entry.isFile() && entry.name === "SKILL.md") {
				await collectSkillFile(path, root.source, root.removable, output);
				continue;
			}
			if (entry.isDirectory() && !entry.isSymbolicLink()) await visit(path, depth + 1);
		}
	};
	await visit(root.path, 0);
}

async function packageSkillRoots(
	settings: PiSettingsRecord,
	agentDir: string,
): Promise<SkillRoot[]> {
	const roots: SkillRoot[] = [];
	for (const entry of packageEntries(settings)) {
		const directory = packageDirectory(entry.source, agentDir);
		if (!directory) continue;
		const meta = await readPackageMeta(directory);
		if (!meta) continue;
		roots.push({ path: join(directory, "skills"), source: "package", removable: false });
		const manifestSkills = meta.pi?.skills;
		if (Array.isArray(manifestSkills)) {
			for (const value of manifestSkills) {
				if (typeof value !== "string" || value.includes("*") || value.includes("?")) continue;
				roots.push({ path: resolve(directory, value), source: "package", removable: false });
			}
		}
	}
	return roots;
}

/**
 * Exact override entries (`-path`, `!path`, `+path`) are how pi turns one discovered extension or
 * skill off and on. Globs stay pi's job: matching them here would need its full pattern rules.
 */
function markerPaths(value: string, agentDir: string): string[] | null {
	const first = value[0];
	if (first !== "-" && first !== "!" && first !== "+") return null;
	const raw = value.slice(1).trim();
	if (!raw || raw.startsWith("builtin:") || raw.includes("*") || raw.includes("?")) return null;
	const candidates = [raw, extensionPath(raw, agentDir), join(homedir(), ".agents", raw)];
	return [...new Set(candidates.map((candidate) => resolve(candidate)))];
}

function markerIsEnabled(
	entries: readonly unknown[],
	agentDir: string,
	targets: readonly string[],
): boolean {
	const wanted = new Set(targets.map((target) => resolve(target)));
	const matched = entries.filter((entry): entry is string => {
		if (typeof entry !== "string") return false;
		const paths = markerPaths(entry.trim(), agentDir);
		return !!paths && paths.some((path) => wanted.has(path));
	});
	let enabled = true;
	if (matched.some((entry) => entry.trim().startsWith("!"))) enabled = false;
	if (matched.some((entry) => entry.trim().startsWith("+"))) enabled = true;
	if (matched.some((entry) => entry.trim().startsWith("-"))) enabled = false;
	return enabled;
}

/** Remove only the exact markers for one target; plain registration entries stay untouched. */
function withoutToggleMarkers(
	entries: readonly unknown[],
	agentDir: string,
	targets: readonly string[],
	prefixes: readonly string[],
): unknown[] {
	const wanted = new Set(targets.map((target) => resolve(target)));
	return entries.filter((entry) => {
		if (typeof entry !== "string") return true;
		const value = entry.trim();
		if (!prefixes.includes(value[0] ?? "")) return true;
		const paths = markerPaths(value, agentDir);
		return !paths || !paths.some((path) => wanted.has(path));
	});
}

function togglePath(value: string): string {
	const trimmed = value.trim();
	if (!trimmed || trimmed.startsWith("-") || trimmed.startsWith("!") || trimmed.startsWith("+")) {
		throw new Error("Choose an extension or skill from the list");
	}
	if (/[\u0000-\u001f\u007f]/u.test(trimmed)) throw new Error("That path contains control characters");
	return trimmed;
}

export async function listPiResources(context: ManagementContext): Promise<{
	agentDir: string;
	extensions: PiExtensionEntry[];
	skills: PiSkillEntry[];
}> {
	const { agentDir } = context;
	const settings = (await readPiSettings(agentDir)).settings;
	const extensions: PiExtensionEntry[] = [];
	for (const builtin of BUILTIN_EXTENSIONS) {
		extensions.push({
			id: `builtin:${builtin}`,
			kind: "builtin",
			label: builtin,
			source: `builtin:${builtin}`,
			version: null,
			path: null,
			enabled: true,
			removable: false,
		});
	}
	for (const entry of packageEntries(settings)) {
		const directory = packageDirectory(entry.source, agentDir);
		const meta = await readPackageMeta(directory);
		extensions.push({
			id: `package:${entry.source}`,
			kind: "package",
			label: meta?.name ?? entry.source,
			source: entry.source,
			version: meta?.version ?? null,
			path: directory,
			enabled: true,
			removable: true,
			...(entry.filtered ? { note: "Resource filters are set" } : {}),
		});
	}
	const configured = Array.isArray(settings.extensions) ? settings.extensions : [];
	for (const value of configured) {
		if (typeof value !== "string" || !value.trim()) continue;
		const path = value.trim();
		const builtinMatch = path.match(/^[+-]?builtin:(.+)$/u);
		if (builtinMatch?.[1]) {
			const entry = extensions.find((candidate) => candidate.kind === "builtin" && candidate.label === builtinMatch[1]);
			if (entry && path.startsWith("-")) entry.enabled = false;
			if (entry && path.startsWith("+")) entry.enabled = true;
			continue;
		}
		if (path.startsWith("-") || path.startsWith("!")) continue;
		const clean = path.startsWith("+") ? path.slice(1) : path;
		const resolved = extensionPath(clean, agentDir);
		if (extensions.some((entry) => entry.path && resolve(entry.path) === resolve(resolved))) continue;
		extensions.push({
			id: `extension:${clean}`,
			kind: "extension",
			label: basename(clean),
			source: clean,
			version: null,
			path: resolved,
			enabled: markerIsEnabled(configured, agentDir, [resolved]),
			removable: true,
		});
	}
	for (const discovered of await discoveredExtensions(agentDir)) {
		if (extensions.some((entry) => entry.path && resolve(entry.path) === resolve(discovered.path ?? ""))) continue;
		extensions.push({
			...discovered,
			enabled: markerIsEnabled(configured, agentDir, discovered.path ? [discovered.path] : []),
		});
	}

	const skills: PiSkillEntry[] = [];
	const seen = new Set<string>();
	const roots: SkillRoot[] = [
		{ path: join(agentDir, "skills"), source: "user", removable: true },
		{ path: join(homedir(), ".agents", "skills"), source: "agents", removable: true },
		...configuredSkillRoots(settings, agentDir),
		...(await packageSkillRoots(settings, agentDir)),
	];
	for (const root of roots) {
		const found: PiSkillEntry[] = [];
		await scanSkillRoot(root, found);
		for (const skill of found) {
			if (seen.has(skill.name)) continue;
			seen.add(skill.name);
			skills.push(skill);
		}
	}
	const skillSettings = Array.isArray(settings.skills) ? settings.skills : [];
	for (const skill of skills) {
		if (skill.source === "package") continue;
		skill.enabled = markerIsEnabled(skillSettings, agentDir, [skill.path, dirname(skill.path)]);
	}
	skills.sort((left, right) => left.name.localeCompare(right.name));
	return { agentDir, extensions, skills };
}

function validatePackageSource(source: string): string {
	const trimmed = normalizePackageInput(source);
	if (!trimmed || trimmed.startsWith("-") || /[\u0000-\u001f\u007f]/u.test(trimmed)) {
		throw new Error("Enter a package source such as npm:pi-tools, git:github.com/user/repo, or ./local-package");
	}
	if (
		!trimmed.startsWith("npm:") &&
		!trimmed.startsWith("git:") &&
		!trimmed.startsWith("http://") &&
		!trimmed.startsWith("https://") &&
		!trimmed.startsWith("ssh://") &&
		!trimmed.startsWith("./") &&
		!trimmed.startsWith("../") &&
		!trimmed.startsWith("~/") &&
		!isAbsolute(trimmed)
	) {
		throw new Error("Package sources need an npm:, git:, http(s):, absolute, or relative prefix");
	}
	return trimmed;
}

async function runPi(context: ManagementContext, args: string[]): Promise<string> {
	const launch = resolveLaunch({
		options: {},
		settings: context.settings,
		processEnv: context.env,
	});
	const env: NodeJS.ProcessEnv = {
		...context.env,
		...launch.env,
		PI_CODING_AGENT_DIR: context.agentDir,
	};
	try {
		await mkdir(context.agentDir, { recursive: true });
		const { stdout, stderr } = await execFileAsync(launch.command, [...launch.args, ...args], {
			timeout: 180_000,
			maxBuffer: 4 * 1024 * 1024,
			env,
			cwd: context.agentDir,
		});
		return [stdout.trim(), stderr.trim()].filter(Boolean).join("\n").trim();
	} catch (error) {
		const failure = error as { stdout?: string; stderr?: string; message?: string };
		const detail = [failure.stderr?.trim(), failure.stdout?.trim()].filter(Boolean).join("\n");
		throw new Error(detail || failure.message || "pi command failed");
	}
}

export async function installPiPackage(context: ManagementContext, source: string): Promise<string> {
	return runPi(context, ["install", validatePackageSource(source)]);
}

export async function removePiPackage(context: ManagementContext, source: string): Promise<string> {
	return runPi(context, ["remove", validatePackageSource(source)]);
}

export async function updatePiPackages(context: ManagementContext, source?: string): Promise<string> {
	return runPi(
		context,
		source ? ["update", validatePackageSource(source)] : ["update", "--extensions"],
	);
}

export async function createPiSkill(
	context: ManagementContext,
	input: { name: string; description: string; instructions: string },
): Promise<{ path: string }> {
	if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(input.name)) {
		throw new Error("Skill names use lowercase letters, numbers, and single hyphens");
	}
	const skillRoot = join(context.agentDir, "skills");
	await mkdir(skillRoot, { recursive: true });
	const agentRoot = await realpath(context.agentDir);
	const realRoot = await realpath(skillRoot);
	if (!inside(agentRoot, realRoot)) {
		throw new Error("The agent skills directory resolves outside the agent directory");
	}
	const directory = join(realRoot, input.name);
	try {
		await lstat(directory);
		throw new Error(`Skill ${input.name} already exists`);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	await mkdir(directory, { recursive: false });
	const description = JSON.stringify(input.description.trim());
	const body = input.instructions.trim() || `# ${input.name}\n`;
	const text = `---\nname: ${input.name}\ndescription: ${description}\n---\n\n${body}\n`;
	const path = join(directory, "SKILL.md");
	await writeFile(path, text, { encoding: "utf8", mode: 0o600 });
	return { path };
}

async function allowedSkillRoots(agentDir: string): Promise<string[]> {
	const roots: string[] = [];
	for (const candidate of [join(agentDir, "skills"), join(homedir(), ".agents", "skills")]) {
		try {
			roots.push(await realpath(candidate));
		} catch {
			// An absent root cannot contain a deletable skill.
		}
	}
	return roots;
}

export async function deletePiSkill(context: ManagementContext, input: { path: string }): Promise<string> {
	const requested = extensionPath(input.path, context.agentDir);
	if (basename(requested) !== "SKILL.md") throw new Error("Only a skill's SKILL.md can be removed");
	const file = await realpath(requested);
	const directory = dirname(file);
	const requestedDirectory = await realpath(dirname(requested));
	if (requestedDirectory !== directory) {
		throw new Error("The skill file is a symlink; remove it from its real directory");
	}
	const roots = await allowedSkillRoots(context.agentDir);
	const allowed = roots.some((root) => inside(root, directory));
	if (!allowed) throw new Error("That skill is outside the user skill directories. Remove its package instead.");
	await rm(directory, { recursive: true, force: false });
	return file;
}

export async function setPiSkillEnabled(input: {
	agentDir: string;
	path: string;
	enabled: boolean;
}): Promise<{ path: string; enabled: boolean }> {
	const value = togglePath(input.path);
	const target = resolve(extensionPath(value, input.agentDir));
	const current = await readPiSettings(input.agentDir);
	const entries = Array.isArray(current.settings.skills) ? [...current.settings.skills] : [];
	let next = withoutToggleMarkers(
		entries,
		input.agentDir,
		[target, dirname(target)],
		input.enabled ? ["-", "!"] : ["+", "-"],
	);
	if (!input.enabled) next.push(`-${target}`);
	await savePiSettings({
		agentDir: input.agentDir,
		revision: current.revision,
		settings: { ...current.settings, skills: next },
	});
	return { path: target, enabled: input.enabled };
}

export async function readPrompt(
	context: ManagementContext,
	kind: PiPromptKind,
): Promise<{ kind: PiPromptKind; path: string; revision: string; content: string; exists: boolean }> {
	const path = join(context.agentDir, kind === "system" ? "SYSTEM.md" : "APPEND_SYSTEM.md");
	const content = await readText(path, 2_000_000);
	return {
		kind,
		path,
		revision: content === null ? "missing" : revisionOf(content),
		content: content ?? "",
		exists: content !== null,
	};
}

export async function writePrompt(input: {
	context: ManagementContext;
	kind: PiPromptKind;
	revision: string;
	content: string;
}): Promise<{ revision: string; exists: boolean }> {
	const current = await readPrompt(input.context, input.kind);
	if (current.revision !== input.revision) throw new Error("The prompt changed on disk. Reload and try again.");
	if (input.content === "") {
		await unlink(current.path).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== "ENOENT") throw error;
		});
		return { revision: "missing", exists: false };
	}
	await atomicWrite(current.path, input.content);
	return { revision: revisionOf(input.content), exists: true };
}

export async function listManagedSessions(
	context: ManagementContext,
	input: { cwd?: string; query?: string; limit?: number },
): Promise<{ sessionDir: string; sessions: PiManagedSession[] }> {
	const sessions = await listPiSessions({
		sessionDir: context.sessionDir,
		...(input.cwd ? { cwd: input.cwd } : {}),
		...(input.query ? { query: input.query } : {}),
		...(input.limit ? { limit: input.limit } : {}),
	});
	return {
		sessionDir: context.sessionDir,
		sessions: sessions.map((session) => {
			const data = session.persistence?.data as { sessionFile?: unknown; sessionId?: unknown } | undefined;
			return {
				sessionFile: typeof data?.sessionFile === "string" ? data.sessionFile : "",
				sessionId: typeof data?.sessionId === "string" ? data.sessionId : "",
				title: session.title ?? null,
				cwd: session.cwd,
				updatedAt: session.updatedAt ?? new Date(0).toISOString(),
			};
		}),
	};
}

type PaseoAgentLike = {
	id: string;
	persistence?: {
		metadata?: { pluginProviderPersistence?: { data?: { sessionFile?: unknown } } };
	};
};

/** Paseo stores the pi session path inside a plugin-provider persistence wrapper. */
export function paseoAgentIdsForSession(agents: PaseoAgentLike[], sessionFile: string): string[] {
	const wanted = resolve(sessionFile);
	const ids: string[] = [];
	for (const agent of agents) {
		const stored = agent.persistence?.metadata?.pluginProviderPersistence?.data?.sessionFile;
		if (typeof stored === "string" && resolve(stored) === wanted) ids.push(agent.id);
	}
	return ids;
}

function resolvePaseoCli(): { command: string; prefix: string[] } {
	const override = process.env.PASEO_CLI?.trim();
	if (override) return { command: override, prefix: [] };
	try {
		const requireFromDaemon = createRequire(process.argv[1] ?? import.meta.url);
		const entry = requireFromDaemon.resolve("@getpaseo/cli/dist/index.js");
		return { command: process.execPath, prefix: [entry] };
	} catch {
		return { command: "paseo", prefix: [] };
	}
}

async function deletePaseoAgent(agentId: string): Promise<void> {
	const { command, prefix } = resolvePaseoCli();
	const args = [
		...prefix,
		"delete",
		agentId,
		"--json",
		...(process.env.PASEO_HOME ? ["--home", process.env.PASEO_HOME] : []),
	];
	try {
		await execFileAsync(command, args, {
			env: process.env,
			timeout: 30_000,
			maxBuffer: 1024 * 1024,
		});
	} catch (error) {
		const detail =
			error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string"
				? error.stderr.trim()
				: error instanceof Error
					? error.message
					: String(error);
		throw new Error(`Paseo could not delete agent ${agentId}: ${detail}`);
	}
}

export async function deleteManagedSession(
	context: ManagementContext,
	input: { sessionFile: string },
): Promise<{ sessionFile: string; deletedAgents: number }> {
	if (!isAbsolute(input.sessionFile) || !input.sessionFile.endsWith(".jsonl")) {
		throw new Error("Not a pi session file");
	}
	const root = await realpath(context.sessionDir).catch(() => {
		throw new Error(`Session directory does not exist: ${context.sessionDir}`);
	});
	const file = await realpath(input.sessionFile).catch(() => {
		throw new Error("Session file does not exist");
	});
	if (!file.endsWith(".jsonl") || !(await stat(file)).isFile() || !inside(root, file)) {
		throw new Error("Session file is outside the configured session directory");
	}
	let agents: PaseoAgentLike[] = [];
	if (context.paseo) {
		const result = await context.paseo.agents.list({
			filter: { includeArchived: true, includeBackground: true },
		});
		agents = (result.entries ?? [])
			.map((entry) => (entry as unknown as { agent?: PaseoAgentLike }).agent)
			.filter((agent): agent is PaseoAgentLike => !!agent && typeof agent.id === "string");
	}
	const ids = paseoAgentIdsForSession(agents, file);
	for (const id of ids) await deletePaseoAgent(id);
	await unlink(file);
	return { sessionFile: input.sessionFile, deletedAgents: ids.length };
}

function inside(root: string, file: string): boolean {
	const rel = relative(root, file);
	return rel !== "" && rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function extensionSettingEntries(settings: PiSettingsRecord): unknown[] {
	return Array.isArray(settings.extensions) ? [...settings.extensions] : [];
}

function isExtensionString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

export async function addPiExtension(input: {
	agentDir: string;
	path: string;
}): Promise<{ path: string }> {
	const value = normalizePackageInput(input.path);
	if (looksLikePackageSource(value)) {
		throw new Error("That is a package source. Use Install package instead of an extension path.");
	}
	if (
		!value ||
		value.startsWith("-") ||
		value.startsWith("!") ||
		/^\+?builtin:/u.test(value) ||
		/[\u0000-\u001f\u007f]/u.test(value)
	) {
		throw new Error("Enter an extension file or directory path, not a built-in extension");
	}
	const current = await readPiSettings(input.agentDir);
	const entries = extensionSettingEntries(current.settings);
	if (entries.some((entry) => isExtensionString(entry) && (entry === value || entry === `+${value}`))) {
		return { path: value };
	}
	// A stale "-path"/"!path" entry would keep the extension disabled, so drop it on add.
	const next = entries.filter(
		(entry) => !isExtensionString(entry) || (entry !== `-${value}` && entry !== `!${value}`),
	);
	next.push(value);
	await savePiSettings({
		agentDir: input.agentDir,
		revision: current.revision,
		settings: { ...current.settings, extensions: next },
	});
	return { path: value };
}

export async function removePiExtension(input: {
	agentDir: string;
	path: string;
}): Promise<{ path: string }> {
	const value = input.path.trim();
	const current = await readPiSettings(input.agentDir);
	const entries = extensionSettingEntries(current.settings);
	const next = entries.filter(
		(entry) =>
			!isExtensionString(entry) ||
			(entry !== value && entry !== `+${value}` && entry !== `-${value}` && entry !== `!${value}`),
	);
	if (next.length === entries.length) throw new Error(`${value} is not an extension setting`);
	await savePiSettings({
		agentDir: input.agentDir,
		revision: current.revision,
		settings: { ...current.settings, extensions: next },
	});
	return { path: value };
}

export async function setPiExtensionEnabled(input: {
	agentDir: string;
	path: string;
	enabled: boolean;
}): Promise<{ path: string; enabled: boolean }> {
	const value = togglePath(input.path);
	const target = extensionPath(value, input.agentDir);
	const current = await readPiSettings(input.agentDir);
	const entries = extensionSettingEntries(current.settings);
	const forced = entries.some(
		(entry) => isExtensionString(entry) && entry.trim() === `+${value}`,
	);
	let next = withoutToggleMarkers(
		entries,
		input.agentDir,
		[target],
		input.enabled ? ["-", "!"] : ["+", "-"],
	);
	if (!input.enabled) {
		// A "+path" was the registration itself; keep it as a plain entry so enabling works later.
		if (
			forced &&
			!next.some((entry) => isExtensionString(entry) && (entry.trim() === value || entry.trim() === `+${value}`))
		) {
			next.push(value);
		}
		next.push(`-${value}`);
	}
	await savePiSettings({
		agentDir: input.agentDir,
		revision: current.revision,
		settings: { ...current.settings, extensions: next },
	});
	return { path: value, enabled: input.enabled };
}

export async function setBuiltinExtension(input: {
	agentDir: string;
	name: string;
	enabled: boolean;
}): Promise<{ enabled: boolean }> {
	const current = await readPiSettings(input.agentDir);
	const entries = extensionSettingEntries(current.settings);
	const next = entries.filter(
		(entry) =>
			!isExtensionString(entry) ||
			(entry !== `+builtin:${input.name}` && entry !== `-builtin:${input.name}`),
	);
	if (!input.enabled) next.push(`-builtin:${input.name}`);
	await savePiSettings({
		agentDir: input.agentDir,
		revision: current.revision,
		settings: { ...current.settings, extensions: next },
	});
	return { enabled: input.enabled };
}
