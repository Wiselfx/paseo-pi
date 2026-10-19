import { describe, expect, it } from "vitest";
import {
	defaultThinkingLevels,
	splitModelId,
	toProviderModel,
	toProviderUsage,
} from "../server/provider/models";

describe("model ids", () => {
	it("splits at the first slash so provider model ids keep theirs", () => {
		expect(splitModelId("NanoGPT/deepseek/deepseek-v4-flash-latest")).toEqual({
			provider: "NanoGPT",
			modelId: "deepseek/deepseek-v4-flash-latest",
		});
		expect(() => splitModelId("no-slash")).toThrow();
		expect(() => splitModelId("/leading")).toThrow();
	});
});

describe("thinking levels", () => {
	it("gives reasoning models pi's default ladder and others only off", () => {
		expect(defaultThinkingLevels({ provider: "p", id: "m", reasoning: true })).toEqual([
			"off",
			"minimal",
			"low",
			"medium",
			"high",
		]);
		expect(defaultThinkingLevels({ provider: "p", id: "m" })).toEqual(["off"]);
	});

	it("maps wire models without inventing thinking for non-reasoning models", () => {
		const model = toProviderModel({
			id: "m",
			provider: "p",
			name: "Model",
			contextWindow: 128_000,
			reasoning: false,
		});
		expect(model.id).toBe("p/m");
		expect(model.label).toBe("Model");
		expect(model.contextWindowMaxTokens).toBe(128_000);
		expect(model.thinkingOptions).toBeUndefined();
		const reasoning = toProviderModel({ id: "r", provider: "p", reasoning: true });
		expect(reasoning.defaultThinkingOptionId).toBe("medium");
		expect(reasoning.thinkingOptions?.map((option) => option.id)).toContain("high");
	});
});

describe("usage", () => {
	it("passes tokens, cost, and context window through", () => {
		expect(
			toProviderUsage(
				{ input: 10, output: 5, cacheRead: 2, totalTokens: 17, cost: { total: 0.25 } },
				1000,
			),
		).toEqual({
			inputTokens: 10,
			cachedInputTokens: 2,
			outputTokens: 5,
			totalCostUsd: 0.25,
			contextWindowMaxTokens: 1000,
			contextWindowUsedTokens: 17,
		});
		expect(toProviderUsage(undefined)).toBeUndefined();
	});
});
