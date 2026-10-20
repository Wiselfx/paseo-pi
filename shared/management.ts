import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const LongText = z.string().max(2_000_000);
const Revision = z.string().min(1).max(128);

/** Raw models.json replaces secret-looking values with this marker; saves restore them. */
export const PI_MODELS_SECRET_MASK = "__PI_SECRET__";

export const piExtensionEntrySchema = z.object({
	id: z.string(),
	kind: z.enum(["package", "extension", "builtin"]),
	label: z.string(),
	source: z.string(),
	version: z.string().nullable(),
	path: z.string().nullable(),
	enabled: z.boolean(),
	removable: z.boolean(),
	note: z.string().optional(),
});

export const piSkillEntrySchema = z.object({
	name: z.string(),
	description: z.string(),
	path: z.string(),
	source: z.enum(["user", "agents", "package", "config", "unknown"]),
	enabled: z.boolean(),
	removable: z.boolean(),
});

export const piListResourcesRpc = defineRpc({
	name: "paseo-pi.list-resources",
	input: z.object({}),
	output: z.object({
		agentDir: z.string(),
		extensions: z.array(piExtensionEntrySchema),
		skills: z.array(piSkillEntrySchema),
	}),
});

export const piInstallPackageRpc = defineRpc({
	name: "paseo-pi.install-package",
	input: z.object({ source: z.string().trim().min(1).max(4_096) }),
	output: z.object({ output: z.string() }),
});

export const piUpdatePackageRpc = defineRpc({
	name: "paseo-pi.update-package",
	input: z.object({ source: z.string().trim().max(4_096).optional() }),
	output: z.object({ output: z.string() }),
});

export const piAddExtensionRpc = defineRpc({
	name: "paseo-pi.add-extension",
	input: z.object({ path: z.string().trim().min(1).max(4_096) }),
	output: z.object({ path: z.string() }),
});

export const piRemoveExtensionRpc = defineRpc({
	name: "paseo-pi.remove-extension",
	input: z.object({ path: z.string().trim().min(1).max(4_096) }),
	output: z.object({ path: z.string() }),
});

export const piSetExtensionEnabledRpc = defineRpc({
	name: "paseo-pi.set-extension-enabled",
	input: z.object({ path: z.string().trim().min(1).max(4_096), enabled: z.boolean() }),
	output: z.object({ path: z.string(), enabled: z.boolean() }),
});

export const piSetSkillEnabledRpc = defineRpc({
	name: "paseo-pi.set-skill-enabled",
	input: z.object({ path: z.string().trim().min(1).max(4_096), enabled: z.boolean() }),
	output: z.object({ path: z.string(), enabled: z.boolean() }),
});

export const piSetBuiltinExtensionRpc = defineRpc({
	name: "paseo-pi.set-builtin-extension",
	input: z.object({
		name: z.enum(["mcp", "llama.cpp", "codemode", "tool-search"]),
		enabled: z.boolean(),
	}),
	output: z.object({ enabled: z.boolean() }),
});

export const piRemovePackageRpc = defineRpc({
	name: "paseo-pi.remove-package",
	input: z.object({ source: z.string().trim().min(1).max(4_096) }),
	output: z.object({ output: z.string() }),
});

export const piCreateSkillRpc = defineRpc({
	name: "paseo-pi.create-skill",
	input: z.object({
		name: z
			.string()
			.trim()
			.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single hyphens.")
			.max(64),
		description: z.string().trim().min(1).max(1_024),
		instructions: z.string().max(200_000).default(""),
	}),
	output: z.object({ path: z.string() }),
});

export const piSkillSourceCandidateSchema = z.object({
	name: z.string(),
	description: z.string(),
	path: z.string(),
	url: z.string(),
	installed: z.boolean(),
});

export const piInspectSkillSourceRpc = defineRpc({
	name: "paseo-pi.inspect-skill-source",
	input: z.object({ source: z.string().trim().min(1).max(4_096) }),
	output: z.object({ candidates: z.array(piSkillSourceCandidateSchema) }),
});

export const piInstallSkillSourceRpc = defineRpc({
	name: "paseo-pi.install-skill-source",
	input: z.object({
		source: z.string().trim().min(1).max(4_096),
		path: z.string().trim().max(4_096).optional(),
	}),
	output: z.object({ path: z.string(), name: z.string() }),
});

export const piFetchedModelSchema = z.object({
	id: z.string(),
	name: z.string().optional(),
	reasoning: z.boolean().optional(),
	input: z.array(z.enum(["text", "image"])).optional(),
	contextWindow: z.number().nullable().optional(),
	maxTokens: z.number().nullable().optional(),
});

export const piFetchModelsRpc = defineRpc({
	name: "paseo-pi.fetch-models",
	input: z.object({ provider: z.string().trim().min(1).max(128) }),
	output: z.object({
		baseUrl: z.string(),
		api: z.string(),
		models: z.array(piFetchedModelSchema),
	}),
});

export const piAddModelsRpc = defineRpc({
	name: "paseo-pi.add-models",
	input: z.object({
		revision: Revision,
		provider: z.string().trim().min(1).max(128),
		models: z.array(piFetchedModelSchema).min(1).max(1_000),
	}),
	output: z.object({ revision: Revision, added: z.number().int(), skipped: z.number().int() }),
});

export const piDeleteSkillRpc = defineRpc({
	name: "paseo-pi.delete-skill",
	input: z.object({ path: z.string().trim().min(1).max(4_096) }),
	output: z.object({ path: z.string() }),
});

const PiSettingsValueSchema = z.record(z.string(), z.unknown());

export const piReadSettingsRpc = defineRpc({
	name: "paseo-pi.read-settings",
	input: z.object({}),
	output: z.object({
		path: z.string(),
		revision: Revision,
		settings: PiSettingsValueSchema,
	}),
});

export const piSaveSettingsRpc = defineRpc({
	name: "paseo-pi.save-settings",
	input: z.object({
		revision: Revision,
		settings: PiSettingsValueSchema,
	}),
	output: z.object({ revision: Revision }),
});

export const piModelEntrySchema = z.object({
	id: z.string(),
	name: z.string().nullable(),
	reasoning: z.boolean(),
	input: z.array(z.enum(["text", "image"])),
	contextWindow: z.number().nullable(),
	maxTokens: z.number().nullable(),
});

export const piProviderEntrySchema = z.object({
	name: z.string(),
	label: z.string().nullable(),
	baseUrl: z.string().nullable(),
	api: z.string().nullable(),
	apiKeySet: z.boolean(),
	models: z.array(piModelEntrySchema),
});

export const piReadModelsRpc = defineRpc({
	name: "paseo-pi.read-models",
	input: z.object({}),
	output: z.object({
		path: z.string(),
		revision: Revision,
		providers: z.array(piProviderEntrySchema),
		raw: z.string(),
	}),
});

export const piSaveProviderRpc = defineRpc({
	name: "paseo-pi.save-provider",
	input: z.object({
		revision: Revision,
		originalName: z.string().max(128).optional(),
		provider: z.object({
			name: z
				.string()
				.trim()
				.regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/, "Use letters, numbers, dots, dashes, or underscores."),
			label: z.string().max(256).optional(),
			baseUrl: z.string().max(2_048).optional(),
			api: z.string().max(128).optional(),
			// Write-only. Undefined preserves an existing key; an empty string clears it.
			apiKey: z.string().max(16_384).optional(),
		}),
	}),
	output: z.object({ revision: Revision }),
});

export const piDeleteProviderRpc = defineRpc({
	name: "paseo-pi.delete-provider",
	input: z.object({ revision: Revision, name: z.string().min(1).max(128) }),
	output: z.object({ revision: Revision }),
});

export const piSaveModelRpc = defineRpc({
	name: "paseo-pi.save-model",
	input: z.object({
		revision: Revision,
		provider: z.string().min(1).max(128),
		originalId: z.string().max(256).optional(),
		model: z.object({
			id: z.string().trim().min(1).max(256),
			name: z.string().max(256).optional(),
			reasoning: z.boolean().optional(),
			input: z.array(z.enum(["text", "image"])).max(2).optional(),
			// null clears an existing value; undefined leaves it unchanged.
			contextWindow: z.number().int().positive().max(100_000_000).nullable().optional(),
			maxTokens: z.number().int().positive().max(100_000_000).nullable().optional(),
		}),
	}),
	output: z.object({ revision: Revision }),
});

export const piDeleteModelRpc = defineRpc({
	name: "paseo-pi.delete-model",
	input: z.object({
		revision: Revision,
		provider: z.string().min(1).max(128),
		id: z.string().min(1).max(256),
	}),
	output: z.object({ revision: Revision }),
});

export const piSaveModelsJsonRpc = defineRpc({
	name: "paseo-pi.save-models-json",
	input: z.object({ revision: Revision, json: z.string().max(4_000_000) }),
	output: z.object({ revision: Revision }),
});

export const piPromptKindSchema = z.enum(["system", "append"]);

export const piReadPromptRpc = defineRpc({
	name: "paseo-pi.read-prompt",
	input: z.object({ kind: piPromptKindSchema }),
	output: z.object({
		kind: piPromptKindSchema,
		path: z.string(),
		revision: Revision,
		content: z.string(),
		exists: z.boolean(),
	}),
});

export const piWritePromptRpc = defineRpc({
	name: "paseo-pi.write-prompt",
	input: z.object({
		kind: piPromptKindSchema,
		revision: Revision,
		content: LongText,
	}),
	output: z.object({ revision: Revision, exists: z.boolean() }),
});

export const piManagedSessionSchema = z.object({
	sessionFile: z.string(),
	sessionId: z.string(),
	title: z.string().nullable(),
	cwd: z.string(),
	updatedAt: z.string(),
});

export const piListManagedSessionsRpc = defineRpc({
	name: "paseo-pi.list-sessions",
	input: z.object({
		cwd: z.string().max(4_096).optional(),
		query: z.string().max(512).optional(),
		limit: z.number().int().min(1).max(200).optional(),
	}),
	output: z.object({
		sessionDir: z.string(),
		sessions: z.array(piManagedSessionSchema),
	}),
});

export const piDeleteSessionRpc = defineRpc({
	name: "paseo-pi.delete-session",
	input: z.object({ sessionFile: z.string().trim().min(1).max(4_096) }),
	output: z.object({ sessionFile: z.string(), deletedAgents: z.number().int() }),
});

export type PiExtensionEntry = z.infer<typeof piExtensionEntrySchema>;
export type PiSkillEntry = z.infer<typeof piSkillEntrySchema>;
export type PiSkillSourceCandidate = z.infer<typeof piSkillSourceCandidateSchema>;
export type PiFetchedModel = z.infer<typeof piFetchedModelSchema>;
export type PiProviderEntry = z.infer<typeof piProviderEntrySchema>;
export type PiModelEntry = z.infer<typeof piModelEntrySchema>;
export type PiManagedSession = z.infer<typeof piManagedSessionSchema>;
export type PiPromptKind = z.infer<typeof piPromptKindSchema>;
export type PiSettingsRecord = z.infer<typeof PiSettingsValueSchema>;
