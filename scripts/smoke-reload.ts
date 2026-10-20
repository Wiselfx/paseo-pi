import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProviderInput } from "@getpaseo/plugin/server/provider";
import { createPiConnection, type PiConnectionDeps } from "../server/provider/connection";
import { PiRpc } from "../server/provider/rpc";
import { PI_CAPABILITIES } from "../server/provider/session";
import { fail, launchSettings, smokeDir } from "./pi-env";

/**
 * Proves the reload path without a model: the generated extension makes `/reload` a real RPC
 * command, and pi picks up a skill created after the session opened.
 */
const agentDir = join(smokeDir, "reload-agent");
await rm(agentDir, { recursive: true, force: true });
await mkdir(agentDir, { recursive: true });
process.env.PI_CODING_AGENT_DIR = agentDir;
process.env.PI_OFFLINE = "1";

// pi reports no models without a catalog, and session.open needs at least one. Nothing is called.
await writeFile(
	join(agentDir, "models.json"),
	JSON.stringify({
		providers: {
			probe: {
				name: "Probe",
				baseUrl: "http://127.0.0.1:9/v1",
				api: "openai-completions",
				apiKey: "probe",
				models: [{ id: "probe-model", name: "Probe model" }],
			},
		},
	}),
	{ mode: 0o600 },
);

const settings: PiConnectionDeps["settings"] = {
	...launchSettings,
	reloadCommand: true,
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(predicate: () => boolean, label: string, timeout = 60_000) {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeout) fail(`timeout waiting for ${label}`);
		await sleep(100);
	}
}

function connect(overrides: Partial<typeof settings> = {}) {
	return createPiConnection(
		{
			settings: { ...settings, ...overrides },
			processEnv: { ...process.env },
			spawn: (options) => new PiRpc(options),
		},
		{ versions: [1], capabilities: [...PI_CAPABILITIES] },
	);
}

const openInput = (sessionId: string) =>
	({
		type: "session.open",
		requestId: `open-${sessionId}`,
		sessionId,
		config: { cwd: "/tmp", env: {}, mcpServers: {}, settings: {}, persist: false },
		history: "skip",
	}) as const;

const reloadPrompt = (
	sessionId: string,
	clientMessageId: string,
): Extract<ProviderInput, { type: "session.prompt" }> => ({
	type: "session.prompt",
	sessionId,
	prompt: {
		clientMessageId,
		delivery: "auto",
		input: { type: "message", content: [{ type: "text", text: "/reload" }] },
	},
});

const conn = connect();
let ready = false;
let reloaded = false;
let completed = false;
let commands: string[] = [];
let failure: string | undefined;
conn.onEvent((event) => {
	if (event.type === "session.ready") ready = true;
	if (event.type === "session.commands") commands = event.commands.map((command) => command.name);
	if (event.type === "session.prompt_result" && event.clientMessageId === "reload")
		completed = event.result.type === "completed";
	if (event.type === "session.notice" && event.notice.title === "Reloaded pi resources") reloaded = true;
	if (event.type === "request.failed") failure = event.error.message;
});

const off = connect({ reloadCommand: false });
let offReady = false;
let offFailure: string | undefined;
off.onEvent((event) => {
	if (event.type === "session.ready") offReady = true;
	if (event.type === "session.prompt_result" && event.result.type === "failed")
		offFailure = event.result.error.message;
	if (event.type === "request.failed") offFailure = event.error.message;
});

try {
	await conn.send(openInput("reload"));
	await until(() => ready, "session.ready");
	if (!commands.includes("reload")) fail(`reload command missing from [${commands.join(", ")}]`);

	await mkdir(join(agentDir, "skills", "probe-skill"), { recursive: true });
	await writeFile(
		join(agentDir, "skills", "probe-skill", "SKILL.md"),
		"---\nname: probe-skill\ndescription: Reload smoke probe\n---\n\nProbe body.\n",
		{ mode: 0o600 },
	);

	await conn.send(reloadPrompt("reload", "reload"));
	await until(() => completed, "reload prompt completion");
	await until(() => reloaded, "reload notice");
	if (failure) fail(failure);
	if (!commands.includes("skill:probe-skill")) {
		fail(`reload did not register the new skill: [${commands.join(", ")}]`);
	}
	console.log(`OK reload: ${commands.length} commands, new skill loaded`);

	await off.send(openInput("no-reload"));
	await until(() => offReady, "no-reload session.ready");
	await off.send(reloadPrompt("no-reload", "off"));
	await until(() => offFailure !== undefined, "disabled reload answer");
	if (!/not available/.test(offFailure ?? "")) fail(`unexpected disabled answer: ${offFailure}`);
	console.log("OK reload disabled: the command is refused with a clear message");
} finally {
	await conn.close();
	await off.close();
	await rm(agentDir, { recursive: true, force: true });
}
