import { describe, expect, it, vi } from "vitest";
import { contributeReloadComposerPills } from "../client/reload-pill";

type Agent = {
	id: string;
	provider?: string | null;
	workspaceId?: string | null;
	status: string;
	archivedAt?: string | null;
};

type Observer = {
	snapshot(input: { entries: { agent: Agent }[] }): void;
	update(message: { type: string; payload?: unknown }): void;
};

function harness() {
	const pills: {
		agentId: string;
		workspaceId: string;
		disabled: boolean;
		press(): Promise<void>;
		update: ReturnType<typeof vi.fn>;
		remove: ReturnType<typeof vi.fn>;
	}[] = [];
	const sends: { agentId: string; text: string }[] = [];
	let observer: Observer | undefined;
	const release = vi.fn().mockResolvedValue(undefined);
	const client = {
		paseo: {
			agents: {
				list: vi.fn(async () => ({
					subscription: {
						subscribe(next: Observer) {
							observer = next;
							return vi.fn();
						},
						release,
					},
				})),
				ref: vi.fn((agentId: string) => ({
					send: async (text: string) => {
						sends.push({ agentId, text });
					},
				})),
			},
		},
		addComposerPill: vi.fn((input: never) => {
			const value = input as unknown as {
				agentId: string;
				workspaceId: string;
				button: { disabled?: boolean; behavior: { onPress(): Promise<void> } };
			};
			const update = vi.fn();
			const remove = vi.fn();
			pills.push({
				agentId: value.agentId,
				workspaceId: value.workspaceId,
				disabled: value.button.disabled === true,
				press: value.button.behavior.onPress,
				update,
				remove,
			});
			return { update, remove };
		}),
	};
	return { client, pills, sends, release, observer: () => observer };
}

const flush = async () => {
	await Promise.resolve();
	await Promise.resolve();
};
const upsert = (agent: Agent) => ({ type: "agent_update", payload: { kind: "upsert", agent } });
const piAgent = (overrides: Partial<Agent> = {}): Agent => ({
	id: "a",
	provider: "pi",
	workspaceId: "w",
	status: "idle",
	...overrides,
});

describe("reload composer pill", () => {
	it("adds a Reload pill to built-in pi agents and sends /reload", async () => {
		const h = harness();
		const cleanup = contributeReloadComposerPills(h.client as never);
		await flush();
		h.observer()?.snapshot({ entries: [{ agent: piAgent() }] });
		expect(h.pills).toHaveLength(1);
		expect(h.pills[0]).toMatchObject({ agentId: "a", workspaceId: "w", disabled: false });
		await h.pills[0]!.press();
		expect(h.sends).toEqual([{ agentId: "a", text: "/reload" }]);
		cleanup();
		expect(h.pills[0]!.remove).toHaveBeenCalledOnce();
	});

	it("keeps the pill for legacy pi-plugin agents", async () => {
		const h = harness();
		contributeReloadComposerPills(h.client as never);
		await flush();
		h.observer()?.snapshot({ entries: [{ agent: piAgent({ id: "legacy", provider: "pi-plugin" }) }] });
		expect(h.pills).toHaveLength(1);
	});

	it("ignores other providers and closed or archived agents", async () => {
		const h = harness();
		contributeReloadComposerPills(h.client as never);
		await flush();
		h.observer()?.snapshot({
			entries: [
				{ agent: piAgent({ id: "other", provider: "codex" }) },
				{ agent: piAgent({ id: "closed", status: "closed" }) },
				{ agent: piAgent({ id: "archived", archivedAt: "2026-01-01T00:00:00Z" }) },
				{ agent: piAgent({ id: "no-workspace", workspaceId: null }) },
			],
		});
		expect(h.pills).toHaveLength(0);
	});

	it("disables the pill while the agent runs and re-enables it when idle", async () => {
		const h = harness();
		contributeReloadComposerPills(h.client as never);
		await flush();
		h.observer()?.update(upsert(piAgent()));
		h.observer()?.update(upsert(piAgent({ status: "running" })));
		expect(h.pills[0]!.update).toHaveBeenLastCalledWith({ disabled: true });
		h.observer()?.update(upsert(piAgent({ status: "idle" })));
		expect(h.pills[0]!.update).toHaveBeenLastCalledWith({ disabled: false });
	});

	it("re-scopes moved agents and removes deleted ones", async () => {
		const h = harness();
		contributeReloadComposerPills(h.client as never);
		await flush();
		h.observer()?.update(upsert(piAgent()));
		h.observer()?.update(upsert(piAgent({ workspaceId: "w2" })));
		expect(h.pills[0]!.remove).toHaveBeenCalledOnce();
		expect(h.pills[1]!.workspaceId).toBe("w2");
		h.observer()?.update({ type: "agent_update", payload: { kind: "remove", agentId: "a" } });
		expect(h.pills[1]!.remove).toHaveBeenCalledOnce();
	});

	it("makes cleanup idempotent", async () => {
		const h = harness();
		const cleanup = contributeReloadComposerPills(h.client as never);
		await flush();
		h.observer()?.update(upsert(piAgent()));
		cleanup();
		cleanup();
		expect(h.pills[0]!.remove).toHaveBeenCalledOnce();
	});
});
