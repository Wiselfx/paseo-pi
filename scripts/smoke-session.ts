import { mkdir } from "node:fs/promises";
import { createPiConnection } from "../server/provider/connection";
import { PiRpc } from "../server/provider/rpc";
import { PI_CAPABILITIES } from "../server/provider/session";
import { fail, launchSettings, smokeDir } from "./pi-env";

await mkdir(smokeDir, { recursive: true });

const conn = createPiConnection(
	{
		settings: launchSettings,
		processEnv: { ...process.env },
		spawn: (options) => new PiRpc(options),
	},
	{ versions: [1], capabilities: [...PI_CAPABILITIES] },
);

let persistence: unknown;
let sawAssistant = false;
let turnDone = false;
conn.onEvent((event) => {
	if (event.type === "session.opened") persistence = event.persistence;
	if (event.type === "timeline.item" && event.item.type === "assistant_message") {
		console.log(`assistant: ${event.item.text}`);
		sawAssistant = event.item.text.trim().length > 0;
	}
	if (event.type === "session.turn" && event.state === "completed") turnDone = true;
	if (event.type === "session.closed" && event.error) fail(event.error.message);
	if (event.type === "request.failed") fail(event.error.message);
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate: () => boolean, label: string, timeout = 120_000) {
	const start = Date.now();
	while (!predicate()) {
		if (Date.now() - start > timeout) fail(`timeout waiting for ${label}`);
		await sleep(100);
	}
}

try {
	await conn.send({
		type: "session.open",
		requestId: "open",
		sessionId: "smoke",
		config: {
			cwd: "/tmp",
			env: {},
			mcpServers: {},
			settings: {},
			model: process.env.PI_SMOKE_MODEL ?? "Zen/deepseek-v4.1-flash-free",
			persist: true,
			title: "Paseo Pi smoke",
		},
		history: "skip",
	});
	await until(() => persistence !== undefined, "session.open");
	console.log(`session: ${JSON.stringify(persistence)}`);
	await conn.send({
		type: "session.prompt",
		sessionId: "smoke",
		prompt: {
			clientMessageId: "m1",
			delivery: "auto",
			input: { type: "message", content: [{ type: "text", text: "Reply with the single word: ready" }] },
		},
	});
	await until(() => turnDone, "turn completion");
	if (!sawAssistant) fail("no assistant message arrived");
	console.log("OK session: prompt, stream, and persistence");
} finally {
	await conn.close();
}
