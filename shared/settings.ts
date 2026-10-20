import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { PI_LAUNCH_SETTINGS_ID } from "./constants";

export const piProfileSchema = z.object({
	name: z
		.string()
		.trim()
		.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and single hyphens.")
		.max(48),
	agentDir: z.string().trim().min(1).max(4_096),
});

export type PiProfile = z.infer<typeof piProfileSchema>;

export const piSettingsSchema = z.object({
	command: z.string().min(1).default("pi"),
	args: z.array(z.string()).default([]),
	inheritEnv: z.array(z.string()).default([]),
	sessionDir: z.string().default(""),
	noContextFiles: z.boolean().default(false),
	noMcp: z.boolean().default(false),
	reloadCommand: z.boolean().default(true),
	profiles: z.array(piProfileSchema).max(64).default([]),
	managedProfile: z.string().default(""),
});

export type PiSettings = z.infer<typeof piSettingsSchema>;

export const piSettings = defineSettings({
	id: PI_LAUNCH_SETTINGS_ID,
	scope: "host",
	version: 1,
	schema: piSettingsSchema,
});

export const PI_SETTINGS_DEFAULTS: PiSettings = piSettingsSchema.parse({});
