import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { ModelsTab } from "./models";
import { OverviewTab } from "./overview";
import { ProfilesTab } from "./profiles";
import { ProjectTab } from "./project";
import { PromptTab } from "./prompt";
import { ResourcesTab } from "./resources";
import { SessionsTab } from "./sessions";
import { SettingsTab } from "./settings";
import { useStyles } from "./shared";

type TabId = "overview" | "profiles" | "resources" | "models" | "prompt" | "project" | "sessions" | "settings";

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
	{ id: "overview", label: "Overview" },
	{ id: "profiles", label: "Profiles" },
	{ id: "resources", label: "Extensions & skills" },
	{ id: "models", label: "Providers & models" },
	{ id: "prompt", label: "Prompt" },
	{ id: "project", label: "Project" },
	{ id: "sessions", label: "Sessions" },
	{ id: "settings", label: "Settings" },
];

function isTab(value: string | undefined): value is TabId {
	return TABS.some((tab) => tab.id === value);
}

export function PiManageScreen({
	theme,
	params,
	layout,
	openSettings,
}: PluginScreenProps & { openSettings(): void }) {
	const styles = useStyles(theme, layout.compact);
	const initial = isTab(params.tab) ? params.tab : "overview";
	const [tab, setTab] = useState<TabId>(initial);
	const [profileEpoch, setProfileEpoch] = useState(0);
	const [focusedTab, setFocusedTab] = useState<TabId | null>(null);
	const tabScroll = useRef<ScrollView>(null);
	const pageScroll = useRef<ScrollView>(null);
	const tabOffsets = useRef<Partial<Record<TabId, number>>>({});
	const revealTab = (id: TabId) => {
		const x = tabOffsets.current[id];
		if (x !== undefined) tabScroll.current?.scrollTo({ x: Math.max(0, x - 16), animated: true });
	};
	useEffect(() => {
		if (isTab(params.tab)) setTab(params.tab);
	}, [params.tab]);
	useEffect(() => {
		revealTab(tab);
		pageScroll.current?.scrollTo({ y: 0, animated: false });
	}, [tab]);
	const content = useMemo(() => {
		switch (tab) {
			case "profiles":
				return <ProfilesTab styles={styles} onProfileChanged={() => setProfileEpoch((value) => value + 1)} />;
			case "resources":
				return <ResourcesTab key={profileEpoch} styles={styles} />;
			case "models":
				return <ModelsTab key={profileEpoch} styles={styles} />;
			case "prompt":
				return <PromptTab key={profileEpoch} styles={styles} />;
			case "project":
				return <ProjectTab key={profileEpoch} styles={styles} />;
			case "sessions":
				return <SessionsTab key={profileEpoch} styles={styles} />;
			case "settings":
				return <SettingsTab key={profileEpoch} styles={styles} />;
			default:
				return (
					<OverviewTab
						key={profileEpoch}
						styles={styles}
						theme={theme}
						onOpenSettings={openSettings}
						onTab={setTab}
					/>
				);
		}
	}, [openSettings, profileEpoch, styles, tab, theme]);

	return (
		<View style={{ flex: 1 }}>
			<View style={styles.tabBar}>
				<ScrollView
					ref={tabScroll}
					horizontal
					showsHorizontalScrollIndicator={false}
					style={{ flexGrow: 0, flexShrink: 0 }}
					contentContainerStyle={styles.tabBarContent}
				>
					{TABS.map((entry) => (
						<Pressable
							key={entry.id}
							accessibilityRole="tab"
							accessibilityState={{ selected: tab === entry.id }}
							aria-selected={tab === entry.id}
							focusable
							onPress={() => {
								if (entry.id === tab) {
									pageScroll.current?.scrollTo({ y: 0, animated: true });
									return;
								}
								setTab(entry.id);
							}}
							onFocus={() => setFocusedTab(entry.id)}
							onBlur={() => setFocusedTab(null)}
							onLayout={(event) => {
								tabOffsets.current[entry.id] = event.nativeEvent.layout.x;
								if (entry.id === tab) revealTab(entry.id);
							}}
							style={[
								styles.tab,
								focusedTab === entry.id ? styles.tabFocused : null,
								tab === entry.id ? styles.tabActive : null,
							]}
						>
							<Text style={tab === entry.id ? styles.tabTextActive : styles.tabText}>
								{entry.label}
							</Text>
						</Pressable>
					))}
				</ScrollView>
			</View>
			<ScrollView
				ref={pageScroll}
				style={{ flex: 1 }}
				contentContainerStyle={styles.scroll}
				keyboardShouldPersistTaps="handled"
			>
				<View style={styles.page}>{content}</View>
			</ScrollView>
		</View>
	);
}
