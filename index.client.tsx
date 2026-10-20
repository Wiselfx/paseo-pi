import type { PluginClientContext, PluginScreenProps, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { PI_SETTINGS_SCREEN_ID } from "./shared/constants";
import { contributeReloadComposerPills } from "./client/reload-pill";
import { PiManageScreen } from "./client/manage/screen";
import { PiSettingsScreen } from "./client/settings-screen";

const LAUNCH_SETTINGS_SCREEN_ID = "pi-launch";

function PiSidebarItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
	return (
		<SidebarRow
			icon="SquareTerminal"
			label="Pi"
			active={currentScreen?.screenId === PI_SETTINGS_SCREEN_ID}
			onPress={() => openScreen({ screenId: PI_SETTINGS_SCREEN_ID })}
		/>
	);
}

export default function contribute(client: PluginClientContext) {
	const removeReloadPills = contributeReloadComposerPills(client);
	const removeSettings = client.addSettingsScreen({
		id: LAUNCH_SETTINGS_SCREEN_ID,
		title: "Pi launch",
		icon: "Settings",
		Component: PiSettingsScreen,
	});
	const removeScreen = client.addScreen({
		id: PI_SETTINGS_SCREEN_ID,
		title: "Pi",
		Component: (props: PluginScreenProps) => (
			<PiManageScreen {...props} openSettings={() => client.openSettings(LAUNCH_SETTINGS_SCREEN_ID)} />
		),
	});
	const removeSidebar = client.addSidebarHeaderItem({
		id: "pi",
		title: "Pi",
		Component: PiSidebarItem,
	});
	const removeOpen = client.addCommandCenterItem({
		id: "pi-open",
		title: "Manage Pi",
		icon: "SquareTerminal",
		keywords: ["pi", "provider", "agent", "models", "extensions", "skills", "sessions", "prompt", "profiles", "project"],
		context: "global",
		onSelect({ openScreen }) {
			openScreen({ screenId: PI_SETTINGS_SCREEN_ID });
		},
	});
	const removeModels = client.addCommandCenterItem({
		id: "pi-models",
		title: "Pi providers & models",
		icon: "Boxes",
		keywords: ["pi", "provider", "models", "models.json", "baseurl", "api key"],
		context: "global",
		onSelect({ openScreen }) {
			openScreen({ screenId: PI_SETTINGS_SCREEN_ID, params: { tab: "models" } });
		},
	});
	const removeProfiles = client.addCommandCenterItem({
		id: "pi-profiles",
		title: "Pi profiles",
		icon: "Users",
		keywords: ["pi", "profiles", "agent directory", "provider", "separate settings"],
		context: "global",
		onSelect({ openScreen }) {
			openScreen({ screenId: PI_SETTINGS_SCREEN_ID, params: { tab: "profiles" } });
		},
	});
	const removeProject = client.addCommandCenterItem({
		id: "pi-project",
		title: "Project Pi settings",
		icon: "FolderCog",
		keywords: ["pi", "project", "settings", "append system", ".pi"],
		context: "global",
		onSelect({ openScreen }) {
			openScreen({ screenId: PI_SETTINGS_SCREEN_ID, params: { tab: "project" } });
		},
	});
	const removeSessions = client.addCommandCenterItem({
		id: "pi-sessions",
		title: "Pi sessions",
		icon: "List",
		keywords: ["pi", "sessions", "history", "delete", "jsonl"],
		context: "global",
		onSelect({ openScreen }) {
			openScreen({ screenId: PI_SETTINGS_SCREEN_ID, params: { tab: "sessions" } });
		},
	});
	const removeConfigure = client.addCommandCenterItem({
		id: "pi-configure",
		title: "Configure Pi launch",
		icon: "Settings",
		keywords: ["pi", "settings", "launch", "command"],
		context: "global",
		onSelect({ openSettings }) {
			openSettings(LAUNCH_SETTINGS_SCREEN_ID);
		},
	});
	return () => {
		removeConfigure();
		removeProject();
		removeProfiles();
		removeSessions();
		removeModels();
		removeOpen();
		removeSidebar();
		removeScreen();
		removeSettings();
		removeReloadPills();
	};
}
