import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type {
	ProviderRegistration,
	ProviderStatus,
	ProviderStatusRequest,
} from "@getpaseo/plugin/server/provider";
import {
	PI_PROVIDER_DESCRIPTION,
	PI_PROVIDER_ID,
	PI_PROVIDER_LABEL,
} from "../../shared/constants";
import { PI_SETTINGS_DEFAULTS, type PiSettings } from "../../shared/settings";
import { createPiConnection, type PiConnectionDeps } from "./connection";

const execFileAsync = promisify(execFile);
const STATUS_TTL_MS = 30_000;

export interface PiRegistrationDeps {
	getSettings?: () => Promise<PiSettings>;
	processEnv?: NodeJS.ProcessEnv;
	diagnostic?: (message: string) => void;
}

export function createPiProvider(deps: PiRegistrationDeps): ProviderRegistration {
	const processEnv = deps.processEnv ?? process.env;
	let cache: { key: string; expiresAt: number; status: ProviderStatus } | undefined;

	const settings = async (): Promise<PiSettings> => {
		try {
			return (await deps.getSettings?.()) ?? PI_SETTINGS_DEFAULTS;
		} catch {
			return PI_SETTINGS_DEFAULTS;
		}
	};

	const status = async (request: ProviderStatusRequest): Promise<ProviderStatus> => {
		const current = await settings();
		const command = request.launch?.command ?? current.command;
		const args = request.launch?.args ?? current.args;
		const key = JSON.stringify([command, args]);
		if (cache && cache.key === key && cache.expiresAt > Date.now()) return cache.status;
		let result: ProviderStatus;
		try {
			const { stdout } = await execFileAsync(command, [...args, "--version"], {
				timeout: 8_000,
				env: { ...processEnv },
				maxBuffer: 64 * 1024,
			});
			const version = stdout.trim().split("\n").at(-1) ?? "";
			result = {
				available: true,
				...(version ? { diagnostic: `pi ${version}` } : {}),
			};
		} catch (error) {
			const code = (error as { code?: string }).code;
			result =
				code === "ENOENT"
					? { available: false, diagnostic: `Pi executable not found: ${command}` }
					: {
							available: false,
							diagnostic: `Pi could not be started: ${error instanceof Error ? error.message : String(error)}`,
						};
		}
		cache = { key, expiresAt: Date.now() + STATUS_TTL_MS, status: result };
		return result;
	};

	return {
		id: PI_PROVIDER_ID,
		label: PI_PROVIDER_LABEL,
		description: PI_PROVIDER_DESCRIPTION,
		icon: "server/provider/pi.svg",
		command: [PI_SETTINGS_DEFAULTS.command],
		status,
		connect: async (request) => {
			const current = await settings();
			const connectionDeps: PiConnectionDeps = {
				...(request.launch ? { launch: request.launch } : {}),
				settings: current,
				processEnv,
				...(deps.diagnostic ? { diagnostic: deps.diagnostic } : {}),
			};
			return createPiConnection(connectionDeps, request);
		},
	};
}
