import { useRpc } from "@getpaseo/plugin/client";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import {
	piAddExtensionRpc,
	piCreateSkillRpc,
	piDeleteSkillRpc,
	piInstallPackageRpc,
	piListResourcesRpc,
	piSetBuiltinExtensionRpc,
	piUpdatePackageRpc,
	piRemoveExtensionRpc,
	piRemovePackageRpc,
	type PiExtensionEntry,
	type PiSkillEntry,
} from "../../shared/management";
import {
	Badge,
	Button,
	Card,
	ConfirmButton,
	Field,
	Notice,
	TextField,
	TextArea,
	type ManageStyles,
} from "./shared";

export function ResourcesTab({ styles }: { styles: ManageStyles }) {
	const listRpc = useRpc(piListResourcesRpc);
	const installRpc = useRpc(piInstallPackageRpc);
	const removeRpc = useRpc(piRemovePackageRpc);
	const addExtensionRpc = useRpc(piAddExtensionRpc);
	const removeExtensionRpc = useRpc(piRemoveExtensionRpc);
	const setBuiltinRpc = useRpc(piSetBuiltinExtensionRpc);
	const updateRpc = useRpc(piUpdatePackageRpc);
	const createRpc = useRpc(piCreateSkillRpc);
	const deleteRpc = useRpc(piDeleteSkillRpc);

	const [extensions, setExtensions] = useState<PiExtensionEntry[]>([]);
	const [skills, setSkills] = useState<PiSkillEntry[]>([]);
	const [agentDir, setAgentDir] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [source, setSource] = useState("");
	const [extensionPath, setExtensionPath] = useState("");
	const [showSkillForm, setShowSkillForm] = useState(false);
	const [skillName, setSkillName] = useState("");
	const [skillDescription, setSkillDescription] = useState("");
	const [skillInstructions, setSkillInstructions] = useState("");

	const load = async () => {
		setLoading(true);
		setError(null);
		try {
			const data = await listRpc({});
			setExtensions(data.extensions);
			setSkills(data.skills);
			setAgentDir(data.agentDir);
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void load();
		// Loaded once on mount; mutations reload explicitly.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const run = async (action: () => Promise<string | void>) => {
		setBusy(true);
		setError(null);
		setNotice(null);
		try {
			const result = await action();
			if (typeof result === "string" && result) setNotice(result);
			await load();
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		} finally {
			setBusy(false);
		}
	};

	const packages = extensions.filter((entry) => entry.kind === "package");
	const configured = extensions.filter((entry) => entry.kind === "extension");
	const builtins = extensions.filter((entry) => entry.kind === "builtin");

	const addExtension = () =>
		void run(async () => {
			const added = await addExtensionRpc({ path: extensionPath });
			setExtensionPath("");
			return `Added ${added.path}. New sessions load it.`;
		});

	const install = () =>
		void run(async () => {
			const result = await installRpc({ source });
			setSource("");
			return result.output || "Package installed.";
		});

	const createSkill = () =>
		void run(async () => {
			const created = await createRpc({
				name: skillName.trim(),
				description: skillDescription.trim(),
				instructions: skillInstructions,
			});
			setSkillName("");
			setSkillDescription("");
			setSkillInstructions("");
			setShowSkillForm(false);
			return `Skill written to ${created.path}`;
		});

	return (
		<>
			<Card
				styles={styles}
				title="Extensions & packages"
				trailing={
					<View style={styles.wrap}>
						<Button
							styles={styles}
							label="Update packages"
							disabled={busy}
							onPress={() =>
								void run(async () => {
									const result = await updateRpc({});
									return result.output || "Packages updated.";
								})
							}
						/>
						<Text style={styles.muted}>{extensions.length}</Text>
					</View>
				}
			>
				<Text style={styles.muted}>
					Packages install through pi's own installer, so npm and git sources are reconciled exactly as they
					would be from a terminal. Agent directory: {agentDir}
				</Text>
				<Field styles={styles} label="Install package" hint="npm:package, git:host/repo, https or ssh URL, or ./local-package (relative to the agent directory)">
					<View style={styles.row}>
						<View style={{ flex: 1 }}>
							<TextField
								styles={styles}
								value={source}
								onChangeText={setSource}
								placeholder="npm:pi-tools"
							/>
						</View>
						<Button
							styles={styles}
							label={busy ? "Working..." : "Install"}
							primary
							disabled={busy || !source.trim()}
							onPress={install}
						/>
					</View>
				</Field>
				<Field styles={styles} label="Add extension path" hint="A TypeScript or JavaScript file, or an extension directory.">
					<View style={styles.row}>
						<View style={{ flex: 1 }}>
							<TextField
								styles={styles}
								value={extensionPath}
								onChangeText={setExtensionPath}
								placeholder="/home/me/.pi/extensions/my-extension.ts"
							/>
						</View>
						<Button
							styles={styles}
							label="Add extension"
							disabled={busy || !extensionPath.trim()}
							onPress={addExtension}
						/>
					</View>
				</Field>
				<Notice styles={styles} message={error} tone="error" />
				<Notice styles={styles} message={notice} tone="ok" />
				{loading ? <Text style={styles.muted}>Reading pi resources...</Text> : null}

				{packages.length > 0 ? (
					<View style={{ gap: 10 }}>
						<Text style={styles.sectionLabel}>Packages</Text>
						{packages.map((entry) => (
							<View key={entry.id} style={[styles.item, styles.between]}>
								<View style={{ flex: 1, gap: 2 }}>
									<View style={styles.wrap}>
										<Text style={styles.text}>{entry.label}</Text>
										{entry.version ? <Badge styles={styles} label={entry.version} /> : null}
										{entry.note ? <Badge styles={styles} label={entry.note} /> : null}
									</View>
									<Text style={styles.mono}>{entry.source}</Text>
									{entry.path ? <Text style={styles.muted}>{entry.path}</Text> : null}
								</View>
								{entry.removable ? (
									<View style={styles.wrap}>
										<Button
											styles={styles}
											label="Update"
											disabled={busy}
											onPress={() =>
												void run(async () => {
													const result = await updateRpc({ source: entry.source });
													return result.output || `Updated ${entry.source}.`;
												})
											}
										/>
										<ConfirmButton
											styles={styles}
											label="Remove"
											confirmLabel="Confirm remove"
											disabled={busy}
											onConfirm={() =>
												void run(async () => {
													const result = await removeRpc({ source: entry.source });
													return result.output || `Removed ${entry.source}.`;
												})
											}
										/>
									</View>
								) : null}
							</View>
						))}
					</View>
				) : null}

				{configured.length > 0 ? (
					<View style={{ gap: 10 }}>
						<Text style={styles.sectionLabel}>Extensions</Text>
						{configured.map((entry) => (
							<View key={entry.id} style={[styles.item, styles.between]}>
								<View style={{ flex: 1, gap: 2 }}>
									<View style={styles.between}>
										<Text style={styles.text}>{entry.label}</Text>
										<Badge styles={styles} label={entry.removable ? "configured" : "discovered"} />
									</View>
									<Text style={styles.mono}>{entry.path ?? entry.source}</Text>
									{entry.note ? <Text style={styles.muted}>{entry.note}</Text> : null}
								</View>
								{entry.removable ? (
									<ConfirmButton
										styles={styles}
										label="Remove"
										confirmLabel="Confirm remove"
										disabled={busy}
										onConfirm={() =>
											void run(async () => {
												await removeExtensionRpc({ path: entry.source });
												return `Removed ${entry.source}.`;
											})
										}
									/>
								) : null}
							</View>
						))}
					</View>
				) : null}

				<View style={{ gap: 8 }}>
					<Text style={styles.sectionLabel}>Built-in extensions</Text>
					<View style={styles.wrap}>
						{builtins.map((entry) => (
							<Button
								key={entry.id}
								styles={styles}
								label={`${entry.enabled ? "Disable" : "Enable"} ${entry.label}`}
								disabled={busy}
								onPress={() =>
									void run(async () => {
										await setBuiltinRpc({
											name: entry.label as "mcp" | "llama.cpp" | "codemode" | "tool-search",
											enabled: !entry.enabled,
										});
										return `${entry.label} ${entry.enabled ? "disabled" : "enabled"}. New sessions use the change.`;
									})
								}
							/>
						))}
					</View>
					<Text style={styles.muted}>Changes apply to new sessions; a running session keeps its loaded extensions.</Text>
				</View>
			</Card>

			<Card
				styles={styles}
				title="Skills"
				trailing={
					<Button
						styles={styles}
						label={showSkillForm ? "Close" : "New skill"}
						onPress={() => setShowSkillForm((value) => !value)}
					/>
				}
			>
				{showSkillForm ? (
					<View style={{ gap: 10 }}>
						<Field styles={styles} label="Name" hint="Lowercase letters, numbers, and hyphens.">
							<TextField styles={styles} value={skillName} onChangeText={setSkillName} placeholder="my-skill" />
						</Field>
						<Field styles={styles} label="Description" hint="What it does and when the model should use it.">
							<TextField
								styles={styles}
								value={skillDescription}
								onChangeText={setSkillDescription}
								placeholder="Extract tables from PDF files."
								autoCapitalize="sentences"
							/>
						</Field>
						<Field styles={styles} label="Instructions">
							<TextArea
								styles={styles}
								value={skillInstructions}
								onChangeText={setSkillInstructions}
								placeholder="# My skill&#10;&#10;Steps the model should follow."
							/>
						</Field>
						<View style={styles.wrap}>
							<Button
								styles={styles}
								label="Create skill"
								primary
								disabled={busy || !skillName.trim() || !skillDescription.trim()}
								onPress={createSkill}
							/>
						</View>
					</View>
				) : null}

				{!loading && skills.length === 0 ? (
					<Text style={styles.muted}>No skills were found in the agent or ~/.agents skill directories.</Text>
				) : null}
				{skills.map((skill) => (
					<View key={skill.path} style={[styles.item, styles.between]}>
						<View style={{ flex: 1, gap: 3 }}>
							<View style={styles.wrap}>
								<Text style={styles.text}>{skill.name}</Text>
								<Badge styles={styles} label={skill.source} />
							</View>
							{skill.description ? <Text style={styles.muted}>{skill.description}</Text> : null}
							<Text style={styles.mono}>{skill.path}</Text>
						</View>
						{skill.removable ? (
							<ConfirmButton
								styles={styles}
								label="Remove"
								confirmLabel="Confirm remove"
								disabled={busy}
								onConfirm={() =>
									void run(async () => {
										await deleteRpc({ path: skill.path });
										return `Removed ${skill.name}.`;
									})
								}
							/>
						) : (
							<Badge styles={styles} label={skill.source} />
						)}
					</View>
				))}
			</Card>
		</>
	);
}
