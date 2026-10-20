import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { PaseoApiLike } from "../server/management";
import {
	assertProfileSlot,
	prepareProfileAgentDir,
	profileEntry,
	profileProviderOverride,
	registerProfileProvider,
	resolveProfileAgentDir,
	unregisterProfileProvider,
} from "../server/profiles";
import { readProject, saveProjectPrompt, saveProjectSettings } from "../server/project";
import { buildManagementContext } from "../server/management";
import { PI_SETTINGS_DEFAULTS } from "../shared/settings";

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function fakePaseo(providers: Record<string, unknown> = {}) {
	const patches: Array<Record<string, unknown>> = [];
	const paseo: PaseoApiLike = {
		agents: { list: async () => ({ entries: [] }) },
		config: {
			get: async () => ({ config: { providers } }),
			patch: async (patch) => {
				patches.push(patch);
				if (patch.removeProviders) {
					for (const id of patch.removeProviders) delete providers[id];
				}
				Object.assign(providers, patch.providers ?? {});
				return {};
			},
		},
	};
	return { paseo, providers, patches };
}

describe("pi profiles", () => {
	it("creates the profile directory and registers a pi provider override", async () => {
		const root = await mkdtemp(join(tmpdir(), "paseo-pi-profile-"));
		roots.push(root);
		const agentDir = join(root, "profiles", "work", "agent");
		await prepareProfileAgentDir(agentDir);
		const { paseo, providers, patches } = fakePaseo();
		await registerProfileProvider(paseo, "work", agentDir);
		expect(providers["pi-work"]).toEqual(profileProviderOverride("work", agentDir));
		expect(providers["pi-work"]).toMatchObject({
			extends: "pi",
			label: "Pi · work",
			env: { PI_CODING_AGENT_DIR: agentDir },
		});
		expect(profileEntry("work", agentDir).providerId).toBe("pi-work");
		await registerProfileProvider(paseo, "work", agentDir);
		expect(patches).toHaveLength(1);
		await unregisterProfileProvider(paseo, "work");
		expect(providers["pi-work"]).toBeUndefined();
	});

	it("rejects duplicate names, shared directories, and the default directory", () => {
		const settings = {
			profiles: [{ name: "work", agentDir: "/home/me/.pi/profiles/work/agent" }],
		};
		expect(() =>
			assertProfileSlot(settings, "work", "/home/me/.pi/profiles/other/agent", "/home/me/.pi/agent"),
		).toThrow(/already exists/u);
		expect(() =>
			assertProfileSlot(settings, "other", "/home/me/.pi/profiles/work/agent", "/home/me/.pi/agent"),
		).toThrow(/another profile/iu);
		expect(() =>
			assertProfileSlot(settings, "other", "/home/me/.pi/agent", "/home/me/.pi/agent"),
		).toThrow(/default pi agent directory/u);
	});

	it("refuses to replace an unrelated provider and requires an absolute directory", async () => {
		const root = await mkdtemp(join(tmpdir(), "paseo-pi-profile-"));
		roots.push(root);
		const { paseo } = fakePaseo({ "pi-work": { extends: "claude", env: {} } });
		await expect(registerProfileProvider(paseo, "work", join(root, "agent"))).rejects.toThrow(
			/already has a provider/u,
		);
		expect(() => resolveProfileAgentDir("work", "relative/path")).toThrow(/absolute/u);
		expect(resolveProfileAgentDir("work")).toContain(join(".pi", "profiles", "work", "agent"));
	});
});

describe("project settings", () => {
	it("reads and writes .pi settings and APPEND_SYSTEM.md with revisions", async () => {
		const root = await mkdtemp(join(tmpdir(), "paseo-pi-project-"));
		roots.push(root);
		const agentDir = join(root, "agent");
		await mkdir(agentDir, { recursive: true });
		const context = buildManagementContext({
			settings: PI_SETTINGS_DEFAULTS,
			sessionDir: join(root, "sessions"),
			env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
		});
		const initial = await readProject(context, { cwd: root });
		expect(initial.settingsPath).toBe(join(root, ".pi", "settings.json"));
		expect(initial.revision).toBe("missing");
		const saved = await saveProjectSettings(context, {
			cwd: root,
			revision: initial.revision,
			settings: { defaultModel: "work-model" },
		});
		expect(JSON.parse(await readFile(initial.settingsPath, "utf8"))).toEqual({
			defaultModel: "work-model",
		});
		const prompt = await saveProjectPrompt(context, {
			cwd: root,
			revision: initial.promptRevision,
			content: "Follow the project rules.\n",
		});
		const after = await readProject(context, { cwd: root });
		expect(after).toMatchObject({
			revision: saved.revision,
			promptRevision: prompt.revision,
			prompt: "Follow the project rules.\n",
		});
		await expect(
			saveProjectSettings(context, { cwd: root, revision: initial.revision, settings: {} }),
		).rejects.toThrow(/changed on disk/u);
		await expect(readProject(context, { cwd: "relative" })).rejects.toThrow(/absolute/u);
	});
});
