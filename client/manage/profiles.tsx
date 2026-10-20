import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { View } from "react-native";
import {
	piPrepareProfileRpc,
	piProfileInfoRpc,
	piRemoveProfileProviderRpc,
	type PiProfileEntry,
} from "../../shared/management";
import { piSettings } from "../../shared/settings";
import {
	Badge,
	Button,
	Card,
	ConfirmButton,
	EmptyState,
	Field,
	Notice,
	Row,
	Section,
	TextField,
	type ManageStyles,
} from "./shared";

export function ProfilesTab({
	styles,
	onProfileChanged,
}: {
	styles: ManageStyles;
	onProfileChanged(): void;
}) {
	const settings = useSettings(piSettings);
	const infoRpc = useRpc(piProfileInfoRpc);
	const prepareRpc = useRpc(piPrepareProfileRpc);
	const removeRpc = useRpc(piRemoveProfileProviderRpc);
	const [defaultDir, setDefaultDir] = useState("");
	const [defaultSessionDir, setDefaultSessionDir] = useState("");
	const [showCreate, setShowCreate] = useState(false);
	const [name, setName] = useState("");
	const [agentDir, setAgentDir] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);

	useEffect(() => {
		void infoRpc({})
			.then((info) => {
				setDefaultDir(info.defaultAgentDir);
				setDefaultSessionDir(info.defaultSessionDir);
			})
			.catch((failure: unknown) => {
				setError(failure instanceof Error ? failure.message : String(failure));
			});
		// The default directories do not change while this screen is open.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	if (settings.status === "loading") {
		return (
			<Section styles={styles} title="Profiles">
				<Card styles={styles}>
					<EmptyState styles={styles} title="Loading profiles…" />
				</Card>
			</Section>
		);
	}
	if (settings.status === "error" || settings.status === "invalid") {
		return (
			<Section styles={styles} title="Profiles">
				<Card styles={styles}>
					<EmptyState styles={styles} title="Could not load profiles" hint={settings.error} />
				</Card>
			</Section>
		);
	}

	const values = settings.values;
	const profiles = values.profiles.map(profileFromSettings);
	const active = profiles.find((profile) => profile.name === values.managedProfile);

	const saveSettings = async (next: typeof values, message: string) => {
		const saved = await settings.save(next, settings.revision);
		if (saved) {
			setNotice(message);
			onProfileChanged();
		}
		return saved;
	};

	const manage = async (profile: PiProfileEntry | null) => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			await saveSettings(
				{ ...values, managedProfile: profile?.name ?? "" },
				profile
					? `This panel now manages ${profile.label}. New sessions that select ${profile.providerId} use the same directory.`
					: "This panel now manages the default pi agent directory.",
			);
		} finally {
			setBusy(false);
		}
	};

	const create = async () => {
		setBusy(true);
		setError(null);
		setNotice(null);
		let prepared: PiProfileEntry | null = null;
		try {
			prepared = await prepareRpc({
				name: name.trim(),
				...(agentDir.trim() ? { agentDir: agentDir.trim() } : {}),
			});
			const next = {
				...values,
				profiles: [...profiles.filter((entry) => entry.name !== prepared?.name), prepared],
				managedProfile: prepared.name,
			};
			const saved = await settings.save(next, settings.revision);
			if (!saved) {
				await removeRpc({ name: prepared.name });
				return;
			}
			setName("");
			setAgentDir("");
			setShowCreate(false);
			setNotice(`Created ${prepared.label}. Select it when creating a new Paseo agent.`);
			onProfileChanged();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setBusy(false);
		}
	};

	const remove = async (profile: PiProfileEntry) => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			const next = {
				...values,
				profiles: profiles.filter((entry) => entry.name !== profile.name),
				managedProfile: values.managedProfile === profile.name ? "" : values.managedProfile,
			};
			if (!(await settings.save(next, settings.revision))) return;
			await removeRpc({ name: profile.name });
			setNotice(`Removed ${profile.label} from Paseo. Its agent directory was left in place.`);
			onProfileChanged();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			<Notice styles={styles} message={error ?? settings.saveError} tone="error" />
			<Notice styles={styles} message={notice} tone="ok" />

			<Section
				styles={styles}
				title="Profiles"
				hint="Named agent directories appear in Paseo as separate Pi providers. Each profile has its own settings, models, skills, extensions, prompts, and sessions."
				trailing={
					<Button
						styles={styles}
						label={showCreate ? "Close" : "New profile"}
						variant="outline"
						onPress={() => setShowCreate((value) => !value)}
					/>
				}
			>
				{showCreate ? (
					<Card styles={styles}>
						<View style={styles.form}>
							<Field
								styles={styles}
								label="Name"
								hint="Lowercase letters, numbers, and hyphens. The provider appears as Pi · name."
							>
								<TextField
									styles={styles}
									value={name}
									onChangeText={setName}
									placeholder="work"
									autoCapitalize="none"
								/>
							</Field>
							<Field
								styles={styles}
								label="Agent directory"
								hint={
									name.trim()
										? `Leave empty for ~/.pi/profiles/${name.trim()}/agent.`
										: "Leave empty to use ~/.pi/profiles/<name>/agent."
								}
							>
								<TextField
									styles={styles}
									value={agentDir}
									onChangeText={setAgentDir}
									placeholder="/home/me/.pi/profiles/work/agent"
									autoCapitalize="none"
								/>
							</Field>
							<View style={styles.formFooter}>
								<Button
									styles={styles}
									label="Create profile"
									variant="primary"
									loading={busy}
									disabled={!name.trim()}
									onPress={() => void create()}
								/>
								<Button
									styles={styles}
									label="Cancel"
									variant="ghost"
									onPress={() => setShowCreate(false)}
								/>
							</View>
						</View>
					</Card>
				) : null}

				<Card styles={styles}>
					<Row
						styles={styles}
						stack
						title="Default"
						hint="Paseo's built-in pi provider. It uses the daemon's own PI_CODING_AGENT_DIR or ~/.pi/agent."
						mono={defaultDir || undefined}
						badges={!active ? <Badge styles={styles} label="managing" /> : null}
						actions={
							<Button
								styles={styles}
								label={!active ? "Managing" : "Manage"}
								variant={!active ? "ghost" : "outline"}
								disabled={busy || !active}
								onPress={() => void manage(null)}
							/>
						}
					/>
					{profiles.length === 0 ? (
						<EmptyState
							styles={styles}
							title="No named profiles"
							hint="Create one to keep a separate Pi configuration and session history."
							action={
								<Button
									styles={styles}
									label="New profile"
									variant="outline"
									onPress={() => setShowCreate(true)}
								/>
							}
						/>
					) : (
						profiles.map((profile) => {
							const selected = values.managedProfile === profile.name;
							return (
								<Row
									key={profile.name}
									styles={styles}
									stack
									title={profile.label}
									hint="Its own settings, models, skills, extensions, prompts, and session history."
									mono={profile.agentDir}
									badges={
										<>
											<Badge styles={styles} label={profile.providerId} />
											{selected ? <Badge styles={styles} label="managing" /> : null}
										</>
									}
									actions={
										<>
											<Button
												styles={styles}
												label={selected ? "Managing" : "Manage"}
												variant={selected ? "ghost" : "outline"}
												disabled={busy || selected}
												onPress={() => void manage(profile)}
											/>
											<ConfirmButton
												styles={styles}
												label="Remove"
												confirmLabel="Confirm remove"
												disabled={busy}
												onConfirm={() => void remove(profile)}
											/>
										</>
									}
								/>
							);
						})
					)}
				</Card>
			</Section>

			<Section styles={styles} title="Sessions">
				<Card styles={styles}>
					<Row
						styles={styles}
						title="Default session directory"
						hint="When a profile is active, its sessions stay under its agent directory."
						mono={defaultSessionDir || undefined}
					/>
					<Row
						styles={styles}
						title="Selecting a profile in Paseo"
						hint="Choose Pi · <name> as the provider when creating an agent. Existing agents keep the provider they were created with."
					/>
				</Card>
			</Section>
		</>
	);
}

function profileFromSettings(profile: { name: string; agentDir: string }): PiProfileEntry {
	return {
		...profile,
		providerId: `pi-${profile.name}`,
		label: `Pi · ${profile.name}`,
	};
}

