import { type PluginSurfaceProps, useRpc } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import { piRefreshRpc, piStatusRpc, type PiStatus } from "../shared/rpc";

type Props = PluginSurfaceProps & {
	openSettings(): void;
};

export function PiScreen({ theme, openSettings }: Props) {
	const [status, setStatus] = useState<PiStatus | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const statusRpc = useRpc(piStatusRpc);
	const refreshRpc = useRpc(piRefreshRpc);

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
		// The screen's data is a host probe, not a subscription.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const styles = useMemo(
		() => ({
			page: { gap: 16, paddingBottom: 32 },
			card: {
				borderWidth: 1,
				borderColor: theme.colors.border,
				backgroundColor: theme.colors.surface1,
				borderRadius: 12,
				padding: 16,
				gap: 10,
			},
			row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
			title: { color: theme.colors.foreground, fontSize: 17, fontWeight: "600" as const },
			label: { color: theme.colors.foregroundMuted, fontSize: 12, letterSpacing: 0.4 },
			value: { color: theme.colors.foreground, fontSize: 14 },
			mono: {
				color: theme.colors.foreground,
				fontSize: 13,
				fontFamily: "monospace",
			},
			muted: { color: theme.colors.foregroundMuted, fontSize: 13 },
			ok: { color: theme.colors.statusSuccess, fontSize: 13, fontWeight: "600" as const },
			bad: { color: theme.colors.statusDanger, fontSize: 13, fontWeight: "600" as const },
			warn: { color: theme.colors.statusWarning, fontSize: 13 },
			button: {
				borderWidth: 1,
				borderColor: theme.colors.border,
				borderRadius: 8,
				paddingVertical: 8,
				paddingHorizontal: 12,
			},
			buttonText: { color: theme.colors.foreground, fontSize: 13 },
			primary: { backgroundColor: theme.colors.accent, borderColor: theme.colors.accent },
			primaryText: { color: theme.colors.accentForeground, fontSize: 13, fontWeight: "600" as const },
			model: {
				flexDirection: "row" as const,
				justifyContent: "space-between" as const,
				gap: 12,
				paddingVertical: 5,
				borderTopWidth: 1,
				borderTopColor: theme.colors.border,
			},
			badge: {
				color: theme.colors.foregroundMuted,
				fontSize: 11,
				textTransform: "uppercase" as const,
				letterSpacing: 0.5,
			},
		}),
		[theme],
	);

	return (
		<View style={styles.page}>
			<View style={styles.card}>
				<View style={styles.row}>
					<Text style={styles.title}>Pi on this host</Text>
					{status ? (
						<Text style={status.available ? styles.ok : styles.bad}>
							{status.available ? "ready" : "unavailable"}
						</Text>
					) : null}
					{busy ? <ActivityIndicator size="small" color={theme.colors.accent} /> : null}
				</View>
				{error ? <Text style={styles.bad}>{error}</Text> : null}
				{status ? (
					<>
						<Text style={styles.mono}>{status.command}</Text>
						<Text style={styles.value}>{status.version ? `pi ${status.version}` : "version unknown"}</Text>
						{status.diagnostic ? <Text style={styles.muted}>{status.diagnostic}</Text> : null}
						<View style={{ gap: 4 }}>
							<Text style={styles.label}>MODELS</Text>
							<Text style={styles.value}>{status.modelCount} configured</Text>
						</View>
						<View style={{ gap: 4 }}>
							<Text style={styles.label}>SESSIONS</Text>
							<Text style={styles.mono}>{status.sessionDir}</Text>
						</View>
						<View style={{ gap: 4 }}>
							<Text style={styles.label}>CONFIG</Text>
							<Text style={styles.mono}>{status.configDir}</Text>
						</View>
					</>
				) : null}
				<View style={[styles.row, { flexWrap: "wrap" as const }]}>
					<Pressable style={styles.button} onPress={() => void load(true)} disabled={busy}>
						<Text style={styles.buttonText}>Refresh</Text>
					</Pressable>
					<Pressable style={styles.button} onPress={openSettings}>
						<Text style={styles.buttonText}>Launch settings</Text>
					</Pressable>
				</View>
			</View>

			{status && status.models.length > 0 ? (
				<View style={styles.card}>
					<Text style={styles.title}>Model catalog</Text>
					{status.models.map((model) => (
						<View key={model.id} style={styles.model}>
							<View style={{ flex: 1, gap: 2 }}>
								<Text style={styles.value}>{model.label}</Text>
								<Text style={styles.mono}>{model.id}</Text>
							</View>
							<View style={{ alignItems: "flex-end" as const, gap: 2 }}>
								{model.reasoning ? <Text style={styles.badge}>reasoning</Text> : null}
								{model.contextWindow ? (
									<Text style={styles.muted}>{Math.round(model.contextWindow / 1000)}k</Text>
								) : null}
							</View>
						</View>
					))}
				</View>
			) : null}
		</View>
	);
}
