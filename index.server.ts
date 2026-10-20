import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
	piAddExtensionRpc,
	piCreateSkillRpc,
	piAddModelsRpc,
	piDeleteModelRpc,
	piDeleteProviderRpc,
	piDeleteSessionRpc,
	piFetchModelsRpc,
	piInspectSkillSourceRpc,
	piInstallSkillSourceRpc,
	piDeleteSkillRpc,
	piInstallPackageRpc,
	piListManagedSessionsRpc,
	piListResourcesRpc,
	piReadModelsRpc,
	piReadPromptRpc,
	piReadSettingsRpc,
	piReadSkillRpc,
	piProfileInfoRpc,
	piPrepareProfileRpc,
	piReadProjectRpc,
	piRemoveProfileProviderRpc,
	piSaveProjectPromptRpc,
	piSaveProjectSettingsRpc,
	piRemoveExtensionRpc,
	piRemovePackageRpc,
	piSaveModelRpc,
	piSaveModelsJsonRpc,
	piSaveProviderRpc,
	piSaveSettingsRpc,
	piSetBuiltinExtensionRpc,
	piSetExtensionEnabledRpc,
	piSetSkillEnabledRpc,
	piUpdatePackageRpc,
	piUpdateSkillRpc,
	piWritePromptRpc,
} from "./shared/management";
import { piRefreshRpc, piStatusRpc } from "./shared/rpc";
import { PI_SETTINGS_DEFAULTS, piSettings, type PiSettings } from "./shared/settings";
import {
	addModels,
	addPiExtension,
	buildManagementContext,
	createPiSkill,
	deleteManagedSession,
	deleteModel,
	deletePiSkill,
	deleteProvider,
	installPiPackage,
	listManagedSessions,
	listPiResources,
	readPiModels,
	readPiSettings,
	readPiSkill,
	readPrompt,
	removePiExtension,
	removePiPackage,
	saveModel,
	saveModelsJson,
	savePiSettings,
	saveProvider,
	setBuiltinExtension,
	setPiExtensionEnabled,
	setPiSkillEnabled,
	updatePiPackages,
	updatePiSkill,
	writePrompt,
} from "./server/management";
import { fetchProviderModels } from "./server/model-source";
import { inspectGitHubSkill, installGitHubSkill } from "./server/skill-source";
import { readProject, saveProjectPrompt, saveProjectSettings } from "./server/project";
import { clearPiStatusCache, piConfigDir, piStatus, piSessionDir } from "./server/pi-status";
import { piAgentDir } from "./server/paths";
import { ensureBuiltinReloadExtension } from "./server/builtin-reload";
import {
	assertProfileSlot,
	prepareProfileAgentDir,
	profileEntry,
	registerProfileProvider,
	resolveProfileAgentDir,
	unregisterProfileProvider,
	validateProfileName,
} from "./server/profiles";

export default function contribute(server: PluginServerContext) {
	const launchSettings = server.registerSettings(piSettings);

	const readSettings = async (): Promise<PiSettings> => {
		const state = await launchSettings.read();
		return state.status === "ready" ? state.values : PI_SETTINGS_DEFAULTS;
	};
	const context = async () => {
		const settings = await readSettings();
		return buildManagementContext({
			settings,
			sessionDir: piSessionDir(settings, process.env),
			env: { ...process.env, PI_CODING_AGENT_DIR: piConfigDir(settings, process.env) },
		});
	};

	const syncBuiltinReload = async (state: Awaited<ReturnType<typeof launchSettings.read>>) => {
		const settings = state.status === "ready" ? state.values : PI_SETTINGS_DEFAULTS;
		try {
			const directories = new Set([
				piAgentDir(process.env),
				...settings.profiles.map((profile) => profile.agentDir),
			]);
			for (const directory of directories) {
				await ensureBuiltinReloadExtension(directory, settings.reloadCommand !== false);
			}
		} catch (error) {
			console.error(
				`[paseo-pi] could not install the built-in reload extension: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	};
	void launchSettings.read().then(syncBuiltinReload).catch((error: unknown) => {
		console.error(
			`[paseo-pi] could not read launch settings for /reload: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	});
	const stopBuiltinReload = launchSettings.subscribe(syncBuiltinReload);

	server.handle(piStatusRpc, async () => piStatus(await readSettings(), process.env));

	server.handle(piProfileInfoRpc, async () => {
		const settings = await readSettings();
		return {
			defaultAgentDir: piAgentDir(process.env),
			defaultSessionDir: piSessionDir({ ...settings, managedProfile: "" }, process.env),
		};
	});
	server.handle(piPrepareProfileRpc, async (input, handlerContext) => {
		const name = validateProfileName(input.name);
		const settings = await readSettings();
		const agentDir = resolveProfileAgentDir(name, input.agentDir);
		assertProfileSlot(settings, name, agentDir, piAgentDir(process.env));
		await prepareProfileAgentDir(agentDir);
		await registerProfileProvider(handlerContext.paseo, name, agentDir);
		try {
			await ensureBuiltinReloadExtension(agentDir, settings.reloadCommand !== false);
		} catch (error) {
			console.error(
				`[paseo-pi] could not install the reload extension in ${agentDir}: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
		return profileEntry(name, agentDir);
	});
	server.handle(piRemoveProfileProviderRpc, async (input, handlerContext) => {
		const name = validateProfileName(input.name);
		await unregisterProfileProvider(handlerContext.paseo, name);
		return { name };
	});

	server.handle(piRefreshRpc, async () => {
		clearPiStatusCache();
		await piStatus(await readSettings(), process.env);
		return { refreshedAt: new Date().toISOString() };
	});

	server.handle(piListResourcesRpc, async () => listPiResources(await context()));
	server.handle(piInstallPackageRpc, async (input) => ({
		output: await installPiPackage(await context(), input.source),
	}));
	server.handle(piRemovePackageRpc, async (input) => ({
		output: await removePiPackage(await context(), input.source),
	}));
	server.handle(piUpdatePackageRpc, async (input) => ({
		output: await updatePiPackages(await context(), input.source),
	}));
	server.handle(piAddExtensionRpc, async (input) =>
		addPiExtension({ agentDir: (await context()).agentDir, path: input.path }),
	);
	server.handle(piRemoveExtensionRpc, async (input) =>
		removePiExtension({ agentDir: (await context()).agentDir, path: input.path }),
	);
	server.handle(piSetBuiltinExtensionRpc, async (input) =>
		setBuiltinExtension({
			agentDir: (await context()).agentDir,
			name: input.name,
			enabled: input.enabled,
		}),
	);
	server.handle(piSetExtensionEnabledRpc, async (input) =>
		setPiExtensionEnabled({
			agentDir: (await context()).agentDir,
			path: input.path,
			enabled: input.enabled,
		}),
	);
	server.handle(piCreateSkillRpc, async (input) => createPiSkill(await context(), input));
	server.handle(piSetSkillEnabledRpc, async (input) =>
		setPiSkillEnabled({
			agentDir: (await context()).agentDir,
			path: input.path,
			enabled: input.enabled,
		}),
	);
	server.handle(piInspectSkillSourceRpc, async (input) => {
		const management = await context();
		const resources = await listPiResources(management);
		return inspectGitHubSkill({
			source: input.source,
			existingNames: resources.skills.map((skill) => skill.name),
		});
	});
	server.handle(piInstallSkillSourceRpc, async (input) => {
		const management = await context();
		const resources = await listPiResources(management);
		return installGitHubSkill({
			source: input.source,
			...(input.path ? { path: input.path } : {}),
			agentDir: management.agentDir,
			existingNames: resources.skills.map((skill) => skill.name),
		});
	});
	server.handle(piDeleteSkillRpc, async (input) => ({
		path: await deletePiSkill(await context(), input),
	}));
	server.handle(piReadSkillRpc, async (input) => readPiSkill(await context(), input));
	server.handle(piUpdateSkillRpc, async (input) => updatePiSkill(await context(), input));

	server.handle(piReadSettingsRpc, async () => readPiSettings((await context()).agentDir));
	server.handle(piSaveSettingsRpc, async (input) =>
		savePiSettings({
			agentDir: (await context()).agentDir,
			revision: input.revision,
			settings: input.settings,
		}),
	);

	server.handle(piReadModelsRpc, async () => readPiModels((await context()).agentDir));
	server.handle(piSaveProviderRpc, async (input) =>
		saveProvider({
			agentDir: (await context()).agentDir,
			revision: input.revision,
			...(input.originalName ? { originalName: input.originalName } : {}),
			provider: input.provider,
		}),
	);
	server.handle(piDeleteProviderRpc, async (input) =>
		deleteProvider({
			agentDir: (await context()).agentDir,
			revision: input.revision,
			name: input.name,
		}),
	);
	server.handle(piSaveModelRpc, async (input) =>
		saveModel({
			agentDir: (await context()).agentDir,
			revision: input.revision,
			provider: input.provider,
			...(input.originalId ? { originalId: input.originalId } : {}),
			model: input.model,
		}),
	);
	server.handle(piDeleteModelRpc, async (input) =>
		deleteModel({
			agentDir: (await context()).agentDir,
			revision: input.revision,
			provider: input.provider,
			id: input.id,
		}),
	);
	server.handle(piFetchModelsRpc, async (input) => {
		const management = await context();
		return fetchProviderModels({
			agentDir: management.agentDir,
			provider: input.provider,
			env: management.env,
		});
	});
	server.handle(piAddModelsRpc, async (input) =>
		addModels({
			agentDir: (await context()).agentDir,
			revision: input.revision,
			provider: input.provider,
			models: input.models,
		}),
	);
	server.handle(piSaveModelsJsonRpc, async (input) =>
		saveModelsJson({
			agentDir: (await context()).agentDir,
			revision: input.revision,
			json: input.json,
		}),
	);

	server.handle(piReadProjectRpc, async (input) => readProject(await context(), input));
	server.handle(piSaveProjectSettingsRpc, async (input) =>
		saveProjectSettings(await context(), input),
	);
	server.handle(piSaveProjectPromptRpc, async (input) =>
		saveProjectPrompt(await context(), input),
	);

	server.handle(piReadPromptRpc, async (input) => readPrompt(await context(), input.kind));
	server.handle(piWritePromptRpc, async (input) =>
		writePrompt({
			context: await context(),
			kind: input.kind,
			revision: input.revision,
			content: input.content,
		}),
	);

	server.handle(piListManagedSessionsRpc, async (input) => listManagedSessions(await context(), input));
	server.handle(piDeleteSessionRpc, async (input, handlerContext) =>
		deleteManagedSession(
			{ ...(await context()), ...(handlerContext.paseo ? { paseo: handlerContext.paseo } : {}) },
			input,
		),
	);

	return () => {
		stopBuiltinReload();
	};
}
