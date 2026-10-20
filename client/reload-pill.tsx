import type {
	PluginButtonRegistration,
	PluginClientContext,
} from "@getpaseo/plugin/client";
import { PI_BUILTIN_PROVIDER_ID, PI_PROVIDER_ID } from "../shared/constants";

type PillAgent = {
	id: string;
	provider?: string | null;
	workspaceId?: string | null;
	status: string;
	archivedAt?: string | null;
};

type PillEntry = {
	workspaceId: string;
	disabled: boolean;
	registration: PluginButtonRegistration;
};

function servesReload(agent: PillAgent): boolean {
	const provider = agent.provider ?? "";
	return (
		provider === PI_BUILTIN_PROVIDER_ID ||
		provider.startsWith(`${PI_BUILTIN_PROVIDER_ID}/`) ||
		provider === PI_PROVIDER_ID ||
		provider.startsWith(`${PI_PROVIDER_ID}/`)
	);
}

function canHostPill(agent: PillAgent): agent is PillAgent & { workspaceId: string } {
	return servesReload(agent) && Boolean(agent.workspaceId) && !agent.archivedAt && agent.status !== "closed";
}

/**
 * Adds a Reload shortcut to every pi composer, built-in or legacy pi-plugin. It sends the same
 * `/reload` the generated extension command answers, so the session reloads its settings, models,
 * extensions and skills without a new session. Requests are answered by a session notice.
 */
export function contributeReloadComposerPills(client: PluginClientContext): () => void {
	const pills = new Map<string, PillEntry>();
	const lifetime = new AbortController();
	let removeObserver: (() => void) | undefined;
	let stopped = false;

	function removePill(agentId: string): void {
		pills.get(agentId)?.registration.remove();
		pills.delete(agentId);
	}

	function syncAgent(agent: PillAgent): void {
		if (stopped) return;
		if (!canHostPill(agent)) {
			removePill(agent.id);
			return;
		}

		const disabled = agent.status === "running";
		const current = pills.get(agent.id);
		if (current?.workspaceId === agent.workspaceId) {
			if (current.disabled !== disabled) {
				current.registration.update({ disabled });
				current.disabled = disabled;
			}
			return;
		}
		removePill(agent.id);

		const agentId = agent.id;
		const registration = client.addComposerPill({
			id: "pi-reload",
			workspaceId: agent.workspaceId,
			agentId,
			button: {
				title: "Reload pi settings, models, extensions and skills",
				label: "Reload",
				icon: "RotateCw",
				disabled,
				behavior: {
					kind: "action",
					async onPress() {
						await client.paseo.agents.ref(agentId).send("/reload");
					},
				},
			},
		});
		pills.set(agentId, { workspaceId: agent.workspaceId, disabled, registration });
	}

	function syncSnapshot(entries: readonly { agent: PillAgent }[]): void {
		if (stopped) return;
		const observed = new Set<string>();
		for (const { agent } of entries) {
			if (canHostPill(agent)) observed.add(agent.id);
			syncAgent(agent);
		}
		for (const agentId of [...pills.keys()]) {
			if (!observed.has(agentId)) removePill(agentId);
		}
	}

	void client.paseo.agents
		.list({
			filter: { includeArchived: false, includeBackground: true },
			subscribe: {},
			signal: lifetime.signal,
		})
		.then(({ subscription }) => {
			if (stopped) return subscription.release();
			removeObserver = subscription.subscribe({
				snapshot: ({ entries }) => syncSnapshot(entries),
				update: (message) => {
					if (message.type !== "agent_update") return;
					const update = message.payload;
					if (update.kind === "remove") removePill(update.agentId);
					else syncAgent(update.agent);
				},
			});
			return undefined;
		})
		.catch((error: unknown) => {
			if (!stopped) console.error("[paseo-pi] composing the reload pill failed", error);
		});

	return () => {
		if (stopped) return;
		stopped = true;
		removeObserver?.();
		lifetime.abort();
		for (const { registration } of pills.values()) registration.remove();
		pills.clear();
	};
}
