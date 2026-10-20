import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fetchProviderModels } from "../server/model-source";

async function agentDirWith(providers: Record<string, unknown>): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "paseo-pi-models-"));
	await writeFile(join(dir, "models.json"), JSON.stringify({ providers }), "utf8");
	return dir;
}

function recordingFetch(reply: { status?: number; body: string; contentType?: string }) {
	const calls: { url: string; headers: Record<string, string> }[] = [];
	const impl = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		const headers: Record<string, string> = {};
		for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
			headers[key.toLowerCase()] = value;
		}
		calls.push({ url, headers });
		return new Response(reply.body, {
			status: reply.status ?? 200,
			headers: { "content-type": reply.contentType ?? "application/json" },
		});
	}) as typeof fetch;
	return { calls, impl };
}

describe("fetchProviderModels", () => {
	it("asks an OpenAI-compatible provider with the stored key and maps its models", async () => {
		const agentDir = await agentDirWith({
			Acme: {
				baseUrl: "https://api.acme.test/v1/",
				api: "openai-completions",
				apiKey: "$ACME_KEY",
			},
		});
		const { calls, impl } = recordingFetch({
			body: JSON.stringify({
				data: [
					{
						id: "acme-large",
						name: "Acme Large",
						context_length: 200000,
						architecture: { input_modalities: ["text", "image"] },
						supported_parameters: ["reasoning_effort"],
						top_provider: { max_completion_tokens: 32000 },
					},
					{ id: "acme-small" },
					{ name: "no id" },
				],
			}),
		});
		const result = await fetchProviderModels({
			agentDir,
			provider: "Acme",
			env: { ACME_KEY: "secret-key" },
			fetch: impl,
		});
		expect(calls).toEqual([
			{ url: "https://api.acme.test/v1/models", headers: expect.objectContaining({ authorization: "Bearer secret-key" }) },
		]);
		expect(result.models).toEqual([
			{
				id: "acme-large",
				name: "Acme Large",
				input: ["text", "image"],
				reasoning: true,
				contextWindow: 200000,
				maxTokens: 32000,
			},
			{ id: "acme-small" },
		]);
	});

	it("uses the Anthropic headers", async () => {
		const agentDir = await agentDirWith({
			Claude: { baseUrl: "https://api.anthropic.test/v1", api: "anthropic-messages", apiKey: "key" },
		});
		const { calls, impl } = recordingFetch({
			body: JSON.stringify({ data: [{ id: "claude-x", display_name: "Claude X" }] }),
		});
		const result = await fetchProviderModels({ agentDir, provider: "Claude", env: {}, fetch: impl });
		expect(calls[0]?.url).toBe("https://api.anthropic.test/v1/models?limit=1000");
		expect(calls[0]?.headers["x-api-key"]).toBe("key");
		expect(calls[0]?.headers["anthropic-version"]).toBe("2023-06-01");
		expect(result.models).toEqual([{ id: "claude-x", name: "Claude X" }]);
	});

	it("passes a Google key in the query and skips embeddings", async () => {
		const agentDir = await agentDirWith({
			Google: {
				baseUrl: "https://generativelanguage.test/v1beta",
				api: "google-generative-ai",
				apiKey: "g-key",
			},
		});
		const { calls, impl } = recordingFetch({
			body: JSON.stringify({
				models: [
					{ name: "models/gemini-pro", displayName: "Gemini Pro", inputTokenLimit: 1000000, outputTokenLimit: 8192 },
					{ name: "models/text-embedding-004" },
				],
			}),
		});
		const result = await fetchProviderModels({ agentDir, provider: "Google", env: {}, fetch: impl });
		expect(calls[0]?.url).toBe("https://generativelanguage.test/v1beta/models?pageSize=1000&key=g-key");
		expect(result.models).toEqual([
			{
				id: "gemini-pro",
				name: "Gemini Pro",
				contextWindow: 1000000,
				maxTokens: 8192,
			},
		]);
	});

	it("reports a rejected key and a non-JSON answer", async () => {
		const agentDir = await agentDirWith({
			Acme: { baseUrl: "https://api.acme.test", apiKey: "bad" },
		});
		await expect(
			fetchProviderModels({
				agentDir,
				provider: "Acme",
				env: {},
				fetch: recordingFetch({ status: 401, body: "{}" }).impl,
			}),
		).rejects.toThrow(/rejected the stored API key/u);
		await expect(
			fetchProviderModels({
				agentDir,
				provider: "Acme",
				env: {},
				fetch: recordingFetch({ body: "<html>" }).impl,
			}),
		).rejects.toThrow(/did not return JSON/u);
	});

	it("explains a missing provider or base URL", async () => {
		const agentDir = await agentDirWith({ Acme: { api: "openai-completions" } });
		await expect(
			fetchProviderModels({ agentDir, provider: "Acme", env: {}, fetch: recordingFetch({ body: "{}" }).impl }),
		).rejects.toThrow(/no base URL/u);
		await expect(
			fetchProviderModels({ agentDir, provider: "Missing", env: {}, fetch: recordingFetch({ body: "{}" }).impl }),
		).rejects.toThrow(/not in models\.json/u);
	});
});
