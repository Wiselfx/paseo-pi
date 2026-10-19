import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * The smoke scripts run against the pi on PATH by default. Point PI_COMMAND/PI_ARGS at another
 * build, and PI_SMOKE_DIR at a writable session directory.
 */
export const piCommand = process.env.PI_COMMAND?.trim() || "pi";
export const piArgs = (process.env.PI_ARGS ?? "")
	.split(/\s+/)
	.map((value) => value.trim())
	.filter(Boolean);
export const smokeDir = process.env.PI_SMOKE_DIR?.trim() || join(tmpdir(), "paseo-pi-smoke");

export const launchSettings = {
	command: piCommand,
	args: piArgs,
	inheritEnv: [] as string[],
	sessionDir: smokeDir,
	noExtensions: true,
	noSkills: true,
	noContextFiles: true,
	noMcp: true,
};

export function fail(message: string): never {
	console.error(`FAIL: ${message}`);
	process.exit(1);
}
