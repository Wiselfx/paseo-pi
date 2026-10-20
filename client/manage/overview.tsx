import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { piRefreshRpc, piStatusRpc, type PiStatus } from "../../shared/rpc";
import {
	ActionRow,
	Badge,
	Button,
	Card,
	Notice,
	Row,
	Section,
	StatusDot,
	type ManageStyles,
	type ManageTheme,
} from "./shared";

export function OverviewTab({
	styles,
	theme,
	onOpenSettings,
	onTab,
}: {
	styles: ManageStyles;
	theme: ManageTheme;
	onOpenSettings(): void;
	onTab(tab: "resources" | "models" | "prompt" | "sessions" | "settings"): void;
}) {
	const statusRpc = useRpc(piStatusRpc);
	const refreshRpc = useRpc(piRefreshRpc);
	const [status, setStatus] = useState<PiStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	const load = async (refresh = false) => {
		setBusy(true);
		setError(null);
		try {
			if (refresh) await refreshRpc({});
			setStatus(await statusRpc({}));
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setBusy(false);
		}
	};

	useEffect(() => {
		void load();
		// The status is a host probe, not a subscription.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const ready = status?.available === true;
	const title = status
		? ready
			? "Pi is ready"
			: "Pi is unavailable"
		: busy
			? "Checking pi…"
			: "Pi is unavailable";

	return (
		<>
			<Notice styles={styles} message={error} tone="error" />

			<Section
				styles={styles}
				title="Status"
				trailing={
					<Button
						styles={styles}
						label={busy ? "Refreshing…" : "Refresh"}
						onPress={() => void load(true)}
						disabled={busy}
					/>
				}
			>
				<Card styles={styles}>
					<View style={styles.hero}>
						<View style={styles.heroLine}>
							{status ? (
								<StatusDot styles={styles} tone={ready ? "ok" : "error"} />
							) : busy ? (
								<ActivityIndicator size="small" color={theme.colors.accent} />
							) : (
								<StatusDot styles={styles} tone="error" />
							)}
							<Text style={styles.heroTitle}>{title}</Text>
						</View>
						<Text style={styles.heroHint}>
							{status
								? `${status.command}${status.version ? ` · version ${status.version}` : ""}`
								: "Running the configured command on this host."}
						</Text>
					</View>
					{status ? (
						<>
							<Row
								styles={styles}
								title="Models"
								hint="Configured for pi"
								actions={<Text style={styles.text}>{status.modelCount}</Text>}
							/>
							<Row styles={styles} title="Sessions" mono={status.sessionDir} />
							<Row styles={styles} title="Agent directory" mono={status.configDir} />
						</>
					) : null}
				</Card>
				{status?.diagnostic && (!ready || status.diagnostic !== `pi ${status.version}`) ? (
					<Notice styles={styles} message={status.diagnostic} tone="warning" />
				) : null}
			</Section>

			<Section styles={styles} title="Manage">
				<Card styles={styles}>
					<ActionRow
						styles={styles}
						title="Extensions & skills"
						hint="Install packages, add extensions, and switch each resource on or off."
						onPress={() => onTab("resources")}
					/>
					<ActionRow
						styles={styles}
						title="Providers & models"
						hint="Edit models.json, add endpoints, and pick the models pi offers."
						onPress={() => onTab("models")}
					/>
					<ActionRow
						styles={styles}
						title="Prompt"
						hint="Add to or replace pi's system prompt."
						onPress={() => onTab("prompt")}
					/>
					<ActionRow
						styles={styles}
						title="Sessions"
						hint="Browse and delete the sessions pi wrote."
						onPress={() => onTab("sessions")}
					/>
					<ActionRow
						styles={styles}
						title="Settings"
						hint="Default model, tools, slash commands, and raw settings.json."
						onPress={() => onTab("settings")}
					/>
					<ActionRow
						styles={styles}
						title="Launch settings"
						hint="Command, arguments, environment, and the /reload command."
						onPress={onOpenSettings}
					/>
				</Card>
			</Section>

			{status && status.models.length > 0 ? (
				<Section styles={styles} title="Models in models.json">
					<Card styles={styles}>
						{status.models.map((model) => (
							<Row
								key={model.id}
								styles={styles}
								title={model.label}
								mono={model.id}
								badges={
									<>
										{model.reasoning ? <Badge styles={styles} label="reasoning" /> : null}
										{model.contextWindow ? (
											<Badge styles={styles} label={`${Math.round(model.contextWindow / 1000)}k ctx`} />
										) : null}
									</>
								}
							/>
						))}
					</Card>
				</Section>
			) : null}
		</>
	);
}
