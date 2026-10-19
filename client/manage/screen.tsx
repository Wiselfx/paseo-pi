import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ModelsTab } from "./models";
import { OverviewTab } from "./overview";
import { PromptTab } from "./prompt";
import { ResourcesTab } from "./resources";
import { SessionsTab } from "./sessions";
import { SettingsTab } from "./settings";
import { useStyles } from "./shared";

type TabId = "overview" | "resources" | "models" | "prompt" | "sessions" | "settings";

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
	{ id: "overview", label: "Overview" },
	{ id: "resources", label: "Extensions & skills" },
	{ id: "models", label: "Providers & models" },
	{ id: "prompt", label: "Prompt" },
	{ id: "sessions", label: "Sessions" },
	{ id: "settings", label: "Settings" },
];

function isTab(value: string | undefined): value is TabId {
	return TABS.some((tab) => tab.id === value);
}

export function PiManageScreen({
	theme,
	params,
	openSettings,
}: PluginScreenProps & { openSettings(): void }) {
	const styles = useStyles(theme);
	const initial = isTab(params.tab) ? params.tab : "overview";
	const [tab, setTab] = useState<TabId>(initial);
	useEffect(() => {
		if (isTab(params.tab)) setTab(params.tab);
	}, [params.tab]);
	const content = useMemo(() => {
		switch (tab) {
			case "resources":
				return <ResourcesTab styles={styles} />;
			case "models":
				return <ModelsTab styles={styles} />;
			case "prompt":
				return <PromptTab styles={styles} />;
			case "sessions":
				return <SessionsTab styles={styles} />;
			case "settings":
				return <SettingsTab styles={styles} />;
			default:
				return <OverviewTab styles={styles} theme={theme} onOpenSettings={openSettings} onTab={setTab} />;
		}
	}, [openSettings, styles, tab, theme]);

	return (
		<View style={{ flex: 1, gap: 10 }}>
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				style={{ flexGrow: 0, flexShrink: 0 }}
				contentContainerStyle={{ gap: 16, paddingBottom: 2 }}
			>
				{TABS.map((entry) => (
					<Pressable
						key={entry.id}
						onPress={() => setTab(entry.id)}
						style={[styles.tab, tab === entry.id ? styles.tabActive : null]}
					>
						<Text style={tab === entry.id ? styles.tabTextActive : styles.tabText}>{entry.label}</Text>
					</Pressable>
				))}
			</ScrollView>
			<ScrollView
				style={{ flex: 1 }}
				contentContainerStyle={styles.page}
				keyboardShouldPersistTaps="handled"
			>
				{content}
			</ScrollView>
		</View>
	);
}
