import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { piRefreshRpc, piStatusRpc, type PiStatus } from "../../shared/rpc";
import { Button, Card, Notice, type ManageStyles, type ManageTheme } from "./shared";

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

	return (
		<>
			<Card
				styles={styles}
				title="Pi on this host"
				trailing={
					<View style={styles.row}>
						{busy ? <ActivityIndicator size="small" color={theme.colors.accent} /> : null}
						{status ? (
							<Text style={status.available ? styles.ok : styles.error}>
								{status.available ? "ready" : "unavailable"}
							</Text>
						) : null}
					</View>
				}
			>
				<Notice styles={styles} message={error} tone="error" />
				{status ? (
					<>
						<View style={styles.row}>
							<Text style={styles.mono}>{status.command}</Text>
							<Text style={styles.muted}>{status.version ? `v${status.version}` : "version unknown"}</Text>
						</View>
						{status.diagnostic && (!status.available || status.diagnostic !== `pi ${status.version}`) ? (
							<Notice styles={styles} message={status.diagnostic} tone="warning" />
						) : null}
						<View style={styles.between}>
							<Text style={styles.label}>Models</Text>
							<Text style={styles.text}>{status.modelCount}</Text>
						</View>
						<View style={{ gap: 3 }}>
							<Text style={styles.label}>Sessions</Text>
							<Text style={styles.mono}>{status.sessionDir}</Text>
						</View>
						<View style={{ gap: 3 }}>
							<Text style={styles.label}>Agent directory</Text>
							<Text style={styles.mono}>{status.configDir}</Text>
						</View>
					</>
				) : null}
				<View style={styles.wrap}>
					<Button styles={styles} label="Refresh" onPress={() => void load(true)} disabled={busy} />
					<Button styles={styles} label="Launch settings" onPress={onOpenSettings} />
					<Button styles={styles} label="Manage resources" onPress={() => onTab("resources")} />
				</View>
			</Card>

			<Card styles={styles} title="Management surface">
				<Text style={styles.muted}>
					Extensions and skills install into pi's own agent directory. Providers and models live in models.json.
					The prompt files are SYSTEM.md and APPEND_SYSTEM.md. Sessions are the JSONL files pi writes.
				</Text>
				<View style={styles.wrap}>
					<Button styles={styles} label="Providers & models" onPress={() => onTab("models")} />
					<Button styles={styles} label="Prompt" onPress={() => onTab("prompt")} />
					<Button styles={styles} label="Sessions" onPress={() => onTab("sessions")} />
					<Button styles={styles} label="Settings" onPress={() => onTab("settings")} />
				</View>
			</Card>

			{status && status.models.length > 0 ? (
				<Card styles={styles} title="Model catalog">
					{status.models.map((model) => (
						<View key={model.id} style={[styles.item, styles.between]}>
							<View style={{ flex: 1, gap: 2 }}>
								<Text style={styles.text}>{model.label}</Text>
								<Text style={styles.mono}>{model.id}</Text>
							</View>
							<View style={{ alignItems: "flex-end" as const, gap: 2 }}>
								{model.reasoning ? <Text style={styles.label}>reasoning</Text> : null}
								{model.contextWindow ? (
									<Text style={styles.muted}>{Math.round(model.contextWindow / 1000)}k</Text>
								) : null}
							</View>
						</View>
					))}
				</Card>
			) : null}
		</>
	);
}
