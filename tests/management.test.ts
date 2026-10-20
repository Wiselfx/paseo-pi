import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	addPiExtension,
	buildManagementContext,
	createPiSkill,
	deleteManagedSession,
	deleteModel,
	deletePiSkill,
	deleteProvider,
	listManagedSessions,
	paseoAgentIdsForSession,
	listPiResources,
	readPiModels,
	readPiSettings,
	readPiSkill,
	readPrompt,
	removePiExtension,
	saveModel,
	saveModelsJson,
	saveProvider,
	savePiSettings,
	setBuiltinExtension,
	setPiExtensionEnabled,
	setPiSkillEnabled,
	updatePiSkill,
	writePrompt,
} from "../server/management";
import { PI_MODELS_SECRET_MASK } from "../shared/management";
import { PI_SETTINGS_DEFAULTS } from "../shared/settings";

const roots: string[] = [];

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "paseo-pi-manage-"));
	roots.push(root);
	const agentDir = join(root, "agent");
	const sessionDir = join(root, "sessions");
	await mkdir(agentDir, { recursive: true });
	await mkdir(sessionDir, { recursive: true });
	const context = buildManagementContext({
		settings: { ...PI_SETTINGS_DEFAULTS, command: "pi" },
		sessionDir,
		env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
	});
	return { root, agentDir, sessionDir, context };
}

afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe("pi settings", () => {
	it("reads missing settings, saves them, and rejects stale revisions", async () => {
		const { agentDir } = await fixture();
		const missing = await readPiSettings(agentDir);
		expect(missing.revision).toBe("missing");
		const saved = await savePiSettings({
			agentDir,
			revision: missing.revision,
			settings: { defaultProvider: "Zen", defaultModel: "model-a" },
		});
		const read = await readPiSettings(agentDir);
		expect(read.settings).toEqual({ defaultProvider: "Zen", defaultModel: "model-a" });
		expect(read.revision).toBe(saved.revision);
		await expect(
			savePiSettings({ agentDir, revision: missing.revision, settings: { defaultModel: "other" } }),
		).rejects.toThrow(/changed on disk/u);
	});

	it("lists packages, a disabled builtin, and skills from resources", async () => {
		const { agentDir, context } = await fixture();
		const packageDir = join(agentDir, "local-package");
		await mkdir(join(packageDir, "skills", "demo"), { recursive: true });
		await writeFile(
			join(packageDir, "package.json"),
			JSON.stringify({ name: "demo-package", version: "1.2.3" }),
		);
		await writeFile(
			join(packageDir, "skills", "demo", "SKILL.md"),
			"---\nname: demo\ndescription: A packaged skill\n---\n\nDo the demo.\n",
		);
		await savePiSettings({
			agentDir,
			revision: "missing",
			settings: {
				packages: ["npm:pi-web-access", "./local-package"],
				extensions: ["-builtin:codemap", "-builtin:codemode"],
			},
		});
		const resources = await listPiResources(context);
		expect(resources.extensions.find((entry) => entry.source === "./local-package")?.version).toBe("1.2.3");
		expect(resources.extensions.find((entry) => entry.label === "codemode")?.enabled).toBe(false);
		expect(resources.skills.find((entry) => entry.name === "demo")).toMatchObject({
			source: "package",
			removable: false,
		});

		await savePiSettings({
			agentDir,
			revision: (await readPiSettings(agentDir)).revision,
			settings: {
				...(await readPiSettings(agentDir)).settings,
				extensions: ["-builtin:codemode", { futureEntry: true }],
			},
		});
		await addPiExtension({ agentDir, path: "/tmp/example-extension.ts" });
		expect((await readPiSettings(agentDir)).settings.extensions).toContain("/tmp/example-extension.ts");
		expect((await readPiSettings(agentDir)).settings.extensions).toContainEqual({ futureEntry: true });
		expect((await listPiResources(context)).extensions.find((entry) => entry.source === "/tmp/example-extension.ts")).toMatchObject({
			kind: "extension",
			removable: true,
		});
		await removePiExtension({ agentDir, path: "/tmp/example-extension.ts" });
		expect((await readPiSettings(agentDir)).settings.extensions).not.toContain("/tmp/example-extension.ts");

		const before = await readPiSettings(agentDir);
		await savePiSettings({
			agentDir,
			revision: before.revision,
			settings: { ...before.settings, extensions: ["-/tmp/reenable.ts"] },
		});
		await addPiExtension({ agentDir, path: "/tmp/reenable.ts" });
		const reenabled = (await readPiSettings(agentDir)).settings.extensions as unknown[];
		expect(reenabled).toContain("/tmp/reenable.ts");
		expect(reenabled).not.toContain("-/tmp/reenable.ts");

		await setBuiltinExtension({ agentDir, name: "codemode", enabled: true });
		expect((await listPiResources(context)).extensions.find((entry) => entry.label === "codemode")?.enabled).toBe(true);
		await setBuiltinExtension({ agentDir, name: "codemode", enabled: false });
	});
});

describe("pi models", () => {
	it("adds a provider and model without returning the API key", async () => {
		const { agentDir } = await fixture();
		await saveProvider({
			agentDir,
			revision: "missing",
			provider: {
				name: "acme",
				label: "Acme",
				baseUrl: "https://api.example.com/v1",
				api: "openai-completions",
				apiKey: "$ACME_KEY",
			},
		});
		let models = await readPiModels(agentDir);
		expect(models.providers[0]).toMatchObject({
			name: "acme",
			label: "Acme",
			baseUrl: "https://api.example.com/v1",
			apiKeySet: true,
			models: [],
		});
		expect(JSON.stringify(models.providers)).not.toContain("$ACME_KEY");
		const saved = await saveModel({
			agentDir,
			revision: models.revision,
			provider: "acme",
			model: {
				id: "acme-chat",
				name: "Acme Chat",
				reasoning: true,
				input: ["text", "image"],
				contextWindow: 128000,
				maxTokens: 16384,
			},
		});
		models = await readPiModels(agentDir);
		expect(models.providers[0]?.models[0]).toMatchObject({
			id: "acme-chat",
			reasoning: true,
			input: ["text", "image"],
			contextWindow: 128000,
		});
		await deleteModel({
			agentDir,
			revision: saved.revision,
			provider: "acme",
			id: "acme-chat",
		});
		models = await readPiModels(agentDir);
		expect(models.providers[0]?.models).toEqual([]);
		await deleteProvider({ agentDir, revision: models.revision, name: "acme" });
		expect((await readPiModels(agentDir)).providers).toEqual([]);
	});

	it("edits raw models JSON with revision checks", async () => {
		const { agentDir } = await fixture();
		const saved = await saveModelsJson({
			agentDir,
			revision: "missing",
			json: JSON.stringify({ providers: { p: { baseUrl: "http://x", api: "openai-completions" } } }),
		});
		expect((await readPiModels(agentDir)).providers[0]?.name).toBe("p");
		await expect(
			saveModelsJson({ agentDir, revision: "missing", json: JSON.stringify({ providers: {} }) }),
		).rejects.toThrow(/changed on disk/u);
		expect((await readPiModels(agentDir)).revision).toBe(saved.revision);
	});

	it("redacts secrets in the raw editor and restores them on save", async () => {
		const { agentDir } = await fixture();
		const modelsFile = join(agentDir, "models.json");
		await writeFile(
			modelsFile,
			JSON.stringify({
				providers: {
					acme: {
						baseUrl: "https://api.example.com/v1",
						apiKey: "plain-secret",
						headers: { Authorization: "Bearer header-secret", "X-Trace": "visible" },
						oauth: { accessToken: "oauth-secret" },
						models: [{ id: "chat", maxTokens: 4096 }],
					},
				},
			}),
		);
		const read = await readPiModels(agentDir);
		expect(read.raw).not.toContain("plain-secret");
		expect(read.raw).not.toContain("header-secret");
		expect(read.raw).not.toContain("oauth-secret");
		expect(read.raw).toContain(PI_MODELS_SECRET_MASK);
		expect(read.raw).toContain("visible");
		expect(read.raw).toContain("4096");
		await saveModelsJson({ agentDir, revision: read.revision, json: read.raw });
		const text = await readFile(modelsFile, "utf8");
		expect(text).toContain("plain-secret");
		expect(text).toContain("header-secret");
		expect(text).toContain("oauth-secret");
		expect(text).not.toContain(PI_MODELS_SECRET_MASK);
	});

	it("does not mask a provider named token and keeps __proto__ as data", async () => {
		const { agentDir } = await fixture();
		const saved = await saveModelsJson({
			agentDir,
			revision: "missing",
			json: '{"providers":{"token":{"baseUrl":"https://token.example/v1"},"__proto__":{"baseUrl":"https://proto.example/v1"}}}',
		});
		const read = await readPiModels(agentDir);
		expect(read.raw).toContain('"token"');
		expect(read.raw).toContain("https://token.example/v1");
		expect(read.providers.map((provider) => provider.name)).toContain("__proto__");
		expect(({} as { baseUrl?: string }).baseUrl).toBeUndefined();
		await deleteProvider({ agentDir, revision: read.revision, name: "__proto__" });
		expect((await readPiModels(agentDir)).providers.map((provider) => provider.name)).toEqual(["token"]);
		expect(saved.revision).toBeTruthy();
	});

	it("rejects editing a provider that disappeared and builtin extension paths", async () => {
		const { agentDir } = await fixture();
		const saved = await saveProvider({
			agentDir,
			revision: "missing",
			provider: { name: "acme", label: "Acme" },
		});
		await expect(
			saveProvider({ agentDir, revision: saved.revision, provider: { name: "acme", label: "Duplicate" } }),
		).rejects.toThrow(/already exists/u);
		await deleteProvider({ agentDir, revision: saved.revision, name: "acme" });
		const revision = (await readPiModels(agentDir)).revision;
		await expect(
			saveProvider({
				agentDir,
				revision,
				originalName: "acme",
				provider: { name: "acme", label: "Acme again" },
			}),
		).rejects.toThrow(/no longer exists/u);
		await expect(addPiExtension({ agentDir, path: "builtin:codemode" })).rejects.toThrow(/built-in/u);
	});

	it("clears model limits and rejects prototype-named providers", async () => {
		const { agentDir } = await fixture();
		let saved = await saveProvider({
			agentDir,
			revision: "missing",
			provider: { name: "acme" },
		});
		saved = await saveModel({
			agentDir,
			revision: saved.revision,
			provider: "acme",
			model: { id: "chat", contextWindow: 128000, maxTokens: 4096 },
		});
		saved = await saveModel({
			agentDir,
			revision: saved.revision,
			provider: "acme",
			model: { id: "chat", contextWindow: null, maxTokens: null },
		});
		const read = await readPiModels(agentDir);
		expect(read.providers[0]?.models[0]).toMatchObject({ contextWindow: null, maxTokens: null });
		expect(Object.prototype).not.toHaveProperty("models");
		await expect(
			saveModel({
				agentDir,
				revision: read.revision,
				provider: "__proto__",
				model: { id: "bad" },
			}),
		).rejects.toThrow(/not in models.json/u);
	});
});

describe("skills and prompts", () => {
	it("creates and deletes a user skill", async () => {
		const { agentDir, context } = await fixture();
		const created = await createPiSkill(context, {
			name: "demo-skill",
			description: "Use for demos.",
			instructions: "# Demo\n\nBe brief.",
		});
		expect(await readFile(created.path, "utf8")).toContain('description: "Use for demos."');
		expect((await listPiResources(context)).skills.find((skill) => skill.name === "demo-skill")).toMatchObject({
			removable: true,
			source: "user",
		});

		const block = join(agentDir, "skills", "block-skill");
		await mkdir(block);
		await writeFile(
			join(block, "SKILL.md"),
			"---\nname: block-skill\ndescription: |\n  First line.\n  Second line.\n---\n\nBody.\n",
		);
		expect((await listPiResources(context)).skills.find((skill) => skill.name === "block-skill")?.description).toBe(
			"First line.\nSecond line.",
		);
		await deletePiSkill(context, { path: created.path });
		await expect(readFile(created.path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
		expect(agentDir).toBeTruthy();
	});

	it("reads and edits a user skill with a revision check", async () => {
		const { context } = await fixture();
		const created = await createPiSkill(context, {
			name: "editable-skill",
			description: "Before.",
			instructions: "Old body.",
		});
		const read = await readPiSkill(context, { path: created.path });
		expect(read.content).toContain("Old body.");
		const updated = await updatePiSkill(context, {
			path: created.path,
			revision: read.revision,
			content: read.content.replace("Old body.", "New body."),
		});
		expect(await readFile(created.path, "utf8")).toContain("New body.");
		expect(updated.revision).not.toBe(read.revision);
		await expect(
			updatePiSkill({
				...context,
			}, {
				path: created.path,
				revision: read.revision,
				content: read.content,
			}),
		).rejects.toThrow(/changed on disk/u);
		await expect(
			updatePiSkill(context, {
				path: created.path,
				revision: updated.revision,
				content: "No frontmatter",
			}),
		).rejects.toThrow(/frontmatter/u);
	});

	it("toggles one skill or extension without touching the others", async () => {
		const { agentDir, context } = await fixture();
		const first = await createPiSkill(context, {
			name: "first-skill",
			description: "First.",
			instructions: "First body.",
		});
		const second = await createPiSkill(context, {
			name: "second-skill",
			description: "Second.",
			instructions: "Second body.",
		});

		await setPiSkillEnabled({ agentDir, path: first.path, enabled: false });
		let skills = (await listPiResources(context)).skills;
		expect(skills.find((skill) => skill.name === "first-skill")?.enabled).toBe(false);
		expect(skills.find((skill) => skill.name === "second-skill")?.enabled).toBe(true);
		expect((await readPiSettings(agentDir)).settings.skills).toContain(`-${first.path}`);

		await setPiSkillEnabled({ agentDir, path: first.path, enabled: true });
		skills = (await listPiResources(context)).skills;
		expect(skills.find((skill) => skill.name === "first-skill")?.enabled).toBe(true);
		expect((await readPiSettings(agentDir)).settings.skills ?? []).not.toContain(`-${first.path}`);
		expect(second.path).toBeTruthy();

		await addPiExtension({ agentDir, path: "/tmp/first-extension.ts" });
		await addPiExtension({ agentDir, path: "/tmp/second-extension.ts" });
		await setPiExtensionEnabled({ agentDir, path: "/tmp/first-extension.ts", enabled: false });
		let extensions = (await listPiResources(context)).extensions;
		expect(extensions.find((entry) => entry.source === "/tmp/first-extension.ts")?.enabled).toBe(false);
		expect(extensions.find((entry) => entry.source === "/tmp/second-extension.ts")?.enabled).toBe(true);
		expect((await readPiSettings(agentDir)).settings.extensions).toContain("-/tmp/first-extension.ts");

		await setPiExtensionEnabled({ agentDir, path: "/tmp/first-extension.ts", enabled: true });
		extensions = (await listPiResources(context)).extensions;
		expect(extensions.find((entry) => entry.source === "/tmp/first-extension.ts")?.enabled).toBe(true);
		expect((await readPiSettings(agentDir)).settings.extensions).toContain("/tmp/first-extension.ts");
		expect((await readPiSettings(agentDir)).settings.extensions).not.toContain("-/tmp/first-extension.ts");

		const discovered = join(agentDir, "extensions", "discovered.ts");
		await mkdir(join(agentDir, "extensions"), { recursive: true });
		await writeFile(discovered, "export default () => {};\n");
		expect((await listPiResources(context)).extensions.find((entry) => entry.path === discovered)?.enabled).toBe(true);
		await setPiExtensionEnabled({ agentDir, path: discovered, enabled: false });
		expect((await listPiResources(context)).extensions.find((entry) => entry.path === discovered)?.enabled).toBe(false);
		await setPiExtensionEnabled({ agentDir, path: discovered, enabled: true });
		expect((await listPiResources(context)).extensions.find((entry) => entry.path === discovered)?.enabled).toBe(true);
	});

	it("writes, reads, and clears SYSTEM.md and APPEND_SYSTEM.md", async () => {
		const { context } = await fixture();
		const initial = await readPrompt(context, "append");
		const written = await writePrompt({
			context,
			kind: "append",
			revision: initial.revision,
			content: "Always answer briefly.\n",
		});
		expect(await readPrompt(context, "append")).toMatchObject({
			content: "Always answer briefly.\n",
			exists: true,
			revision: written.revision,
		});
		const cleared = await writePrompt({
			context,
			kind: "append",
			revision: written.revision,
			content: "",
		});
		expect(cleared).toEqual({ revision: "missing", exists: false });
		await expect(
			writePrompt({ context, kind: "system", revision: "wrong", content: "x" }),
		).rejects.toThrow(/changed on disk/u);
	});
});

describe("sessions", () => {
	it("lists sessions and deletes only files inside the session directory", async () => {
		const { root, sessionDir, context } = await fixture();
		const directory = join(sessionDir, "--work--");
		await mkdir(directory);
		const sessionFile = join(directory, "1700000000000_abc.jsonl");
		await writeFile(
			sessionFile,
			`${JSON.stringify({ type: "session", version: 3, id: "abc", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/work" })}\n${JSON.stringify(
				{ type: "message", message: { role: "user", content: [{ type: "text", text: "Hello" }] } },
			)}\n`,
		);
		const listed = await listManagedSessions(context, {});
		expect(listed.sessions).toHaveLength(1);
		expect(listed.sessions[0]).toMatchObject({ sessionId: "abc", sessionFile, title: "Hello", cwd: "/work" });
		await expect(deleteManagedSession(context, { sessionFile: join(root, "outside.jsonl") })).rejects.toThrow(
			/does not exist|outside/u,
		);
		await deleteManagedSession(context, { sessionFile });
		await expect(readFile(sessionFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	});
});

describe("paseoAgentIdsForSession", () => {
	it("matches the plugin persistence wrapper and ignores other agents", () => {
		const agents = [
			{
				id: "agent-1",
				persistence: {
					metadata: { pluginProviderPersistence: { data: { sessionFile: "/root/.pi/sessions/a.jsonl" } } },
				},
			},
			{ id: "agent-2", persistence: { metadata: {} } },
			{ id: "agent-3" },
		];
		const builtIn = [
			{ id: "agent-4", persistence: { provider: "pi", sessionId: "s", nativeHandle: "/root/.pi/sessions/c.jsonl" } },
			{ id: "agent-5", persistence: { provider: "pi", sessionId: "t", nativeHandle: "/root/.pi/sessions/d.jsonl" } },
		];
		expect(paseoAgentIdsForSession(agents, "/root/.pi/sessions/./a.jsonl")).toEqual(["agent-1"]);
		expect(paseoAgentIdsForSession(agents, "/root/.pi/sessions/b.jsonl")).toEqual([]);
		expect(paseoAgentIdsForSession(builtIn, "/root/.pi/sessions/./c.jsonl")).toEqual(["agent-4"]);
	});
});
