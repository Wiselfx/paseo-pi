import { describe, expect, it } from "vitest";
import { buildSessionArgs, resolveLaunch } from "../server/provider/options";

const settings = { command: "pi", args: [] as string[], inheritEnv: [] as string[] };

describe("resolveLaunch", () => {
	it("prefers paseo's launch over options and settings", () => {
		expect(
			resolveLaunch({
				launch: { command: "/opt/pi", args: ["--mode", "rpc"], env: { A: "launch" } },
				options: { command: "agent-pi", args: ["--x"], env: { A: "options", B: "options" } },
				settings: { ...settings, command: "settings-pi", env: { B: "settings", C: "settings" } },
				processEnv: {},
			}),
		).toEqual({ command: "/opt/pi", args: ["--mode", "rpc"], env: { A: "launch", B: "options", C: "settings" } });
	});

	it("inherits only named environment variables", () => {
		expect(
			resolveLaunch({
				options: { inheritEnv: ["ZEN_API_KEY", "ABSENT"] },
				settings,
				processEnv: { ZEN_API_KEY: "secret", OTHER: "ignored" },
			}).env,
		).toEqual({ ZEN_API_KEY: "secret" });
	});

	it("rejects an empty command", () => {
		expect(() =>
			resolveLaunch({ options: { command: "  " }, settings, processEnv: {} }),
		).toThrow(/empty/);
	});
});

describe("buildSessionArgs", () => {
	it("uses a fresh session by default and absolute resume paths", () => {
		expect(buildSessionArgs({ persist: true })).toEqual(["--mode", "rpc"]);
		expect(buildSessionArgs({ persist: false })).toEqual(["--mode", "rpc", "--no-session"]);
		expect(buildSessionArgs({ persist: true, sessionFile: "/tmp/a.jsonl" })).toEqual([
			"--mode",
			"rpc",
			"--session",
			"/tmp/a.jsonl",
		]);
		expect(() => buildSessionArgs({ persist: true, sessionFile: "a.jsonl" })).toThrow(/absolute/);
	});

	it("adds toggles, title, prompt, and extra args in order", () => {
		expect(
			buildSessionArgs({
				persist: true,
				sessionDir: "/tmp/sessions",
				title: "A title",
				systemPrompt: "  Be brief.  ",
				noExtensions: true,
				noMcp: true,
				extraArgs: ["--provider", "Zen"],
			}),
		).toEqual([
			"--mode",
			"rpc",
			"--session-dir",
			"/tmp/sessions",
			"--name",
			"A title",
			"--no-extensions",
			"--no-mcp",
			"--append-system-prompt",
			"Be brief.",
			"--provider",
			"Zen",
		]);
	});

	it("omits a blank system prompt", () => {
		expect(buildSessionArgs({ persist: true, systemPrompt: "   " })).toEqual(["--mode", "rpc"]);
	});
});
