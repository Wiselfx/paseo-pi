import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Pi's agent directory. PI_CODING_AGENT_DIR is the documented variable; PI_CONFIG_DIR is kept
 * for configurations written by earlier versions of this plugin.
 */
export function piAgentDir(env: NodeJS.ProcessEnv): string {
	return (
		env.PI_CODING_AGENT_DIR?.trim() ||
		env.PI_CONFIG_DIR?.trim() ||
		join(homedir(), ".pi", "agent")
	);
}

/**
 * The agent directory the management panel is currently editing. Named profiles are plain pi
 * agent directories, selected by the host-scoped `managedProfile` launch setting.
 */
export function managedAgentDir(settings: { managedProfile: string; profiles: ReadonlyArray<{ name: string; agentDir: string }> }, env: NodeJS.ProcessEnv): string {
	if (settings.managedProfile) {
		const profile = settings.profiles.find((entry) => entry.name === settings.managedProfile);
		if (profile) return profile.agentDir;
	}
	return piAgentDir(env);
}
