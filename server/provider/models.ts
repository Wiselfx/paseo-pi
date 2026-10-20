import type { ProviderModel, ProviderThinkingOption } from "@getpaseo/plugin/server/provider";

export interface PiWireModel {
	id: string;
	name?: string;
	provider: string;
	api?: string;
	reasoning?: boolean;
	input?: string[];
	contextWindow?: number;
	maxTokens?: number;
	thinkingLevelMap?: Record<string, string | null>;
}

const LEVEL_LABELS: Record<string, string> = {
	off: "Off",
	minimal: "Minimal",
	low: "Low",
	medium: "Medium",
	high: "High",
	xhigh: "Extra high",
	max: "Max",
};

/** pi's own default ladder when a model declares no map; xhigh/max need an explicit map. */
export function defaultThinkingLevels(model: PiWireModel | undefined): string[] {
	if (!model?.reasoning) return ["off"];
	return ["off", "minimal", "low", "medium", "high"];
}

export function thinkingOptionsFor(levels: readonly string[]): ProviderThinkingOption[] {
	return levels.map((id) => ({
		id,
		label: LEVEL_LABELS[id] ?? id,
		...(id === "off" ? { description: "No reasoning effort" } : {}),
	}));
}

export function publicModelId(model: { provider: string; id: string }): string {
	return `${model.provider}/${model.id}`;
}

export function splitModelId(value: string): { provider: string; modelId: string } {
	const index = value.indexOf("/");
	if (index <= 0 || index === value.length - 1) {
		throw new Error(`Model id must be provider/model: ${value}`);
	}
	return { provider: value.slice(0, index), modelId: value.slice(index + 1) };
}

export function toProviderModel(
	model: PiWireModel,
	levels: readonly string[] = defaultThinkingLevels(model),
): ProviderModel {
	const options = thinkingOptionsFor(levels);
	return {
		id: publicModelId(model),
		label: model.name?.trim() || model.id,
		description: `${model.provider}${model.contextWindow ? ` · ${Math.round(model.contextWindow / 1000)}k context` : ""}`,
		contextWindowMaxTokens: model.contextWindow,
		...(model.reasoning
			? {
					thinkingOptions: options,
					defaultThinkingOptionId: levels.includes("medium") ? "medium" : levels[0],
				}
			: {}),
		metadata: {
			provider: model.provider,
			modelId: model.id,
			...(model.input ? { input: model.input } : {}),
			reasoning: model.reasoning === true,
			...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
			...(model.maxTokens ? { maxTokens: model.maxTokens } : {}),
		},
	};
}

export interface PiUsage {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	cost?: { total?: number };
}

export function toProviderUsage(usage: PiUsage | undefined, contextWindow?: number) {
	if (!usage) return undefined;
	const input = usage.input ?? 0;
	const cached = usage.cacheRead ?? 0;
	const output = usage.output ?? 0;
	const used = usage.totalTokens ?? input + cached + (usage.cacheWrite ?? 0) + output;
	return {
		inputTokens: input,
		cachedInputTokens: cached,
		outputTokens: output,
		...(usage.cost?.total !== undefined ? { totalCostUsd: usage.cost.total } : {}),
		...(contextWindow ? { contextWindowMaxTokens: contextWindow } : {}),
		...(used > 0 ? { contextWindowUsedTokens: used } : {}),
	};
}
