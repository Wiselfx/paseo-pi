import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

const PiModelSummarySchema = z.object({
	id: z.string(),
	label: z.string(),
	provider: z.string(),
	reasoning: z.boolean(),
	contextWindow: z.number().optional(),
});

export const piStatusRpc = defineRpc({
	name: "paseo-pi.status",
	input: z.object({}),
	output: z.object({
		command: z.string(),
		available: z.boolean(),
		version: z.string().nullable(),
		diagnostic: z.string().nullable(),
		sessionDir: z.string(),
		modelCount: z.number(),
		models: z.array(PiModelSummarySchema),
		configDir: z.string(),
	}),
});

export const piRefreshRpc = defineRpc({
	name: "paseo-pi.refresh",
	input: z.object({}),
	output: z.object({ refreshedAt: z.string() }),
});

export type PiStatus = z.infer<typeof piStatusRpc.output>;
export type PiModelSummary = z.infer<typeof PiModelSummarySchema>;
