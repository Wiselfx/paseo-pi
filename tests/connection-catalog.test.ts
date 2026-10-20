import { describe, expect, it } from "vitest";
import type { ProviderEvent } from "@getpaseo/plugin/server/provider";
import { createPiConnection, type PiConnectionDeps } from "../server/provider/connection";

function harness(exposeModels: boolean) {
	const calls: string[] = [];
	const models = [
		{ id: "fast", provider: "Zen", name: "Fast", reasoning: true, contextWindow: 100000 },
		{ id: "smart", provider: "Zen", name: "Smart" },
	];
	const deps: PiConnectionDeps = {
		settings: {
			command: "pi",
			args: [],
			inheritEnv: [],
			sessionDir: "/tmp/paseo-pi-test",
			noExtensions: false,
			noSkills: false,
			noContextFiles: false,
			noMcp: false,
			exposeModels,
		},
		processEnv: {},
		spawn: () =>
			({
				request: async (method: string) => {
					calls.push(method);
					if (method === "get_state") return { model: models[0] };
					if (method === "get_available_models") return { models };
					if (method === "get_available_thinking_levels") return { levels: ["off", "low", "high"] };
					throw new Error(`unexpected ${method}`);
				},
				close: async () => undefined,
			}) as never,
	};
	const events: ProviderEvent[] = [];
	const connection = createPiConnection(deps, { versions: [1], capabilities: [] });
	connection.onEvent((event) => events.push(event));
	return { connection, events, calls };
}

async function catalog(exposeModels: boolean) {
	const { connection, events, calls } = harness(exposeModels);
	await connection.send({ type: "catalog", requestId: "catalog" });
	const event = events.find((entry) => entry.type === "catalog");
	if (event?.type !== "catalog") throw new Error("no catalog event");
	await connection.close();
	return { catalog: event.catalog, calls };
}

describe("provider catalog and Paseo's built-in pi models", () => {
	it("advertises no models by default, avoiding a duplicate list", async () => {
		const { catalog: result, calls } = await catalog(false);
		expect(result.models).toEqual([]);
		expect(result.defaultModel).toBeUndefined();
		expect(result.thinkingOptions?.length ?? 0).toBeGreaterThan(0);
		expect(calls).not.toContain("get_available_models");
	});

	it("lists pi's models only when the owner opts in", async () => {
		const { catalog: result } = await catalog(true);
		expect(result.models.map((model) => model.id)).toEqual(["Zen/fast", "Zen/smart"]);
		expect(result.defaultModel).toBe("Zen/fast");
	});
});
