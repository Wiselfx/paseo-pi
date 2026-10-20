import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import type { PiModelSummary, PiStatus } from "../shared/rpc";
import type { PiSettings } from "../shared/settings";
import { PiRpc } from "./provider/rpc";
import { buildSessionArgs } from "./provider/options";
import type { PiWireModel } from "./provider/models";
import { managedAgentDir } from "./paths";

const execFileAsync = promisify(execFile);
const TTL_MS = 20_000;

let cached: { key: string; expiresAt: number; value: PiStatus } | undefined;

export function piConfigDir(settings: PiSettings, env: NodeJS.ProcessEnv): string {
	return managedAgentDir(settings, env);
}

export function piSessionDir(settings: PiSettings, env: NodeJS.ProcessEnv): string {
	if (settings.sessionDir.trim()) return settings.sessionDir.trim();
	if (env.PI_CODING_AGENT_SESSION_DIR?.trim()) return env.PI_CODING_AGENT_SESSION_DIR.trim();
	return join(piConfigDir(settings, env), "sessions");
}

async function probeVersion(command: string, args: string[], env: NodeJS.ProcessEnv) {
	try {
		const { stdout } = await execFileAsync(command, [...args, "--version"], {
			timeout: 8_000,
			env,
			maxBuffer: 64 * 1024,
		});
		return { available: true as const, version: stdout.trim().split("\n").at(-1) ?? "" };
	} catch (error) {
		return {
			available: false as const,
			diagnostic:
				(error as { code?: string }).code === "ENOENT"
					? `Pi executable not found: ${command}`
					: `Pi could not be started: ${error instanceof Error ? error.message : String(error)}`,
		};
	}
}

async function probeModels(
	settings: PiSettings,
	env: NodeJS.ProcessEnv,
	cwd: string,
): Promise<{ models: PiModelSummary[]; diagnostic?: string }> {
	const args = [
		...settings.args,
		...buildSessionArgs({
			persist: false,
			...(settings.noContextFiles ? { noContextFiles: true } : {}),
			...(settings.noMcp ? { noMcp: true } : {}),
		}),
	];
	const inherited: Record<string, string> = {};
	for (const name of settings.inheritEnv) {
		const value = env[name];
		if (value !== undefined) inherited[name] = value;
	}
	const rpc = new PiRpc({ command: settings.command, args, cwd, env: inherited });
	try {
		const data = (await rpc.request("get_available_models")) as { models?: unknown[] };
		const models = (data?.models ?? []).filter(
			(model): model is PiWireModel =>
				!!model &&
				typeof model === "object" &&
				typeof (model as PiWireModel).id === "string" &&
				typeof (model as PiWireModel).provider === "string",
		);
		return {
			models: models.map((model) => ({
				id: `${model.provider}/${model.id}`,
				label: model.name?.trim() || model.id,
				provider: model.provider,
				reasoning: model.reasoning === true,
				...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
			})),
		};
	} catch (error) {
		return { models: [], diagnostic: error instanceof Error ? error.message : String(error) };
	} finally {
		await rpc.close().catch(() => undefined);
	}
}

async function fileStamp(path: string): Promise<string> {
	try {
		const info = await stat(path);
		return `${info.mtimeMs}:${info.size}`;
	} catch {
		return "missing";
	}
}

export async function piStatus(settings: PiSettings, env: NodeJS.ProcessEnv): Promise<PiStatus> {
	const configDir = piConfigDir(settings, env);
	const key = JSON.stringify([
		settings,
		configDir,
		piSessionDir(settings, env),
		await fileStamp(join(configDir, "settings.json")),
		await fileStamp(join(configDir, "models.json")),
	]);
	if (cached && cached.key === key && cached.expiresAt > Date.now()) return cached.value;
	const version = await probeVersion(settings.command, settings.args, env);
	let models: PiModelSummary[] = [];
	let modelDiagnostic: string | undefined;
	if (version.available) {
		const probed = await probeModels(settings, env, homedir());
		models = probed.models;
		modelDiagnostic = probed.diagnostic;
	}
	const diagnostic = "diagnostic" in version ? version.diagnostic : modelDiagnostic;
	const value: PiStatus = {
		command: settings.command,
		available: version.available,
		version: version.available ? version.version : null,
		diagnostic: diagnostic ?? null,
		sessionDir: piSessionDir(settings, env),
		modelCount: models.length,
		models,
		configDir,
	};
	cached = { key, expiresAt: Date.now() + TTL_MS, value };
	return value;
}

export function clearPiStatusCache(): void {
	cached = undefined;
}
