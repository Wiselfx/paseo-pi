import { mkdtemp, mkdir, writeFile, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	defaultSessionDir,
	listPiSessions,
	parsePersistence,
	resolveSessionDir,
} from "../server/sessions";

const root = join(tmpdir(), "paseo-pi-sessions-test");
const projectA = join(root, "--tmp-a--");
const projectB = join(root, "--tmp-b--");

function sessionFile(id: string, cwd: string, lines: object[]): string {
	return [
		JSON.stringify({ type: "session", version: 3, id, timestamp: new Date().toISOString(), cwd }),
		...lines.map((line) => JSON.stringify(line)),
		"",
	].join("\n");
}

beforeAll(async () => {
	await mkdir(projectA, { recursive: true });
	await mkdir(projectB, { recursive: true });
	await writeFile(
		join(projectA, "2026-01-01_a.jsonl"),
		sessionFile("a", "/tmp/a", [
			{ type: "session_info", name: "Named session" },
			{ type: "message", message: { role: "user", content: "hello" } },
		]),
	);
	await writeFile(
		join(projectA, "2026-01-02_b.jsonl"),
		sessionFile("b", "/tmp/a", [
			{ type: "message", message: { role: "user", content: [{ type: "text", text: "find me" }] } },
		]),
	);
	await writeFile(
		join(projectB, "2026-01-03_c.jsonl"),
		sessionFile("c", "/tmp/b", []),
	);
	await writeFile(join(projectA, "ignore.txt"), "not a session");
	const now = Date.now() / 1000;
	await utimes(join(projectB, "2026-01-03_c.jsonl"), now, now - 60);
	await utimes(join(projectA, "2026-01-02_b.jsonl"), now, now - 120);
	await utimes(join(projectA, "2026-01-01_a.jsonl"), now, now - 180);
});

afterAll(async () => {
	const { rm } = await import("node:fs/promises");
	await rm(root, { recursive: true, force: true });
});

function sessionId(session: { persistence: { data: unknown } }): string | undefined {
	const data = session.persistence.data;
	return data && typeof data === "object" && !Array.isArray(data)
		? (data as { sessionId?: string }).sessionId
		: undefined;
}

describe("session listing", () => {
	it("lists newest first and derives titles", async () => {
		const sessions = await listPiSessions({ sessionDir: root });
		expect(sessions.map(sessionId)).toEqual(["c", "b", "a"]);
		expect(sessions.find((session) => sessionId(session) === "a")?.title).toBe(
			"Named session",
		);
		expect(sessions.find((session) => sessionId(session) === "b")?.title).toBe(
			"find me",
		);
	});

	it("filters by cwd and query", async () => {
		await expect(listPiSessions({ sessionDir: root, cwd: "/tmp/b" })).resolves.toHaveLength(1);
		await expect(listPiSessions({ sessionDir: root, query: "NAMED" })).resolves.toHaveLength(1);
		await expect(listPiSessions({ sessionDir: root, query: "nothing" })).resolves.toHaveLength(0);
	});

	it("honours the limit and tolerates a missing directory", async () => {
		await expect(listPiSessions({ sessionDir: root, limit: 1 })).resolves.toHaveLength(1);
		await expect(listPiSessions({ sessionDir: join(root, "absent") })).resolves.toEqual([]);
	});
});

describe("persistence", () => {
	it("accepts version 1 with an absolute file and optional id", () => {
		expect(parsePersistence({ version: 1, data: { sessionFile: "/x.jsonl", sessionId: "id" } })).toEqual({
			sessionFile: "/x.jsonl",
			sessionId: "id",
		});
	});

	it("rejects other versions, relative paths, and malformed payloads", () => {
		expect(parsePersistence({ version: 2, data: { sessionFile: "/x" } })).toBeUndefined();
		expect(parsePersistence({ version: 1, data: { sessionFile: "x" } })).toBeUndefined();
		expect(parsePersistence({ version: 1, data: [] })).toBeUndefined();
		expect(parsePersistence(null)).toBeUndefined();
	});
});

describe("session directories", () => {
	it("uses the option, then env, then pi's default", () => {
		expect(defaultSessionDir()).toMatch(/\.pi\/agent\/sessions$/);
		expect(
			resolveSessionDir({ option: "/opt", env: { PI_CODING_AGENT_SESSION_DIR: "/env" } }),
		).toBe("/opt");
		expect(resolveSessionDir({ env: { PI_CODING_AGENT_SESSION_DIR: "/env" } })).toBe("/env");
		expect(resolveSessionDir({ processEnv: { PI_CODING_AGENT_SESSION_DIR: "/proc" } })).toBe("/proc");
		expect(defaultSessionDir({ PI_CODING_AGENT_DIR: "/custom/agent" })).toBe(
			"/custom/agent/sessions",
		);
		expect(resolveSessionDir({ processEnv: { PI_CODING_AGENT_DIR: "/custom/agent" } })).toBe(
			"/custom/agent/sessions",
		);
		expect(resolveSessionDir({ processEnv: { PI_CONFIG_DIR: "/legacy" } })).toBe(
			"/legacy/sessions",
		);
	});
});
