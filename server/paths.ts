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
