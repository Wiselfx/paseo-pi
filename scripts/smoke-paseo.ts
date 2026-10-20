import { createPaseoClient } from "@getpaseo/client";
import { fail } from "./pi-env";

/**
 * End-to-end against a running daemon with this plugin installed.
 * PASEO_URL defaults to the throwaway dev instance; pass another URL or set PI_PROVIDER.
 */
const url = process.env.PASEO_URL ?? "ws://127.0.0.1:39085/ws";
const provider = process.env.PASEO_PI_PROVIDER ?? "pi";
const model = process.env.PI_SMOKE_MODEL ?? "Zen/deepseek-v4.1-flash-free";
const cwd = process.env.PI_SMOKE_CWD ?? "/tmp";

const client = createPaseoClient({ url, clientId: "paseo-pi-smoke" });
let agentId: string | undefined;
try {
	await client.connect();
	const available = await client.providers.listAvailable();
	const entry = available.providers.find((candidate) => candidate.provider === provider);
	if (!entry) fail(`provider ${provider} is not configured`);
	if (!entry.available) fail(`provider ${provider} is unavailable: ${entry.error ?? "no diagnostic"}`);

	const models = (await client.providers.listModels(provider as never, { cwd })).models ?? [];
	if (!models.some((candidate) => candidate.id === model)) {
		fail(`${provider} does not offer ${model}`);
	}
	console.log(`OK catalog: ${provider}, ${models.length} models`);

	const agent = await client.agents.create({
		cwd,
		title: "Paseo Pi smoke",
		config: { provider: `${provider}/${model}` },
		prompt: "Reply with the single word: ready",
	});
	agentId = agent.id;
	const result = await agent.waitForFinish(180_000);
	const timeline = await agent.timeline.refetch({ limit: 20 });
	const serialized = JSON.stringify(timeline);
	if (!serialized.includes("ready")) fail("assistant reply did not reach the timeline");
	if (serialized.toLowerCase().includes("request.failed")) fail("the plugin reported a failed request");
	console.log(`OK agent: ${agent.id} finished (${result.status}) with a visible reply`);

	if (provider === "pi" || provider === "pi-plugin") {
		const commands = await agent.commands();
		if (!commands.commands.some((command) => command.name === "reload")) {
			fail("the live session does not list the reload command");
		}
		await agent.send("/reload");
		const after = await agent.waitForFinish(30_000);
		if (after.status === "error") fail("reload finished with an error");
		const page = await agent.timeline.refetch({ limit: 20 });
		if (JSON.stringify(page).toLowerCase().includes("request.failed")) {
			fail("reload reported a failed request");
		}
		console.log("OK reload: command listed and accepted");
	}
} catch (error) {
	console.error(error);
	fail("Paseo smoke threw");
} finally {
	if (agentId) {
		try {
			await client.agents.ref(agentId).archive();
		} catch {
			// The smoke result is what matters; an archived leftover is not fatal.
		}
	}
	await client.close();
}
