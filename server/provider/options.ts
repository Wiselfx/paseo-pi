import { isAbsolute } from "node:path";
import { z } from "zod";

/**
 * Provider options arrive per agent and are untrusted. Everything is optional: the plugin's
 * host settings supply the defaults, and Paseo's resolved launch wins over both.
 */
export const PiProviderOptionsSchema = z
	.object({
		command: z.string().min(1).max(4096).optional(),
		args: z.array(z.string().max(8192)).max(128).optional(),
		env: z.record(z.string().max(256), z.string().max(65536)).optional(),
		inheritEnv: z.array(z.string().min(1).max(256)).max(256).optional(),
		sessionDir: z.string().max(4096).optional(),
		noExtensions: z.boolean().optional(),
		noSkills: z.boolean().optional(),
		noContextFiles: z.boolean().optional(),
		noMcp: z.boolean().optional(),
		extraArgs: z.array(z.string().max(8192)).max(128).optional(),
	})
	.strip();

export type PiProviderOptions = z.infer<typeof PiProviderOptionsSchema>;

export interface PiLaunch {
	command: string;
	args: string[];
	env: Record<string, string>;
}

/**
 * Paseo's launch (already resolved for the agent) beats provider options, which beat host
 * settings. Environment values are additive: named values are copied on top of the daemon
 * environment for the child process.
 */
export function resolveLaunch(input: {
	launch?: { command: string; args?: readonly string[]; env?: Record<string, string> };
	options: PiProviderOptions;
	settings: {
		command: string;
		args: string[];
		inheritEnv: string[];
		env?: Record<string, string>;
	};
	processEnv: NodeJS.ProcessEnv;
}): PiLaunch {
	const command = input.launch?.command ?? input.options.command ?? input.settings.command;
	const args = [...(input.launch?.args ?? input.options.args ?? input.settings.args)];
	const env: Record<string, string> = {};
	for (const name of [...input.settings.inheritEnv, ...(input.options.inheritEnv ?? [])]) {
		const value = input.processEnv[name];
		if (value !== undefined) env[name] = value;
	}
	for (const [name, value] of Object.entries(input.settings.env ?? {})) env[name] = value;
	for (const [name, value] of Object.entries(input.options.env ?? {})) env[name] = value;
	for (const [name, value] of Object.entries(input.launch?.env ?? {})) env[name] = value;
	if (!command.trim()) throw new Error("Pi command is empty");
	return { command, args, env };
}

/** Args for one RPC session. Resume uses the persisted file, never a cwd-relative lookup. */
export function buildSessionArgs(input: {
	persist: boolean;
	sessionFile?: string;
	sessionDir?: string;
	systemPrompt?: string;
	title?: string;
	extensionPaths?: readonly string[];
	extraArgs?: readonly string[];
	noExtensions?: boolean;
	noSkills?: boolean;
	noContextFiles?: boolean;
	noMcp?: boolean;
}): string[] {
	const args = ["--mode", "rpc"];
	if (input.sessionFile) {
		if (!isAbsolute(input.sessionFile)) throw new Error("Pi session file must be absolute");
		args.push("--session", input.sessionFile);
	} else if (!input.persist) {
		args.push("--no-session");
	}
	if (input.sessionDir) args.push("--session-dir", input.sessionDir);
	if (input.title) args.push("--name", input.title.slice(0, 512));
	if (input.noExtensions) args.push("--no-extensions");
	if (input.noSkills) args.push("--no-skills");
	if (input.noContextFiles) args.push("--no-context-files");
	if (input.noMcp) args.push("--no-mcp");
	const prompt = input.systemPrompt?.trim();
	if (prompt) args.push("--append-system-prompt", prompt);
	// Explicit paths survive --no-extensions, which is what lets /reload exist at all.
	for (const path of input.extensionPaths ?? []) args.push("--extension", path);
	if (input.extraArgs?.length) args.push(...input.extraArgs);
	return args;
}
