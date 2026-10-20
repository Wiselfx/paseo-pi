import { readProviderRecord } from "./management";

export type FetchedModel = {
	id: string;
	name?: string;
	reasoning?: boolean;
	input?: ("text" | "image")[];
	contextWindow?: number | null;
	maxTokens?: number | null;
};

const MAX_RESPONSE_BYTES = 2_000_000;

function resolveKey(value: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
	if (!value) return undefined;
	const match = value.match(/^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*))$/u);
	if (!match) return value;
	return env[match[1] ?? match[2] ?? ""] ?? undefined;
}

function endpoint(baseUrl: string, suffix: string): string {
	return `${baseUrl.replace(/\/+$/u, "")}${suffix}`;
}

function positive(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

function openAiModel(value: unknown): FetchedModel | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const model = value as Record<string, unknown>;
	const id = typeof model.id === "string" ? model.id.trim() : "";
	if (!id) return null;
	const architecture =
		model.architecture && typeof model.architecture === "object" && !Array.isArray(model.architecture)
			? (model.architecture as Record<string, unknown>)
			: {};
	const modalities = Array.isArray(architecture.input_modalities)
		? architecture.input_modalities.filter((item): item is string => typeof item === "string")
		: [];
	const topProvider =
		model.top_provider && typeof model.top_provider === "object" && !Array.isArray(model.top_provider)
			? (model.top_provider as Record<string, unknown>)
			: {};
	const parameters = Array.isArray(model.supported_parameters)
		? model.supported_parameters.filter((item): item is string => typeof item === "string")
		: [];
	const fetched: FetchedModel = { id };
	if (typeof model.name === "string" && model.name.trim()) fetched.name = model.name.trim();
	if (modalities.includes("image")) fetched.input = ["text", "image"];
	if (parameters.some((parameter) => parameter.startsWith("reasoning"))) fetched.reasoning = true;
	const context = positive(model.context_length ?? model.context_window ?? model.contextWindow);
	if (context) fetched.contextWindow = context;
	const completion = positive(topProvider.max_completion_tokens ?? model.max_tokens ?? model.maxTokens);
	if (completion) fetched.maxTokens = completion;
	return fetched;
}

function anthropicModel(value: unknown): FetchedModel | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const model = value as Record<string, unknown>;
	const id = typeof model.id === "string" ? model.id.trim() : "";
	if (!id) return null;
	const fetched: FetchedModel = { id };
	if (typeof model.display_name === "string" && model.display_name.trim()) {
		fetched.name = model.display_name.trim();
	}
	return fetched;
}

function googleModel(value: unknown): FetchedModel | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const model = value as Record<string, unknown>;
	const raw = typeof model.name === "string" ? model.name.trim() : "";
	if (!raw) return null;
	const id = raw.replace(/^models\//u, "");
	if (!id || id.startsWith("embedding") || id.includes("embedding")) return null;
	const fetched: FetchedModel = { id };
	if (typeof model.displayName === "string" && model.displayName.trim()) fetched.name = model.displayName.trim();
	const context = positive(model.inputTokenLimit);
	if (context) fetched.contextWindow = context;
	const output = positive(model.outputTokenLimit);
	if (output) fetched.maxTokens = output;
	return fetched;
}

function unique(models: FetchedModel[]): FetchedModel[] {
	const seen = new Set<string>();
	const output: FetchedModel[] = [];
	for (const model of models) {
		if (seen.has(model.id)) continue;
		seen.add(model.id);
		output.push(model);
	}
	return output.sort((left, right) => left.id.localeCompare(right.id));
}

/**
 * Ask a models.json provider which models it serves. The stored key never leaves the server; it
 * only travels to the provider's own base URL. Keys written as `$NAME` are read from the env.
 */
export async function fetchProviderModels(input: {
	agentDir: string;
	provider: string;
	env: NodeJS.ProcessEnv;
	fetch?: typeof fetch;
	signal?: AbortSignal;
}): Promise<{ baseUrl: string; api: string; models: FetchedModel[] }> {
	const record = await readProviderRecord(input.agentDir, input.provider);
	if (!record) throw new Error(`Provider ${input.provider} is not in models.json`);
	const baseUrl = record.baseUrl?.trim();
	if (!baseUrl) throw new Error(`Provider ${input.provider} has no base URL to fetch from`);
	if (!/^https?:\/\//iu.test(baseUrl)) throw new Error("The provider base URL must start with http:// or https://");
	const api = record.api?.trim() || "openai-completions";
	const key = resolveKey(record.apiKey, input.env);
	const headers: Record<string, string> = { accept: "application/json", ...record.headers };
	let url: string;
	if (api === "anthropic-messages") {
		if (key) headers["x-api-key"] = key;
		headers["anthropic-version"] ??= "2023-06-01";
		url = endpoint(baseUrl, "/models?limit=1000");
	} else if (api === "google-generative-ai") {
		url = endpoint(baseUrl, `/models?pageSize=1000${key ? `&key=${encodeURIComponent(key)}` : ""}`);
	} else if (api === "openai-completions" || api === "openai-responses") {
		if (key) headers.authorization = `Bearer ${key}`;
		url = endpoint(baseUrl, "/models");
	} else {
		throw new Error(`Fetching models is not supported for the ${api} API`);
	}

	const fetchImpl = input.fetch ?? fetch;
	let response: Response;
	try {
		response = await fetchImpl(url, {
			headers,
			redirect: "follow",
			signal: input.signal ?? AbortSignal.timeout(20_000),
		});
	} catch (error) {
		throw new Error(
			`Could not reach ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	if (response.status === 401 || response.status === 403) {
		throw new Error(`The provider rejected the stored API key (${response.status})`);
	}
	if (!response.ok) {
		throw new Error(`The provider answered ${response.status} ${response.statusText}`);
	}
	const text = await response.text();
	if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
		throw new Error("The provider's model list is too large");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		throw new Error("The provider did not return JSON; check the base URL and API type");
	}
	const document = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
	let models: FetchedModel[] = [];
	if (api === "google-generative-ai") {
		const data = Array.isArray(document.models) ? document.models : [];
		models = data.map(googleModel).filter((model): model is FetchedModel => model !== null);
	} else if (api === "anthropic-messages") {
		const data = Array.isArray(document.data) ? document.data : [];
		models = data.map(anthropicModel).filter((model): model is FetchedModel => model !== null);
	} else {
		const data = Array.isArray(document.data) ? document.data : [];
		models = data.map(openAiModel).filter((model): model is FetchedModel => model !== null);
	}
	return { baseUrl, api, models: unique(models) };
}
