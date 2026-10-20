import { mkdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { PiSettings } from "../shared/settings";
import type { PiProfileEntry } from "../shared/management";

const PROFILE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const MAX_PROFILE_AGENT_DIR = 4_096;

export function profileProviderId(name: string): string {
	return `pi-${name}`;
}

export function defaultProfileAgentDir(name: string): string {
	return join(homedir(), ".pi", "profiles", name, "agent");
}

export function validateProfileName(name: string): string {
	if (!PROFILE_NAME.test(name)) {
		throw new Error("Profile names use lowercase letters, numbers, and single hyphens");
	}
	return name;
}

export function resolveProfileAgentDir(name: string, requested?: string): string {
	const value = requested?.trim();
	if (!value) return defaultProfileAgentDir(name);
	if (!isAbsolute(value)) throw new Error("A profile's agent directory must be an absolute path");
	if (value.includes("\0")) throw new Error("A profile's agent directory contains an invalid character");
	return resolve(value);
}

export function assertProfileSlot(
	settings: Pick<PiSettings, "profiles">,
	name: string,
	agentDir: string,
	defaultAgentDir: string,
): void {
	if (settings.profiles.some((profile) => profile.name === name)) {
		throw new Error(`A profile named ${name} already exists`);
	}
	const wanted = resolve(agentDir);
	if (wanted === resolve(defaultAgentDir)) {
		throw new Error("That is the default pi agent directory. Use Manage on the default profile instead");
	}
	if (settings.profiles.some((profile) => resolve(profile.agentDir) === wanted)) {
		throw new Error("Another profile already uses that agent directory");
	}
}

export function profileEntry(name: string, agentDir: string): PiProfileEntry {
	return {
		name,
		providerId: profileProviderId(name),
		label: `Pi · ${name}`,
		agentDir,
	};
}

/** Paseo provider override: the built-in pi provider with a fixed agent directory. */
export function profileProviderOverride(name: string, agentDir: string): Record<string, unknown> {
	return {
		extends: "pi",
		label: `Pi · ${name}`,
		env: { PI_CODING_AGENT_DIR: agentDir },
	};
}

export function managedProfile(settings: PiSettings): PiProfileEntry | undefined {
	if (!settings.managedProfile) return undefined;
	const found = settings.profiles.find((profile) => profile.name === settings.managedProfile);
	return found ? profileEntry(found.name, found.agentDir) : undefined;
}

export async function prepareProfileAgentDir(agentDir: string): Promise<string> {
	if (Buffer.byteLength(agentDir, "utf8") > MAX_PROFILE_AGENT_DIR) {
		throw new Error("The profile agent directory is too long");
	}
	await mkdir(agentDir, { recursive: true, mode: 0o700 });
	const real = await realpath(agentDir);
	if (real !== resolve(agentDir)) {
		throw new Error("The profile agent directory resolves through a symlink");
	}
	return real;
}

/** Shape of the provider override Paseo stores for a named pi profile. */
function isOurProvider(value: unknown, agentDir: string): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const entry = value as Record<string, unknown>;
	const env = entry.env;
	return (
		entry.extends === "pi" &&
		!!env &&
		typeof env === "object" &&
		!Array.isArray(env) &&
		(env as Record<string, unknown>).PI_CODING_AGENT_DIR === agentDir
	);
}

export async function registerProfileProvider(
	paseo: import("./management").PaseoApiLike,
	name: string,
	agentDir: string,
): Promise<void> {
	if (!paseo.config) throw new Error("Paseo did not expose its config API");
	const providerId = profileProviderId(name);
	const current = await paseo.config.get();
	const existing = current.config.providers?.[providerId];
	if (existing !== undefined && !isOurProvider(existing, agentDir)) {
		throw new Error(
			`Paseo already has a provider named ${providerId}. Choose a different profile name.`,
		);
	}
	if (existing !== undefined) return;
	await paseo.config.patch({
		providers: { [providerId]: profileProviderOverride(name, agentDir) },
	});
}

export async function unregisterProfileProvider(
	paseo: import("./management").PaseoApiLike,
	name: string,
): Promise<void> {
	if (!paseo.config) throw new Error("Paseo did not expose its config API");
	const providerId = profileProviderId(name);
	const current = await paseo.config.get();
	if (current.config.providers?.[providerId] === undefined) return;
	await paseo.config.patch({ removeProviders: [providerId] });
}
