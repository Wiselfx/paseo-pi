import { PiRpc } from "../server/provider/rpc";
import { fail, launchSettings } from "./pi-env";

const rpc = new PiRpc({
	command: launchSettings.command,
	args: [
		...launchSettings.args,
		"--mode",
		"rpc",
		"--no-session",
		"--no-extensions",
		"--no-skills",
		"--no-context-files",
		"--no-mcp",
	],
	cwd: "/tmp",
	env: { PI_OFFLINE: "1" },
});

try {
	const state = (await rpc.request("get_state")) as { model?: { provider?: string; id?: string } };
	const models = (await rpc.request("get_available_models")) as { models?: unknown[] };
	const levels = (await rpc.request("get_available_thinking_levels")) as { levels?: string[] };
	const commands = (await rpc.request("get_commands")) as { commands?: unknown[] };
	if (!state.model?.provider || !state.model.id) fail("get_state has no model");
	if (!models.models?.length) fail("get_available_models returned no models");
	if (!levels.levels?.includes("off")) fail("thinking levels do not include off");
	if (!Array.isArray(commands.commands)) fail("get_commands did not return an array");
	console.log(
		`OK rpc: ${state.model.provider}/${state.model.id}, ${models.models.length} models, ${levels.levels.length} levels, ${commands.commands.length} commands`,
	);
} catch (error) {
	console.error(error);
	fail("RPC probe threw");
} finally {
	await rpc.close();
}
