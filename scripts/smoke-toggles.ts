import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiRpc } from "../server/provider/rpc";

const root = await mkdtemp(join(tmpdir(), "paseo-pi-toggle-"));
const agent = join(root, "agent");
await mkdir(join(agent, "skills", "first"), { recursive: true });
await mkdir(join(agent, "skills", "second"), { recursive: true });
await mkdir(join(agent, "extensions"), { recursive: true });
const first = join(agent, "skills", "first", "SKILL.md");
const extension = join(agent, "extensions", "toggle-check.ts");
await writeFile(first, "---\nname: first-skill\ndescription: First\n---\n\nFirst.\n");
await writeFile(
	join(agent, "skills", "second", "SKILL.md"),
	"---\nname: second-skill\ndescription: Second\n---\n\nSecond.\n",
);
await writeFile(
	extension,
	'export default (pi) => { pi.registerCommand("toggle-check", { description: "Extension present", handler: async () => {} }); };\n',
);

async function commands(settings: Record<string, unknown>): Promise<string[]> {
	await writeFile(join(agent, "settings.json"), JSON.stringify(settings));
	const rpc = new PiRpc({
		command: process.env.PI_COMMAND ?? "pi",
		args: ["--mode", "rpc", "--no-session"],
		cwd: root,
		env: { PI_CODING_AGENT_DIR: agent },
	});
	try {
		const result = (await rpc.request("get_commands")) as {
			commands?: { name: string }[];
		};
		return (result.commands ?? []).map((command) => command.name);
	} finally {
		await rpc.close();
	}
}

try {
	const all = await commands({});
	for (const name of ["skill:first-skill", "skill:second-skill", "toggle-check"]) {
		if (!all.includes(name)) throw new Error(`${name} did not load before toggling`);
	}

	const disabled = await commands({ skills: [`-${first}`], extensions: [`-${extension}`] });
	if (disabled.includes("skill:first-skill")) throw new Error("The disabled skill still loaded");
	if (disabled.includes("toggle-check")) throw new Error("The disabled extension still loaded");
	if (!disabled.includes("skill:second-skill")) throw new Error("Disabling one skill also disabled another");

	const enabled = await commands({ skills: [], extensions: [] });
	if (!enabled.includes("skill:first-skill") || !enabled.includes("toggle-check")) {
		throw new Error("Removing the exact markers did not re-enable the resources");
	}
	console.log("OK toggles: exact -path markers disable one skill or extension without touching the others");
} finally {
	await rm(root, { recursive: true, force: true });
}
