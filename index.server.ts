import type { PluginServerContext } from "@getpaseo/plugin/server";
import { PI_PROVIDER_ID } from "./shared/constants";
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
	piRemoveExtensionRpc,
	piRemovePackageRpc,
	piSaveModelRpc,
	piSaveModelsJsonRpc,
	piSaveProviderRpc,
	piSaveSettingsRpc,
	piSetBuiltinExtensionRpc,
	piUpdatePackageRpc,
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
	readPrompt,
	removePiExtension,
	removePiPackage,
	saveModel,
	saveModelsJson,
	savePiSettings,
	saveProvider,
	setBuiltinExtension,
	updatePiPackages,
	writePrompt,
} from "./server/management";
import { fetchProviderModels } from "./server/model-source";
import { inspectGitHubSkill, installGitHubSkill } from "./server/skill-source";
import { clearPiStatusCache, piConfigDir, piStatus, piSessionDir } from "./server/pi-status";
import { createPiProvider } from "./server/provider/registration";

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
			env: { ...process.env, PI_CODING_AGENT_DIR: piConfigDir(process.env) },
		});
	};

	server.registerProvider(
		createPiProvider({
			getSettings: readSettings,
			diagnostic: (message) => console.error(`[${PI_PROVIDER_ID}] ${message}`),
		}),
	);

	server.handle(piStatusRpc, async () => piStatus(await readSettings(), process.env));

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
	server.handle(piCreateSkillRpc, async (input) => createPiSkill(await context(), input));
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

	return () => {};
}
