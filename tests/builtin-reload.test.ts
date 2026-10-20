import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	builtinReloadExtensionPath,
	ensureBuiltinReloadExtension,
} from "../server/builtin-reload";

const roots: string[] = [];

async function root(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "paseo-pi-builtin-reload-"));
	roots.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("built-in pi reload extension", () => {
	it("installs the generated extension and is idempotent", async () => {
		const agentDir = await root();
		expect(await ensureBuiltinReloadExtension(agentDir, true)).toBe(true);
		const path = builtinReloadExtensionPath(agentDir);
		const content = await readFile(path, "utf8");
		expect(content).toContain('pi.registerCommand("reload"');
		expect(await ensureBuiltinReloadExtension(agentDir, true)).toBe(false);
	});

	it("removes only its own generated file when disabled", async () => {
		const agentDir = await root();
		await ensureBuiltinReloadExtension(agentDir, true);
		const path = builtinReloadExtensionPath(agentDir);
		expect(await ensureBuiltinReloadExtension(agentDir, false)).toBe(true);
		await expect(readFile(path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("leaves a user file alone", async () => {
		const agentDir = await root();
		const path = builtinReloadExtensionPath(agentDir);
		await ensureBuiltinReloadExtension(agentDir, true);
		await writeFile(path, "export default function mine() {}\n", "utf8");
		expect(await ensureBuiltinReloadExtension(agentDir, false)).toBe(false);
		expect(await readFile(path, "utf8")).toContain("function mine");
		await expect(ensureBuiltinReloadExtension(agentDir, true)).rejects.toThrow("not generated");
	});
});
