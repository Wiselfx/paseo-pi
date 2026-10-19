import { mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createPiConnection } from "../server/provider/connection";
import { PiRpc } from "../server/provider/rpc";
import { PI_CAPABILITIES } from "../server/provider/session";
import { fail, launchSettings, smokeDir } from "./pi-env";

await mkdir(smokeDir, { recursive: true });
const files = (await readdir(smokeDir)).filter((file) => file.endsWith(".jsonl")).sort();
const newest = files.at(-1);
if (!newest) fail(`no session files in ${smokeDir}; run smoke-session.ts first`);

const conn = createPiConnection(
	{ settings: launchSettings, spawn: (options) => new PiRpc(options) },
	{ versions: [1], capabilities: [...PI_CAPABILITIES] },
);

const replay: string[] = [];
const fresh: string[] = [];
let ready = false;
let turnDone = false;
conn.onEvent((event) => {
	if (event.type === "session.ready") ready = true;
	if (event.type === "timeline.item") {
		const text = event.item.type === "user_message" || event.item.type === "assistant_message"
			? `${event.item.type}:${event.item.text}`
			: undefined;
		if (text) (ready ? fresh : replay).push(text);
	}
	if (event.type === "session.turn" && event.state === "completed") turnDone = true;
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
		requestId: "resume",
		sessionId: "resumed",
		config: {
			cwd: "/tmp",
			env: {},
			mcpServers: {},
			settings: {},
			persist: true,
		},
		persistence: { version: 1, data: { sessionFile: join(smokeDir, newest) } },
		history: "replay",
	});
	await until(() => ready, "session.ready");
	if (!replay.some((item) => item.startsWith("user_message:"))) fail("replay had no user message");
	if (!replay.some((item) => item.startsWith("assistant_message:"))) fail("replay had no assistant message");
	console.log(`replay: ${JSON.stringify(replay)}`);

	await conn.send({
		type: "session.prompt",
		sessionId: "resumed",
		prompt: {
			clientMessageId: "m2",
			delivery: "auto",
			input: { type: "message", content: [{ type: "text", text: "Reply with the single word: again" }] },
		},
	});
	await until(() => turnDone, "resumed turn completion");
	if (!fresh.some((item) => item.startsWith("assistant_message:"))) fail("no assistant message after resume");
	console.log(`new: ${JSON.stringify(fresh)}`);
	console.log("OK resume: replay and continued prompt");
} finally {
	await conn.close();
}
