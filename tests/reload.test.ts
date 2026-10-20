import { stat, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
	RELOAD_COMMAND_EXTENSION,
	isReloadCommand,
	reloadCommandExtensionPath,
} from "../server/provider/reload-extension";

describe("reload command extension", () => {
	it("writes a private extension that runs pi's own reload", async () => {
		const path = await reloadCommandExtensionPath();
		expect(path.endsWith(".mjs")).toBe(true);
		const source = await readFile(path, "utf8");
		expect(source).toBe(RELOAD_COMMAND_EXTENSION);
		expect(source).toContain('pi.registerCommand("reload"');
		expect(source).toContain("await ctx.reload()");
		const mode = (await stat(path)).mode & 0o777;
		expect(mode).toBe(0o600);
	});

	it("reuses the same path for the life of the process", async () => {
		expect(await reloadCommandExtensionPath()).toBe(await reloadCommandExtensionPath());
	});

	it("recognizes only the bare command", () => {
		expect(isReloadCommand("/reload")).toBe(true);
		expect(isReloadCommand("  /reload\n")).toBe(true);
		expect(isReloadCommand("/reload now")).toBe(false);
		expect(isReloadCommand("/reloader")).toBe(false);
		expect(isReloadCommand("please /reload")).toBe(false);
	});
});
