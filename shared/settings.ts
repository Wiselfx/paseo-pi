import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { PI_LAUNCH_SETTINGS_ID } from "./constants";

export const piSettingsSchema = z.object({
	command: z.string().min(1).default("pi"),
	args: z.array(z.string()).default([]),
	inheritEnv: z.array(z.string()).default([]),
	sessionDir: z.string().default(""),
	noExtensions: z.boolean().default(false),
	noSkills: z.boolean().default(false),
	noContextFiles: z.boolean().default(false),
	noMcp: z.boolean().default(false),
	reloadCommand: z.boolean().default(true),
	/**
	 * Paseo's built-in pi provider already lists these models. Listing them here too puts every
	 * one in the app twice, so the plugin's provider advertises none unless asked.
	 */
	exposeModels: z.boolean().default(false),
});

export type PiSettings = z.infer<typeof piSettingsSchema>;

export const piSettings = defineSettings({
	id: PI_LAUNCH_SETTINGS_ID,
	scope: "host",
	version: 1,
	schema: piSettingsSchema,
});

export const PI_SETTINGS_DEFAULTS: PiSettings = piSettingsSchema.parse({});
